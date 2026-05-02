const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('send-guide')
        .setDescription('Post the Player Verification & Privacy Guide')
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('Channel to post the guide in')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const target = interaction.options.getChannel('channel');

        const embed = new EmbedBuilder()
            .setColor(0x2e8b57)
            .setTitle('🛡️  PLAYER VERIFICATION: STEP-BY-STEP')
            .setDescription(
                'To join, we must verify your combat history. ' +
                'This ensures fair handicaps and keeps the **Net Leaderboard** competitive for everyone.'
            )
            .addFields(
                {
                    name:  '🔓  Step 1: Make Your Stats Public',
                    value: [
                        '> Open **Battlefield 6**.',
                        '> Go to **Settings › Accessibility & Privacy**.',
                        '> Ensure **\'Share Usage Data\'** is toggled **ON**.',
                        '',
                        '⚠️ If this is **OFF**, our system cannot see your stats and you will be rejected.',
                    ].join('\n'),
                    inline: false,
                },
                {
                    name:  '🤖  Step 2: Run /verify',
                    value:
                        'Type `/verify` in this channel. A popup will appear — enter your **EA ID**.\n\n' +
                        '> ⚠️ **Only EA ID is accepted** — not Steam, not PS5, not Xbox.\n' +
                        '> Your EA ID is found in the **top-right corner** of the **"Search for Player"** screen in the BF6 menu.\n\n' +
                        'The bot will pull your Redsec data and calculate your **Redsec Index**.',
                    inline: false,
                },
                {
                    name:  '🕹️  Step 3: Set Your In-Game Name',
                    value:
                        'Once verified, **update your Discord display name** (or server nickname) to your **in-game gamertag** — ' +
                        'the name your teammates and opponents see in-game. This can be your Steam, Xbox, or PS5 username.\n\n' +
                        'The bot will automatically prefix it with your Redsec Index — for example: `[+1.2] YourGamertag`.\n\n' +
                        '> 💡 Already verified? Run `/refresh` to re-sync your stats and apply the new format.',
                    inline: false,
                },
                {
                    name:  '❓  Why do we do this?',
                    value:
                        'We analyze your lifetime Redsec stats to find your **Personal Par**. ' +
                        'This allows us to run a **Net Score** leaderboard where a casual squad can ' +
                        'realistically beat a pro squad — by simply playing better than their own average.',
                    inline: false,
                },
            )
            .setFooter({ text: 'Redsec — Verification Guide' })
            .setTimestamp();

        await target.send({ embeds: [embed] });
        await interaction.reply({ content: `✅  Guide posted in ${target}.`, ephemeral: true });
    },
};
