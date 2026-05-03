const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder, PermissionFlagsBits, ChannelType,
} = require('discord.js');
const {
    loadMatches, saveMatches, loadRatings, loadXpConfig, loadPlayers,
    getOrCreateRating, newMatchId, fmtIndex, playerName,
    buildQueueEmbed, resolveMatch, updateXpLeaderboard,
} = require('../utils/xpMatch');

function isInMatch(matches, userId) {
    return Object.values(matches).some(
        m => m.status === 'open' && (m.team1.includes(userId) || m.team2.includes(userId))
    );
}

// ── xp_start — posted by /setup-xp; clicking creates a new match queue ────────
async function handleXpStart(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const config = loadXpConfig();
    if (!config?.queueChannelId) {
        return interaction.editReply('XP system not set up. Ask an admin to run `/setup-xp`.');
    }

    const matches = loadMatches();
    if (isInMatch(matches, interaction.user.id)) {
        return interaction.editReply('You are already in an open match queue.');
    }

    const matchId = newMatchId();
    matches[matchId] = {
        id:             matchId,
        guildId:        interaction.guildId,
        status:         'open',
        team1:          [],
        team2:          [],
        vc1Id:          null,
        vc2Id:          null,
        queueMessageId: null,
        reports:        {},
        winner:         null,
        createdAt:      new Date().toISOString(),
    };
    saveMatches(matches);

    const players = loadPlayers();
    const embed   = buildQueueEmbed(matches[matchId], players);
    const row     = buildJoinRow(matchId, false, false);

    const ch  = await interaction.client.channels.fetch(config.queueChannelId).catch(() => null);
    if (!ch) return interaction.editReply('Queue channel not found.');

    const msg = await ch.send({ embeds: [embed], components: [row] });

    matches[matchId].queueMessageId = msg.id;
    saveMatches(matches);

    return interaction.editReply(`Match **#${matchId}** created in <#${config.queueChannelId}>!`);
}

function buildJoinRow(matchId, t1Full, t2Full) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`xp_join:${matchId}:1`)
            .setLabel('Join Team 1')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(t1Full),
        new ButtonBuilder()
            .setCustomId(`xp_join:${matchId}:2`)
            .setLabel('Join Team 2')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(t2Full),
        new ButtonBuilder()
            .setCustomId(`xp_leave:${matchId}`)
            .setLabel('Leave Queue')
            .setStyle(ButtonStyle.Secondary),
    );
}

// ── xp_join — join a team slot ────────────────────────────────────────────────
async function handleXpJoin(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const [, matchId, teamNum] = interaction.customId.split(':');
    const teamKey = `team${teamNum}`;

    const matches = loadMatches();
    const match   = matches[matchId];
    if (!match || match.status !== 'open') {
        return interaction.editReply('This match is no longer open.');
    }

    const userId = interaction.user.id;

    // Already on this team
    if (match[teamKey].includes(userId)) {
        return interaction.editReply('You are already on this team.');
    }
    // On the other team
    const otherKey = teamKey === 'team1' ? 'team2' : 'team1';
    if (match[otherKey].includes(userId)) {
        return interaction.editReply('You are already on the other team.');
    }
    // In another open match
    const otherMatch = Object.values(matches).find(
        m => m.id !== matchId && m.status === 'open' &&
             (m.team1.includes(userId) || m.team2.includes(userId))
    );
    if (otherMatch) return interaction.editReply('You are already in another open match queue.');

    if (match[teamKey].length >= 2) {
        return interaction.editReply('That team is already full.');
    }

    match[teamKey].push(userId);
    saveMatches(matches);

    const players = loadPlayers();
    const config  = loadXpConfig();

    const t1Full = match.team1.length >= 2;
    const t2Full = match.team2.length >= 2;
    const allFull = t1Full && t2Full;

    const embed = buildQueueEmbed(match, players);
    const row   = buildJoinRow(matchId, t1Full, t2Full);

    if (config?.queueChannelId && match.queueMessageId) {
        const ch = await interaction.client.channels.fetch(config.queueChannelId).catch(() => null);
        if (ch) {
            const msg = await ch.messages.fetch(match.queueMessageId).catch(() => null);
            if (msg) {
                await msg.edit({
                    embeds:     [embed],
                    components: allFull ? [] : [row],
                }).catch(() => {});
            }
        }
    }

    await interaction.editReply(`You joined **Team ${teamNum}** for match **#${matchId}**!`);

    if (allFull) {
        await startActivePhase(interaction.client, match, matches, config, players);
    }
}

