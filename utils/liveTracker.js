const { EmbedBuilder } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const DATA_DIR = require('./dataDir');
const { fetchPlayerStats } = require('./api');
const { loadById, save: saveTournament } = require('./tournament');
const { handleTournamentDetection, pruneExpiredFragments } = require('./tournamentTracker');

const TRACKERS_FILE = path.join(DATA_DIR, 'active-trackers.json');
const CONFIG_FILE   = path.join(DATA_DIR, 'live-tracker-config.json');

const MAX_TRACKERS  = 100;
const IDLE_STRIKES  = 9;   // 9 ticks * 5 min = 45 min idle → auto-stop
const ERROR_STRIKES = 3;   // 3 consecutive API failures → auto-stop
const PER_PLAYER_DELAY_MS = 1000; // ~1 req/sec to be polite to the community API

const TRACKING_ROLE_NAME  = '🟢 Live Tracking';
const TRACKING_ROLE_COLOR = 0x00CC44;

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
        kills:                 m.kills                 ?? 0,
        deaths:                m.deaths                ?? 0,
        wins:                  m.wins                  ?? 0,
        losses:                m.losses                ?? 0,
        matches:               m.matches               ?? 0,
        killAssists:           m.killAssists           ?? 0,
        headshotKills:         m.headshotKills         ?? 0,
        revives:               m.revives               ?? 0,
        spots:                 m.spots                 ?? 0,
        objectivesCaptured:    m.objectivesCaptured    ?? 0,
        objectivesDefended:    m.objectivesDefended    ?? 0,
        objectivesDestroyed:   m.objectivesDestroyed   ?? 0,
        vehiclesDestroyedWith: m.vehiclesDestroyedWith ?? 0,
        scoreIn:               m.scoreIn               ?? 0,
        secondsPlayed:         m.secondsPlayed         ?? 0,
        lastPlacement:         data.lastPlacement      ?? 0,
    };
}

async function findOrCreateTrackingRole(guild) {
    await guild.roles.fetch();
    let role = guild.roles.cache.find(r => r.name === TRACKING_ROLE_NAME);
    if (!role) {
        role = await guild.roles.create({
            name:        TRACKING_ROLE_NAME,
            color:       TRACKING_ROLE_COLOR,
            mentionable: false,
            hoist:       false,
            reason:      'Live tracker enrolment indicator',
        });
    }
    return role;
}

async function addTrackingRole(guild, member) {
    try {
        const role = await findOrCreateTrackingRole(guild);
        await member.roles.add(role);
    } catch (err) {
        console.error('[liveTracker] addTrackingRole failed:', err);
    }
}

async function removeTrackingRole(client, guildId, userId) {
    try {
        const guild  = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        const role   = guild.roles.cache.find(r => r.name === TRACKING_ROLE_NAME);
        if (role && member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
        }
    } catch { /* member or guild gone — fine */ }
}

async function dmUser(client, userId, content) {
    try {
        const user = await client.users.fetch(userId);
        await user.send(content);
    } catch { /* DMs disabled — skip */ }
}

