const {
    ModalBuilder, TextInputBuilder, TextInputStyle,
    ActionRowBuilder, EmbedBuilder,
} = require('discord.js');
const { fetchPlayerStats, extractRedsecStats, buildErrorMessage, fmt, fmtInt } = require('../utils/api');
const { applyPlayerProfile, formatIndex } = require('../utils/profile');
const { postServerLeaderboard } = require('../utils/serverLeaderboard');
const { recomputeAndRefreshAllTeams } = require('../utils/tournament');
const fs   = require('fs');
const path = require('path');

const DATA_DIR     = require('../utils/dataDir');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');

function loadPlayers() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch { return {}; }
}
function savePlayers(d) { fs.writeFileSync(PLAYERS_FILE, JSON.stringify(d, null, 2), 'utf8'); }

const PLATFORM_NAMES = { ea: 'PC (EA)', psn: 'PlayStation', xbox: 'Xbox' };

const PLATFORM_PLACEHOLDERS = {
    ea:   'Your EA ID / username',
    psn:  'Your PSN username',
    xbox: 'Your Xbox Gamertag',
};

async function handleVerifyPlatformButton(interaction) {
    const platform = interaction.customId.split(':')[1] ?? 'ea';
    const modal = new ModalBuilder()
        .setCustomId(`verify_modal:${platform}`)
        .setTitle('🛡️  Verify Your Account')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('display_name')
                    .setLabel('Username / Display Name')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(1)
                    .setMaxLength(64)
                    .setPlaceholder(PLATFORM_PLACEHOLDERS[platform] ?? 'Your in-game username'),
            ),
        );
    await interaction.showModal(modal);
}

async function handleVerifyModal(interaction) {
    const platform = interaction.customId.split(':')[1] ?? 'ea';
    const eaId     = interaction.fields.getTextInputValue('display_name').trim();

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

    const duplicate = Object.entries(players).find(([uid, p]) =>
        uid !== interaction.user.id &&
        p.eaId?.toLowerCase() === resolvedName.toLowerCase() &&
        (p.platform ?? 'ea') === platform
    );
    if (duplicate) {
        return interaction.editReply({
            embeds: [errorEmbed(`This ${PLATFORM_NAMES[platform] ?? platform} account is already registered to another player. Contact an admin if this is a mistake.`)],
        });
    }

    players[interaction.user.id] = {
        eaId:       resolvedName,
        platform,
        kd:         parseFloat(kd.toFixed(2)),
        wins,
        redsecIndex,
        verifiedAt: new Date().toISOString(),
        displayName: resolvedName,
    };
    savePlayers(players);

    await applyPlayerProfile(interaction.guild, interaction.member, resolvedName, redsecIndex, resolvedName, platform);
    await recomputeAndRefreshAllTeams(interaction.client, players);

    const nicknamePreview = `[${formatIndex(redsecIndex)}] ${resolvedName}`;
    const embed = new EmbedBuilder()
        .setColor(0x00CC44)
        .setTitle('✅  Verification Complete')
        .addFields(
            { name: '🖥️ Platform',     value: PLATFORM_NAMES[platform] ?? platform,  inline: false },
            { name: '🪪 Username',     value: `\`${resolvedName}\``,                  inline: false },
            { name: '🏷️ Nickname',     value: `\`${nicknamePreview}\``,               inline: false },
            { name: '⚔️ K/D Ratio',    value: `\`${fmt(kd)}\``,                       inline: true },
            { name: '🏆 Total Wins',   value: `\`${fmtInt(wins)}\``,                  inline: true },
            { name: '📊 Redsec Index', value: `\`${formatIndex(redsecIndex)}\``,       inline: true },
        )
        .setFooter({ text: 'Redsec · Verified' })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    const generalChat = interaction.guild.channels.cache.find(c => c.name === '💬-general-chat');
    if (generalChat) {
        await generalChat.send(
            `👋 Welcome to **The Operators**, <@${interaction.user.id}>!\n` +
            `${PLATFORM_NAMES[platform] ?? platform}: \`${resolvedName}\` · Redsec Index: \`${formatIndex(redsecIndex)}\``
        ).catch(() => {});
    }

    const statsChannel = interaction.guild.channels.cache.find(c => c.name.includes('player-stats'));
    if (statsChannel) await postServerLeaderboard(statsChannel).catch(() => {});
}

