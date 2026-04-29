const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-community')
        .setDescription('Create the 🌍 COMMUNITY category and channels (idempotent)')
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
        if (!verifiedRole) {
            log.push('⚠️  @Verified role not found — channel visibility will be broken. Run `/setup` first.');
        }
        const verifiedId = verifiedRole?.id;

        // ── helpers ──────────────────────────────────────────────────────────
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
            const opts = { name, type, parent: parentId };
            if (permissionOverwrites !== undefined) opts.permissionOverwrites = permissionOverwrites;
            const ch = await guild.channels.create(opts);
            log.push(`✅  Channel **${name}**`);
            return ch;
        }

        // ── COMMUNITY category — @Verified only ──────────────────────────────
        const communityPerms = [
            { id: everyoneId, deny:  [PermissionFlagsBits.ViewChannel] },
            ...(verifiedId ? [{
                id:    verifiedId,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.AddReactions,
                    PermissionFlagsBits.EmbedLinks,
                    PermissionFlagsBits.AttachFiles,
                ],
            }] : []),
            { id: botId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ];

        const communityCat = await findOrCreateCategory('🌍 COMMUNITY', communityPerms);

        // All channels inherit permissions from the category
        await findOrCreateChannel('📸-setups-and-gear', ChannelType.GuildText, communityCat.id);
        await findOrCreateChannel('🐕-pet-pics',        ChannelType.GuildText, communityCat.id);
        await findOrCreateChannel('🍕-food-pics',       ChannelType.GuildText, communityCat.id);
        await findOrCreateChannel('📢-self-promo',      ChannelType.GuildText, communityCat.id);
        await findOrCreateChannel('💡-suggestions',     ChannelType.GuildText, communityCat.id);

        // ── Summary ───────────────────────────────────────────────────────────
        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('🌍  Community Setup')
            .setDescription(log.join('\n'))
            .setFooter({ text: 'Redsec — Community Infrastructure' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
