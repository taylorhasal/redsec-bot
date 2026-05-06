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
                    name: '👤  Player',
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
                {
                    name: '🏆  Admin — Tournaments',
                    value: [
                        '`/tournament-create` — Set up a new tournament and create all channels',
                        '`/tournament-start` — Start the tournament clock (enables auto-scoring)',
                        '`/tournament-end` — End the tournament, post final results, delete channels',
                        '`/register-team` — Register a team on behalf of players',
                    ].join('\n'),
                },
                {
                    name: '🔧  Admin — Players',
                    value: [
                        '`/verify-user` — Manually verify a Discord member',
                        '`/update-all` — Re-sync stats and roles for every verified player',
                        '`/server-leaderboard` — Post the full server player rankings',
                    ].join('\n'),
                },
                {
                    name: '📣  Admin — Content',
                    value: [
                        '`/send-guide` — Post the player verification guide',
                        '`/send-briefing` — Post the official mission briefing',
                        '`/announce` — Pull all voice members into Announcements',
                        '`/announce-end` — Return voice members to their previous channels',
                    ].join('\n'),
                },
                {
                    name: '⚙️  Admin — Setup',
                    value: [
                        '`/setup` — Bootstrap the full server infrastructure',
                        '`/setup-community` — Create community channels',
                        '`/setup-lfg` — Create Looking for Group channels',
                        '`/setup-voice` — Create dynamic voice channels',
                        '`/setup-live-tracker` — Create the live tracking channel',
                        '`/setup-xp` — Create XP Ranked channels and leaderboard',
                        '`/setup-rules` — Post or refresh the rules channel',
                    ].join('\n'),
                },
            )
            .setFooter({ text: 'Redsec · Battlefield 6' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
