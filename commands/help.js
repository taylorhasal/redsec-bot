const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('List all available Redsec bot commands'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('📋  Redsec Bot — Commands')
            .addFields(
                {
                    name: '/stats',
                    value: 'Fetch a player\'s live Redsec stats from Battlefield 6.\n`ea_id` · `platform (optional)`',
                },
                {
                    name: '/profile',
                    value: 'View a verified member\'s Redsec profile including K/D, Win Rate, and Redsec Index.\n`@user`',
                },
            )
            .setFooter({ text: 'Redsec · Battlefield 6' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
