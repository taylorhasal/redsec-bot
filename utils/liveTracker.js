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
        kills:         m.kills         ?? 0,
        deaths:        m.deaths        ?? 0,
        wins:          m.wins          ?? 0,
        losses:        m.losses        ?? 0,
        matches:       m.matches       ?? 0,
        killAssists:   m.killAssists   ?? 0,
        headshotKills: m.headshotKills ?? 0,
        revives:       m.revives       ?? 0,
        spots:         m.spots         ?? 0,
        scoreIn:       m.scoreIn       ?? 0,
        secondsPlayed: m.secondsPlayed ?? 0,
        lastPlacement: data.lastPlacement            ?? 0,
        humanDamage:   data.devidedDamage?.human       ?? 0,
        vehicleDamage: data.devidedDamage?.withVehicle ?? 0,
        vehicleKills:  data.dividedKills?.vehicle      ?? 0,
    };
}

// True if the member is currently connected to a voice channel (cache lookup —
// voice states are populated on connect, so this is reliable even after a restart).
function memberInVoice(client, guildId, userId) {
    const m = client.guilds.cache.get(guildId)?.members.cache.get(userId);
    return !!m?.voice?.channelId;
}

function freshSession() {
    return {
        startedAt:     new Date().toISOString(),
        games:         0,
        kills:         0,
        deaths:        0,
        assists:       0,
        headshots:     0,
        revives:       0,
        score:         0,
        wins:          0,
        bestPlacement: null,
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
    const won = delta.wins > 0;
    // Placement is the most recent game only — meaningless when several games are aggregated
    const placementStr = matchesDelta > 1
        ? '—'
        : (snapshot.lastPlacement > 0 ? `#${snapshot.lastPlacement}` : '—');

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
        `<@${userId}>`,
        `🏆 ${placementStr}  ⚔️ **${delta.kills}**K  💀 **${delta.deaths}**D  🤝 **${delta.killAssists}** Asst  📊 **${kd}** K/D`,
        `💥 **${(delta.humanDamage ?? 0).toLocaleString()}** / **${(delta.vehicleDamage ?? 0).toLocaleString()}** Dmg  🔥 **${kpm}** KPM  🎯 **${delta.headshotKills}** HS (${hsPct})`,
        `🏅 **${(delta.scoreIn ?? 0).toLocaleString()}** Score  ⏱️ ~${gameLengthMin}m  🚑 **${delta.revives}** Rev  👁️ **${delta.spots}** Spots`,
    ];

    if (matchesDelta > 1) lines.push(`⚠️ ${matchesDelta} matches aggregated`);

    return new EmbedBuilder()
        .setColor(won ? 0x00CC44 : 0xCC0000)
        .setTitle(won ? `👑  ${eaId}  ·  WIN` : `🎮  ${eaId}`)
        .setDescription(lines.join('\n'))
        .setFooter({ text: 'Detected via live tracker' })
        .setTimestamp();
}

function buildSessionSummaryEmbed(eaId, ses) {
    const durMin = Math.max(1, Math.round((Date.now() - new Date(ses.startedAt).getTime()) / 60000));
    const kd     = ses.deaths > 0 ? (ses.kills / ses.deaths).toFixed(2) : `${ses.kills}.00`;
    const best   = ses.bestPlacement != null && ses.bestPlacement > 0 ? `#${ses.bestPlacement}` : '—';
    const won    = ses.wins > 0;

    return new EmbedBuilder()
        .setColor(won ? 0x00CC44 : 0xCC0000)
        .setTitle(`🎮  Live Tracking Session — ${eaId}`)
        .setDescription(`You played **${ses.games}** Redsec Squad game${ses.games === 1 ? '' : 's'} over **${durMin} min** of tracking.`)
        .addFields(
            { name: '🏆 Wins',        value: `\`${ses.wins}\``,                   inline: true },
            { name: '⚔️ Kills',       value: `\`${ses.kills}\``,                  inline: true },
            { name: '💀 Deaths',      value: `\`${ses.deaths}\``,                 inline: true },
            { name: '📊 K/D',         value: `\`${kd}\``,                         inline: true },
            { name: '🤝 Assists',     value: `\`${ses.assists}\``,                inline: true },
            { name: '🎯 Headshots',   value: `\`${ses.headshots}\``,              inline: true },
            { name: '🏅 Score',       value: `\`${ses.score.toLocaleString()}\``, inline: true },
            { name: '🚑 Revives',     value: `\`${ses.revives}\``,                inline: true },
            { name: '🥇 Best Place',  value: `\`${best}\``,                       inline: true },
        )
        .setFooter({ text: 'Hop back in voice to keep tracking · /stats' })
        .setTimestamp();
}

