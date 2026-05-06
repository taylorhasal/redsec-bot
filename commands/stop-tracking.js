const { SlashCommandBuilder } = require('discord.js');
const { loadTrackers, saveTrackers, removeTrackingRole } = require('../utils/liveTracker');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stop-tracking')
        .setDescription('Stop auto-detecting your Redsec Squad games in the live tracker channel'),

    async execute(interaction) {
        const userId  = interaction.user.id;
        const trackers = loadTrackers();
        const tracker  = trackers[userId];

        if (!tracker || tracker.personalTracking === false) {
            return interaction.reply({
                content: tracker?.tournamentId
                    ? "You don't have personal tracking running. (Your games are still being auto-scored for the tournament — that runs automatically.)"
                    : "You're not currently being tracked.",
                ephemeral: true,
            });
        }

        tracker.personalTracking = false;

        if (tracker.tournamentId) {
            // Keep the entry alive — still needed for tournament auto-scoring
            saveTrackers(trackers);
            await interaction.reply({
                content: '🛑  Personal live tracking stopped. Your games will no longer appear in the tracker channel, but tournament auto-scoring continues in the background.',
                ephemeral: true,
            });
        } else {
            // No tournament tracking — remove the entry entirely
            delete trackers[userId];
            saveTrackers(trackers);
            await removeTrackingRole(interaction.client, interaction.guild.id, userId);
            await interaction.reply({
                content: '🛑  Live tracking stopped.',
                ephemeral: true,
            });
        }
    },
};
