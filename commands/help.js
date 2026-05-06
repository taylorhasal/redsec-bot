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
                    name: '👤  Player',
                    value: [
                        '`/verify` — Link your EA account to the server',
                        '`/stats` — View your live Redsec stats',
                        '`/profile` — Look up another verified player\'s stats',
                        '`/change-name <gamertag>` — Update your display name on the leaderboard and roster',
                        '`/xp` — Check your XP Ranked position and record',
                    ].join('\n'),
                },
                {
                    name: '🔧  Admin',
                    value: [
                        '`/verify-user` — Manually verify a member',
                        '`/send-guide` — Post the verification guide to a channel',
                        '`/setup-xp` — Set up the XP Ranked category and channels',
                    ].join('\n'),
                },
            )
            .setFooter({ text: 'Redsec · Battlefield 6' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
