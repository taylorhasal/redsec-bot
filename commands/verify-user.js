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
            option.setName('ea_id')
                .setDescription('Their EA ID')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('display_name')
                .setDescription('Their in-game display name (Steam/Xbox/PS5 gamertag) — optional')
                .setRequired(false)
                .setMaxLength(32)),

    async execute(interaction) {
        const target          = interaction.options.getMember('member');
        const eaId            = interaction.options.getString('ea_id').trim();
        const rawDisplayName  = interaction.options.getString('display_name');
        const displayNameArg  = rawDisplayName?.trim() || null;

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
                embeds: [errorEmbed(`No Redsec combat history found for \`${eaId}\`. They need at least one Redsec match.`)],
            });
        }

        const { kpm, kd, wins } = redsec;
        const redsecIndex  = parseFloat(((0.40 - kpm) * 25).toFixed(1));
        const resolvedName = data.userName ?? eaId;

        const players          = loadPlayers();
        const existing         = players[target.id];
        const finalDisplayName = displayNameArg ?? existing?.displayName ?? null;
        players[target.id] = {
            eaId:       resolvedName,
            kd:         parseFloat(kd.toFixed(2)),
            wins,
            redsecIndex,
            verifiedAt: new Date().toISOString(),
            ...(finalDisplayName ? { displayName: finalDisplayName } : {}),
        };
        savePlayers(players);

        await applyPlayerProfile(interaction.guild, target, resolvedName, redsecIndex, finalDisplayName);

        const embed = new EmbedBuilder()
            .setColor(0x00CC44)
            .setTitle('✅  Member Verified')
            .addFields(
                { name: '👤 Discord',      value: `<@${target.id}>`,               inline: false },
                { name: '🪪 EA ID',        value: `\`${resolvedName}\``,           inline: true },
                ...(finalDisplayName ? [{ name: '🏷️ Display Name', value: `\`${finalDisplayName}\``, inline: true }] : []),
                { name: '⚔️ K/D Ratio',    value: `\`${fmt(kd)}\``,               inline: true },
                { name: '🏆 Total Wins',   value: `\`${fmtInt(wins)}\``,           inline: true },
                { name: '📊 Redsec Index', value: `\`${formatIndex(redsecIndex)}\``, inline: true },
            )
            .setFooter({ text: `Verified by ${interaction.user.tag}` })
            .setTimestamp();

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
