const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
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

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify-user')
        .setDescription('Manually verify a Discord member')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option.setName('member')
                .setDescription('The Discord member to verify')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('platform')
                .setDescription('Their platform')
                .setRequired(true)
                .addChoices(
                    { name: 'EA',          value: 'ea' },
                    { name: 'Steam',       value: 'steam' },
                    { name: 'PlayStation', value: 'psn' },
                    { name: 'Xbox',        value: 'xbox' },
                    { name: 'Epic',        value: 'epic' },
                ))
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Their in-game username')
                .setRequired(true)),

    async execute(interaction) {
        const target   = interaction.options.getMember('member');
        const platform = interaction.options.getString('platform');
        const eaId     = interaction.options.getString('username').trim();

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
                embeds: [errorEmbed(`No Redsec combat history found for \`${eaId}\`. They need at least one Redsec match.`)],
            });
        }

        const { kpm, kd, wins } = redsec;
        const redsecIndex  = parseFloat(((0.40 - kpm) * 25).toFixed(1));
        const resolvedName = data.userName ?? eaId;
        const avatar       = data.avatar ?? null;

        const players = loadPlayers();
        players[target.id] = {
            eaId:       resolvedName,
            platform,
            kd:         parseFloat(kd.toFixed(2)),
            wins,
            redsecIndex,
            verifiedAt: new Date().toISOString(),
        };
        savePlayers(players);

        await applyPlayerProfile(interaction.guild, target, resolvedName, redsecIndex);

        const embed = new EmbedBuilder()
            .setColor(0x00CC44)
            .setTitle('✅  Member Verified')
            .addFields(
                { name: '👤 Discord',      value: `<@${target.id}>`,               inline: true },
                { name: '🪪 EA ID',        value: `\`${resolvedName}\``,           inline: true },
                { name: '🖥️ Platform',     value: `\`${platform.toUpperCase()}\``, inline: true },
                { name: '⚔️ K/D Ratio',    value: `\`${fmt(kd)}\``,               inline: true },
                { name: '🏆 Total Wins',   value: `\`${fmtInt(wins)}\``,          inline: true },
                { name: '📊 Redsec Index', value: `\`${formatIndex(redsecIndex)}\``, inline: true },
            )
            .setFooter({ text: `Verified by ${interaction.user.tag}` })
            .setTimestamp();

        if (avatar) embed.setThumbnail(avatar);

        await interaction.editReply({ embeds: [embed] });

        const statsChannel = interaction.guild.channels.cache.find(c => c.name.includes('player-stats'));
        if (statsChannel) await postServerLeaderboard(statsChannel).catch(() => {});
    },
};

function errorEmbed(description) {
    return new EmbedBuilder()
        .setColor(0x1a0000)
        .setTitle('❌ Error')
        .setDescription(description)
        .setTimestamp();
}