function buildDetectionEmbed(eaId, userId, delta, snapshot) {
    const placement    = snapshot.lastPlacement;
    const placementStr = placement > 0 ? `#${placement}` : '—';

    let resultStr = '—';
    if (delta.wins > 0)        resultStr = '🏆 Win';
    else if (delta.losses > 0) resultStr = 'Loss';

    const gameLengthMin = delta.matches > 0
        ? Math.round((delta.secondsPlayed / delta.matches) / 60)
        : 0;

    const kd    = delta.deaths > 0 ? (delta.kills / delta.deaths).toFixed(2) : `${delta.kills}.00`;
    const kpm   = delta.secondsPlayed > 0
        ? (delta.kills / (delta.secondsPlayed / 60)).toFixed(2)
        : '0.00';
    const hsPct = delta.kills > 0
        ? ((delta.headshotKills / delta.kills) * 100).toFixed(0) + '%'
        : '0%';

    return new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle(`🎮  ${eaId}  ·  Redsec Squad`)
        .setDescription(`<@${userId}>`)
        .addFields(
            { name: '✅ Result',     value: `\`${resultStr}\``,                           inline: true },
            { name: '🏆 Placement',  value: `\`${placementStr}\``,                        inline: true },
            { name: '⏱️ Length',     value: `\`~${gameLengthMin}m\``,                     inline: true },

            { name: '⚔️ Kills',      value: `\`${delta.kills}\``,                         inline: true },
            { name: '💀 Deaths',     value: `\`${delta.deaths}\``,                        inline: true },
            { name: '📊 K/D',        value: `\`${kd}\``,                                  inline: true },

            { name: '🔥 KPM',        value: `\`${kpm}\``,                                 inline: true },
            { name: '🎯 Headshots',  value: `\`${delta.headshotKills} (${hsPct})\``,      inline: true },
            { name: '🤝 Assists',    value: `\`${delta.killAssists}\``,                   inline: true },

            { name: '🏅 Score',      value: `\`${delta.scoreIn}\``,                       inline: true },
            { name: '🚑 Revives',    value: `\`${delta.revives}\``,                       inline: true },
            { name: '👁️ Spots',      value: `\`${delta.spots}\``,                         inline: true },
        )
        .setFooter({ text: 'Detected via live tracker · /stop-tracking to disable' })
        .setTimestamp();
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

        // Collect all tournament IDs with active trackers — prune expired fragments after the loop
        const touchedTournamentIds = new Set(
            Object.values(trackers).map(t => t.tournamentId).filter(Boolean)
        );

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
                if (tracker.errorStrikes >= ERROR_STRIKES && !tracker.tournamentId) {
                    delete trackers[userId];
                    if (tracker.guildId) await removeTrackingRole(client, tracker.guildId, userId);
                    await dmUser(client, userId,
                        `🛑 Live tracking for **${tracker.eaId}** stopped after ${ERROR_STRIKES} consecutive API errors. Run \`/start-tracking\` to resume.`);
                }
                continue;
            }

            tracker.errorStrikes = 0;

            const current = extractRedsecSquadSnapshot(data);
            if (!current) {
                tracker.idleStrikes = (tracker.idleStrikes ?? 0) + 1;
                if (tracker.idleStrikes >= IDLE_STRIKES && !tracker.tournamentId) {
                    delete trackers[userId];
                    if (tracker.guildId) await removeTrackingRole(client, tracker.guildId, userId);
                    await dmUser(client, userId,
                        `⏸️ Live tracking paused for **${tracker.eaId}** after 45 min idle. Run \`/start-tracking\` to resume.`);
                }
                continue;
            }

            const prev = tracker.snapshot;
            const matchesDelta = current.matches - (prev?.matches ?? current.matches);

            if (matchesDelta > 0) {
                const delta = {
                    matches:               matchesDelta,
                    kills:                 current.kills                 - prev.kills,
                    deaths:                current.deaths                - prev.deaths,
                    wins:                  current.wins                  - prev.wins,
                    losses:                current.losses                - prev.losses,
                    killAssists:           current.killAssists           - prev.killAssists,
                    headshotKills:         current.headshotKills         - prev.headshotKills,
                    revives:               current.revives               - prev.revives,
                    spots:                 current.spots                 - prev.spots,
                    objectivesCaptured:    current.objectivesCaptured    - prev.objectivesCaptured,
                    objectivesDefended:    current.objectivesDefended    - prev.objectivesDefended,
                    objectivesDestroyed:   current.objectivesDestroyed   - prev.objectivesDestroyed,
                    vehiclesDestroyedWith: current.vehiclesDestroyedWith - prev.vehiclesDestroyedWith,
                    scoreIn:               current.scoreIn               - prev.scoreIn,
                    secondsPlayed:         current.secondsPlayed         - prev.secondsPlayed,
                };

                const embed = buildDetectionEmbed(tracker.eaId, userId, delta, current);
                if (matchesDelta > 1) {
                    embed.addFields({
                        name:   '⚠️ Multi-match detection',
                        value:  `${matchesDelta} matches were played in this 5-min window — stats above are aggregated.`,
                        inline: false,
                    });
                }

                // Tournament and personal tracking are independent — both can fire for the same game.
                // personalTracking defaults to true for legacy entries (no field = manually started).
                const isPersonal   = tracker.personalTracking !== false;
                const isTournament = !!tracker.tournamentId;

                if (isTournament) {
                    const tournament = loadById(tracker.tournamentId);
                    if (tournament) {
                        await handleTournamentDetection(client, tournament, tracker.teamId, userId, delta, current);
                        saveTournament(tournament);
                    }
                }
                if (isPersonal && trackerChannel) {
                    await trackerChannel.send({ embeds: [embed] }).catch(err => console.error('[liveTracker] post failed:', err));
                }

                tracker.snapshot       = current;
                tracker.lastDetectedAt = new Date().toISOString();
                tracker.idleStrikes    = 0;
            } else {
                tracker.idleStrikes = (tracker.idleStrikes ?? 0) + 1;
                if (tracker.idleStrikes >= IDLE_STRIKES && !tracker.tournamentId) {
                    delete trackers[userId];
                    if (tracker.guildId) await removeTrackingRole(client, tracker.guildId, userId);
                    await dmUser(client, userId,
                        `⏸️ Live tracking paused for **${tracker.eaId}** after 45 min idle. Run \`/start-tracking\` to resume.`);
                }
            }
        }

        saveTrackers(trackers);

        // Prune expired fragments for every tournament touched this tick
        for (const tournamentId of touchedTournamentIds) {
            const t = loadById(tournamentId);
            if (t) {
                await pruneExpiredFragments(client, t);
                saveTournament(t);
            }
        }
    } finally {
        tickInFlight = false;
    }
}

module.exports = {
    loadTrackers, saveTrackers, loadConfig,
    extractRedsecSquadSnapshot, runLiveTrackerTick,
    addTrackingRole, removeTrackingRole,
    MAX_TRACKERS, TRACKING_ROLE_NAME,
};
