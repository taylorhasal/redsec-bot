const { EmbedBuilder } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const DATA_DIR = require('./dataDir');
const { fetchPlayerStats } = require('./api');
const { loadAll, save, getPlacementPoints } = require('./tournament');
const { updateLeaderboard } = require('./leaderboard');

const TRACKERS_FILE = path.join(DATA_DIR, 'active-trackers.json');
const CONFIG_FILE   = path.join(DATA_DIR, 'live-tracker-config.json');

const MAX_TRACKERS  = 100;
const IDLE_STRIKES  = 4;   // 4 ticks * 5 min = 20 min idle → auto-stop
const ERROR_STRIKES = 3;   // 3 consecutive API failures → auto-stop
const DEADLINE_MS   = (2 * 60 + 35) * 60 * 1000; // 2h35m tournament window
const PER_PLAYER_DELAY_MS = 1000; // ~1 req/sec to be polite to the community API

function loadTrackers() {
    try { return JSON.parse(fs.readFileSync(TRACKERS_FILE, 'utf8')); }
    catch { return {}; }
}
function saveTrackers(d) { fs.writeFileSync(TRACKERS_FILE, JSON.stringify(d, null, 2), 'utf8'); }

function loadConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
    catch { return null; }
}

function extractRedsecSquadSnapshot(data) {
    const m = (data?.gameModes ?? []).find(g => g.id === 'gm_brsquad');
    if (!m) return null;
    return {
        kills:          m.kills          ?? 0,
        deaths:         m.deaths         ?? 0,
        wins:           m.wins           ?? 0,
        losses:         m.losses         ?? 0,
        matches:        m.matches        ?? 0,
        headshotKills:  m.headshotKills  ?? 0,
        secondsPlayed:  m.secondsPlayed  ?? 0,
        lastPlacement:  data.lastPlacement ?? 0,
    };
}

async function dmUser(client, userId, content) {
    try {
        const user = await client.users.fetch(userId);
        await user.send(content);
    } catch { /* DMs disabled — skip */ }
}

function findActiveTeamForUser(userId) {
    const all = loadAll();
    const now = Date.now();
    for (const tournament of Object.values(all)) {
        if (!tournament.startedAt) continue;
        const startedMs = new Date(tournament.startedAt).getTime();
        if (now > startedMs + DEADLINE_MS) continue;
        for (const [teamId, team] of Object.entries(tournament.teams ?? {})) {
            if (team.players?.includes(userId) || team.captainId === userId) {
                return { tournament, teamId, team };
            }
        }
    }
    return null;
}

function nextGameKey(team) {
    const existing = Object.keys(team.scores ?? {});
    let n = 1;
    while (existing.includes(`game${n}`)) n++;
    return `game${n}`;
}

function buildDetectionEmbed(eaId, userId, delta, snapshot) {
    const placement = snapshot.lastPlacement;
    const placementStr = placement > 0 ? `#${placement}` : '—';
    const winsDelta = delta.wins;
    const lossesDelta = delta.losses;
    let resultStr = '—';
    if (winsDelta > 0) resultStr = '🏆 Win';
    else if (lossesDelta > 0) resultStr = 'Loss';

    const gameLengthMin = delta.matches > 0
        ? Math.round((delta.secondsPlayed / delta.matches) / 60)
        : 0;
    const gameKpm = (delta.secondsPlayed > 0)
        ? (delta.kills / (delta.secondsPlayed / 60)).toFixed(2)
        : '0.00';

    return new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle(`🎮  ${eaId} just finished a Redsec Squad match`)
        .setDescription(`<@${userId}>`)
        .addFields(
            { name: '⚔️ Kills',       value: `\`${delta.kills}\``, inline: true },
            { name: '🏆 Placement',   value: `\`${placementStr}\``, inline: true },
            { name: '✅ Result',      value: resultStr,             inline: true },
            { name: '⏱️ Game length', value: `\`~${gameLengthMin}m\``, inline: true },
            { name: '📊 Game KPM',    value: `\`${gameKpm}\``,      inline: true },
        )
        .setFooter({ text: 'Detected via live tracker · /stop-tracking to disable' })
        .setTimestamp();
}

