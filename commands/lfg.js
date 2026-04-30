const { SlashCommandBuilder, ChannelType } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const DATA_DIR = require('../utils/dataDir');

const CONFIG_FILE = path.join(DATA_DIR, 'lfg-config.json');

function loadConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
    catch { return null; }
}

const LFG_NAME_RE = /^LFG SQUAD \d+$/i;
const ANY_SQUAD_RE = /^(?:LFG )?SQUAD (\d+)$/i;

function getUsedSquadNumbers(guild, categoryId) {
    const used = new Set();
    for (const ch of guild.channels.cache.values()) {
        if (ch.parentId !== categoryId || ch.type !== ChannelType.GuildVoice) continue;
        const m = ch.name.match(ANY_SQUAD_RE);
        if (m) used.add(parseInt(m[1], 10));
    }
    return used;
}

function lowestUnusedNumber(used) {
    let n = 1;
    while (used.has(n)) n++;
    return n;
}

function findAvailableLfgChannel(guild, categoryId) {
    for (const ch of guild.channels.cache.values()) {
        if (ch.parentId !== categoryId || ch.type !== ChannelType.GuildVoice) continue;
        if (!LFG_NAME_RE.test(ch.name)) continue;
        if (ch.members.size < 4) return ch;
    }
    return null;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lfg')
        .setDescription('Find a squad — joins or creates an LFG voice channel'),

    async execute(interaction) {
        const config = loadConfig();
        if (!config?.categoryId) {
            return interaction.reply({
                content: 'LFG channels have not been set up yet. Ask an admin to run `/setup-lfg`.',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });
        await interaction.guild.channels.fetch();

        const member = interaction.member;

        // Already in an LFG/SQUAD channel?
        const currentVc = member.voice?.channel;
        if (currentVc && currentVc.parentId === config.categoryId && ANY_SQUAD_RE.test(currentVc.name)) {
            return interaction.editReply({ content: `You're already in ${currentVc}. Rally your squad!` });
        }

        // Find existing open LFG SQUAD channel or create one
        let targetChannel = findAvailableLfgChannel(interaction.guild, config.categoryId);

        if (!targetChannel) {
            const used  = getUsedSquadNumbers(interaction.guild, config.categoryId);
            const n     = lowestUnusedNumber(used);
            const catCh = interaction.guild.channels.cache.get(config.categoryId);

            targetChannel = await interaction.guild.channels.create({
                name:   `LFG SQUAD ${n}`,
                type:   ChannelType.GuildVoice,
                parent: config.categoryId,
                permissionOverwrites: catCh
                    ? catCh.permissionOverwrites.cache.map(po => ({ id: po.id, allow: po.allow, deny: po.deny }))
                    : [],
            });
        }

        // Move if already in voice, otherwise send a link
        if (member.voice?.channelId) {
            await member.voice.setChannel(targetChannel).catch(() => {});
            return interaction.editReply({ content: `Moved you to ${targetChannel}!` });
        } else {
            return interaction.editReply({ content: `Join your squad here: ${targetChannel}` });
        }
    },
};