async function handleAdminVerifyPlatformButton(interaction) {
    const parts    = interaction.customId.split(':'); // admin_verify_platform:PLATFORM:TARGETID
    const platform = parts[1] ?? 'ea';
    const targetId = parts[2];
    const modal = new ModalBuilder()
        .setCustomId(`admin_verify_modal:${platform}:${targetId}`)
        .setTitle('🛡️  Verify Member')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('display_name')
                    .setLabel('Username / Display Name')
                    .setStyle(TextInputStyle.Short)
                    .setRequired(true)
                    .setMinLength(1)
                    .setMaxLength(64)
                    .setPlaceholder(PLATFORM_PLACEHOLDERS[platform] ?? 'Their in-game username'),
            ),
        );
    await interaction.showModal(modal);
}

async function handleAdminVerifyModal(interaction) {
    const parts    = interaction.customId.split(':'); // admin_verify_modal:PLATFORM:TARGETID
    const platform = parts[1] ?? 'ea';
    const targetId = parts[2];
    const eaId     = interaction.fields.getTextInputValue('display_name').trim();

    await interaction.deferReply({ ephemeral: true });

    const target = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!target) {
        return interaction.editReply({ embeds: [errorEmbed('Could not find that member in this server.')] });
    }

    let data;
    try {
        data = await fetchPlayerStats(eaId, platform);
    } catch (err) {
        return interaction.editReply({ embeds: [errorEmbed(buildErrorMessage(err))] });
    }

    const redsec = extractRedsecStats(data);
    if (!redsec) {
        return interaction.editReply({
            embeds: [errorEmbed(`No Redsec combat history found for \`${eaId}\`. They need at least one Redsec match.`)],
        });
    }

    const { kpm, kd, wins } = redsec;
    const redsecIndex  = parseFloat(((0.40 - kpm) * 25).toFixed(1));
    const resolvedName = data.userName ?? eaId;

    const players = loadPlayers();
    players[target.id] = {
        eaId:        resolvedName,
        platform,
        kd:          parseFloat(kd.toFixed(2)),
        wins,
        redsecIndex,
        verifiedAt:  new Date().toISOString(),
        displayName: resolvedName,
    };
    savePlayers(players);

    await applyPlayerProfile(interaction.guild, target, resolvedName, redsecIndex, resolvedName, platform);
    await recomputeAndRefreshAllTeams(interaction.client, players);

    const embed = new EmbedBuilder()
        .setColor(0x00CC44)
        .setTitle('✅  Member Verified')
        .addFields(
            { name: '👤 Discord',      value: `<@${target.id}>`,                    inline: false },
            { name: '🖥️ Platform',     value: PLATFORM_NAMES[platform] ?? platform, inline: false },
            { name: '🪪 Username',     value: `\`${resolvedName}\``,                inline: true },
            { name: '⚔️ K/D Ratio',    value: `\`${fmt(kd)}\``,                    inline: true },
            { name: '🏆 Total Wins',   value: `\`${fmtInt(wins)}\``,               inline: true },
            { name: '📊 Redsec Index', value: `\`${formatIndex(redsecIndex)}\``,    inline: true },
        )
        .setFooter({ text: `Verified by ${interaction.user.tag}` })
        .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    const statsChannel = interaction.guild.channels.cache.find(c => c.name.includes('player-stats'));
    if (statsChannel) await postServerLeaderboard(statsChannel).catch(() => {});
}

function errorEmbed(description) {
    return new EmbedBuilder()
        .setColor(0x1a0000)
        .setTitle('❌ Error')
        .setDescription(description)
        .setTimestamp();
}

module.exports = { handleVerifyPlatformButton, handleVerifyModal, handleAdminVerifyPlatformButton, handleAdminVerifyModal };
