const { EmbedBuilder } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const DATA_DIR     = require('./dataDir');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const MAX_PLAYERS  = 50;

function loadPlayers() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch { return {}; }
}

function getTier(index) {
    if (index >= 6)  return 'Recruit';
    if (index >= 2)  return 'Scout';
    if (index > -2)  return 'Sentinel';
    if (index > -6)  return 'Vanguard';
    if (index > -10) return 'Operator';
    return 'Phantom';
}

function formatIndex(index) {
    return (index >= 0 ? '+' : '') + index.toFixed(1);
}

function buildServerLeaderboardEmbed() {
    const players = loadPlayers();
    const sorted  = Object.entries(players)
        .filter(([, p]) => typeof p.redsecIndex === 'number' && p.eaId)
        .sort(([, a], [, b]) => a.redsecIndex - b.redsecIndex)
        .slice(0, MAX_PLAYERS);

    if (sorted.length === 0) return null;

    const header = ` RK    NAME                     IDX     TIER`;
    const sep    = ' ' + '─'.repeat(header.length);
    const lines  = sorted.map(([, p], i) => {
        const rk   = `#${i + 1}`.padEnd(5);
        const name = (p.displayName ?? p.eaId).slice(0, 22).padEnd(22);
        const idx  = formatIndex(p.redsecIndex).padStart(5);
        const tier = getTier(p.redsecIndex).padEnd(8);
        return ` ${rk} ${name}  ${idx}   ${tier}`;
    });

    return new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle('🏆  Redsec — Server Player Rankings')
        .setDescription(
            `Sorted by Redsec Index\n` +
            `Showing **${sorted.length}** verified player${sorted.length !== 1 ? 's' : ''}\n\n` +
            `\`\`\`\n${[header, sep, ...lines].join('\n')}\n\`\`\``
        )
        .setFooter({ text: 'Updated automatically after every /verify and /update' })
        .setTimestamp();
}

// Returns "#N of M" for the given userId based on the same sort the leaderboard uses
// (redsecIndex ascending — lower index = more skilled = higher rank). Returns null if
// the player isn't on the leaderboard (no redsecIndex or no eaId).
function getServerRank(userId, players = loadPlayers()) {
    const ranked = Object.entries(players)
        .filter(([, p]) => typeof p.redsecIndex === 'number' && p.eaId)
        .sort(([, a], [, b]) => a.redsecIndex - b.redsecIndex);
    const idx = ranked.findIndex(([uid]) => uid === userId);
    if (idx === -1) return null;
    return `#${idx + 1} of ${ranked.length}`;
}

async function postServerLeaderboard(channel) {
    const embed = buildServerLeaderboardEmbed();
    if (!embed) return;

    const messages = await channel.messages.fetch({ limit: 100 });
    if (messages.size > 0) {
        await channel.bulkDelete(messages).catch(() => {});
    }

    await channel.send({ embeds: [embed] });
}

module.exports = { buildServerLeaderboardEmbed, postServerLeaderboard, getServerRank };
