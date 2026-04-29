const {
    EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');

const DATA_DIR     = require('../utils/dataDir');
const PENDING_FILE = path.join(DATA_DIR, 'pending-verifications.json');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const { loadAll, save } = require('../utils/tournament');
const { updateLeaderboard } = require('../utils/leaderboard');

function loadPending() {
    try { return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8')); }
    catch { return {}; }
}
function savePending(d) { fs.writeFileSync(PENDING_FILE, JSON.stringify(d, null, 2), 'utf8'); }

function loadPlayers() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch { return {}; }
}
function savePlayers(d) { fs.writeFileSync(PLAYERS_FILE, JSON.stringify(d, null, 2), 'utf8'); }

async function dmUser(client, userId, content) {
    try {
        const user = await client.users.fetch(userId);
        await user.send(content);
    } catch { /* DMs disabled — skip silently */ }
}

function approvedEmbed(record, userId, adjustedBy = null) {
    return new EmbedBuilder()
        .setColor(0x00CC44)
        .setTitle('✅  Verification Approved')
        .setDescription(`<@${userId}>`)
        .addFields(
            { name: '🪪 EA ID',        value: `\`${record.eaId}\``,                       inline: true },
            { name: '🖥️ Platform',     value: `\`${record.platform.toUpperCase()}\``,      inline: true },
            { name: '​',          value: '​',                                     inline: true },
            { name: '⚔️ K/D',          value: `\`${record.kd.toFixed(2)}\``,               inline: true },
            { name: '📈 Win Rate',      value: `\`${(record.winRate * 100).toFixed(1)}%\``, inline: true },
            { name: '📊 Redsec Index', value: `\`${record.redsecIndex}\``,                  inline: true },
        )
        .setFooter({ text: adjustedBy ? `Index adjusted by ${adjustedBy}` : 'Approved' })
        .setTimestamp();
}

function commitToPlayers(userId, record) {
    const players = loadPlayers();
    players[userId] = {
        eaId:        record.eaId,
        platform:    record.platform,
        kd:          record.kd,
        winRate:     record.winRate,
        redsecIndex: record.redsecIndex,
        verifiedAt:  new Date().toISOString(),
    };
    savePlayers(players);
}

// ── Button: audit_approve:<userId> ───────────────────────────────────────────
async function handleAuditApprove(interaction) {
    const userId  = interaction.customId.split(':')[1];
    const pending = loadPending();
    const record  = pending[userId];

    if (!record) {
        return interaction.reply({ content: 'This verification has already been processed.', ephemeral: true });
    }

    commitToPlayers(userId, record);
    delete pending[userId];
    savePending(pending);

    await interaction.update({ embeds: [approvedEmbed(record, userId)], components: [] });
    await dmUser(
        interaction.client, userId,
        `✅  **Your Redsec verification has been approved!**\n` +
        `EA ID: \`${record.eaId}\`  ·  Redsec Index: \`${record.redsecIndex}\``
    );
}

// ── Button: audit_reject:<userId> ────────────────────────────────────────────
async function handleAuditReject(interaction) {
    const userId  = interaction.customId.split(':')[1];
    const pending = loadPending();
    const record  = pending[userId];

    if (!record) {
        return interaction.reply({ content: 'This verification has already been processed.', ephemeral: true });
    }

    delete pending[userId];
    savePending(pending);

    const embed = new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle('❌  Verification Rejected')
        .setDescription(`<@${userId}>  ·  \`${record.eaId}\``)
        .setFooter({ text: `Rejected by ${interaction.user.tag}` })
        .setTimestamp();

    await interaction.update({ embeds: [embed], components: [] });
    await dmUser(
        interaction.client, userId,
        `❌  Your Redsec verification was **rejected**. Contact an admin if you believe this is an error.`
    );
}

// ── Button: audit_adjust:<userId> — open modal ───────────────────────────────
async function handleAuditAdjust(interaction) {
    const userId  = interaction.customId.split(':')[1];
    const pending = loadPending();
    const record  = pending[userId];

    if (!record) {
        return interaction.reply({ content: 'This verification has already been processed.', ephemeral: true });
    }

    const modal = new ModalBuilder()
        .setCustomId(`audit_adjust_modal:${userId}`)
        .setTitle('Adjust Redsec Index');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('adjusted_index')
                .setLabel(`Current: ${record.redsecIndex} — Enter corrected value`)
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(String(record.redsecIndex))
                .setRequired(true)
        )
    );

    await interaction.showModal(modal);
}

