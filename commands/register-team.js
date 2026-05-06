const {
    SlashCommandBuilder, PermissionFlagsBits,
    UserSelectMenuBuilder, ButtonBuilder, ButtonStyle,
    ActionRowBuilder,
} = require('discord.js');
const { loadAll, loadById } = require('../utils/tournament');
const { pendingAdminRegs } = require('../interactions/registration');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('register-team')
        .setDescription('Register a team in a tournament on behalf of players')
        .addStringOption(o =>
            o.setName('tournament')
                .setDescription('Tournament to register the team in')
                .setAutocomplete(true)
                .setRequired(true))
        .addStringOption(o =>
            o.setName('name')
                .setDescription('Team name')
                .setRequired(true)
                .setMinLength(2)
                .setMaxLength(32))
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

    async execute(interaction) {
        const tournamentId = interaction.options.getString('tournament');
        const teamName     = interaction.options.getString('name').trim();
        const tournament   = loadById(tournamentId);

        if (!tournament) {
            return interaction.reply({ content: 'Tournament not found.', ephemeral: true });
        }

        pendingAdminRegs.set(interaction.user.id, { teamName, tournamentId });

        await interaction.reply({
            content: `**${teamName}** → **${tournament.name}**\n\nStep 1 of 2 — Select the team captain:`,
            components: [
                new ActionRowBuilder().addComponents(
                    new UserSelectMenuBuilder()
                        .setCustomId('admin_captain_select')
                        .setPlaceholder('Search for captain by name or username')
                        .setMinValues(1)
                        .setMaxValues(1)
                ),
            ],
            ephemeral: true,
        });
    },
};
