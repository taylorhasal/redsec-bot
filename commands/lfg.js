const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const DATA_DIR = require('../utils/dataDir');
const { getSkillRoleName, formatIndex } = require('../utils/profile');
const { loadListings, saveListings } = require('../utils/lfgExpiry');

const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');
const CONFIG_FILE  = path.join(DATA_DIR, 'lfg-config.json');

function loadPlayers() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch { return {}; }
}
function loadConfig() {
    try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
    catch { return null; }
}

const TWO_HOURS = 2 * 60 * 60 * 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('lfg')
        .setDescription('Post a Looking for Group listing in #lfg-feed')
        .addStringOption(o =>
            o.setName('mode')
                .setDescription('Are you looking for a duo or a full squad?')
                .setRequired(true)
                .addChoices(
                    { name: 'Duo',   value: 'Duo' },
                    { name: 'Squad', value: 'Squad' },
                )),

    async execute(interaction, client) {
        const mode   = interaction.options.getString('mode');
        const userId = interaction.user.id;

        // Must be verified
        const players = loadPlayers();
        const record  = players[userId];
        if (!record) {
            return interaction.reply({
                content: 'You must be verified to use LFG. Run `/verify` first.',
                ephemeral: true,
            });
        }

        // Check for existing active listing
        const listings = loadListings();
        if (listings[userId]) {
            return interaction.reply({
                content: 'You already have an active listing in <#' + listings[userId].feedChannelId + '>. Use the **Withdraw** button on your post to remove it first.',
                ephemeral: true,
            });
        }

        // Load channel config
        const config = loadConfig();
        if (!config?.feedChannelId) {
            return interaction.reply({
                content: 'LFG channels have not been set up yet. Ask an admin to run `/setup-lfg`.',
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const feedCh = await client.channels.fetch(config.feedChannelId).catch(() => null);
        if (!feedCh) {
            return interaction.editReply({ content: 'LFG feed channel not found. Ask an admin to run `/setup-lfg` again.' });
        }

        const tier      = getSkillRoleName(record.redsecIndex);
        const idxStr    = formatIndex(record.redsecIndex);
        const expiresAt = Date.now() + TWO_HOURS;
        const expiresTs = Math.floor(expiresAt / 1000);

        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle(`🔍  ${record.eaId} is Looking for Group`)
            .addFields(
                { name: '🎖️ Tier',      value: tier,                       inline: true },
                { name: '📊 Index',     value: `\`${idxStr}\``,            inline: true },
                { name: '🖥️ Platform',  value: record.platform.toUpperCase(), inline: true },
                { name: '🎮 Mode',      value: mode,                       inline: true },
                { name: '⏱️ Expires',   value: `<t:${expiresTs}:R>`,       inline: true },
            )
            .setFooter({ text: 'Click Request to Join to send them a ping in #lfg-chat' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`lfg_join:${userId}`)
                .setLabel('🙋 Request to Join')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`lfg_withdraw:${userId}`)
                .setLabel('❌ Withdraw')
                .setStyle(ButtonStyle.Secondary),
        );

        const msg = await feedCh.send({ embeds: [embed], components: [row] });

        listings[userId] = {
            messageId:     msg.id,
            feedChannelId: config.feedChannelId,
            chatChannelId: config.chatChannelId,
            expiresAt,
            mode,
        };
        saveListings(listings);

        await interaction.editReply({
            content: `✅  Your LFG post is live in <#${config.feedChannelId}>. It expires <t:${expiresTs}:R>.`,
        });
    },
};
