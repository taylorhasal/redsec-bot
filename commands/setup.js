const {
    SlashCommandBuilder, PermissionFlagsBits, ChannelType,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');

const ROLES = [
    { name: 'Verified',  color: null     },
    { name: 'Recruit',   color: 0xd3d3d3 },
    { name: 'Scout',     color: 0x4682b4 },
    { name: 'Sentinel',  color: 0x2e8b57 },
    { name: 'Vanguard',  color: 0xff8c00 },
    { name: 'Operator',  color: 0xff4500 },
    { name: 'Phantom',   color: 0x8b0000 },
];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Bootstrap the entire Redsec server infrastructure (idempotent)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const guild      = interaction.guild;
        const botId      = client.user.id;
        const everyoneId = guild.id;
        const log        = [];

        await guild.channels.fetch();
        await guild.roles.fetch();

        // ── 1. Roles ─────────────────────────────────────────────────────────
        const createdRoles = {};
        for (const { name, color } of ROLES) {
            const existing = guild.roles.cache.find(r => r.name === name);
            if (existing) {
                log.push(`⏭️  Role **@${name}**`);
                createdRoles[name] = existing;
            } else {
                const opts = { name };
                if (color !== null) opts.color = color;
                createdRoles[name] = await guild.roles.create(opts);
                log.push(`✅  Role **@${name}**`);
            }
        }

        const verifiedId = createdRoles['Verified'].id;

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

        // ── 2. START HERE — visible to @everyone ─────────────────────────────
        const startHereCat = await findOrCreateCategory('🏁 START HERE', []);

        const readOnlyPerms = [
            { id: everyoneId, deny:  [PermissionFlagsBits.SendMessages] },
            { id: botId,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ];
        await findOrCreateChannel('📜-rules-and-info',      ChannelType.GuildText, startHereCat.id, readOnlyPerms);
        await findOrCreateChannel('🛡️-verification-guide', ChannelType.GuildText, startHereCat.id, readOnlyPerms);
        const verifyHereCh = await findOrCreateChannel('🤖-verify-here', ChannelType.GuildText, startHereCat.id, readOnlyPerms);

        // ── 3. THE OPERATORS — @Verified only ────────────────────────────────
        const operatorsBasePerms = [
            { id: everyoneId, deny:  [PermissionFlagsBits.ViewChannel] },
            { id: verifiedId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] },
            { id: botId,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ];
        const operatorsCat = await findOrCreateCategory('🎖️ THE OPERATORS', operatorsBasePerms);

        await findOrCreateChannel('💬-general-chat', ChannelType.GuildText, operatorsCat.id, [
            { id: everyoneId, deny:  [PermissionFlagsBits.ViewChannel] },
            { id: verifiedId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions, PermissionFlagsBits.EmbedLinks] },
            { id: botId,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ]);

        // #📊-player-stats — read-only; syncs with category (no extra sends)
        await findOrCreateChannel('📊-player-stats', ChannelType.GuildText, operatorsCat.id);

        await findOrCreateChannel('📸-combat-clips', ChannelType.GuildText, operatorsCat.id, [
            { id: everyoneId, deny:  [PermissionFlagsBits.ViewChannel] },
            { id: verifiedId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles] },
            { id: botId,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ]);

        await findOrCreateChannel('➕ Create Voice', ChannelType.GuildVoice, operatorsCat.id, [
            { id: everyoneId, deny:  [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
            { id: verifiedId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] },
            { id: botId,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.MoveMembers] },
        ]);

        // ── 4. COMMAND CENTER — admins only ───────────────────────────────────
        const commandCenterPerms = [
            { id: everyoneId, deny:  [PermissionFlagsBits.ViewChannel] },
            { id: botId,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ];
        const commandCenterCat = await findOrCreateCategory('🛠️ COMMAND CENTER', commandCenterPerms);

        // Both channels inherit from category
        await findOrCreateChannel('🕵️-admin-audit', ChannelType.GuildText, commandCenterCat.id);
        await findOrCreateChannel('🚨-log-files',   ChannelType.GuildText, commandCenterCat.id);

        // ── 5. Persistent Verify Now button in #🤖-verify-here ───────────────
        const verifyEmbed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('🛡️  Verify Your Account')
            .setDescription(
                'Click **Verify Now** below to link your EA ID and unlock the rest of the server.\n\n' +
                'You\'ll be asked for your **EA ID** (the one you use for Battlefield 6) and an optional **display name** (your gamertag — Steam, Xbox, or PS5).\n\n' +
                'Once verified, you\'ll get the **@Verified** role, your skill tier, and your Redsec Index — and you\'ll be able to access community channels, tournaments, and 2v2 Kill Race.'
            )
            .setFooter({ text: 'Redsec · Verification' });
        const verifyRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('verify_platform:setup')
                .setLabel('🛡️  Verify Now')
                .setStyle(ButtonStyle.Danger),
        );
        const recent = await verifyHereCh.messages.fetch({ limit: 10 }).catch(() => null);
        const existing = recent?.find(m =>
            m.author.id === botId &&
            m.embeds.length > 0 &&
            m.embeds[0].title?.includes('Verify Your Account')
        );
        if (existing) {
            await existing.edit({ embeds: [verifyEmbed], components: [verifyRow] });
            log.push(`⏭️  Verify Now button (refreshed)`);
        } else {
            await verifyHereCh.send({ embeds: [verifyEmbed], components: [verifyRow] });
            log.push(`✅  Verify Now button posted in **#🤖-verify-here**`);
        }

        // ── 6. Summary embed ──────────────────────────────────────────────────
        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('🛠️  Redsec Server Setup')
            .setDescription(log.join('\n'))
            .setFooter({ text: 'Redsec — Server Infrastructure' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};
