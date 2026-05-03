const {
    SlashCommandBuilder, PermissionFlagsBits, ChannelType,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const {
    loadRatings, saveRatings, loadPlayers, saveXpConfig,
    buildXpLeaderboardEmbed,
} = require('../utils/xpMatch');

const HOW_TO_PLAY = `
**Welcome to XP Ranked** — a 2v2 kill-race mode where you earn and lose XP based on your performance and the skill gap between teams.

**How It Works**
Your XP starts at **1,000**. After every match, both teams gain or lose XP based on the outcome and the skill gap between the teams (Redsec Index).
• Upset a stronger team? You earn significantly more XP.
• Beat a weaker team? You earn less — it was expected.
• Lose to a stronger team? You lose less — no shame in that.
• Lose to a weaker team? You lose more — you were supposed to win.

**How to Play**

**Step 1 — Queue Up**
Click **Start XP Match** in <#QUEUE_PLACEHOLDER>. A match queue embed will appear. Join Team 1 or Team 2 — you need 2 players per side to start.

**Step 2 — Set Up the Lobby**
Once all 4 slots are filled, voice channels are created for each team. The **host team** (the more skilled team by combined Redsec Index) queues a **Squads Redsec** match. All four players join the host's lobby — no handicaps applied.

**Step 3 — Play the Match**
All four players are in the same lobby competing against the rest of the battle royale. It's a **kill race** — the team with the most kills at the end of the round wins. A few important rules:
• The round ends when the game ends or all players from both teams have been eliminated.
• If both players on a team are eliminated but they hold the kill lead, the match isn't over — the surviving team still has time to catch up.
• Players may use **redeploys** to bring teammates back into the fight. Players returned via **Second Chance** are fully back in play as normal.
• Note: if a redeploy brings back an opposing player, they are back in the game and can compete for kills — this is part of the format.
• Agree on your format before you start: **Best of 1**, **Best of 3**, or **Best of 5**.

**Step 4 — Report the Result**
When the series is over, click **Report Result** on the match embed and select the winning team. Both teams must report.
• If both reports **agree** → XP is applied automatically.
• If reports **conflict** → the match is flagged as disputed and a Moderator will review.
• **Keep proof of the score** (screenshot or video) in case of a dispute — mods will ask for it.

**Leaderboard**
Standings update automatically after every match. Check <#LEADERBOARD_PLACEHOLDER> to see where you rank.
`.trim();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-xp')
        .setDescription('Create the XP Ranked category, channels, leaderboard, and start button')
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
            // Category
            console.log('[setup-xp] Creating category...');
            const category = await guild.channels.create({
                name: '📊 XP Ranked',
                type: ChannelType.GuildCategory,
            });

            // Channels
            console.log('[setup-xp] Creating channels...');
            const leaderboardCh = await guild.channels.create({
                name:                 'xp-leaderboard',
                type:                 ChannelType.GuildText,
                parent:               category.id,
                permissionOverwrites: readOnly,
            });

            const howToPlayCh = await guild.channels.create({
                name:                 'xp-how-to-play',
                type:                 ChannelType.GuildText,
                parent:               category.id,
                permissionOverwrites: readOnly,
            });

            const queueCh = await guild.channels.create({
                name:   'xp-queue',
                type:   ChannelType.GuildText,
                parent: category.id,
            });

            const logCh = await guild.channels.create({
                name:   'xp-match-log',
                type:   ChannelType.GuildText,
                parent: category.id,
            });

            // Seed all verified players at 1000 XP (don't overwrite existing)
            console.log('[setup-xp] Seeding ratings...');
            const players = loadPlayers();
            const ratings = loadRatings();
            for (const userId of Object.keys(players)) {
                if (!ratings[userId]) ratings[userId] = { xp: 1000, wins: 0, losses: 0 };
            }
            saveRatings(ratings);

            // Post leaderboard embed
            console.log('[setup-xp] Posting leaderboard...');
            const lbEmbed = buildXpLeaderboardEmbed(ratings, players);
            const lbMsg   = await leaderboardCh.send({ embeds: [lbEmbed] });

            // Post how-to-play guide
            console.log('[setup-xp] Posting how-to-play...');
            const guideText = HOW_TO_PLAY
                .replace('QUEUE_PLACEHOLDER',       queueCh.id)
                .replace('LEADERBOARD_PLACEHOLDER', leaderboardCh.id);

            const guideEmbed = new EmbedBuilder()
                .setColor(0xCC0000)
                .setTitle('📖  How to Play XP Ranked')
                .setDescription(guideText)
                .setFooter({ text: 'Redsec · XP Ranked' })
                .setTimestamp();
            await howToPlayCh.send({ embeds: [guideEmbed] });

            // Post persistent "Start XP Match" button in queue channel
            console.log('[setup-xp] Posting start button...');
            const startRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('xp_start')
                    .setLabel('🎯  Start XP Match')
                    .setStyle(ButtonStyle.Danger),
            );
            await queueCh.send({
                content: '**Click below to create a new XP Ranked match queue.**',
                components: [startRow],
            });

            // Save config
            console.log('[setup-xp] Saving config...');
            saveXpConfig({
                categoryId:           category.id,
                leaderboardChannelId: leaderboardCh.id,
                leaderboardMessageId: lbMsg.id,
                howToPlayChannelId:   howToPlayCh.id,
                queueChannelId:       queueCh.id,
                logChannelId:         logCh.id,
            });

            console.log('[setup-xp] Done.');
            await interaction.editReply(
                `✅ **XP Ranked** set up!\n` +
                `• <#${leaderboardCh.id}> — live leaderboard\n` +
                `• <#${howToPlayCh.id}> — how to play guide\n` +
                `• <#${queueCh.id}> — match queue\n` +
                `• <#${logCh.id}> — match log\n` +
                `\nAll ${Object.keys(players).length} verified player(s) seeded at 1,000 XP.`
            );
        } catch (err) {
            console.error('[setup-xp] FAILED:', err);
            await interaction.editReply(`❌ Setup failed at step: **${err.message}**`).catch(() => {});
        }
    },
};
