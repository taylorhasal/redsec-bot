const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { loadAll, loadById } = require('../utils/tournament');
const { sendFiveMinWarning } = require('../utils/warnings');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('test-warning')
        .setDescription('Test the 5-minute admin warning for a tournament')
        .addStringOption(o =>
            o.setName('tournament')
                .setDescription('Tournament to test')
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

        await sendFiveMinWarning(client, tournament);

        await interaction.editReply({
            content: `✅ 5-minute warning sent to the admin audit channel for **${tournament.name}**. If no message appeared, check that \`🕵️-admin-audit\` exists and that there is at least one team with fewer than 4 players.`,
        });
    },
};
