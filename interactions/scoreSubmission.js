const {
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, EmbedBuilder, ChannelType,
    ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { loadAll, loadByChannel, save, getPlacementPoints, teamScoreSummary } = require('../utils/tournament');
const { updateLeaderboard } = require('../utils/leaderboard');

const DEADLINE_MS = (2 * 60 + 35) * 60 * 1000; // 2 h 35 m

function isPastDeadline(tournament) {
    if (!tournament.startedAt) return false;
    return Date.now() > new Date(tournament.startedAt).getTime() + DEADLINE_MS;
}

function scoreStatus(score) {
    if (!score) return null;
    if (score.status) return score.status;
    return score.pending === false ? 'official' : 'unofficial';
}

// ── Step 1: Button — submit_score ────────────────────────────────────────────
async function handleSubmitScoreButton(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('score_modal')
        .setTitle('Submit Game Score');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('game_number')
                .setLabel('Game Number (e.g. 1, 2, 3...)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('1')
                .setMaxLength(3)
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('team_kills')
                .setLabel('Total Team Kills')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('42')
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('placement')
                .setLabel('Placement Rank (e.g. 1, 2, 3...)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('1')
                .setRequired(true)
        )
    );

    await interaction.showModal(modal);
}

// ── Step 2: Modal — score_modal ──────────────────────────────────────────────
async function handleScoreModal(interaction, client) {
    const gameNumber = parseInt(interaction.fields.getTextInputValue('game_number').trim());
    const kills      = parseInt(interaction.fields.getTextInputValue('team_kills').trim());
    const placement  = parseInt(interaction.fields.getTextInputValue('placement').trim());

    if (isNaN(gameNumber) || gameNumber < 1) {
        return interaction.reply({ content: 'Game Number must be a positive number (1, 2, 3...).', ephemeral: true });
    }
    if (isNaN(kills) || kills < 0) {
        return interaction.reply({ content: 'Team Kills must be a valid number (0 or higher).', ephemeral: true });
    }
    if (isNaN(placement) || placement < 1) {
        return interaction.reply({ content: 'Placement must be a valid rank (1 or higher).', ephemeral: true });
    }

    const tournament = loadByChannel(interaction.channelId);
    if (!tournament) {
        return interaction.reply({ content: 'No active tournament found.', ephemeral: true });
    }

    if (isPastDeadline(tournament)) {
        return interaction.reply({
            content: '⛔ The submission window has closed (2 h 35 m after tournament start). No further scores will be accepted.',
            ephemeral: true,
        });
    }

    const teamEntry = Object.entries(tournament.teams)
        .find(([, t]) => t.captainId === interaction.user.id);

    if (!teamEntry) {
        return interaction.reply({
            content: 'You are not registered as a team captain in this tournament.',
            ephemeral: true,
        });
    }

    const [teamId, team] = teamEntry;
    const gameKey = `game${gameNumber}`;
    const existing = tournament.teams[teamId].scores[gameKey];

    if (existing) {
        const st = scoreStatus(existing);
        if (st === 'pending' || st === 'official') {
            return interaction.reply({
                content: `Game ${gameNumber} has already been submitted for **${team.name}** (${st}). Use **Manage Submissions** to delete it first.`,
                ephemeral: true,
            });
        }
        // unofficial — allow overwrite (treat as edit)
    }

    await interaction.deferReply({ ephemeral: true });

    const killPoints      = kills;
    const placementPoints = getPlacementPoints(placement);
    const gamePoints      = killPoints + placementPoints;

    tournament.teams[teamId].scores[gameKey] = {
        kills,
        placement,
        killPoints,
        placementPoints,
        gamePoints,
        status:      'unofficial',
        submittedAt: new Date().toISOString(),
    };
    save(tournament);
    await updateLeaderboard(client, tournament);

    const embed = new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle('📋  Score Submitted — Unofficial')
        .setDescription('Your score is live on the leaderboard. Use **Manage Submissions → Submit Proof** after the tournament to get it officially confirmed.')
        .addFields(
            { name: '🏷️ Team',             value: `\`${team.name}\``,      inline: true },
            { name: '🎮 Game',              value: `\`Game ${gameNumber}\``, inline: true },
            { name: '​',               value: '​',                  inline: true },
            { name: '💀 Kills',            value: `\`${kills}\``,           inline: true },
            { name: '🏆 Placement',        value: `\`#${placement}\``,      inline: true },
            { name: '📊 Game Points',      value: `\`${gamePoints}\``,      inline: true },
            { name: '🔫 Kill Points',      value: `\`${killPoints}\``,      inline: true },
            { name: '🎖️ Placement Points', value: `\`${placementPoints}\``, inline: true },
        )
        .setFooter({ text: 'Redsec Tournament · Appears on leaderboard as unofficial' })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

// ── Step 3: messageCreate — evidence screenshot detection ────────────────────
async function handleEvidenceMessage(message, client) {
    if (message.author.bot)             return;
    if (!message.channel.isThread())    return;
    if (message.attachments.size === 0) return;

    // Find which tournament this thread belongs to
    const all = loadAll();
    let tournament, teamId, gameKey;

    outer: for (const t of Object.values(all)) {
        for (const [tid, team] of Object.entries(t.teams ?? {})) {
            for (const [gk, score] of Object.entries(team.scores ?? {})) {
                if (score?.evidenceThreadId === message.channel.id) {
                    tournament = t; teamId = tid; gameKey = gk;
                    break outer;
                }
            }
        }
    }

    if (!tournament) return;

    const team  = tournament.teams[teamId];
    const score = team.scores[gameKey];
    if (!score) return;

    const st = scoreStatus(score);
    if (st !== 'unofficial') return; // already pending or official

    if (message.author.id !== team.captainId) {
        await message.reply('Only the team captain can submit evidence for this score.');
        return;
    }

    tournament.teams[teamId].scores[gameKey].status = 'pending';
    save(tournament);

    await message.reply('📸  Screenshot received — awaiting admin review.');

    // Notify admin-audit
    const guild = client.guilds.cache.get(tournament.guildId);
    if (!guild) return;
    const auditCh = guild.channels.cache.find(c => c.name.includes('admin-audit'));
    if (!auditCh) return;

    const gameLabel = gameKey.replace('game', 'Game ');
    const { gross, net, handicap } = teamScoreSummary(team);
    const hcSign = handicap >= 0 ? `+${handicap.toFixed(1)}` : `${handicap.toFixed(1)}`;

    const embed = new EmbedBuilder()
        .setColor(0xffaa00)
        .setTitle(`🔍  Score Proof — ${team.name} · ${gameLabel}`)
        .addFields(
            { name: '🏷️ Team',             value: `\`${team.name}\``,           inline: true },
            { name: '🎮 Game',              value: `\`${gameLabel}\``,            inline: true },
            { name: '​',               value: '​',                       inline: true },
            { name: '💀 Kills',            value: `\`${score.kills}\``,           inline: true },
            { name: '🏆 Placement',        value: `\`#${score.placement}\``,      inline: true },
            { name: '📊 Game Points',      value: `\`${score.gamePoints}\``,      inline: true },
            { name: '📈 Team Gross',       value: `\`${gross} pts\``,             inline: true },
            { name: '🏆 Team Net',         value: `\`${net} pts\``,               inline: true },
            { name: '📊 Handicap',         value: `\`${hcSign}\``,                inline: true },
        )
        .setFooter({ text: `Tournament: ${tournament.name} · Screenshot in thread` })
        .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`score_approve:${tournament.id}:${teamId}:${gameKey}`)
            .setLabel('✅  Approve')
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId(`score_reject:${tournament.id}:${teamId}:${gameKey}`)
            .setLabel('❌  Reject')
            .setStyle(ButtonStyle.Danger),
    );

    await auditCh.send({ embeds: [embed], components: [row] });
}

