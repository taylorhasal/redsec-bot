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
                        'Type `/verify` in this channel. A popup will appear with **two fields**:\n\n' +
                        '> **EA ID** *(required)* — found in the **top-right corner** of the **"Search for Player"** screen in BF6.\n' +
                        '> ⚠️ **Only EA ID is accepted** — not Steam, not PS5, not Xbox.\n\n' +
                        '> **Display Name** *(optional)* — your in-game gamertag (Steam, Xbox, or PS5 name). Leave blank to use your EA ID.\n\n' +
                        'The bot will pull your Redsec data, calculate your **Redsec Index**, and automatically set your server nickname.',
                    inline: false,
                },
                {
                    name:  '🏷️  Step 3: Your Nickname',
                    value:
                        'After verification, the bot automatically sets your server nickname to `[Index] YourName` — no manual changes needed.\n\n' +
                        '> 💡 Changed your in-game name? Run `/change-name` to update your display name.\n' +
                        '> 💡 Want to re-sync your stats? Run `/update`.',
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
