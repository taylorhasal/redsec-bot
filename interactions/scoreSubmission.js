const {
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, EmbedBuilder, ChannelType,
    ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { loadByChannel, save, getPlacementPoints, teamScoreSummary } = require('../utils/tournament');
const { updateLeaderboard } = require('../utils/leaderboard');

const DEADLINE_MS = (2 * 60 + 35) * 60 * 1000; // 2 h 35 m

function isPastDeadline(tournament) {
    if (!tournament.startedAt) return false;
    return Date.now() > new Date(tournament.startedAt).getTime() + DEADLINE_MS;
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
                .setLabel('Game Number (1 or 2)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder('1')
                .setMaxLength(1)
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

    if (![1, 2].includes(gameNumber)) {
        return interaction.reply({ content: 'Game Number must be **1** or **2**.', ephemeral: true });
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

    // Find team by captain ID
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

    // Block re-submission of any game already submitted (pending or confirmed)
    if (tournament.teams[teamId].scores[gameKey]) {
        const status = tournament.teams[teamId].scores[gameKey].pending ? 'pending evidence' : 'confirmed';
        return interaction.reply({
            content: `Game ${gameNumber} has already been submitted for **${team.name}** (${status}). Use **Manage Submissions** to edit or delete it first.`,
            ephemeral: true,
        });
    }

    await interaction.deferReply({ ephemeral: true });

    const killPoints      = kills;
    const placementPoints = getPlacementPoints(placement);
    const gamePoints      = killPoints + placementPoints;

    // Create an evidence thread on the score-submissions channel
    const thread = await interaction.channel.threads.create({
        name: `Evidence — ${team.name} · Game ${gameNumber}`,
        type: ChannelType.PublicThread,
        reason: `Score evidence for ${team.name} Game ${gameNumber}`,
    });

    tournament.teams[teamId].scores[gameKey] = {
        kills,
        placement,
        killPoints,
        placementPoints,
        gamePoints,
        pending:          true,
        evidenceThreadId: thread.id,
        submittedAt:      new Date().toISOString(),
        confirmedAt:      null,
    };
    save(tournament);

    await thread.send(
        `📸  <@${interaction.user.id}> — upload your **Game ${gameNumber}** scoreboard screenshot here to confirm your score.\n\n` +
        `**${team.name}** · Kills: \`${kills}\` · Placement: \`#${placement}\` · Kill Pts: \`${killPoints}\` · Placement Pts: \`${placementPoints}\` · Game Total: \`${gamePoints} pts\``
    );

    const embed = new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle('📋  Score Submitted — Pending Evidence')
        .setDescription(`Upload your screenshot in ${thread} to confirm. The score will be locked in once evidence is received.`)
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
        .setFooter({ text: 'Redsec Tournament · Awaiting screenshot' })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
}

// ── Step 3: messageCreate — evidence screenshot detection ────────────────────
async function handleEvidenceMessage(message, client) {
    if (message.author.bot)             return;
    if (!message.channel.isThread())    return;
    if (message.attachments.size === 0) return;

    const tournament = loadByChannel(message.channel.parentId);
    if (!tournament) return;

    for (const [teamId, team] of Object.entries(tournament.teams)) {
        for (const [gameKey, score] of Object.entries(team.scores)) {
            if (!score || !score.pending)                       continue;
            if (score.evidenceThreadId !== message.channel.id) continue;

            if (message.author.id !== team.captainId) {
                await message.reply('Only the team captain can submit evidence for this score.');
                return;
            }

            tournament.teams[teamId].scores[gameKey].pending     = false;
            tournament.teams[teamId].scores[gameKey].confirmedAt = new Date().toISOString();
            save(tournament);

            const { gross, net, handicap, confirmed } = teamScoreSummary(tournament.teams[teamId]);
            const hcSign    = handicap >= 0 ? `+${handicap.toFixed(1)}` : `${handicap.toFixed(1)}`;
            const gameLabel = gameKey === 'game1' ? 'Game 1' : 'Game 2';

            await message.reply(
                `✅  **${gameLabel}** score confirmed for **${team.name}**!\n` +
                `Gross: \`${gross} pts\`  ·  HC: \`${hcSign}\`  ·  Net: \`${net} pts\`  ·  ${confirmed}/2 confirmed`
            );

            await message.channel.setLocked(true).catch(() => {});
            await message.channel.setArchived(true).catch(() => {});

            await updateLeaderboard(client, tournament);
            return;
        }
    }
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

    for (const [gameKey, score] of Object.entries(team.scores)) {
        const label = gameKey === 'game1' ? 'Game 1' : 'Game 2';
        if (!score) {
            lines.push(`**${label}:** Not submitted`);
        } else if (score.pending) {
            lines.push(`**${label}:** ⏳ Pending evidence — Kills: \`${score.kills}\` · Placement: \`#${score.placement}\` · Points: \`${score.gamePoints}\``);
            if (!past) {
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`score_edit:${teamId}:${gameKey}`)
                        .setLabel(`Edit ${label}`)
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(`score_delete:${teamId}:${gameKey}`)
                        .setLabel(`Delete ${label}`)
                        .setStyle(ButtonStyle.Danger)
                );
            }
        } else {
            lines.push(`**${label}:** ✅ Confirmed — Kills: \`${score.kills}\` · Placement: \`#${score.placement}\` · Points: \`${score.gamePoints}\``);
            if (!past) {
                buttons.push(
                    new ButtonBuilder()
                        .setCustomId(`score_delete:${teamId}:${gameKey}`)
                        .setLabel(`Delete ${label}`)
                        .setStyle(ButtonStyle.Danger)
                );
            }
        }
    }

    const components = buttons.length > 0
        ? [new ActionRowBuilder().addComponents(...buttons)]
        : [];

    const footer = past
        ? '\n\n⛔ The submission window has closed — scores can no longer be modified.'
        : (buttons.length > 0 ? '\n\nPending scores can be **edited** (re-opens the form) or **deleted**. Confirmed scores can only be deleted.' : '');

    await interaction.reply({
        content: `📊  **${team.name}** — Score Submissions\n\n${lines.join('\n')}${footer}`,
        components,
        ephemeral: true,
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
        return interaction.update({
            content: '⛔ The submission window has closed. Scores can no longer be modified.',
            components: [],
        });
    }

    const score = team.scores[gameKey];
    if (!score || !score.pending) {
        return interaction.update({
            content: 'Only pending scores (no screenshot yet) can be edited. Delete a confirmed score and resubmit if needed.',
            components: [],
        });
    }

    const gameNumber = gameKey === 'game1' ? 1 : 2;

    // Archive the old evidence thread
    if (score.evidenceThreadId) {
        const thread = await interaction.client.channels.fetch(score.evidenceThreadId).catch(() => null);
        if (thread) {
            await thread.send('✏️  The captain has edited this submission. This thread has been archived.').catch(() => {});
            await thread.setLocked(true).catch(() => {});
            await thread.setArchived(true).catch(() => {});
        }
    }

    tournament.teams[teamId].scores[gameKey] = null;
    save(tournament);
    await updateLeaderboard(interaction.client, tournament);

    // Re-open the score modal
    const modal = new ModalBuilder()
        .setCustomId('score_modal')
        .setTitle(`Edit Game ${gameNumber} Score`);

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('game_number')
                .setLabel('Game Number (1 or 2)')
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(String(gameNumber))
                .setMaxLength(1)
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
        return interaction.update({
            content: '⛔ The submission window has closed. Scores can no longer be modified.',
            components: [],
        });
    }

    const score = team.scores[gameKey];
    if (!score) {
        return interaction.update({ content: 'That submission no longer exists.', components: [] });
    }

    const gameLabel = gameKey === 'game1' ? 'Game 1' : 'Game 2';

    if (score.evidenceThreadId) {
        const thread = await interaction.client.channels.fetch(score.evidenceThreadId).catch(() => null);
        if (thread) {
            await thread.send('🗑️  This submission was deleted by the captain. The thread has been archived.').catch(() => {});
            await thread.setLocked(true).catch(() => {});
            await thread.setArchived(true).catch(() => {});
        }
    }

    tournament.teams[teamId].scores[gameKey] = null;
    save(tournament);
    await updateLeaderboard(interaction.client, tournament);

    await interaction.update({
        content: `✅  **${gameLabel}** submission deleted for **${team.name}**. You can now resubmit using **Submit Game Score**.`,
        components: [],
    });
}

module.exports = {
    handleSubmitScoreButton,
    handleScoreModal,
    handleEvidenceMessage,
    handleManageScoresButton,
    handleScoreEditButton,
    handleScoreDeleteButton,
};
