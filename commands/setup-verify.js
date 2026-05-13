const {
    SlashCommandBuilder, PermissionFlagsBits, ChannelType,
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-verify')
        .setDescription('Create the 🤖-verify-here channel and post the Verify Now button (idempotent)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const guild      = interaction.guild;
        const botId      = client.user.id;
        const everyoneId = guild.id;
        const log        = [];

        await guild.channels.fetch();

        // ── Find or create 🏁 START HERE category ────────────────────────────
        let startHereCat = guild.channels.cache.find(
            c => c.name === '🏁 START HERE' && c.type === ChannelType.GuildCategory
        );
        if (startHereCat) {
            log.push(`⏭️  Category **🏁 START HERE**`);
        } else {
            startHereCat = await guild.channels.create({
                name: '🏁 START HERE',
                type: ChannelType.GuildCategory,
            });
            log.push(`✅  Category **🏁 START HERE**`);
        }

        // ── Find or create 🤖-verify-here channel ────────────────────────────
        const readOnlyPerms = [
            { id: everyoneId, deny:  [PermissionFlagsBits.SendMessages] },
            { id: botId,      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ];

        let verifyHereCh = guild.channels.cache.find(
            c => c.name === '🤖-verify-here' && c.parentId === startHereCat.id && c.type === ChannelType.GuildText
        );
        if (verifyHereCh) {
            log.push(`⏭️  Channel **#🤖-verify-here**`);
        } else {
            verifyHereCh = await guild.channels.create({
                name:                 '🤖-verify-here',
                type:                 ChannelType.GuildText,
                parent:               startHereCat.id,
                permissionOverwrites: readOnlyPerms,
            });
            log.push(`✅  Channel **#🤖-verify-here**`);
        }

        // ── Post or refresh the Verify Now button ────────────────────────────
        const verifyEmbed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('🛡️  Verify Your Account')
            .setDescription(
                'Click **Verify Now** below to link your gaming account and unlock the rest of the server.\n\n' +
                'Select your platform (**PC**, **PlayStation**, or **Xbox**), then enter your in-game username.\n\n' +
                'Once verified, you\'ll get the **@Verified** role, your platform role, your skill tier, and your Redsec Index.'
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
            log.push(`✅  Verify Now button posted`);
        }

        const summary = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle('🛡️  Verify Channel Setup')
            .setDescription(log.join('\n'))
            .setFooter({ text: 'Redsec · Verification' })
            .setTimestamp();

        await interaction.editReply({ embeds: [summary] });
    },
};
