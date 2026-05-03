const {
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, EmbedBuilder,
} = require('discord.js');
const { fetchPlayerStats, extractRedsecStats, buildErrorMessage, fmt, fmtInt } = require('../utils/api');
const { applyPlayerProfile, formatIndex } = require('../utils/profile');
const { postServerLeaderboard } = require('../utils/serverLeaderboard');
const fs   = require('fs');
const path = require('path');

const DATA_DIR     = require('../utils/dataDir');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');

function loadPlayers() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch { return {}; }
}
function savePlayers(d) { fs.writeFileSync(PLAYERS_FILE, JSON.stringify(d, null, 2), 'utf8'); }

// Kept for backward compat — old platform buttons in existing Discord messages still work
async function handleVerifyPlatformButton(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('verify_modal')
        .setTitle('Enter Your EA ID');

    const input = new TextInputBuilder()
        .setCustomId('ea_id')
        .setLabel('Your EA ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(64)
        .setPlaceholder('Found top-right on the Search for Player screen in BF6');

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    await interaction.showModal(modal);
}

async function handleVerifyModal(interaction) {
    const eaId = interaction.fields.getTextInputValue('ea_id').trim();

    await interaction.deferReply({ ephemeral: true });

    let data;
    try {
        data = await fetchPlayerStats(eaId, 'ea');
    } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(buildErrorMessage(err))] });
    }

    const redsec = extractRedsecStats(data);
    if (!redsec) {
        return interaction.editReply({
            embeds: [errorEmbed('No Redsec combat history found. Play at least one Redsec match to verify.')],
        });
    }

    const { kpm, kd, wins } = redsec;
    const redsecIndex  = parseFloat(((0.40 - kpm) * 25).toFixed(1));
    const resolvedName = data.userName ?? eaId;

    const players  = loadPlayers();
    const existing = players[interaction.user.id];
    players[interaction.user.id] = {
        eaId:       resolvedName,
        kd:         parseFloat(kd.toFixed(2)),
        wins,
        redsecIndex,
        verifiedAt: new Date().toISOString(),
        ...(existing?.displayName ? { displayName: existing.displayName } : {}),
    };
    savePlayers(players);

    await applyPlayerProfile(interaction.guild, interaction.member, resolvedName, redsecIndex, existing?.displayName ?? null);

    const embed = new EmbedBuilder()
        .setColor(0x00CC44)
        .setTitle('✅  Verification Complete')
        .addFields(
            { name: '🪪 EA ID',        value: `\`${resolvedName}\``,             inline: false },
            { name: '⚔️ K/D Ratio',    value: `\`${fmt(kd)}\``,                  inline: true },
            { name: '🏆 Total Wins',   value: `\`${fmtInt(wins)}\``,             inline: true },
            { name: '📊 Redsec Index', value: `\`${formatIndex(redsecIndex)}\``, inline: true },
        )
        .setFooter({ text: 'Redsec · Verified' })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    const generalChat = interaction.guild.channels.cache.find(c => c.name === '💬-general-chat');
    if (generalChat) {
        await generalChat.send(
            `👋 Welcome to **The Operators**, <@${interaction.user.id}>!\n` +
            `EA ID: \`${resolvedName}\` · Redsec Index: \`${formatIndex(redsecIndex)}\``
        ).catch(() => {});
    }

    const statsChannel = interaction.guild.channels.cache.find(c => c.name.includes('player-stats'));
    if (statsChannel) {
        await postServerLeaderboard(statsChannel).catch(() => {});
    }
}

function errorEmbed(description) {
    return new EmbedBuilder()
        .setColor(0x1a0000)
        .setTitle('❌ Error')
        .setDescription(description)
        .setTimestamp();
}

module.exports = { handleVerifyPlatformButton, handleVerifyModal };
