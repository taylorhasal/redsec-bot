const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
    fetchPlayerStats, extractRedsecStats, buildErrorMessage,
    formatTime, fmt, fmtInt,
} = require('../utils/api');
const { applyPlayerProfile, formatIndex } = require('../utils/profile');
const fs   = require('fs');
const path = require('path');

const DATA_DIR     = require('../utils/dataDir');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');

function loadPlayers() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch { return {}; }
}
function savePlayers(d) { fs.writeFileSync(PLAYERS_FILE, JSON.stringify(d, null, 2), 'utf8'); }

const BLANK = '​';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription("Show a player's Redsec stats from Battlefield 6")
        .addStringOption(option =>
            option.setName('ea_id')
                .setDescription('EA / in-game username (leave blank to use your own verified account)')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('platform')
                .setDescription('Platform (default: EA)')
                .addChoices(
                    { name: 'EA',         value: 'ea' },
                    { name: 'Steam',      value: 'steam' },
                    { name: 'PlayStation', value: 'psn' },
                    { name: 'Xbox',       value: 'xbox' },
                    { name: 'Epic',       value: 'epic' },
                )),

    async execute(interaction) {
        let eaId     = interaction.options.getString('ea_id');
        let platform = interaction.options.getString('platform') ?? 'ea';

        // Default to caller's verified account when no ea_id is provided
        if (!eaId) {
            const record = loadPlayers()[interaction.user.id];
            if (!record) {
                return interaction.reply({
                    embeds: [errorEmbed('You have not verified yet. Run `/verify` first, or provide an EA ID.')],
                    ephemeral: true,
                });
            }
            eaId     = record.eaId;
            platform = record.platform ?? 'pc';
        }

        await interaction.deferReply();

        let data;
        try {
            data = await fetchPlayerStats(eaId, platform);
        } catch (err) {
            return interaction.editReply({ embeds: [errorEmbed(buildErrorMessage(err))] });
        }

        const s = extractRedsecStats(data);
        if (!s) {
            return interaction.editReply({
                embeds: [errorEmbed('No Redsec combat history found.')],
            });
        }

        const redsecIndex = parseFloat(((0.40 - s.kpm) * 25).toFixed(1));
        const displayName = data.userName ?? eaId;
        const avatar      = data.avatar ?? null;

        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle(`⚔️  ${displayName}  —  Redsec`)
            .setDescription(`Platform: \`${platform.toUpperCase()}\`  ·  Duos, Quads & Solo · All Seasons`)
            .addFields(
                {
                    name: '⚔️  K / D',
                    value: `K/D Ratio: \`${fmt(s.kd)}\``,
                    inline: true,
                },
                {
                    name: '🎯  Kills',
                    value: [
                        `Total:   \`${fmtInt(s.kills)}\``,
                        `Per Min: \`${fmt(s.kpm)}\``,
                    ].join('\n'),
                    inline: true,
                },
                {
                    name: '💀  Deaths',
                    value: [
                        `Total:   \`${fmtInt(s.deaths)}\``,
                        `Per Min: \`${fmt(s.dpm)}\``,
                    ].join('\n'),
                    inline: true,
                },
                {
                    name: '📊  Matches',
                    value: `Wins: \`${fmtInt(s.wins)}\``,
                    inline: true,
                },
                {
                    name: '⏱️  Time Played',
                    value: `\`${formatTime(s.timePlayed)}\``,
                    inline: true,
                },
                {
                    name: '📊  Redsec Index',
                    value: `\`${formatIndex(redsecIndex)}\``,
                    inline: true,
                },
            )
            .setFooter({ text: 'Redsec — Duos & Quads · All Seasons' })
            .setTimestamp();

        if (avatar) embed.setThumbnail(avatar);

        await interaction.editReply({ embeds: [embed] });

        // Update profile if this user is verified and the ea_id matches their record
        const players = loadPlayers();
        const record  = players[interaction.user.id];
        if (record && record.eaId.toLowerCase() === (data.userName ?? eaId).toLowerCase()) {
            record.redsecIndex = redsecIndex;
            record.wins        = s.wins;
            record.kd          = parseFloat(s.kd.toFixed(2));
            savePlayers(players);
            await applyPlayerProfile(interaction.guild, interaction.member, record.eaId, redsecIndex);
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
