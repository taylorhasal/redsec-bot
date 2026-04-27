const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { postServerLeaderboard } = require('../utils/serverLeaderboard');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('server-leaderboard')
        .setDescription('Post the full server rankings of all verified players sorted by Redsec Index')
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('Channel to post the leaderboard in')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const target = interaction.options.getChannel('channel');

        await postServerLeaderboard(target);

        await interaction.editReply({ content: `✅  Server leaderboard posted in ${target}.` });
    },
};
