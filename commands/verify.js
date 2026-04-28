const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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
        .setName('verify')
        .setDescription('Link your EA ID and calculate your Redsec Index')
        .addStringOption(option =>
            option.setName('ea_id')
                .setDescription('Your EA / in-game username')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('platform')
                .setDescription('Platform (default: ea)')
                .addChoices(
                    { name: 'EA', value: 'ea' },
                    { name: 'Steam', value: 'steam' },
                    { name: 'PlayStation', value: 'psn' },
                    { name: 'Xbox',   value: 'xbox' },
                )),

    async execute(interaction) {
        const eaId     = interaction.options.getString('ea_id');
        const platform = interaction.options.getString('platform') ?? 'ea';

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
        const avatar       = data.avatar ?? null;

        // Save to players.json
        const players = loadPlayers();
        players[interaction.user.id] = {
            eaId:        resolvedName,
            platform,
            kd:          parseFloat(kd.toFixed(2)),
            wins,
            redsecIndex,
            verifiedAt:  new Date().toISOString(),
        };
        savePlayers(players);

        // Apply nickname + roles
        await applyPlayerProfile(interaction.guild, interaction.member, resolvedName, redsecIndex);

        const embed = new EmbedBuilder()
            .setColor(0x00CC44)
            .setTitle('✅  Verification Complete')
            .addFields(
                { name: '🪪 EA ID',        value: `\`${resolvedName}\``,           inline: true },
                { name: '🖥️ Platform',     value: `\`${platform.toUpperCase()}\``,  inline: true },
                { name: '​',          value: '​',                         inline: true },
                { name: '⚔️ K/D Ratio',    value: `\`${fmt(kd)}\``,                inline: true },
                { name: '🏆 Total Wins',   value: `\`${fmtInt(wins)}\``,            inline: true },
                { name: '📊 Redsec Index', value: `\`${formatIndex(redsecIndex)}\``, inline: true },
            )
            .setFooter({ text: 'Redsec · Verified' })
            .setTimestamp();

        if (avatar) embed.setThumbnail(avatar);

        await interaction.editReply({ embeds: [embed] });

        // Welcome message in #general-chat (THE OPERATORS category)
        const generalChat = interaction.guild.channels.cache.find(c => c.name === '💬-general-chat');
        if (generalChat) {
            const indexStr = formatIndex(redsecIndex);
            await generalChat.send(
                `👋 Welcome to **The Operators**, <@${interaction.user.id}>!\n` +
                `EA ID: \`${resolvedName}\` · Redsec Index: \`${indexStr}\``
            ).catch(() => {});
        }

        // Auto-update server leaderboard in #player-stats
        const statsChannel = interaction.guild.channels.cache.find(c => c.name.includes('player-stats'));
        if (statsChannel) {
            await postServerLeaderboard(statsChannel).catch(() => {});
        }
    },
};

function errorEmbed(description) {
    return new EmbedBuilder()
        .setColor(0x1a0000)
        .setTitle('❌ Error')
        .setDescription(description)
        .setTimestamp();
}
