const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('commands-admin')
        .setDescription('List all admin commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('🔧  Redsec Bot — Admin Commands')
            .addFields(
                {
                    name: '🏆  Tournaments',
                    value: [
                        '`/tournament-create` — Set up a new tournament and create all channels',
                        '`/tournament-start` — Start the tournament clock (enables auto-scoring)',
                        '`/tournament-end` — End the tournament, post final results, delete channels',
                        '`/register-team` — Register a team on behalf of players',
                    ].join('\n'),
                },
                {
                    name: '👤  Players',
                    value: [
                        '`/verify-user` — Manually verify a Discord member',
                        '`/update-all` — Re-sync stats and roles for every verified player',
                        '`/server-leaderboard` — Post the full server player rankings',
                    ].join('\n'),
                },
                {
                    name: '📣  Content',
                    value: [
                        '`/send-guide` — Post the player verification guide',
                        '`/send-briefing` — Post the official mission briefing',
                        '`/announce` — Pull all voice members into Announcements',
                        '`/announce-end` — Return voice members to their previous channels',
                    ].join('\n'),
                },
                {
                    name: '⚙️  Setup',
                    value: [
                        '`/setup` — Bootstrap the full server infrastructure',
                        '`/setup-community` — Create community channels',
                        '`/setup-verify` — Create the verify channel and post the Verify Now button',
                        '`/setup-lfg` — Create Looking for Group channels',
                        '`/setup-voice` — Create dynamic voice channels',
                        '`/setup-live-tracker` — Create the live tracking channel',
                        '`/setup-kill-race` — Create 2v2 Kill Race channels and leaderboard',
                        '`/setup-rules` — Post or refresh the rules channel',
                    ].join('\n'),
                },
            )
            .setFooter({ text: 'Redsec · Admin' })
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