async function startActivePhase(client, match, matches, config, players) {
    match.status = 'active';

    const guild = await client.guilds.fetch(match.guildId).catch(() => null);
    if (!guild || !config?.categoryId) { saveMatches(matches); return; }

    // Create team VCs
    const vc1 = await guild.channels.create({
        name:   `🔴 Team 1 — #${match.id}`,
        type:   ChannelType.GuildVoice,
        parent: config.categoryId,
    }).catch(() => null);

    const vc2 = await guild.channels.create({
        name:   `🔵 Team 2 — #${match.id}`,
        type:   ChannelType.GuildVoice,
        parent: config.categoryId,
    }).catch(() => null);

    if (vc1) match.vc1Id = vc1.id;
    if (vc2) match.vc2Id = vc2.id;
    saveMatches(matches);

    // Move players to VCs
    const moveMembers = async (uids, vc) => {
        if (!vc) return;
        for (const uid of uids) {
            const member = await guild.members.fetch(uid).catch(() => null);
            if (member?.voice?.channelId) await member.voice.setChannel(vc).catch(() => {});
        }
    };
    await moveMembers(match.team1, vc1);
    await moveMembers(match.team2, vc2);

    // Determine host team (lower combined Redsec Index = more skilled = host)
    const idx1 = match.team1.reduce((s, uid) => s + (players[uid]?.redsecIndex ?? 0), 0);
    const idx2 = match.team2.reduce((s, uid) => s + (players[uid]?.redsecIndex ?? 0), 0);
    const hostTeam   = idx1 <= idx2 ? 1 : 2;
    const hostIdx    = hostTeam === 1 ? idx1 : idx2;

    const activeEmbed = new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle(`✅  Match #${match.id} — IN PROGRESS`)
        .addFields(
            { name: '🔴  Team 1', value: match.team1.map(u => `<@${u}> · ${playerName(u, players)}`).join('\n'), inline: true },
            { name: '🔵  Team 2', value: match.team2.map(u => `<@${u}> · ${playerName(u, players)}`).join('\n'), inline: true },
            {
                name:  `🏠  Host: Team ${hostTeam}`,
                value: `Combined index: \`${fmtIndex(hostIdx)}\`\nCreate the in-game custom lobby — the other team will join you.`,
                inline: false,
            },
        )
        .setFooter({ text: 'Both teams report the result when done.' })
        .setTimestamp();

    const reportRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`xp_report:${match.id}`)
            .setLabel('Report Result')
            .setStyle(ButtonStyle.Primary),
    );

    if (config?.queueChannelId && match.queueMessageId) {
        const ch = await client.channels.fetch(config.queueChannelId).catch(() => null);
        if (ch) {
            const msg = await ch.messages.fetch(match.queueMessageId).catch(() => null);
            if (msg) await msg.edit({ embeds: [activeEmbed], components: [reportRow] }).catch(() => {});
        }
    }
}

// ── xp_leave — leave open queue ───────────────────────────────────────────────
async function handleXpLeave(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const [, matchId] = interaction.customId.split(':');
    const matches = loadMatches();
    const match   = matches[matchId];

    if (!match || match.status !== 'open') {
        return interaction.editReply('This match is no longer in the queue phase.');
    }

    const userId = interaction.user.id;
    const onTeam1 = match.team1.includes(userId);
    const onTeam2 = match.team2.includes(userId);

    if (!onTeam1 && !onTeam2) {
        return interaction.editReply('You are not in this match.');
    }

    // If the user is the only person and created the match (team1[0]), cancel it
    const totalPlayers = match.team1.length + match.team2.length;
    if (totalPlayers === 1) {
        const config = loadXpConfig();
        if (config?.queueChannelId && match.queueMessageId) {
            const ch = await interaction.client.channels.fetch(config.queueChannelId).catch(() => null);
            if (ch) {
                const msg = await ch.messages.fetch(match.queueMessageId).catch(() => null);
                if (msg) await msg.edit({ content: '❌ Match cancelled — host left the queue.', embeds: [], components: [] }).catch(() => {});
            }
        }
        delete matches[matchId];
        saveMatches(matches);
        return interaction.editReply('You left and the match was cancelled.');
    }

    if (onTeam1) match.team1 = match.team1.filter(u => u !== userId);
    if (onTeam2) match.team2 = match.team2.filter(u => u !== userId);
    saveMatches(matches);

    const players = loadPlayers();
    const config  = loadXpConfig();
    const embed   = buildQueueEmbed(match, players);
    const row     = buildJoinRow(matchId, match.team1.length >= 2, match.team2.length >= 2);

    if (config?.queueChannelId && match.queueMessageId) {
        const ch = await interaction.client.channels.fetch(config.queueChannelId).catch(() => null);
        if (ch) {
            const msg = await ch.messages.fetch(match.queueMessageId).catch(() => null);
            if (msg) await msg.edit({ embeds: [embed], components: [row] }).catch(() => {});
        }
    }

    return interaction.editReply(`You left match **#${matchId}**.`);
}

