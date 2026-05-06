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

        const eaIdInput = new TextInputBuilder()
            .setCustomId('ea_id')
            .setLabel('Your EA ID')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(64)
            .setPlaceholder('Found top-right on the Search for Player screen in BF6');

        const displayNameInput = new TextInputBuilder()
            .setCustomId('display_name')
            .setLabel('Display Name (optional)')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(32)
            .setPlaceholder('Leave blank to use your EA ID');

        modal.addComponents(
            new ActionRowBuilder().addComponents(eaIdInput),
            new ActionRowBuilder().addComponents(displayNameInput),
        );
        await interaction.showModal(modal);
    },
};
