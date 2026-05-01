const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const DATA_DIR = require('../utils/dataDir');

const CONFIG_FILE = path.join(DATA_DIR, 'live-tracker-config.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-live-tracker')
        .setDescription('Create the 📊 LIVE TRACKING category and channel (idempotent)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const guild      = interaction.guild;
        const botId      = client.user.id;
        const everyoneId = guild.id;
        const log        = [];

        await guild.channels.fetch();
        await guild.roles.fetch();

        const verifiedRole = guild.roles.cache.find(r => r.name === 'Verified');
        const verifiedId   = verifiedRole?.id;
        if (!verifiedId) log.push('⚠️  @Verified role not found — run /setup first.');

        async function findOrCreateCategory(name, permissionOverwrites) {
            const existing = guild.channels.cache.find(
                c => c.name === name && c.type === ChannelType.GuildCategory
            );
            if (existing) { log.push(`⏭️  Category **${name}**`); return existing; }
            const cat = await guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites });
            log.push(`✅  Category **${name}**`);
            return cat;
        }

        async function findOrCreateChannel(name, type, parentId, permissionOverwrites) {
            const existing = guild.channels.cache.find(
                c => c.name === name && c.parentId === parentId && c.type === type
            );
            if (existing) { log.push(`⏭️  Channel **${name}**`); return existing; }
            const ch = await guild.channels.create({ name, type, parent: parentId, permissionOverwrites });
            log.push(`✅  Channel **${name}**`);
            return ch;
        }

        const catPerms = [
            { id: everyoneId, deny:  [PermissionFlagsBits.ViewChannel] },
            ...(verifiedId ? [{ id: verifiedId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }] : []),
            { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ];
        const trackerCat = await findOrCreateCategory('📊 LIVE TRACKING', catPerms);

        const readOnlyForVerified = [
            { id: everyoneId, deny:  [PermissionFlagsBits.ViewChannel] },
            ...(verifiedId ? [{ id: verifiedId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] }] : []),
            { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ];

        const trackerCh = await findOrCreateChannel('📊-live-tracker', ChannelType.GuildText, trackerCat.id, readOnlyForVerified);
        const howToCh   = await findOrCreateChannel('📋-how-to-use',  ChannelType.GuildText, trackerCat.id, readOnlyForVerified);

        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ channelId: trackerCh.id }, null, 2), 'utf8');

        // Post or refresh the explainer embed in #📋-how-to-use
        const howToEmbed = buildHowToEmbed(trackerCh.id);
        const recent     = await howToCh.messages.fetch({ limit: 10 });
        const botMsg     = recent.find(m => m.author.id === botId && m.embeds.length > 0);
        if (botMsg) await botMsg.edit({ embeds: [howToEmbed] });
        else        await howToCh.send({ embeds: [howToEmbed] });

        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('📊  Live Tracker Setup')
            .setDescription(log.join('\n'))
            .setFooter({ text: 'Redsec — Live Tracker' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};

function buildHowToEmbed(trackerChannelId) {
    return new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle('📊  Live Game Tracker — How It Works')
        .setDescription(
            `The bot polls your BF6 stats every 5 minutes and posts each detected ` +
            `Redsec Squad game in <#${trackerChannelId}> — kills, deaths, K/D, ` +
            `placement, score, the works.`
        )
        .addFields(
            {
                name:  '▶️  How to Start',
                value: 'Run `/start-tracking` (you must be verified). You\'ll get the 🟢 Live Tracking role while active.',
            },
            {
                name:  '⏹️  How to Stop',
                value: 'Run `/stop-tracking` — the role is removed and polling ends.',
            },
            {
                name:  '⏸️  Auto-Pause',
                value: 'Tracking auto-stops after **45 minutes** with no detected Redsec Squad games. You\'ll get a DM. Run `/start-tracking` again to resume.',
            },
            {
                name:  '📊  What Gets Tracked',
                value: 'Per game: Result · Placement · Length · Kills · Deaths · K/D · KPM · Headshots % · Assists · Score · Revives · Spots',
            },
            {
                name:  '⚠️  Limitations',
                value:
                    '• Only **Redsec Squad** is detected (not Duo/Solo).\n' +
                    '• Placement is best-effort. If you queue a different mode immediately after a Redsec game, the placement number may be wrong.\n' +
                    '• Kills, deaths, and other counters are always accurate (computed from stat deltas).',
            },
        )
        .setFooter({ text: 'Redsec — Live Tracker' });
}
