const { EmbedBuilder } = require('discord.js');
const fs       = require('fs');
const path     = require('path');
const DATA_DIR = require('./dataDir');

const MATCHES_FILE = path.join(DATA_DIR, 'kill-race-matches.json');
const RECORDS_FILE = path.join(DATA_DIR, 'kill-race-records.json');
const CONFIG_FILE  = path.join(DATA_DIR, 'kill-race-config.json');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');

function loadMatches()           { try { return JSON.parse(fs.readFileSync(MATCHES_FILE, 'utf8')); } catch { return {}; } }
function saveMatches(d)          { fs.writeFileSync(MATCHES_FILE, JSON.stringify(d, null, 2), 'utf8'); }
function loadRecords()           { try { return JSON.parse(fs.readFileSync(RECORDS_FILE, 'utf8')); } catch { return {}; } }
function saveRecords(d)          { fs.writeFileSync(RECORDS_FILE, JSON.stringify(d, null, 2), 'utf8'); }
function loadKillRaceConfig()    { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return null; } }
function saveKillRaceConfig(d)   { fs.writeFileSync(CONFIG_FILE, JSON.stringify(d, null, 2), 'utf8'); }
function loadPlayers()           { try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); } catch { return {}; } }

function newMatchId() {
    return Date.now().toString(36).slice(-5).toUpperCase();
}

function playerName(uid, players) {
    const p = players[uid];
    return p?.displayName ?? p?.eaId ?? `User`;
}

function winRateLabel(record) {
    const total = record.wins + record.losses;
    if (total === 0) return '—';
    return `${Math.round(record.wins / total * 100)}%`;
}

function sortRecords(records) {
    return Object.entries(records).sort(([, a], [, b]) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return a.losses - b.losses;
    });
}

function buildLeaderboardEmbed(records, players) {
    const sorted = sortRecords(records);

    if (sorted.length === 0) {
        return new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('⚔️  2v2 Kill Race — Leaderboard')
            .setDescription('No matches played yet. Be the first to queue up.')
            .setFooter({ text: 'Redsec · 2v2 Kill Race' })
            .setTimestamp();
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = sorted.map(([uid, r], i) => {
        const name = playerName(uid, players);
        const rank = medals[i] ?? `\`#${i + 1}\``;
        return `${rank}  **${name}**  ·  ${r.wins}W ${r.losses}L  (${winRateLabel(r)})`;
    });

    return new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle('⚔️  2v2 Kill Race — Leaderboard')
        .setDescription(lines.join('\n').slice(0, 4000))
        .setFooter({ text: 'Redsec · 2v2 Kill Race — updates after every match' })
        .setTimestamp();
}

async function updateKillRaceLeaderboard(client) {
    const config = loadKillRaceConfig();
    if (!config?.leaderboardMessageId || !config?.leaderboardChannelId) return;
    const ch = await client.channels.fetch(config.leaderboardChannelId).catch(() => null);
    if (!ch) return;
    const msg = await ch.messages.fetch(config.leaderboardMessageId).catch(() => null);
    if (!msg) return;
    await msg.edit({ embeds: [buildLeaderboardEmbed(loadRecords(), loadPlayers())] }).catch(() => {});
}

function buildQueueEmbed(match, players) {
    const slot = (team, i) => {
        const uid = match[team][i];
        return uid ? `<@${uid}> · ${playerName(uid, players)}` : '*Open*';
    };

    const allFull = match.team1.length >= 2 && match.team2.length >= 2;

    return new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle(`⚔️  2v2 Kill Race — #${match.id}`)
        .addFields(
            { name: '🔴  Team 1', value: `${slot('team1', 0)}\n${slot('team1', 1)}`, inline: true },
            { name: '🔵  Team 2', value: `${slot('team2', 0)}\n${slot('team2', 1)}`, inline: true },
        )
        .setFooter({ text: allFull ? 'All slots filled — starting match…' : 'Click a button below to join!' })
        .setTimestamp();
}

async function resolveMatch(client, match, winnerTeam) {
    const records = loadRecords();
    const team1Won = winnerTeam === 'team1';

    for (const uid of match.team1) {
        records[uid] ??= { wins: 0, losses: 0 };
        if (team1Won) records[uid].wins++; else records[uid].losses++;
    }
    for (const uid of match.team2) {
        records[uid] ??= { wins: 0, losses: 0 };
        if (!team1Won) records[uid].wins++; else records[uid].losses++;
    }
    saveRecords(records);

    for (const vcId of [match.vc1Id, match.vc2Id]) {
        if (!vcId) continue;
        const vc = await client.channels.fetch(vcId).catch(() => null);
        if (vc) await vc.delete().catch(() => {});
    }

    await updateKillRaceLeaderboard(client);
}

async function checkKillRaceQueues(client) {
    const matches = loadMatches();
    const config  = loadKillRaceConfig();
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
    loadMatches, saveMatches, loadRecords, saveRecords,
    loadKillRaceConfig, saveKillRaceConfig, loadPlayers,
    playerName, sortRecords, winRateLabel,
    buildLeaderboardEmbed, buildQueueEmbed,
    updateKillRaceLeaderboard, resolveMatch, checkKillRaceQueues, newMatchId,
};
