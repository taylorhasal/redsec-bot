const { EmbedBuilder } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const DATA_DIR     = require('./dataDir');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');

const FRAGMENT_TIMEOUT_MS = 15 * 60 * 1000; // 15 min

function loadPlayers() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch { return {}; }
}

// Start trackers for every player on every registered team.
// If a player already has a tracker running, upgrade it to a tournament tracker
// instead of skipping them.
async function startTournamentTracking(client, tournament) {
    const {
        loadTrackers, saveTrackers,
        addTrackingRole, extractRedsecSquadSnapshot,
    } = require('./liveTracker');
    const { fetchPlayerStats } = require('./api');

    const trackers = loadTrackers();
    const players  = loadPlayers();
    const guild    = await client.guilds.fetch(tournament.guildId).catch(() => null);
    if (!guild) return;

    for (const [teamId, team] of Object.entries(tournament.teams)) {
        for (const userId of (team.players ?? [])) {
            const player = players[userId];
            if (!player?.eaId) continue;

            const existing = trackers[userId];

            if (existing) {
                // Add tournament fields — preserve personal tracking state
                existing.tournamentId = tournament.id;
                existing.teamId       = teamId;
                continue;
            }

            // Brand-new entry — tournament only (player hasn't opted into personal tracking)
            const data     = await fetchPlayerStats(player.eaId, 'ea').catch(() => null);
            const snapshot = data ? extractRedsecSquadSnapshot(data) : null;

            trackers[userId] = {
                eaId:            player.eaId,
                guildId:         tournament.guildId,
                snapshot,
                personalTracking: false,
                tournamentId:    tournament.id,
                teamId,
                errorStrikes:    0,
                idleStrikes:     0,
                lastDetectedAt:  null,
            };

            const member = await guild.members.fetch(userId).catch(() => null);
            if (member) await addTrackingRole(guild, member);
        }
    }

    saveTrackers(trackers);
}

// Remove tournament enrollment from all trackers in this tournament.
// If a player also has personal tracking active, their entry stays alive for that.
// If a player only had tournament tracking, their entry is deleted and role removed.
async function stopTournamentTracking(client, tournament) {
    const { loadTrackers, saveTrackers, removeTrackingRole } = require('./liveTracker');
    const trackers    = loadTrackers();
    const roleRemove  = [];

    for (const [userId, t] of Object.entries(trackers)) {
        if (t.tournamentId !== tournament.id) continue;

        delete t.tournamentId;
        delete t.teamId;

        if (!t.personalTracking) {
            // No personal tracking running — remove the entry entirely
            roleRemove.push({ userId, guildId: t.guildId });
            delete trackers[userId];
        }
        // If personalTracking: true, keep the entry — it remains a personal tracker
    }

    saveTrackers(trackers);

    for (const { userId, guildId } of roleRemove) {
        if (guildId) await removeTrackingRole(client, guildId, userId).catch(() => {});
    }
}

// Called inside runLiveTrackerTick when a tournament player's game is detected.
// Stores the player's result as a fragment and checks if the full team is now ready.
// The caller is responsible for calling save(tournament) after this returns.
async function handleTournamentDetection(client, tournament, teamId, userId, delta, snapshot) {
    if (!tournament.trackerFragments) tournament.trackerFragments = {};
    if (!tournament.trackerFragments[teamId]) tournament.trackerFragments[teamId] = {};

    tournament.trackerFragments[teamId][userId] = {
        kills:      delta.kills,
        placement:  snapshot.lastPlacement,
        detectedAt: new Date().toISOString(),
    };

    const team        = tournament.teams[teamId];
    const fragments   = tournament.trackerFragments[teamId];
    const teamPlayers = team?.players ?? [];

    // Silently wait until all teammates are in — no intermediate messages posted
    const allPresent = teamPlayers.every(pid => fragments[pid]);
    if (!allPresent) return;

    // All fragments present — check placements match
    const placements = teamPlayers.map(pid => fragments[pid].placement);
    const allMatch   = placements.every(p => p === placements[0]);

    const trackerCh = await fetchTrackerChannel(client, tournament);

    if (!allMatch) {
        if (trackerCh) {
            await trackerCh.send(
                `⚠️ **${team?.name ?? teamId}**: mismatched placements detected ` +
                `(${placements.join(', ')}) — manual review needed.`
            ).catch(() => {});
        }
        delete tournament.trackerFragments[teamId];
        return;
    }

    // All players matched — sum kills (each player's kills count individually),
    // apply placement points ONCE for the team.
    const totalKills = teamPlayers.reduce((sum, pid) => sum + fragments[pid].kills, 0);
    const placement  = placements[0];
    await autoSubmitTeamGame(client, tournament, teamId, team, totalKills, placement, trackerCh, teamPlayers, fragments);
    delete tournament.trackerFragments[teamId];
}

