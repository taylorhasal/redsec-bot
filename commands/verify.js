const {
    SlashCommandBuilder,
    ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Link your EA ID and calculate your Redsec Index'),

    async execute(interaction) {
        const modal = new ModalBuilder()
            .setCustomId('verify_modal')
            .setTitle('Enter Your EA ID');

        const input = new TextInputBuilder()
            .setCustomId('ea_id')
            .setLabel('Your EA ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(64)
            .setPlaceholder('Found top-right on the Search for Player screen in BF6');

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    },
};