async function autoSubmitTournamentScore(client, userId, eaId, delta, snapshot) {
    const found = findActiveTeamForUser(userId);
    if (!found) return null;

    const { tournament, teamId, team } = found;
    const placement = snapshot.lastPlacement || 0;
    const killPoints = delta.kills;
    const placementPoints = getPlacementPoints(placement);
    const gamePoints = killPoints + placementPoints;

    const gameKey = nextGameKey(team);
    team.scores = team.scores ?? {};
    team.scores[gameKey] = {
        kills:           delta.kills,
        placement,
        killPoints,
        placementPoints,
        gamePoints,
        status:          'pending',
        submittedAt:     new Date().toISOString(),
        autoDetected:    true,
    };

    save(tournament);
    await updateLeaderboard(client, tournament).catch(err => console.error('[liveTracker] leaderboard update failed:', err));

    // Notify in tourney-chat so the captain knows to upload proof
    const chatId = tournament.channels?.tourneyChat;
    if (chatId) {
        const chatCh = await client.channels.fetch(chatId).catch(() => null);
        if (chatCh) {
            await chatCh.send({
                content: `🎯 **Auto-detected** Redsec Squad game for **${team.name}** (${eaId}): **${delta.kills} kills**, placement **#${placement || '?'}** → **${gamePoints} pts** added as **${gameKey}** (pending). <@${team.captainId}> upload your screenshot in <#${tournament.channels.scoreSubmissions}> to confirm.`,
            }).catch(() => {});
        }
    }

    return { tournament, teamId, gameKey, gamePoints };
}

let tickInFlight = false;

async function runLiveTrackerTick(client) {
    if (tickInFlight) {
        console.log('[liveTracker] previous tick still running, skipping this 5min slot');
        return;
    }
    tickInFlight = true;

    try {
        const config = loadConfig();
        const trackers = loadTrackers();
        const userIds = Object.keys(trackers);
        if (userIds.length === 0) return;

        const trackerChannel = config?.channelId
            ? await client.channels.fetch(config.channelId).catch(() => null)
            : null;

        for (const userId of userIds) {
            const tracker = trackers[userId];
            if (!tracker) continue;

            // Spacing — first iteration runs immediately
            await new Promise(r => setTimeout(r, PER_PLAYER_DELAY_MS));

            let data;
            try {
                data = await fetchPlayerStats(tracker.eaId, 'ea');
            } catch (err) {
                tracker.errorStrikes = (tracker.errorStrikes ?? 0) + 1;
                if (tracker.errorStrikes >= ERROR_STRIKES) {
                    delete trackers[userId];
                    await dmUser(client, userId,
                        `🛑 Live tracking for **${tracker.eaId}** stopped after ${ERROR_STRIKES} consecutive API errors. Run \`/start-tracking\` to resume.`);
                }
                continue;
            }

            tracker.errorStrikes = 0;

            const current = extractRedsecSquadSnapshot(data);
            if (!current) {
                tracker.idleStrikes = (tracker.idleStrikes ?? 0) + 1;
                if (tracker.idleStrikes >= IDLE_STRIKES) {
                    delete trackers[userId];
                    await dmUser(client, userId,
                        `⏸️ Live tracking paused for **${tracker.eaId}** after 20 min idle. Run \`/start-tracking\` to resume.`);
                }
                continue;
            }

            const prev = tracker.snapshot;
            const matchesDelta = current.matches - (prev?.matches ?? current.matches);

            if (matchesDelta > 0) {
                const delta = {
                    matches:       matchesDelta,
                    kills:         current.kills - prev.kills,
                    wins:          current.wins  - prev.wins,
                    losses:        current.losses - prev.losses,
                    secondsPlayed: current.secondsPlayed - prev.secondsPlayed,
                };

                // Almost always matchesDelta === 1; if >1, post one embed and note multi-match
                if (trackerChannel) {
                    const embed = buildDetectionEmbed(tracker.eaId, userId, delta, current);
                    if (matchesDelta > 1) {
                        embed.addFields({ name: '⚠️ Multi-match detection', value: `${matchesDelta} matches were played in this 5-min window — stats above are aggregated.`, inline: false });
                    }
                    await trackerChannel.send({ embeds: [embed] }).catch(err => console.error('[liveTracker] post failed:', err));
                }

                await autoSubmitTournamentScore(client, userId, tracker.eaId, delta, current).catch(err => console.error('[liveTracker] tournament submit failed:', err));

                tracker.snapshot       = current;
                tracker.lastDetectedAt = new Date().toISOString();
                tracker.idleStrikes    = 0;
            } else {
                tracker.idleStrikes = (tracker.idleStrikes ?? 0) + 1;
                if (tracker.idleStrikes >= IDLE_STRIKES) {
                    delete trackers[userId];
                    await dmUser(client, userId,
                        `⏸️ Live tracking paused for **${tracker.eaId}** after 20 min idle. Run \`/start-tracking\` to resume.`);
                }
            }
        }

        saveTrackers(trackers);
    } finally {
        tickInFlight = false;
    }
}

module.exports = {
    loadTrackers, saveTrackers, loadConfig,
    extractRedsecSquadSnapshot, runLiveTrackerTick,
    MAX_TRACKERS,
};