// Called after all players in a tick have been processed.
// Expires fragments older than FRAGMENT_TIMEOUT_MS and alerts the admin channel.
// The caller is responsible for calling save(tournament) after this returns.
async function pruneExpiredFragments(client, tournament) {
    if (!tournament.trackerFragments) return;

    const now       = Date.now();
    const trackerCh = await fetchTrackerChannel(client, tournament);

    for (const [teamId, fragments] of Object.entries(tournament.trackerFragments)) {
        const team        = tournament.teams[teamId];
        const detectedIds = Object.keys(fragments);
        const oldest      = Math.min(...detectedIds.map(id => new Date(fragments[id].detectedAt).getTime()));

        if (now - oldest < FRAGMENT_TIMEOUT_MS) continue;

        if (trackerCh) {
            const detected = detectedIds
                .map(id => `<@${id}> ${fragments[id].kills}k #${fragments[id].placement}`)
                .join(', ');
            const missing = (team?.players ?? [])
                .filter(id => !fragments[id])
                .map(id => `<@${id}>`)
                .join(', ');
            await trackerCh.send(
                `❌ **${team?.name ?? teamId}**: fragment expired after 15 min — ` +
                `detected: ${detected}` +
                (missing ? ` — no result from: ${missing}` : '') +
                `. Manual score entry may be needed.`
            ).catch(() => {});
        }

        delete tournament.trackerFragments[teamId];
    }
}

async function autoSubmitTeamGame(client, tournament, teamId, team, kills, placement, trackerCh, playerIds, fragments) {
    const { getPlacementPoints, calculateGamePoints, save } = require('./tournament');
    const { updateLeaderboard } = require('./leaderboard');

    const placementPoints = getPlacementPoints(placement);
    const gamePoints      = calculateGamePoints(kills, placement);

    // Pick the next unused game slot
    const usedKeys = Object.keys(team.scores ?? {}).filter(k => tournament.teams[teamId].scores[k] != null);
    const nextN    = usedKeys.length + 1;
    const gameKey  = `game${nextN}`;

    tournament.teams[teamId].scores[gameKey] = {
        kills,
        placement,
        killPoints:     kills,
        placementPoints,
        gamePoints,
        status:         'unofficial',
        source:         'tracker',
        trackedPlayers: playerIds,
        submittedAt:    new Date().toISOString(),
    };

    save(tournament);
    await updateLeaderboard(client, tournament);

    if (trackerCh) {
        const players = loadPlayers();

        // Build per-player kill breakdown (widest name determines padding)
        const rows = playerIds.map(id => {
            const name   = players[id]?.displayName ?? players[id]?.eaId ?? `<@${id}>`;
            const kCount = fragments?.[id]?.kills ?? '?';
            return { name, kCount };
        });
        const maxLen = Math.max(...rows.map(r => r.name.length));
        const breakdown = rows
            .map(r => `\`${r.name.padEnd(maxLen)}\`  ${r.kCount} kill${r.kCount !== 1 ? 's' : ''}`)
            .join('\n');

        const embed = new EmbedBuilder()
            .setColor(0x00CC44)
            .setTitle(`✅  ${team.name}  ·  Game ${nextN}`)
            .addFields(
                {
                    name:   '👥 Kill Breakdown',
                    value:  breakdown,
                    inline: false,
                },
                { name: '💀 Team Kills',    value: `\`${kills}\``,           inline: true },
                { name: '🏆 Placement',     value: `\`#${placement}\``,      inline: true },
                { name: '📊 Game Points',   value: `\`${gamePoints}\``,      inline: true },
                { name: '🎖️ Placement Pts', value: `\`${placementPoints}\``, inline: true },
                { name: '🔫 Kill Pts',      value: `\`${kills}\``,           inline: true },
            )
            .setFooter({ text: 'Auto-tracked · unofficial — screenshot verification still required' })
            .setTimestamp();

        await trackerCh.send({ embeds: [embed] }).catch(() => {});
    }
}

async function fetchTrackerChannel(client, tournament) {
    const id = tournament.channels?.trackerChannelId;
    if (!id) return null;
    return client.channels.fetch(id).catch(() => null);
}

module.exports = {
    startTournamentTracking,
    stopTournamentTracking,
    handleTournamentDetection,
    pruneExpiredFragments,
};
