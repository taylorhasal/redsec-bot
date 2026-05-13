const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify-user')
        .setDescription('Manually verify a Discord member')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption(option =>
            option.setName('member')
                .setDescription('The Discord member to verify')
                .setRequired(true)),

    async execute(interaction) {
        const target = interaction.options.getMember('member');
        if (!target) {
            return interaction.reply({ content: 'Could not find that member in this server.', ephemeral: true });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`admin_verify_platform:ea:${target.id}`).setLabel('PC (EA)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`admin_verify_platform:psn:${target.id}`).setLabel('PlayStation').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`admin_verify_platform:xbox:${target.id}`).setLabel('Xbox').setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({
            content: `Select platform for <@${target.id}>:`,
            components: [row],
            ephemeral: true,
        });
    },
};
