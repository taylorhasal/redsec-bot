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

const PLATFORM_LABELS = {
    ea:    'EA',
    steam: 'Steam',
    psn:   'PlayStation',
    xbox:  'Xbox',
    epic:  'Epic',
};

// Step 1 — user clicked a platform button → show username modal
async function handleVerifyPlatformButton(interaction) {
    const platform = interaction.customId.split(':')[1];

    const modal = new ModalBuilder()
        .setCustomId(`verify_modal:${platform}`)
        .setTitle('Enter Username');

    const usernameInput = new TextInputBuilder()
        .setCustomId('ea_id')
        .setLabel('Your In-Game Username')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(64)
        .setPlaceholder('Enter your exact in-game username');

    modal.addComponents(new ActionRowBuilder().addComponents(usernameInput));
    await interaction.showModal(modal);
}

// Step 2 — modal submitted → run verification
async function handleVerifyModal(interaction) {
    const platform = interaction.customId.split(':')[1];
    const eaId     = interaction.fields.getTextInputValue('ea_id').trim();

    await interaction.deferReply({ ephemeral: true });

    let data;
    try {
        data = await fetchPlayerStats(eaId, platform);
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

    const players = loadPlayers();
    players[interaction.user.id] = {
        eaId:       resolvedName,
        platform,
        kd:         parseFloat(kd.toFixed(2)),
        wins,
        redsecIndex,
        verifiedAt: new Date().toISOString(),
    };
    savePlayers(players);

    await applyPlayerProfile(interaction.guild, interaction.member, resolvedName, redsecIndex);

    const embed = new EmbedBuilder()
        .setColor(0x00CC44)
        .setTitle('✅  Verification Complete')
        .addFields(
            { name: '🪪 EA ID',        value: `\`${resolvedName}\``,                              inline: true },
            { name: '🖥️ Platform',     value: `\`${PLATFORM_LABELS[platform] ?? platform}\``,     inline: true },
            { name: '​',          value: '​',                                            inline: true },
            { name: '⚔️ K/D Ratio',    value: `\`${fmt(kd)}\``,                                   inline: true },
            { name: '🏆 Total Wins',   value: `\`${fmtInt(wins)}\``,                              inline: true },
            { name: '📊 Redsec Index', value: `\`${formatIndex(redsecIndex)}\``,                  inline: true },
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
