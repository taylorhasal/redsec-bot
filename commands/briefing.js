const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

const FORMAT_CONTENT = [
    '▸ Teams of up 2 or 4, depending on if tourney is duo or quads',
    '▸ Lobby up with your team and load into public lobbies',
    '▸ Farm public lobbies for 2 hours, beginning at the designated the start time',
    '▸ Submit your **Top 2** scoring games for review',
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
    'The index is a handicap — some players receive a bonus, other players receive a penalty. We analyze your lifetime Redsec stats to find your Personal Par. This allows us to run a Net Score leaderboard where a casual squad can realistically beat a pro squad — by simply playing better than their own average.  Run /profile to see your index.',
].join('\n');

const CASEFILES_CONTENT = [
    '**What if two teams finish tied on score?**',
    '',
    '**①** Highest single-game kill count wins.',
    '**②** Still tied? Team with the single player with highest kill game wins',
    '**③** If ALL conditions match → prizes are **SPLIT**',
    '> Both teams displayed as: `⚖️ TIE`',
].join('\n');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('send-briefing')
        .setDescription('Post the official Redsec Open Mission Briefing')
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('Channel to post in (defaults to current channel)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const target = interaction.options.getChannel('channel') ?? interaction.channel;

        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('📋  REDSEC BOT RACE RULES')
            .setDescription(
                '**RULES APPLY TO ALL SERVER TOURNAMENTS**\n' +
                '*unless otherwise noted*'
            )
            .addFields(
                { name: '▸ [I]  THE FORMAT',                value: FORMAT_CONTENT,   inline: false },
                { name: '▸ [II]  THE POINT SYSTEM',         value: POINTS_CONTENT,  inline: false },
                { name: '▸ [III]  THE INDEX',               value: INDEX_CONTENT,    inline: false },
                { name: '▸ [IV]  THE "WHAT-IF" CASE FILES', value: CASEFILES_CONTENT, inline: false },
            )
            .setFooter({ text: 'Redsec — Mission Briefing · Use /verify to link your EA account' })
            .setTimestamp();

        await target.send({ embeds: [embed] });
        await interaction.reply({ content: `✅  Briefing posted in ${target}.`, ephemeral: true });
    },
};
