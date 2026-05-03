const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
    fetchPlayerStats, extractRedsecStats, buildErrorMessage,
    formatTime, fmt, fmtInt,
} = require('../utils/api');
const { applyPlayerProfile, formatIndex } = require('../utils/profile');
const { loadRatings } = require('../utils/xpMatch');
const fs   = require('fs');
const path = require('path');

const DATA_DIR     = require('../utils/dataDir');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');

function loadPlayers() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch { return {}; }
}
function savePlayers(d) { fs.writeFileSync(PLAYERS_FILE, JSON.stringify(d, null, 2), 'utf8'); }

const B = '​';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('Show your Redsec stats'),

    async execute(interaction) {
        const record = loadPlayers()[interaction.user.id];
        if (!record) {
            return interaction.reply({
                embeds: [errorEmbed('You have not verified yet. Run `/verify` first.')],
                ephemeral: true,
            });
        }

        await interaction.deferReply();

        let data;
        try {
            data = await fetchPlayerStats(record.eaId, 'ea');
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
        const eaName      = data.userName ?? record.eaId;
        const gamertag    = record.displayName ?? null;

        // Keep stored record up to date
        const players = loadPlayers();
        players[interaction.user.id] = {
            ...players[interaction.user.id],
            redsecIndex,
            wins: s.wins,
            kd:   parseFloat(s.kd.toFixed(2)),
        };
        savePlayers(players);
        await applyPlayerProfile(interaction.guild, interaction.member, eaName, redsecIndex, gamertag);

        const ratings  = loadRatings();
        const xpRecord = ratings[interaction.user.id] ?? null;
        await interaction.editReply({ embeds: [buildStatsEmbed(gamertag ?? eaName, s, redsecIndex, xpRecord)] });
    },
};

function buildStatsEmbed(displayName, s, redsecIndex, xpRecord = null) {
    const embed = new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle(`${displayName}  —  Redsec`)
        .setDescription('Duo & Squad  ·  All Seasons')
        .addFields(
            { name: 'Combat',       value: B, inline: true },
            { name: B,              value: B, inline: true },
            { name: 'Match Record', value: B, inline: true },

            { name: 'K/D Ratio',   value: fmt(s.kd),               inline: true },
            { name: B,             value: B,                        inline: true },
            { name: 'Matches',     value: fmtInt(s.matches),        inline: true },

            { name: 'Kills',       value: fmtInt(s.kills),          inline: true },
            { name: B,             value: B,                        inline: true },
            { name: 'Wins',        value: fmtInt(s.wins),           inline: true },

            { name: 'Deaths',      value: fmtInt(s.deaths),         inline: true },
            { name: B,             value: B,                        inline: true },
            { name: 'Losses',      value: fmtInt(s.losses),         inline: true },

            { name: 'KPM',         value: fmt(s.kpm),               inline: true },
            { name: B,             value: B,                        inline: true },
            { name: 'Win %',       value: s.winPercent,             inline: true },

            { name: 'Revives',     value: fmtInt(s.revives),        inline: true },
            { name: B,             value: B,                        inline: true },
            { name: 'Time Played', value: formatTime(s.timePlayed), inline: true },

            { name: 'Redsec Index', value: formatIndex(redsecIndex), inline: false },
        )
        .setTimestamp();

    if (xpRecord) {
        embed.addFields({
            name:   '🏆  XP Ranked',
            value:  `**${xpRecord.xp.toLocaleString()} XP**  ·  ${xpRecord.wins}W  ${xpRecord.losses}L`,
            inline: false,
        });
    }

    return embed;
}

function errorEmbed(description) {
    return new EmbedBuilder()
        .setColor(0x1a0000)
        .setTitle('Error')
        .setDescription(description)
        .setTimestamp();
}

module.exports.buildStatsEmbed = buildStatsEmbed;