// ── xp_report — show ephemeral "who won?" buttons ────────────────────────────
async function handleXpReport(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const [, matchId] = interaction.customId.split(':');
    const matches = loadMatches();
    const match   = matches[matchId];

    if (!match || (match.status !== 'active' && match.status !== 'reporting')) {
        return interaction.editReply('This match is not in a reportable state.');
    }

    const userId = interaction.user.id;
    if (!match.team1.includes(userId) && !match.team2.includes(userId)) {
        return interaction.editReply('Only players in this match can report the result.');
    }

    if (match.reports[userId]) {
        return interaction.editReply('You have already submitted a report for this match.');
    }

    const players = loadPlayers();
    const t1Names = match.team1.map(u => playerName(u, players)).join(' & ');
    const t2Names = match.team2.map(u => playerName(u, players)).join(' & ');

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`xp_report_winner:${matchId}:team1`)
            .setLabel(`🔴 Team 1 Won  (${t1Names})`)
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`xp_report_winner:${matchId}:team2`)
            .setLabel(`🔵 Team 2 Won  (${t2Names})`)
            .setStyle(ButtonStyle.Primary),
    );

    return interaction.editReply({ content: `**Match #${matchId}** — who won?`, components: [row] });
}

// ── xp_report_winner — record vote, check agreement ──────────────────────────
async function handleXpReportWinner(interaction) {
    await interaction.deferUpdate();

    const [, matchId, reportedWinner] = interaction.customId.split(':');
    const matches = loadMatches();
    const match   = matches[matchId];

    if (!match || (match.status !== 'active' && match.status !== 'reporting')) {
        return interaction.editReply({ content: 'This match is no longer active.', components: [] });
    }

    const userId = interaction.user.id;
    if (!match.team1.includes(userId) && !match.team2.includes(userId)) {
        return interaction.editReply({ content: 'You are not in this match.', components: [] });
    }

    if (match.reports[userId]) {
        return interaction.editReply({ content: 'You already submitted a report.', components: [] });
    }

    match.reports[userId]  = reportedWinner;
    match.status           = 'reporting';
    saveMatches(matches);

    // Check if we have one report from each team side
    const t1Reports = match.team1.filter(u => match.reports[u]);
    const t2Reports = match.team2.filter(u => match.reports[u]);

    await interaction.editReply({ content: `Report recorded. Waiting for the other team to report.`, components: [] });

    if (t1Reports.length === 0 || t2Reports.length === 0) return;

    // Get first report from each side
    const vote1 = match.reports[t1Reports[0]];
    const vote2 = match.reports[t2Reports[0]];

    if (vote1 === vote2) {
        // Agreement — resolve
        const config  = loadXpConfig();
        const result  = await resolveMatch(interaction.client, match, vote1);
        match.status  = 'complete';
        match.winner  = vote1;
        saveMatches(matches);
        await postMatchLog(interaction.client, match, result, config, false);
    } else {
        // Dispute
        match.status = 'disputed';
        saveMatches(matches);
        const config = loadXpConfig();
        await postDisputeLog(interaction.client, match, config);
    }
}

