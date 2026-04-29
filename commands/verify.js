const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Link your EA ID and calculate your Redsec Index'),

    async execute(interaction) {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('verify_platform:ea')  .setLabel('EA')          .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('verify_platform:psn') .setLabel('PlayStation') .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('verify_platform:xbox').setLabel('Xbox')        .setStyle(ButtonStyle.Secondary),
        );

        await interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xCC0000)
                    .setTitle('🎮  Select Your Platform')
                    .setDescription('Choose the platform your account is on, then enter your username.'),
            ],
            components: [row],
            ephemeral: true,
        });
    },
};
