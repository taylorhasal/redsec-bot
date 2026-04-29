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

const B = '​'; // zero-width space for blank inline field

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
                    { name: 'EA',          value: 'ea' },
                    { name: 'PlayStation', value: 'psn' },
                    { name: 'Xbox',        value: 'xbox' },
                )),

    async execute(interaction) {
        let eaId     = interaction.options.getString('ea_id');
        let platform = interaction.options.getString('platform') ?? 'ea';

        if (!eaId) {
            const record = loadPlayers()[interaction.user.id];
            if (!record) {
                return interaction.reply({
                    embeds: [errorEmbed('You have not verified yet. Run `/verify` first, or provide an EA ID.')],
                    ephemeral: true,
                });
            }
            eaId     = record.eaId;
            platform = record.platform ?? 'ea';
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

        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle(`${displayName}  —  Redsec`)
            .setDescription(`Platform: ${platform.toUpperCase()}  ·  Duo & Squad  ·  All Seasons`)
            .addFields(
                // Section headers
                { name: 'Combat',       value: B, inline: true },
                { name: B,              value: B, inline: true },
                { name: 'Match Record', value: B, inline: true },

                // Row: K/D | blank | Matches
                { name: 'K/D Ratio',   value: fmt(s.kd),          inline: true },
                { name: B,             value: B,                   inline: true },
                { name: 'Matches',     value: fmtInt(s.matches),   inline: true },

                // Row: Kills | blank | Wins
                { name: 'Kills',       value: fmtInt(s.kills),     inline: true },
                { name: B,             value: B,                   inline: true },
                { name: 'Wins',        value: fmtInt(s.wins),      inline: true },

                // Row: Deaths | blank | Losses
                { name: 'Deaths',      value: fmtInt(s.deaths),    inline: true },
                { name: B,             value: B,                   inline: true },
                { name: 'Losses',      value: fmtInt(s.losses),    inline: true },

                // Row: KPM | blank | Win %
                { name: 'KPM',         value: fmt(s.kpm),          inline: true },
                { name: B,             value: B,                   inline: true },
                { name: 'Win %',       value: s.winPercent,        inline: true },

                // Row: Revives | blank | Time Played
                { name: 'Revives',     value: fmtInt(s.revives),   inline: true },
                { name: B,             value: B,                   inline: true },
                { name: 'Time Played', value: formatTime(s.timePlayed), inline: true },

                // Redsec Index standalone
                { name: 'Redsec Index', value: formatIndex(redsecIndex), inline: false },
            )
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });

        // Update profile if this user is looking up their own verified account
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
        .setTitle('Error')
        .setDescription(description)
        .setTimestamp();
}