// ── Modal: audit_adjust_modal:<userId> ───────────────────────────────────────
async function handleAuditAdjustModal(interaction) {
    const userId   = interaction.customId.split(':')[1];
    const rawValue = interaction.fields.getTextInputValue('adjusted_index').trim();
    const newIndex = parseFloat(rawValue);

    if (isNaN(newIndex)) {
        return interaction.reply({ content: `\`${rawValue}\` is not a valid number.`, ephemeral: true });
    }

    const pending = loadPending();
    const record  = pending[userId];

    if (!record) {
        return interaction.reply({ content: 'This verification has already been processed.', ephemeral: true });
    }

    record.redsecIndex = parseFloat(newIndex.toFixed(2));
    commitToPlayers(userId, record);
    delete pending[userId];
    savePending(pending);

    await interaction.reply({ content: `✅  Index set to \`${record.redsecIndex}\` — player approved.`, ephemeral: true });

    // Update the original audit message
    if (record.auditMessageId && process.env.AUDIT_CHANNEL_ID) {
        const channel = await interaction.client.channels.fetch(process.env.AUDIT_CHANNEL_ID).catch(() => null);
        if (channel) {
            const msg = await channel.messages.fetch(record.auditMessageId).catch(() => null);
            if (msg) await msg.edit({ embeds: [approvedEmbed(record, userId, interaction.user.tag)], components: [] });
        }
    }

    await dmUser(
        interaction.client, userId,
        `✅  **Your Redsec verification has been approved!**\n` +
        `EA ID: \`${record.eaId}\`  ·  Redsec Index: \`${record.redsecIndex}\``
    );
}

// ── Button: score_approve:{tournamentId}:{teamId}:{gameKey} ──────────────────
async function handleScoreApprove(interaction) {
    const [, tournamentId, teamId, gameKey] = interaction.customId.split(':');
    const client = interaction.client;

    const all = loadAll();
    const tournament = all[tournamentId];
    if (!tournament) return interaction.update({ content: 'Tournament not found.', components: [] });

    const team  = tournament.teams?.[teamId];
    const score = team?.scores?.[gameKey];
    if (!score) return interaction.update({ content: 'Score not found.', components: [] });

    score.status     = 'official';
    score.approvedAt = new Date().toISOString();
    save(tournament);
    await updateLeaderboard(client, tournament);

    if (score.evidenceThreadId) {
        const thread = await client.channels.fetch(score.evidenceThreadId).catch(() => null);
        if (thread) {
            await thread.send('✅  Score approved by admin. Thread archived.').catch(() => {});
            await thread.setLocked(true).catch(() => {});
            await thread.setArchived(true).catch(() => {});
        }
    }

    const gameLabel = gameKey.replace('game', 'Game ');
    const embed = new EmbedBuilder()
        .setColor(0x00CC44)
        .setTitle('✅  Score Approved')
        .addFields(
            { name: '🏷️ Team',    value: `\`${team.name}\``,         inline: true },
            { name: '🎮 Game',    value: `\`${gameLabel}\``,           inline: true },
            { name: '📊 Points',  value: `\`${score.gamePoints}\``,    inline: true },
        )
        .setFooter({ text: `Approved by ${interaction.user.tag}` })
        .setTimestamp();

    await interaction.update({ embeds: [embed], components: [] });

    await dmUser(client, team.captainId,
        `✅  **${gameLabel}** score approved for **${team.name}** in **${tournament.name}**!\n` +
        `Kills: \`${score.kills}\` · Placement: \`#${score.placement}\` · Points: \`${score.gamePoints}\``
    );
}

// ── Button: score_reject:{tournamentId}:{teamId}:{gameKey} ───────────────────
async function handleScoreReject(interaction) {
    const [, tournamentId, teamId, gameKey] = interaction.customId.split(':');
    const client = interaction.client;

    const all = loadAll();
    const tournament = all[tournamentId];
    if (!tournament) return interaction.update({ content: 'Tournament not found.', components: [] });

    const team  = tournament.teams?.[teamId];
    const score = team?.scores?.[gameKey];
    if (!score) return interaction.update({ content: 'Score not found.', components: [] });

    const threadId = score.evidenceThreadId;
    score.status           = 'unofficial';
    score.evidenceThreadId = null;
    save(tournament);

    if (threadId) {
        const thread = await client.channels.fetch(threadId).catch(() => null);
        if (thread) {
            await thread.send('❌  Proof rejected by admin. Please resubmit via **Manage Submissions → Submit Proof**.').catch(() => {});
            await thread.setLocked(true).catch(() => {});
            await thread.setArchived(true).catch(() => {});
        }
    }

    const gameLabel = gameKey.replace('game', 'Game ');
    const embed = new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle('❌  Score Proof Rejected')
        .addFields(
            { name: '🏷️ Team', value: `\`${team.name}\``,  inline: true },
            { name: '🎮 Game', value: `\`${gameLabel}\``,   inline: true },
        )
        .setFooter({ text: `Rejected by ${interaction.user.tag}` })
        .setTimestamp();

    await interaction.update({ embeds: [embed], components: [] });

    await dmUser(client, team.captainId,
        `❌  **${gameLabel}** proof was rejected for **${team.name}** in **${tournament.name}**.\n` +
        `The score still counts as unofficial. Use **Manage Submissions → Submit Proof** to try again.`
    );
}

module.exports = { handleAuditApprove, handleAuditReject, handleAuditAdjust, handleAuditAdjustModal, handleScoreApprove, handleScoreReject };