// ── Manage Scores: Button — manage_scores ────────────────────────────────────
async function handleManageScoresButton(interaction) {
    const tournament = loadByChannel(interaction.channelId);
    if (!tournament) return interaction.reply({ content: 'No active tournament found.', ephemeral: true });

    const teamEntry = Object.entries(tournament.teams)
        .find(([, t]) => t.captainId === interaction.user.id);

    if (!teamEntry) {
        return interaction.reply({
            content: 'Only team captains can manage score submissions.',
            ephemeral: true,
        });
    }

    const [teamId, team] = teamEntry;
    const lines   = [];
    const buttons = [];
    const past    = isPastDeadline(tournament);

    const sorted = Object.entries(team.scores)
        .filter(([, s]) => s != null)
        .sort(([a], [b]) => parseInt(a.replace('game', '')) - parseInt(b.replace('game', '')));

    const allKeys = ['game1', 'game2'];
    // Show submitted games plus game1/game2 placeholders if not submitted
    const displayKeys = [...new Set([...allKeys, ...Object.keys(team.scores)])].sort(
        (a, b) => parseInt(a.replace('game', '')) - parseInt(b.replace('game', ''))
    );

    for (const gameKey of displayKeys) {
        const score = team.scores[gameKey];
        const label = gameKey.replace('game', 'Game ');
        if (!score) {
            lines.push(`**${label}:** Not submitted`);
        } else {
            const st = scoreStatus(score);
            const statusIcon = st === 'official' ? '✅ Official' : st === 'pending' ? '🔍 Pending Review' : '⏳ Unofficial';
            lines.push(`**${label}:** ${statusIcon} — Kills: \`${score.kills}\` · Placement: \`#${score.placement}\` · Points: \`${score.gamePoints}\``);
            if (!past) {
                if (st === 'unofficial') {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`score_proof:${teamId}:${gameKey}`)
                            .setLabel(`Submit Proof: ${label}`)
                            .setStyle(ButtonStyle.Primary),
                        new ButtonBuilder()
                            .setCustomId(`score_edit:${teamId}:${gameKey}`)
                            .setLabel(`Edit ${label}`)
                            .setStyle(ButtonStyle.Secondary),
                        new ButtonBuilder()
                            .setCustomId(`score_delete:${teamId}:${gameKey}`)
                            .setLabel(`Delete ${label}`)
                            .setStyle(ButtonStyle.Danger)
                    );
                } else {
                    buttons.push(
                        new ButtonBuilder()
                            .setCustomId(`score_delete:${teamId}:${gameKey}`)
                            .setLabel(`Delete ${label}`)
                            .setStyle(ButtonStyle.Danger)
                    );
                }
            }
        }
    }

    // Chunk buttons into rows of max 5
    const components = [];
    for (let i = 0; i < buttons.length; i += 5) {
        components.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
        if (components.length >= 5) break;
    }

    const footer = past
        ? '\n\n⛔ The submission window has closed — scores can no longer be modified.'
        : '';

    await interaction.reply({
        content: `📊  **${team.name}** — Score Submissions\n\n${lines.join('\n')}${footer}`,
        components,
        ephemeral: true,
    });
}

