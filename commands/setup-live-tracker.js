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

        const trackerCh = await findOrCreateChannel('📊-live-tracker', ChannelType.GuildText, trackerCat.id, [
            { id: everyoneId, deny:  [PermissionFlagsBits.ViewChannel] },
            ...(verifiedId ? [{ id: verifiedId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] }] : []),
            { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ]);

        fs.writeFileSync(CONFIG_FILE, JSON.stringify({ channelId: trackerCh.id }, null, 2), 'utf8');

        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('📊  Live Tracker Setup')
            .setDescription(log.join('\n'))
            .setFooter({ text: 'Redsec — Live Tracker' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
