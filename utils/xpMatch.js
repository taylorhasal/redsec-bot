const { EmbedBuilder } = require('discord.js');
const fs       = require('fs');
const path     = require('path');
const DATA_DIR = require('./dataDir');

const MATCHES_FILE   = path.join(DATA_DIR, 'xp-matches.json');
const RATINGS_FILE   = path.join(DATA_DIR, 'xp-ratings.json');
const XP_CONFIG_FILE = path.join(DATA_DIR, 'xp-config.json');
const PLAYERS_FILE   = path.join(DATA_DIR, 'players.json');

function loadMatches()   { try { return JSON.parse(fs.readFileSync(MATCHES_FILE,   'utf8')); } catch { return {}; } }
function saveMatches(d)  { fs.writeFileSync(MATCHES_FILE,   JSON.stringify(d, null, 2), 'utf8'); }
function loadRatings()   { try { return JSON.parse(fs.readFileSync(RATINGS_FILE,   'utf8')); } catch { return {}; } }
function saveRatings(d)  { fs.writeFileSync(RATINGS_FILE,   JSON.stringify(d, null, 2), 'utf8'); }
function loadXpConfig()  { try { return JSON.parse(fs.readFileSync(XP_CONFIG_FILE, 'utf8')); } catch { return null; } }
function saveXpConfig(d) { fs.writeFileSync(XP_CONFIG_FILE, JSON.stringify(d, null, 2), 'utf8'); }
function loadPlayers()   { try { return JSON.parse(fs.readFileSync(PLAYERS_FILE,   'utf8')); } catch { return {}; } }

const XP_FLOOR = 100;

function newMatchId() {
    return Date.now().toString(36).slice(-5).toUpperCase();
}

function getOrCreateRating(ratings, userId) {
    if (!ratings[userId]) ratings[userId] = { xp: 1000, wins: 0, losses: 0 };
    return ratings[userId];
}

function initRating(userId) {
    const ratings = loadRatings();
    if (!ratings[userId]) {
        ratings[userId] = { xp: 1000, wins: 0, losses: 0 };
        saveRatings(ratings);
    }
}

function expectedWinRate(myTeamIndex, oppTeamIndex) {
    const diff = myTeamIndex - oppTeamIndex;
    return 1 / (1 + Math.pow(10, diff / 10));
}

function calcXpDelta(myExpectedWin, won) {
    if (won) return  Math.round(100 - 75 * myExpectedWin);
    else     return -Math.round(15  + 65 * myExpectedWin);
}

function fmtIndex(n) {
    return (n >= 0 ? '+' : '') + n.toFixed(1);
}

function playerName(uid, players) {
    const p = players[uid];
    return p?.displayName ?? p?.eaId ?? `User`;
}

function buildXpLeaderboardEmbed(ratings, players) {
    const entries = Object.entries(ratings).sort(([, a], [, b]) => b.xp - a.xp);

    if (entries.length === 0) {
        return new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('🏆  XP Ranked Leaderboard')
            .setDescription('No players ranked yet. Complete a match to appear here.')
            .setFooter({ text: 'Redsec · XP Ranked' })
            .setTimestamp();
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = entries.map(([uid, r], i) => {
        const name = playerName(uid, players);
        const rank = medals[i] ?? `\`#${i + 1}\``;
        return `${rank}  **${name}**  ·  ${r.xp.toLocaleString()} XP  ·  ${r.wins}W ${r.losses}L`;
    });

    return new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle('🏆  XP Ranked Leaderboard')
        .setDescription(lines.join('\n').slice(0, 4000))
        .setFooter({ text: 'Redsec · XP Ranked — updates after every match' })
        .setTimestamp();
}

async function updateXpLeaderboard(client) {
    const config = loadXpConfig();
    if (!config?.leaderboardMessageId || !config?.leaderboardChannelId) return;
    const ch = await client.channels.fetch(config.leaderboardChannelId).catch(() => null);
    if (!ch) return;
    const msg = await ch.messages.fetch(config.leaderboardMessageId).catch(() => null);
    if (!msg) return;
    await msg.edit({ embeds: [buildXpLeaderboardEmbed(loadRatings(), loadPlayers())] }).catch(() => {});
}

function buildQueueEmbed(match, players) {
    const slot = (team, i) => {
        const uid = match[team][i];
        return uid ? `<@${uid}> · ${playerName(uid, players)}` : '*Open*';
    };

    const allFull = match.team1.length >= 2 && match.team2.length >= 2;

    return new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle(`🎯  XP Match — #${match.id}`)
        .addFields(
            { name: '🔴  Team 1', value: `${slot('team1', 0)}\n${slot('team1', 1)}`, inline: true },
            { name: '🔵  Team 2', value: `${slot('team2', 0)}\n${slot('team2', 1)}`, inline: true },
        )
        .setFooter({ text: allFull ? 'All slots filled — starting match…' : 'Click a button below to join!' })
        .setTimestamp();
}

async function resolveMatch(client, match, winnerTeam) {
    const ratings = loadRatings();
    const players = loadPlayers();

    const idx1 = match.team1.reduce((s, uid) => s + (players[uid]?.redsecIndex ?? 0), 0);
    const idx2 = match.team2.reduce((s, uid) => s + (players[uid]?.redsecIndex ?? 0), 0);

    const team1Won = winnerTeam === 'team1';
    const delta1   = calcXpDelta(expectedWinRate(idx1, idx2), team1Won);
    const delta2   = calcXpDelta(expectedWinRate(idx2, idx1), !team1Won);

    for (const uid of match.team1) {
        const r = getOrCreateRating(ratings, uid);
        r.xp = Math.max(XP_FLOOR, r.xp + delta1);
        if (team1Won) r.wins++; else r.losses++;
    }
    for (const uid of match.team2) {
        const r = getOrCreateRating(ratings, uid);
        r.xp = Math.max(XP_FLOOR, r.xp + delta2);
        if (!team1Won) r.wins++; else r.losses++;
    }
    saveRatings(ratings);

    for (const vcId of [match.vc1Id, match.vc2Id]) {
        if (!vcId) continue;
        const vc = await client.channels.fetch(vcId).catch(() => null);
        if (vc) await vc.delete().catch(() => {});
    }

    await updateXpLeaderboard(client);
    return { delta1, delta2, idx1, idx2, team1Won };
}

async function checkXpQueues(client) {
    const matches = loadMatches();
    const config  = loadXpConfig();
    const TIMEOUT = 30 * 60 * 1000;
    const now     = Date.now();
    let changed   = false;

    for (const [matchId, match] of Object.entries(matches)) {
        if (match.status !== 'open') continue;
        if (now - new Date(match.createdAt).getTime() < TIMEOUT) continue;

        if (config?.queueChannelId && match.queueMessageId) {
            const ch = await client.channels.fetch(config.queueChannelId).catch(() => null);
            if (ch) {
                const msg = await ch.messages.fetch(match.queueMessageId).catch(() => null);
                if (msg) await msg.edit({ content: '⏰ Match expired — no one joined within 30 minutes.', embeds: [], components: [] }).catch(() => {});
            }
        }

        delete matches[matchId];
        changed = true;
    }

    if (changed) saveMatches(matches);
}

module.exports = {
    loadMatches, saveMatches, loadRatings, saveRatings,
    loadXpConfig, saveXpConfig, getOrCreateRating, initRating,
    expectedWinRate, calcXpDelta, fmtIndex, playerName,
    buildXpLeaderboardEmbed, buildQueueEmbed,
    updateXpLeaderboard, resolveMatch, checkXpQueues, newMatchId,
};
