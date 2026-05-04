const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { fetchPlayerStats, extractRedsecStats, buildErrorMessage } = require('../utils/api');
const { buildStatsEmbed } = require('./stats');
const { loadRatings } = require('../utils/xpMatch');
const fs   = require('fs');
const path = require('path');

const DATA_DIR     = require('../utils/dataDir');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');

function loadPlayers() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch { return {}; }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription("View a verified player's Redsec stats")
        .addStringOption(option =>
            option.setName('player')
                .setDescription('Start typing an EA ID to search verified players')
                .setRequired(true)
                .setAutocomplete(true)),

    async autocomplete(interaction) {
        const typed   = interaction.options.getFocused().toLowerCase();
        const players = loadPlayers();

        const choices = Object.entries(players)
            .filter(([, r]) =>
                r.eaId?.toLowerCase().includes(typed) ||
                r.displayName?.toLowerCase().includes(typed)
            )
            .slice(0, 25)
            .map(([discordId, r]) => ({
                name:  r.displayName ?? r.eaId,
                value: discordId,
            }));

        await interaction.respond(choices);
    },

    async execute(interaction) {
        const discordId = interaction.options.getString('player');
        const players   = loadPlayers();
        const record    = players[discordId];

        if (!record) {
            return interaction.reply({
                embeds: [errorEmbed('Player not found or not verified.')],
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
                embeds: [errorEmbed(`No Redsec combat history found for \`${record.eaId}\`.`)],
            });
        }

        const redsecIndex = parseFloat(((0.40 - s.kpm) * 25).toFixed(1));
        const displayName = record.displayName ?? data.userName ?? record.eaId;

        const ratings  = loadRatings();
        const xpRecord = ratings[discordId] ?? null;
        await interaction.editReply({ embeds: [buildStatsEmbed(displayName, s, redsecIndex, xpRecord)] });
    },
};

function errorEmbed(description) {
    return new EmbedBuilder()
        .setColor(0x1a0000)
        .setTitle('Error')
        .setDescription(description)
        .setTimestamp();
}
