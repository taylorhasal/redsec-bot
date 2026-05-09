const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Link your gaming account and calculate your Redsec Index'),

    async execute(interaction) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('verify_platform:ea').setLabel('PC (EA)').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('verify_platform:psn').setLabel('PlayStation').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('verify_platform:xbox').setLabel('Xbox').setStyle(ButtonStyle.Secondary),
        );
        await interaction.reply({
            content: 'Select your platform to continue:',
            components: [row],
            ephemeral: true,
        });
    },
};