// ── xp_mod_resolve — admin/mod overrides disputed match ──────────────────────
async function handleXpModResolve(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    const isMod   = interaction.member.roles.cache.some(r => r.name === 'Moderator');
    if (!isAdmin && !isMod) {
        return interaction.editReply('Only Administrators or Moderators can resolve disputes.');
    }

    const [, matchId, winnerTeam] = interaction.customId.split(':');
    const matches = loadMatches();
    const match   = matches[matchId];

    if (!match || match.status !== 'disputed') {
        return interaction.editReply('This match is not in a disputed state.');
    }

    const config = loadXpConfig();
    const result = await resolveMatch(interaction.client, match, winnerTeam);
    match.status = 'complete';
    match.winner = winnerTeam;
    saveMatches(matches);

    await postMatchLog(interaction.client, match, result, config, true);

    // Disable mod buttons on the dispute message
    if (config?.logChannelId && match.disputeMessageId) {
        const ch = await interaction.client.channels.fetch(config.logChannelId).catch(() => null);
        if (ch) {
            const msg = await ch.messages.fetch(match.disputeMessageId).catch(() => null);
            if (msg) await msg.edit({ components: [] }).catch(() => {});
        }
    }

    return interaction.editReply(`Match **#${matchId}** resolved. **${winnerTeam === 'team1' ? 'Team 1' : 'Team 2'}** wins.`);
}

// ── Helpers for log channel embeds ───────────────────────────────────────────

async function postMatchLog(client, match, result, config, byMod) {
    if (!config?.logChannelId) return;
    const ch = await client.channels.fetch(config.logChannelId).catch(() => null);
    if (!ch) return;

    const players    = require('../utils/xpMatch').loadPlayers();
    const winnerTeam = result.team1Won ? 'team1' : 'team2';
    const loserTeam  = result.team1Won ? 'team2' : 'team1';

    const winNames  = match[winnerTeam].map(u => `<@${u}> · ${playerName(u, players)}`).join('\n');
    const loseNames = match[loserTeam].map(u => `<@${u}> · ${playerName(u, players)}`).join('\n');

    const embed = new EmbedBuilder()
        .setColor(0x00CC44)
        .setTitle(`✅  Match #${match.id} Complete${byMod ? ' (Mod Override)' : ''}`)
        .addFields(
            { name: `🏆 Winners (${winnerTeam === 'team1' ? 'Team 1' : 'Team 2'})`, value: winNames, inline: true },
            { name: `❌ Losers (${loserTeam === 'team1' ? 'Team 1' : 'Team 2'})`,   value: loseNames, inline: true },
            {
                name:  'XP Changes',
                value: `Winners: **${result.team1Won ? `+${result.delta1}` : `+${result.delta2}`}** XP\nLosers: **${result.team1Won ? result.delta2 : result.delta1}** XP`,
                inline: false,
            },
            {
                name:  'Team Index',
                value: `Team 1: \`${fmtIndex(result.idx1)}\`  ·  Team 2: \`${fmtIndex(result.idx2)}\``,
                inline: false,
            },
        )
        .setFooter({ text: 'Redsec · XP Ranked' })
        .setTimestamp();

    await ch.send({ embeds: [embed] }).catch(() => {});
}

async function postDisputeLog(client, match, config) {
    if (!config?.logChannelId) return;
    const ch = await client.channels.fetch(config.logChannelId).catch(() => null);
    if (!ch) return;

    const players = require('../utils/xpMatch').loadPlayers();

    const t1Names = match.team1.map(u => `<@${u}> · ${playerName(u, players)}`).join('\n');
    const t2Names = match.team2.map(u => `<@${u}> · ${playerName(u, players)}`).join('\n');

    const reportLines = Object.entries(match.reports).map(([uid, winner]) => {
        const name = playerName(uid, players);
        return `<@${uid}> (${name}) reported **${winner === 'team1' ? 'Team 1' : 'Team 2'}** won`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setColor(0xFF9900)
        .setTitle(`⚠️  Disputed Match #${match.id}`)
        .addFields(
            { name: '🔴  Team 1', value: t1Names, inline: true },
            { name: '🔵  Team 2', value: t2Names, inline: true },
            { name: 'Conflicting Reports', value: reportLines || 'None recorded', inline: false },
        )
        .setDescription('Moderators: review and resolve below.')
        .setFooter({ text: 'Redsec · XP Ranked — Dispute' })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`xp_mod_resolve:${match.id}:team1`)
            .setLabel('Team 1 Wins')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(`xp_mod_resolve:${match.id}:team2`)
            .setLabel('Team 2 Wins')
            .setStyle(ButtonStyle.Primary),
    );

    const msg = await ch.send({ embeds: [embed], components: [row] }).catch(() => null);
    if (msg) {
        const matches = loadMatches();
        if (matches[match.id]) {
            matches[match.id].disputeMessageId = msg.id;
            saveMatches(matches);
        }
    }
}

module.exports = {
    handleXpStart,
    handleXpJoin,
    handleXpLeave,
    handleXpReport,
    handleXpReportWinner,
    handleXpModResolve,
};
