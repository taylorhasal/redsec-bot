const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const origins = require('../utils/announceState');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announce-end')
        .setDescription('Return all voice members to the channels they were in before the announcement')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        if (origins.size === 0) {
            return interaction.editReply({ content: 'No active announcement to end.' });
        }

        const guild = interaction.guild;
        let returned = 0;

        for (const [userId, channelId] of origins) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member?.voice.channelId) {
                await member.voice.setChannel(channelId).catch(() => {});
                returned++;
            }
        }

        origins.clear();

        await interaction.editReply({
            content: `✅ Returned **${returned}** member${returned !== 1 ? 's' : ''} to their original channels.`,
        });
    },
};
