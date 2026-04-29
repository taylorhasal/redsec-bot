const { EmbedBuilder } = require('discord.js');
const { teamScoreSummary } = require('./tournament');

function idxLabel(teamIndex) {
    const s = Math.abs(teamIndex).toFixed(1);
    return teamIndex >= 0 ? `+${s}` : `-${s}`;
}

function sortTeams(teams, scoreKey) {
    return [...teams].sort((a, b) => {
        if (b.s[scoreKey] !== a.s[scoreKey])           return b.s[scoreKey] - a.s[scoreKey];
        if (b.s.bestGameKills !== a.s.bestGameKills)   return b.s.bestGameKills - a.s.bestGameKills;
        return a.s.bestGamePlacement - b.s.bestGamePlacement;
    });
}

function isTied(a, b, scoreKey) {
    return a.s[scoreKey]           === b.s[scoreKey] &&
           a.s.bestGameKills       === b.s.bestGameKills &&
           a.s.bestGamePlacement   === b.s.bestGamePlacement;
}

function computeRanks(sorted, scoreKey) {
    const ranks = [];
    let i = 0, rankNum = 1;
    while (i < sorted.length) {
        let j = i + 1;
        while (j < sorted.length && isTied(sorted[j - 1], sorted[j], scoreKey)) j++;
        const groupSize = j - i;
        for (let k = i; k < j; k++) ranks.push(groupSize > 1 ? 'TIE' : `#${rankNum}`);
        rankNum += groupSize;
        i = j;
    }
    return ranks;
}

function hasUnofficialTop2(team) {
    const allScores = Object.values(team.scores ?? {}).filter(g => g != null);
    const top2 = [...allScores].sort((a, b) => b.gamePoints - a.gamePoints).slice(0, 2);
    return top2.some(g => g.status !== 'official' && g.pending !== false);
}

function buildTable(sorted, scoreKey) {
    const colHdr = scoreKey === 'gross' ? 'GROSS' : '  NET';
    const header = ` RK    TEAM (IDX)              SUBM  ${colHdr}`;
    const sep    = ' ' + '─'.repeat(header.length);

    if (sorted.length === 0) {
        return [header, sep, '  No teams registered yet.'].join('\n');
    }

    const ranks = computeRanks(sorted, scoreKey);

    const lines = sorted.map((t, i) => {
        const rkS   = ranks[i].padEnd(5);
        const flag  = hasUnofficialTop2(t) ? '†' : ' ';
        const nameS = `${t.name}${flag} (${idxLabel(t.teamIndex)})`.slice(0, 23).padEnd(23);
        const prog  = `${t.s.official}/${t.s.submitted}`.padEnd(4);
        const score = scoreKey === 'gross'
            ? String(t.s.gross).padStart(5)
            : t.s.net.toFixed(1).padStart(6);
        return ` ${rkS} ${nameS}  ${prog} ${score}`;
    });

    return [header, sep, ...lines].join('\n');
}

function buildLeaderboardEmbed(tournament) {
    const teams = Object.values(tournament.teams ?? {})
        .map(t => ({ ...t, s: teamScoreSummary(t) }));

    const grossSorted = sortTeams(teams, 'gross');
    const netSorted   = sortTeams(teams, 'net');

    return new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle(`🏆  ${tournament.name} — Live Standings`)
        .addFields(
            {
                name:   '🎯  Gross Leaderboard',
                value:  `\`\`\`\n${buildTable(grossSorted, 'gross')}\n\`\`\``,
                inline: false,
            },
            {
                name:   '🏆  Net Leaderboard',
                value:  `\`\`\`\n${buildTable(netSorted, 'net')}\n\`\`\``,
                inline: false,
            },
        )
        .setFooter({ text: `${tournament.name} · † unofficial · off/sub · Tie-break: kills → placement → TIE` })
        .setTimestamp();
}

async function updateLeaderboard(client, tournament) {
    const { liveLeaderboard, leaderboardMessageId } = tournament?.channels ?? {};
    if (!liveLeaderboard || !leaderboardMessageId) return;

    try {
        const channel = await client.channels.fetch(liveLeaderboard);
        const message = await channel.messages.fetch(leaderboardMessageId);
        await message.edit({ embeds: [buildLeaderboardEmbed(tournament)] });
    } catch (err) {
        console.error('[Leaderboard] Failed to update:', err.message);
    }
}

module.exports = { buildLeaderboardEmbed, updateLeaderboard };
