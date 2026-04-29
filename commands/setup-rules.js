const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

const FORMAT_CONTENT = [
    '▸ Teams of up 2 or 4, depending on if tourney is duo or quads',
    '▸ Lobby up with your team and load into public lobbies',
    '▸ Farm public lobbies for 2 hours, beginning at the designated start time',
    '▸ Your top 2 games will be added to your teams score on the leaderboard',
    '▸ **Submission grace:** 35 minutes after the window closes',
].join('\n');

const POINTS_CONTENT = [
    '`1 Kill = 1 Kill Point`',
    '',
    '**Placement Points**',
    '```',
    ' 1st  ─────────── +15 pts',
    ' 2nd  ─────────── +12 pts',
    ' 3rd  ─────────── +10 pts',
    ' 4th  ────────────  +8 pts',
    ' 5th  ────────────  +6 pts',
    ' 6th–10th ─────────  +4 pts',
    ' 11th+ ─────────────  +0 pts',
    '```',
].join('\n');

const INDEX_CONTENT = [
    '**Team Index (per game):** Sum of all player handicaps',
    '',
    '**Gross Score** = Kills + Placement Points',
    '**Net Score** = Gross + (Team Index × 2)',
    '',
    'The index is a handicap — some players receive a bonus, other players receive a penalty. We analyze your lifetime Redsec stats to find your Personal Par. This allows us to run a Net Score leaderboard where a casual squad can realistically beat a pro squad — by simply playing better than their own average. Run `/profile` to see your index.',
].join('\n');

const CASEFILES_CONTENT = [
    '**What if two teams finish tied on score?**',
    '',
    '**①** Highest single-game kill count wins.',
    '**②** Still tied? Team with the single player with highest kill game wins',
    '**③** If ALL conditions match → prizes are **SPLIT**',
    'Both teams displayed as: `⚖️ TIE`',
].join('\n');

function buildRulesEmbed() {
    return new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle('📋  REDSEC BOT RACE RULES')
        .setDescription(
            '**RULES APPLY TO ALL SERVER TOURNAMENTS**\n' +
            '*unless otherwise noted*'
        )
        .addFields(
            { name: '▸ [I]  THE FORMAT',                value: FORMAT_CONTENT,    inline: false },
            { name: '▸ [II]  THE POINT SYSTEM',         value: POINTS_CONTENT,    inline: false },
            { name: '▸ [III]  THE INDEX',               value: INDEX_CONTENT,     inline: false },
            { name: '▸ [IV]  THE "WHAT-IF" CASE FILES', value: CASEFILES_CONTENT, inline: false },
        )
        .setFooter({ text: 'Redsec — Mission Briefing · Use /verify to link your EA account' })
        .setTimestamp();
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-rules')
        .setDescription('Create (or refresh) the #📋-rules channel with current race rules')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const guild      = interaction.guild;
        const botId      = client.user.id;
        const everyoneId = guild.id;

        await guild.channels.fetch();

        const CATEGORY_ID = '1498221740080234497';

        const readOnlyPerms = [
            { id: everyoneId, deny:  [PermissionFlagsBits.SendMessages] },
            { id: botId,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ];

        // Find or create the channel
        let channel = guild.channels.cache.find(
            c => c.name === '📋-rules' && c.type === ChannelType.GuildText
        );

        if (!channel) {
            channel = await guild.channels.create({
                name:                '📋-rules',
                type:                ChannelType.GuildText,
                parent:              CATEGORY_ID,
                permissionOverwrites: readOnlyPerms,
            });
        }

        // Post or refresh the rules embed
        const existing = await channel.messages.fetch({ limit: 10 });
        const botMsg   = existing.find(m => m.author.id === botId && m.embeds.length > 0);

        if (botMsg) {
            await botMsg.edit({ embeds: [buildRulesEmbed()] });
            await interaction.editReply(`✅  Rules updated in ${channel}.`);
        } else {
            await channel.send({ embeds: [buildRulesEmbed()] });
            await interaction.editReply(`✅  Rules posted in ${channel}.`);
        }
    },
};
