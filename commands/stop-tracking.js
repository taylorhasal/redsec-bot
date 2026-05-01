const { SlashCommandBuilder } = require('discord.js');
const { loadTrackers, saveTrackers } = require('../utils/liveTracker');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop-tracking')
        .setDescription('Stop auto-detecting your Redsec Squad games'),

    async execute(interaction) {
        const userId = interaction.user.id;
        const trackers = loadTrackers();

        if (!trackers[userId]) {
            return interaction.reply({
                content: "You're not currently being tracked.",
                ephemeral: true,
            });
        }

        delete trackers[userId];
        saveTrackers(trackers);

        await interaction.reply({
            content: '🛑  Live tracking stopped.',
            ephemeral: true,
        });
    },
};
