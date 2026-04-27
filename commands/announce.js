const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const origins = require('../utils/announceState');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Pull all voice members into the Announcements channel so you can address everyone')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        if (origins.size > 0) {
            return interaction.editReply({
                content: '⛔ An announcement is already in progress. Use `/announce-end` to return everyone first.',
            });
        }

        const guild = interaction.guild;
        await guild.channels.fetch();

        // Find or create the Announcements voice channel
        let announceChannel = guild.channels.cache.find(
            c => c.name === '📢 Announcements' && c.type === ChannelType.GuildVoice
        );

        if (!announceChannel) {
            const verifiedRole = guild.roles.cache.find(r => r.name === 'Verified');
            const operatorsCat = guild.channels.cache.find(
                c => c.name.includes('OPERATORS') && c.type === ChannelType.GuildCategory
            );

            const permissionOverwrites = [
                { id: guild.id,       deny:  [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
                { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.MoveMembers] },
            ];
            if (verifiedRole) {
                permissionOverwrites.push({
                    id:    verifiedRole.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect],
                    deny:  [PermissionFlagsBits.Speak],
                });
            }

            announceChannel = await guild.channels.create({
                name:                '📢 Announcements',
                type:                ChannelType.GuildVoice,
                parent:              operatorsCat?.id ?? null,
                permissionOverwrites,
            });
        }

        // Collect all voice members not already in the Announcements channel
        await guild.members.fetch();
        const toMove = guild.voiceStates.cache.filter(
            vs => vs.channelId && vs.channelId !== announceChannel.id
        );

        let moved = 0;
        for (const [userId, vs] of toMove) {
            origins.set(userId, vs.channelId);
            await vs.member.voice.setChannel(announceChannel).catch(() => {});
            moved++;
        }

        // Move the admin too (if they're in voice)
        if (interaction.member.voice.channelId && interaction.member.voice.channelId !== announceChannel.id) {
            origins.set(interaction.user.id, interaction.member.voice.channelId);
            await interaction.member.voice.setChannel(announceChannel).catch(() => {});
            moved++;
        }

        await interaction.editReply({
            content: `✅ Moved **${moved}** member${moved !== 1 ? 's' : ''} to ${announceChannel}. Use \`/announce-end\` to return everyone when done.`,
        });
    },
};
