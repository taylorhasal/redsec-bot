const {
    SlashCommandBuilder, PermissionFlagsBits, ChannelType,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} = require('discord.js');
const { save, newTeamId }           = require('../utils/tournament');
const { buildLeaderboardEmbed }     = require('../utils/leaderboard');
const { parseScheduledStart }       = require('../utils/warnings');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tournament-create')
        .setDescription('Set up a new Redsec tournament and create all required channels')
        .addStringOption(o =>
            o.setName('name')
                .setDescription('Tournament name')
                .setRequired(true))
        .addStringOption(o =>
            o.setName('date')
                .setDescription('Tournament date (e.g. May 15, 2026)')
                .setRequired(true))
        .addStringOption(o =>
            o.setName('time')
                .setDescription('Start time in PST (e.g. 6:00 PM)')
                .setRequired(true))
        .addChannelOption(o =>
            o.setName('rules_channel')
                .setDescription('The #tourney-rules channel to link in tourney-info')
                .setRequired(true))
        .addChannelOption(o =>
            o.setName('results_channel')
                .setDescription('Channel to post final standings when the tournament ends')
                .setRequired(true))
        .addStringOption(o =>
            o.setName('entry_fee')
                .setDescription('Entry fee per team of 4 (e.g. $10, Free, $5/player)')
                .setRequired(true))
        .addStringOption(o =>
            o.setName('gross_payouts')
                .setDescription('Gross leaderboard payouts by place (e.g. 1st: 50%, 2nd: 30%, 3rd: 20%)')
                .setRequired(false))
        .addStringOption(o =>
            o.setName('net_payouts')
                .setDescription('Net leaderboard payouts by place (e.g. 1st: 50%, 2nd: 30%, 3rd: 20%)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const name           = interaction.options.getString('name');
        const date           = interaction.options.getString('date');
        const time           = interaction.options.getString('time');
        const rulesChannel   = interaction.options.getChannel('rules_channel');
        const resultsChannel = interaction.options.getChannel('results_channel');
        const entryFee       = interaction.options.getString('entry_fee');
        const grossPayouts   = interaction.options.getString('gross_payouts');
        const netPayouts     = interaction.options.getString('net_payouts');
        const guild          = interaction.guild;
        const scheduledStartAt = parseScheduledStart(date, time);
        const botId          = interaction.client.user.id;

        // Resolve the @Verified role created by /setup
        await guild.roles.fetch();
        const verifiedRole = guild.roles.cache.find(r => r.name === 'Verified');
        if (!verifiedRole) {
            return interaction.editReply('⚠️ No **@Verified** role found. Run `/setup` first to create server roles.');
        }

        // Category
        const category = await guild.channels.create({
            name: `🏆 ${name}`,
            type: ChannelType.GuildCategory,
        });

        // Verified-only read-only (bot can post, @everyone cannot see)
        const readOnlyPerms = [
            { id: guild.id,        deny:  ['ViewChannel', 'SendMessages'] },
            { id: verifiedRole.id, allow: ['ViewChannel', 'ReadMessageHistory'] },
            { id: botId,           allow: ['ViewChannel', 'SendMessages', 'CreatePublicThreads', 'ManageThreads', 'ReadMessageHistory'] },
        ];

        // Verified players can also chat here
        const chatPerms = [
            { id: guild.id,        deny:  ['ViewChannel', 'SendMessages'] },
            { id: verifiedRole.id, allow: ['ViewChannel', 'SendMessages', 'AddReactions', 'ReadMessageHistory'] },
            { id: botId,           allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
        ];

        const [
            regChannel, scoreChannel, lbChannel,
            chatChannel, rosterChannel, infoChannel,
        ] = await Promise.all([
            guild.channels.create({ name: 'registration',      type: ChannelType.GuildText, parent: category.id, permissionOverwrites: readOnlyPerms }),
            guild.channels.create({ name: 'score-submissions', type: ChannelType.GuildText, parent: category.id, permissionOverwrites: readOnlyPerms }),
            guild.channels.create({ name: 'live-leaderboard',  type: ChannelType.GuildText, parent: category.id, permissionOverwrites: readOnlyPerms }),
            guild.channels.create({ name: 'tourney-chat',      type: ChannelType.GuildText, parent: category.id, permissionOverwrites: chatPerms }),
            guild.channels.create({ name: 'rosters',           type: ChannelType.GuildText, parent: category.id, permissionOverwrites: readOnlyPerms }),
            guild.channels.create({ name: 'tourney-info',      type: ChannelType.GuildText, parent: category.id, permissionOverwrites: readOnlyPerms }),
        ]);

        // #registration
        const regMsg = await regChannel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xCC0000)
                    .setTitle('📋  Team Registration')
                    .setDescription(
                        `Click **Register Team** to enter **${name}**.\n\n` +
                        `All players must have the <@&${verifiedRole.id}> role. Run \`/verify\` to link your EA ID and get verified.`
                    )
                    .setFooter({ text: 'Redsec Tournament' }),
            ],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('register_open')
                        .setLabel('Register Team')
                        .setStyle(ButtonStyle.Danger)
                ),
            ],
        });

        // #score-submissions
        const scoreMsg = await scoreChannel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xCC0000)
                    .setTitle('🎮  Score Submissions')
                    .setDescription(
                        'Team captains: click **Submit Game Score** after each game — scores appear on the leaderboard immediately as unofficial.\n\n' +
                        'Enter your game number, total team kills, and placement. Submit as many games as you want — the bot uses your **top 2** automatically.\n\n' +
                        'After the tournament, use **Manage Submissions → Submit Proof** to upload screenshots for admin review.'
                    )
                    .addFields({
                        name: '📊 Point Tiers',
                        value: [
                            '`1 Kill = 1 Point`',
                            '`1st → 15 pts`',
                            '`2nd → 12 pts`',
                            '`3rd → 10 pts`',
                            '`4th → 8 pts`',
                            '`5th → 6 pts`',
                            '`6th–10th → 4 pts`',
                            '`11th+ → 0 pts`',
                        ].join('\n'),
                    })
                    .setFooter({ text: 'Redsec Tournament' }),
            ],
            components: [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('submit_score')
                        .setLabel('Submit Game Score')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId('manage_scores')
                        .setLabel('Manage Submissions')
                        .setStyle(ButtonStyle.Secondary)
                ),
            ],
        });

        // #tourney-chat
        await chatChannel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xCC0000)
                    .setTitle(`💬  ${name} — Tournament Chat`)
                    .setDescription(
                        `Welcome to **${name}**!\n\n` +
                        `This channel is open to all verified participants. Use it to communicate with other teams before and during the tournament.`
                    )
                    .setFooter({ text: 'Redsec Tournament' }),
            ],
        });

        // #rosters
        await rosterChannel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xCC0000)
                    .setTitle('👥  Registered Teams')
                    .setDescription('Team rosters will appear here as teams register.')
                    .setFooter({ text: 'Redsec Tournament · Rosters' }),
            ],
        });

        // #tourney-info
        await infoChannel.send({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xCC0000)
                    .setTitle(`🏆  ${name}`)
                    .addFields(
                        { name: '📅  Date',        value: date,                     inline: true },
                        { name: '⏰  Start Time',  value: `${time} PDT`,            inline: true },
                        { name: '💰  Entry Fee',   value: `${entryFee} per team`,   inline: true },
                        ...(grossPayouts || netPayouts ? [{
                            name:  '💵  Payouts',
                            value: [
                                grossPayouts ? `**Gross:** ${grossPayouts}` : null,
                                netPayouts   ? `**Net:** ${netPayouts}`     : null,
                            ].filter(Boolean).join('\n'),
                            inline: false,
                        }] : []),
                        { name: '📋  Rules',       value: `<#${rulesChannel.id}>`,  inline: false },
                        {
                            name:  '📋  How to Register',
                            value: `> Head to ${regChannel} and click **Register Team**.\n> You will be automatically added as captain. Select up to 3 verified teammates, or register solo (you will need to complete your roster manually.)`,
                            inline: false,
                        },
                        {
                            name:  '🎮  How to Submit Scores',
                            value: `> Once the tournament is complete, go to ${scoreChannel} and click **Submit Game Score**.\n> Enter your game number (1 or 2), total team kills, and placement. A private thread will be created — upload your **scoreboard screenshot** there to confirm the score.`,
                            inline: false,
                        },
                        {
                            name:  '🏆  Post Tournament Leaderboard',
                            value: `> Check out the leaderboard at ${lbChannel}.\n> Both **Gross** (raw points) and **Net** (handicap-adjusted) rankings are shown.`,
                            inline: false,
                        },
                        {
                            name:  '👥  Team Rosters',
                            value: `> View all registered teams and their players in ${rosterChannel}.`,
                            inline: false,
                        },
                        {
                            name:  '💬  Tournament Chat',
                            value: `> Use ${chatChannel} to communicate with other teams before and during the event.`,
                            inline: false,
                        },
                    )
                    .setFooter({ text: 'Redsec Tournament · All times in PDT' }),
            ],
        });

        // Build tournament object
        const tournamentId = newTeamId();
        const tournament = {
            id:              tournamentId,
            name,
            guildId:         guild.id,
            verifiedRoleId:  verifiedRole.id,
            categoryId:      category.id,
            resultsChannelId: resultsChannel.id,
            entryFee,
            grossPayouts:      grossPayouts    ?? null,
            netPayouts:        netPayouts      ?? null,
            scheduledStartAt:  scheduledStartAt ?? null,
            startedAt:         null,
            warnings:          { oneHour: false, fiveMin: false },
            channels: {
                registration:             regChannel.id,
                scoreSubmissions:         scoreChannel.id,
                liveLeaderboard:          lbChannel.id,
                rosters:                  rosterChannel.id,
                tourneyChat:              chatChannel.id,
                registrationMessageId:    regMsg.id,
                scoreSubmissionMessageId: scoreMsg.id,
                leaderboardMessageId:     null,
            },
            teams: {},
        };

        // #live-leaderboard — initial embed
        const lbMsg = await lbChannel.send({ embeds: [buildLeaderboardEmbed(tournament)] });
        tournament.channels.leaderboardMessageId = lbMsg.id;

        save(tournament);

        await interaction.editReply(
            `✅  **${name}** is ready!\n` +
            `${regChannel} · ${scoreChannel} · ${lbChannel} · ${chatChannel} · ${rosterChannel} · ${infoChannel}`
        );
    },
};