// ── Submit Proof: Button — score_proof:{teamId}:{gameKey} ────────────────────
async function handleSubmitProofButton(interaction) {
    const [, teamId, gameKey] = interaction.customId.split(':');

    const tournament = loadByChannel(interaction.channelId);
    if (!tournament) return interaction.reply({ content: 'No active tournament found.', ephemeral: true });

    const team = tournament.teams[teamId];
    if (!team) return interaction.reply({ content: 'Team not found.', ephemeral: true });

    if (interaction.user.id !== team.captainId) {
        return interaction.reply({ content: 'Only the team captain can submit proof.', ephemeral: true });
    }

    const score = team.scores[gameKey];
    if (!score) return interaction.reply({ content: 'Score not found.', ephemeral: true });

    if (scoreStatus(score) !== 'unofficial') {
        return interaction.reply({ content: 'Proof has already been submitted for this game.', ephemeral: true });
    }

    // Re-use existing thread if still open
    if (score.evidenceThreadId) {
        const existing = await interaction.client.channels.fetch(score.evidenceThreadId).catch(() => null);
        if (existing && !existing.archived) {
            return interaction.reply({
                content: `Your evidence thread is already open: ${existing}. Upload your screenshot there.`,
                ephemeral: true,
            });
        }
    }

    await interaction.deferReply({ ephemeral: true });

    const gameLabel = gameKey.replace('game', 'Game ');
    const thread = await interaction.channel.threads.create({
        name: `Evidence — ${team.name} · ${gameLabel}`,
        type: ChannelType.PublicThread,
        reason: `Score evidence for ${team.name} ${gameLabel}`,
    });

    tournament.teams[teamId].scores[gameKey].evidenceThreadId = thread.id;
    save(tournament);

    await thread.send(
        `📸  <@${interaction.user.id}> — upload your **${gameLabel}** scoreboard screenshot here.\n\n` +
        `**${team.name}** · Kills: \`${score.kills}\` · Placement: \`#${score.placement}\` · Points: \`${score.gamePoints}\``
    );

    await interaction.editReply({
        content: `📸  Evidence thread created: ${thread}\nUpload your scoreboard screenshot there to send it for admin review.`,
    });
}

