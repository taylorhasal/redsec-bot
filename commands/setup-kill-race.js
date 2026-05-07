const {
    SlashCommandBuilder, PermissionFlagsBits, ChannelType,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const {
    loadRecords, loadPlayers, saveKillRaceConfig,
    buildLeaderboardEmbed,
} = require('../utils/killRace');

const HOW_TO_PLAY = `
**Welcome to 2v2 Kill Race** — a head-to-head squad mode where two teams of two compete in a Redsec Squad lobby and the team with more kills wins. Wins and losses are tracked on the leaderboard.

**How to Play**

**Step 1 — Queue Up**
Click **Start 2v2 Kill Race Match** in <#QUEUE_PLACEHOLDER>. A match queue embed will appear. Join Team 1 or Team 2 — you need 2 players per side to start.

**Step 2 — Set Up the Lobby**
Once all 4 slots are filled, voice channels are created for each team. The **host team** (the more skilled team by combined Redsec Index) queues a **Squads Redsec** match. All four players join the host's lobby.

**Step 3 — Play the Match**
All four players are in the same lobby competing against the rest of the battle royale. It's a **kill race** — the team with the most kills at the end of the round wins. A few important rules:
• The round ends when the game ends or all players from both teams have been eliminated.
• If both players on a team are eliminated but they hold the kill lead, the match isn't over — the surviving team still has time to catch up.
• Players may use **redeploys** to bring teammates back into the fight. Players returned via **Second Chance** are fully back in play as normal.
• Note: if a redeploy brings back an opposing player, they are back in the game and can compete for kills — this is part of the format.
• Agree on your format before you start: **Best of 1**, **Best of 3**, or **Best of 5**.

**Step 4 — Report the Result**
When the series is over, click **Report Result** on the match embed and select the winning team. Both teams must report.
• If both reports **agree** → the result is recorded automatically and W/L updates instantly.
• If reports **conflict** → the match is flagged as disputed and a Moderator will review.
• **Keep proof of the score** (screenshot or video) in case of a dispute — mods will ask for it.

**Leaderboard**
Standings update automatically after every match. Check <#LEADERBOARD_PLACEHOLDER> to see where you rank. You only appear after your first completed match.
`.trim();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-kill-race')
        .setDescription('Create the 2v2 Kill Race category, channels, leaderboard, and start button')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;
        const botId  = interaction.client.user.id;

        const readOnly = [
            { id: guild.roles.everyone.id, deny:  [PermissionFlagsBits.SendMessages] },
            { id: botId,                   allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ];

        try {
            console.log('[setup-kill-race] Creating category...');
            const category = await guild.channels.create({
                name: '⚔️ 2v2 Kill Race',
                type: ChannelType.GuildCategory,
            });

            console.log('[setup-kill-race] Creating channels...');
            const leaderboardCh = await guild.channels.create({
                name:                 'kill-race-leaderboard',
                type:                 ChannelType.GuildText,
                parent:               category.id,
                permissionOverwrites: readOnly,
            });

            const howToPlayCh = await guild.channels.create({
                name:                 'kill-race-how-to-play',
                type:                 ChannelType.GuildText,
                parent:               category.id,
                permissionOverwrites: readOnly,
            });

            const queueCh = await guild.channels.create({
                name:   'kill-race-queue',
                type:   ChannelType.GuildText,
                parent: category.id,
            });

            const logCh = await guild.channels.create({
                name:   'kill-race-log',
                type:   ChannelType.GuildText,
                parent: category.id,
            });

            // Post leaderboard embed (empty state — players appear after their first match)
            console.log('[setup-kill-race] Posting leaderboard...');
            const records = loadRecords();
            const players = loadPlayers();
            const lbEmbed = buildLeaderboardEmbed(records, players);
            const lbMsg   = await leaderboardCh.send({ embeds: [lbEmbed] });

            console.log('[setup-kill-race] Posting how-to-play...');
            const guideText = HOW_TO_PLAY
                .replace('QUEUE_PLACEHOLDER',       queueCh.id)
                .replace('LEADERBOARD_PLACEHOLDER', leaderboardCh.id);

            const guideEmbed = new EmbedBuilder()
                .setColor(0xCC0000)
                .setTitle('📖  How to Play 2v2 Kill Race')
                .setDescription(guideText)
                .setFooter({ text: 'Redsec · 2v2 Kill Race' })
                .setTimestamp();
            await howToPlayCh.send({ embeds: [guideEmbed] });

            console.log('[setup-kill-race] Posting start button...');
            const startRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('killrace_start')
                    .setLabel('⚔️  Start 2v2 Kill Race Match')
                    .setStyle(ButtonStyle.Danger),
            );
            await queueCh.send({
                content: '**Click below to create a new 2v2 Kill Race match queue.**',
                components: [startRow],
            });

            console.log('[setup-kill-race] Saving config...');
            saveKillRaceConfig({
                categoryId:           category.id,
                leaderboardChannelId: leaderboardCh.id,
                leaderboardMessageId: lbMsg.id,
                howToPlayChannelId:   howToPlayCh.id,
                queueChannelId:       queueCh.id,
                logChannelId:         logCh.id,
            });

            console.log('[setup-kill-race] Done.');
            await interaction.editReply(
                `✅ **2v2 Kill Race** set up!\n` +
                `• <#${leaderboardCh.id}> — live leaderboard\n` +
                `• <#${howToPlayCh.id}> — how to play guide\n` +
                `• <#${queueCh.id}> — match queue\n` +
                `• <#${logCh.id}> — match log\n` +
                `\nPlayers appear on the leaderboard after their first completed match.`
            );
        } catch (err) {
            console.error('[setup-kill-race] FAILED:', err);
            await interaction.editReply(`❌ Setup failed at step: **${err.message}**`).catch(() => {});
        }
    },
};