async function startPersonalTracking(userId, guildId, client) {
    const players = loadPlayers();
    const player  = players[userId];
    if (!player) return;

    const config = loadConfig();
    if (!config?.channelId) return;

    const { eaId, platform = 'ea' } = player;
    const trackers = loadTrackers();
    const existing = trackers[userId];

    if (existing?.tournamentId) {
        // Tournament entry — reactivate personal tracking, keep snapshot for tournament continuity
        if (existing.personalTracking === true) return;
        existing.personalTracking = true;
        existing.session          = freshSession();
        saveTrackers(trackers);
    } else {
        // Bail before burning an API call if we're at capacity with no existing slot to reuse
        if (!existing && Object.keys(trackers).length >= MAX_TRACKERS) return;

        // New entry or stale personal entry — always take a fresh snapshot.
        // The community API can lag by several minutes; taking the snapshot here and then
        // immediately comparing on the next tick would fire for games played before VC join.
        // The stabilizing flag causes the first tick to re-baseline silently instead of posting.
        let data;
        try { data = await fetchPlayerStats(eaId, platform); }
        catch { return; }
        const snapshot = extractRedsecSquadSnapshot(data);
        if (!snapshot) return;

        if (existing) {
            existing.snapshot        = snapshot;
            existing.personalTracking = true;
            existing.stabilizing     = true;
            existing.idleStrikes     = 0;
            existing.errorStrikes    = 0;
            existing.session         = freshSession();
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
                session:          freshSession(),
            };
        }
        saveTrackers(trackers);
    }

    try {
        const guild  = await client.guilds.fetch(guildId);
        const member = await guild.members.fetch(userId);
        await addTrackingRole(guild, member);
    } catch { /* guild/member gone */ }
}

async function stopPersonalTracking(userId, guildId, client) {
    const trackers = loadTrackers();
    const tracker  = trackers[userId];
    if (!tracker || tracker.personalTracking === false) return;

    tracker.personalTracking = false;
    const ses  = tracker.session;
    const eaId = tracker.eaId;

    if (tracker.tournamentId) {
        delete tracker.session;
        saveTrackers(trackers);
    } else {
        delete trackers[userId];
        saveTrackers(trackers);
        await removeTrackingRole(client, guildId, userId);
    }

    if (ses && ses.games > 0) {
        await dmUser(client, userId, { embeds: [buildSessionSummaryEmbed(eaId, ses)] });
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
                    if (memberInVoice(client, tracker.guildId, userId)) {
                        // Still in voice — keep the entry alive; voice-leave is the real cleanup trigger
                        tracker.idleStrikes = 0;
                    } else {
                        // Left voice (event missed, or stale entry) — clean up
                        delete trackers[userId];
                        if (tracker.guildId) await removeTrackingRole(client, tracker.guildId, userId);
                        await dmUser(client, userId,
                            `⏸️ Live tracking paused for **${tracker.eaId}**. Hop back into a voice channel to resume.`);
                    }
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
                    matches:       matchesDelta,
                    kills:         current.kills         - prev.kills,
                    deaths:        current.deaths        - prev.deaths,
                    wins:          current.wins          - prev.wins,
                    losses:        current.losses        - prev.losses,
                    killAssists:   current.killAssists   - prev.killAssists,
                    headshotKills: current.headshotKills - prev.headshotKills,
                    revives:       current.revives       - prev.revives,
                    spots:         current.spots         - prev.spots,
                    scoreIn:       current.scoreIn       - prev.scoreIn,
                    secondsPlayed: current.secondsPlayed - prev.secondsPlayed,
                    humanDamage:   current.humanDamage   - (prev.humanDamage   ?? current.humanDamage),
                    vehicleDamage: current.vehicleDamage - (prev.vehicleDamage ?? current.vehicleDamage),
                    vehicleKills:  current.vehicleKills  - (prev.vehicleKills  ?? current.vehicleKills),
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
                if (isPersonal) {
                    const ses = tracker.session ?? (tracker.session = freshSession());
                    ses.games     += matchesDelta;
                    ses.kills     += delta.kills;
                    ses.deaths    += delta.deaths;
                    ses.assists   += delta.killAssists;
                    ses.headshots += delta.headshotKills;
                    ses.revives   += delta.revives;
                    ses.score     += delta.scoreIn;
                    ses.wins      += delta.wins;
                    if (matchesDelta === 1 && current.lastPlacement > 0) {
                        ses.bestPlacement = ses.bestPlacement == null
                            ? current.lastPlacement
                            : Math.min(ses.bestPlacement, current.lastPlacement);
                    }
                    if (trackerChannel) {
                        await trackerChannel.send({ embeds: [embed], allowedMentions: { parse: [] } })
                            .catch(err => console.error('[liveTracker] post failed:', err));
                    }
                }

                tracker.snapshot       = current;
                tracker.lastDetectedAt = new Date().toISOString();
                tracker.idleStrikes    = 0;
            } else {
                tracker.idleStrikes = (tracker.idleStrikes ?? 0) + 1;
                if (tracker.idleStrikes >= IDLE_STRIKES && !tracker.tournamentId) {
                    if (memberInVoice(client, tracker.guildId, userId)) {
                        // Still in voice — re-baseline silently and keep tracking
                        tracker.snapshot    = current;
                        tracker.idleStrikes = 0;
                    } else {
                        // Left voice (event missed, or stale entry) — clean up
                        delete trackers[userId];
                        if (tracker.guildId) await removeTrackingRole(client, tracker.guildId, userId);
                        await dmUser(client, userId,
                            `⏸️ Live tracking paused for **${tracker.eaId}**. Hop back into a voice channel to resume.`);
                    }
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