// ── Edit Score: Button — score_edit:{teamId}:{gameKey} ───────────────────────
async function handleScoreEditButton(interaction) {
    const [, teamId, gameKey] = interaction.customId.split(':');

    const tournament = loadByChannel(interaction.channelId);
    if (!tournament) return interaction.reply({ content: 'No active tournament found.', ephemeral: true });

    const team = tournament.teams[teamId];
    if (!team) return interaction.reply({ content: 'Team not found.', ephemeral: true });

    if (interaction.user.id !== team.captainId) {
        return interaction.reply({ content: 'Only the team captain can edit submissions.', ephemeral: true });
    }

    if (isPastDeadline(tournament)) {
        return interaction.update({ content: '⛔ The submission window has closed. Scores can no longer be modified.', components: [] });
    }

    const score = team.scores[gameKey];
    if (!score || scoreStatus(score) !== 'unofficial') {
        return interaction.update({
            content: 'Only unofficial scores can be edited. Delete a pending or official score and resubmit if needed.',
            components: [],
        });
    }

    const gameNumber = parseInt(gameKey.replace('game', ''));

    tournament.teams[teamId].scores[gameKey] = null;
    save(tournament);
    await updateLeaderboard(interaction.client, tournament);

    const modal = new ModalBuilder()
        .setCustomId('score_modal')
        .setTitle(`Edit Game ${gameNumber} Score`);

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('game_number')
                .setLabel('Game Number (e.g. 1, 2, 3...)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(String(gameNumber))
                .setMaxLength(3)
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('team_kills')
                .setLabel('Total Team Kills')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('42')
                .setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('placement')
                .setLabel('Placement Rank (e.g. 1, 2, 3...)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('1')
                .setRequired(true)
        )
    );

    await interaction.showModal(modal);
}

// ── Delete Score: Button — score_delete:{teamId}:{gameKey} ───────────────────
async function handleScoreDeleteButton(interaction) {
    const [, teamId, gameKey] = interaction.customId.split(':');

    const tournament = loadByChannel(interaction.channelId);
    if (!tournament) return interaction.reply({ content: 'No active tournament found.', ephemeral: true });

    const team = tournament.teams[teamId];
    if (!team) return interaction.reply({ content: 'Team not found.', ephemeral: true });

    if (interaction.user.id !== team.captainId) {
        return interaction.reply({ content: 'Only the team captain can delete submissions.', ephemeral: true });
    }

    if (isPastDeadline(tournament)) {
        return interaction.update({ content: '⛔ The submission window has closed. Scores can no longer be modified.', components: [] });
    }

    const score = team.scores[gameKey];
    if (!score) {
        return interaction.update({ content: 'That submission no longer exists.', components: [] });
    }

    const gameLabel = gameKey.replace('game', 'Game ');

    if (score.evidenceThreadId) {
        const thread = await interaction.client.channels.fetch(score.evidenceThreadId).catch(() => null);
        if (thread) {
            await thread.send('🗑️  This submission was deleted by the captain. Thread archived.').catch(() => {});
            await thread.setLocked(true).catch(() => {});
            await thread.setArchived(true).catch(() => {});
        }
    }

    tournament.teams[teamId].scores[gameKey] = null;
    save(tournament);
    await updateLeaderboard(interaction.client, tournament);

    await interaction.update({
        content: `✅  **${gameLabel}** submission deleted for **${team.name}**. You can resubmit using **Submit Game Score**.`,
        components: [],
    });
}

module.exports = {
    handleSubmitScoreButton,
    handleScoreModal,
    handleEvidenceMessage,
    handleManageScoresButton,
    handleSubmitProofButton,
    handleScoreEditButton,
    handleScoreDeleteButton,
};
