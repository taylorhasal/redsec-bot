const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('commands')
        .setDescription('List all available Redsec bot commands'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('📋  Redsec Bot — Commands')
            .addFields(
                {
                    name: '👤  Player Commands',
                    value: [
                        '`/verify` — Link your EA ID, set your display name, and calculate your Redsec Index',
                        '`/update` — Re-sync your Redsec stats, index, and server roles',
                        '`/change-name <gamertag>` — Update your display name on the leaderboard and roster',
                        '`/stats` — View your live Redsec stats',
                        '`/profile` — Look up another verified player\'s stats',
                        '`/start-tracking` — Auto-detect your Redsec Squad games (posts to live tracker)',
                        '`/stop-tracking` — Stop personal live tracking',
                        '`/xp` — View your XP Ranked stats',
                    ].join('\n'),
                },
            )
            .setFooter({ text: 'Redsec · Battlefield 6' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
