const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const DATA_DIR = require('../utils/dataDir');

const VOICE_CONFIG_FILE = path.join(DATA_DIR, 'voice-config.json');
function saveVoiceConfig(d) { fs.writeFileSync(VOICE_CONFIG_FILE, JSON.stringify(d, null, 2), 'utf8'); }

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup-voice')
        .setDescription('Create the Voice Chats category with auto-create voice channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;

        const category = await guild.channels.create({
            name: 'Voice Chats',
            type: ChannelType.GuildCategory,
        });

        const trigger = await guild.channels.create({
            name: 'Create New Voice Channel',
            type: ChannelType.GuildVoice,
            parent: category.id,
        });

        saveVoiceConfig({ triggerChannelId: trigger.id, categoryId: category.id });

        await interaction.editReply(
            `✅ **Voice Chats** category created.\n` +
            `Join **Create New Voice Channel** to auto-spawn a private squad channel.`
        );
    },
};
