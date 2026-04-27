const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { loadAll, loadById, remove } = require('../utils/tournament');
const { buildLeaderboardEmbed }     = require('../utils/leaderboard');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tournament-end')
        .setDescription('End a tournament, post final results, and delete all its channels')
        .addStringOption(o =>
            o.setName('tournament')
                .setDescription('Tournament to end')
                .setAutocomplete(true)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async autocomplete(interaction) {
        const all     = loadAll();
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = Object.entries(all)
            .filter(([, t]) => t.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(([id, t]) => ({ name: t.name, value: id }));
        await interaction.respond(choices);
    },

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const tournamentId = interaction.options.getString('tournament');
        const tournament   = loadById(tournamentId);

        if (!tournament) {
            return interaction.editReply({ content: 'Tournament not found.' });
        }

        // Check if any scores have been confirmed
        const hasResults = Object.values(tournament.teams).some(team =>
            Object.values(team.scores).some(score => score && !score.pending)
        );

        // Post final standings only if there are confirmed scores
        if (hasResults && tournament.resultsChannelId) {
            const resultsCh = await client.channels.fetch(tournament.resultsChannelId).catch(() => null);
            if (resultsCh) {
                const embed = buildLeaderboardEmbed(tournament)
                    .setTitle(`🏆  ${tournament.name} — Final Results`)
                    .setColor(0xFFD700);
                await resultsCh.send({ embeds: [embed] }).catch(() => {});
            }
        }

        // Delete all channels inside the category, then the category itself
        if (tournament.categoryId) {
            const category = await client.channels.fetch(tournament.categoryId).catch(() => null);
            if (category) {
                for (const [, ch] of category.children.cache) {
                    await ch.delete().catch(() => {});
                }
                await category.delete().catch(() => {});
            }
        }

        // Remove tournament from storage
        remove(tournamentId);

        const msg = hasResults
            ? `✅  **${tournament.name}** ended — final results posted and channels deleted.`
            : `✅  **${tournament.name}** cancelled — channels deleted (no results to post).`;

        await interaction.editReply({ content: msg });
    },
};
