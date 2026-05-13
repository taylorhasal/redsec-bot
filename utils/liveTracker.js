const { EmbedBuilder } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const DATA_DIR = require('./dataDir');
const { fetchPlayerStats } = require('./api');
const { loadById, save: saveTournament } = require('./tournament');
const { handleTournamentDetection, pruneExpiredFragments } = require('./tournamentTracker');

const TRACKERS_FILE = path.join(DATA_DIR, 'active-trackers.json');
const CONFIG_FILE   = path.join(DATA_DIR, 'live-tracker-config.json');
const PLAYERS_FILE  = path.join(DATA_DIR, 'players.json');

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

function loadPlayers() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch { return {}; }
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
        humanDamage:           data.devidedDamage?.human       ?? 0,
        vehicleDamage:         data.devidedDamage?.withVehicle ?? 0,
        vehicleKills:          data.dividedKills?.vehicle      ?? 0,
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

function buildDetectionEmbed(eaId, userId, delta, snapshot, matchesDelta = 1) {
    const placement    = snapshot.lastPlacement;
    const placementStr = placement > 0 ? `#${placement}` : '—';

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

    const lines = [
        `🏆 ${placementStr}  ⚔️ **${delta.kills}**K  💀 **${delta.deaths}**D  🤝 **${delta.killAssists}** Asst  📊 **${kd}** K/D`,
        `💥 **${(delta.humanDamage ?? 0).toLocaleString()}** / **${(delta.vehicleDamage ?? 0).toLocaleString()}** Dmg  🔥 **${kpm}** KPM  🎯 **${delta.headshotKills}** HS (${hsPct})`,
        `🏅 **${(delta.scoreIn ?? 0).toLocaleString()}** Score  ⏱️ ~${gameLengthMin}m  🚑 **${delta.revives}** Rev  👁️ **${delta.spots}** Spots`,
    ];

    if (matchesDelta > 1) lines.push(`⚠️ ${matchesDelta} matches aggregated`);

    return new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle(`🎮  ${eaId}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Detected via live tracker' })
        .setTimestamp();
}

async function startPersonalTracking(userId, guildId, client) {
    console.log(`[liveTracker] startPersonalTracking called — userId=${userId} guildId=${guildId}`);
    const players = loadPlayers();
    const player  = players[userId];
    if (!player) { console.log(`[liveTracker] user ${userId} not verified — skipping`); return; }

    const config = loadConfig();
    if (!config?.channelId) { console.log('[liveTracker] no tracker config — skipping'); return; }

    const { eaId, platform = 'ea' } = player;
    console.log(`[liveTracker] verified as ${eaId} (${platform})`);
    const trackers = loadTrackers();
    const existing = trackers[userId];

    if (existing?.tournamentId) {
        // Tournament entry — reactivate personal tracking, keep snapshot for tournament continuity
        if (existing.personalTracking === true) { console.log('[liveTracker] already tracking — skipping'); return; }
        existing.personalTracking = true;
        saveTrackers(trackers);
    } else {
        // New entry or stale personal entry — always take a fresh snapshot.
        // The community API can lag by several minutes; taking the snapshot here and then
        // immediately comparing on the next tick would fire for games played before VC join.
        // The stabilizing flag causes the first tick to re-baseline silently instead of posting.
        let data;
        try {
            console.log(`[liveTracker] fetching stats for ${eaId}...`);
            data = await fetchPlayerStats(eaId, platform);
        } catch (err) {
            console.log(`[liveTracker] API fetch failed for ${eaId}:`, err?.message ?? err);
            return;
        }
        const snapshot = extractRedsecSquadSnapshot(data);
        if (!snapshot) { console.log(`[liveTracker] no Redsec Squad data for ${eaId} — skipping`); return; }

        if (Object.keys(trackers).length >= MAX_TRACKERS && !existing) { console.log('[liveTracker] at capacity — skipping'); return; }

        if (existing) {
            existing.snapshot        = snapshot;
            existing.personalTracking = true;
            existing.stabilizing     = true;
            existing.idleStrikes     = 0;
            existing.errorStrikes    = 0;
        } else {
            trackers[userId] = {
                eaId,
                platform,
                guildId,
                snapshot,
                personalTracking: true,
                stabilizing:      true,
                startedAt:        new Date().toISOString(),
                lastDetectedAt:   null,
                idleStrikes:      0,
                errorStrikes:     0,
            };
        }
        saveTrackers(trackers);
        console.log(`[liveTracker] tracker entry created for ${eaId} (stabilizing)`);
    }

    try {
        const guild  = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        await addTrackingRole(guild, member);
        console.log(`[liveTracker] tracking role assigned to ${eaId}`);
    } catch (err) {
        console.error('[liveTracker] addTrackingRole failed:', err);
    }
}

async function stopPersonalTracking(userId, guildId, client) {
    const trackers = loadTrackers();
    const tracker  = trackers[userId];
    if (!tracker || tracker.personalTracking === false) return;

    tracker.personalTracking = false;

    if (tracker.tournamentId) {
        saveTrackers(trackers);
    } else {
        delete trackers[userId];
        saveTrackers(trackers);
        await removeTrackingRole(client, guildId, userId);
    }
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
                data = await fetchPlayerStats(tracker.eaId, tracker.platform ?? 'ea');
            } catch (err) {
                tracker.errorStrikes = (tracker.errorStrikes ?? 0) + 1;
                if (tracker.errorStrikes >= ERROR_STRIKES && !tracker.tournamentId) {
                    delete trackers[userId];
                    if (tracker.guildId) await removeTrackingRole(client, tracker.guildId, userId);
                    await dmUser(client, userId,
                        `🛑 Live tracking for **${tracker.eaId}** stopped after ${ERROR_STRIKES} consecutive API errors. Rejoin a voice channel to resume.`);
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
                        `⏸️ Live tracking paused for **${tracker.eaId}** after 45 min idle. Rejoin a voice channel to resume.`);
                }
                continue;
            }

            // On the first tick after VC join, re-baseline silently to absorb API lag.
            // The snapshot taken at join time may not reflect games finished just before joining.
            if (tracker.stabilizing) {
                tracker.snapshot   = current;
                delete tracker.stabilizing;
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
                    humanDamage:           current.humanDamage   - (prev.humanDamage   ?? current.humanDamage),
                    vehicleDamage:         current.vehicleDamage - (prev.vehicleDamage ?? current.vehicleDamage),
                    vehicleKills:          current.vehicleKills  - (prev.vehicleKills  ?? current.vehicleKills),
                };

                const embed = buildDetectionEmbed(tracker.eaId, userId, delta, current, matchesDelta);

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
                        `⏸️ Live tracking paused for **${tracker.eaId}** after 45 min idle. Rejoin a voice channel to resume.`);
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
    startPersonalTracking, stopPersonalTracking,
    MAX_TRACKERS, TRACKING_ROLE_NAME,
};
