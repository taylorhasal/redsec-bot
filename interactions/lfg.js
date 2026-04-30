const fs   = require('fs');
const path = require('path');
const DATA_DIR = require('../utils/dataDir');
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

async function handleLfgWithdraw(interaction) {
    const posterId = interaction.customId.split(':')[1];

    if (interaction.user.id !== posterId) {
        return interaction.reply({
            content: 'Only the person who posted this listing can withdraw it.',
            ephemeral: true,
        });
    }

    const listings = loadListings();
    const listing  = listings[posterId];

    // Delete the embed message
    try {
        const ch  = await interaction.client.channels.fetch(listing?.feedChannelId ?? interaction.channelId);
        const msg = await ch.messages.fetch(listing?.messageId ?? interaction.message.id);
        await msg.delete();
    } catch { /* already deleted */ }

    delete listings[posterId];
    saveListings(listings);

    await interaction.reply({ content: '✅  Your LFG listing has been removed.', ephemeral: true });
}

async function handleLfgJoin(interaction) {
    const posterId  = interaction.customId.split(':')[1];
    const clickerId = interaction.user.id;

    if (clickerId === posterId) {
        return interaction.reply({ content: "You can't join your own listing.", ephemeral: true });
    }

    const players = loadPlayers();
    if (!players[clickerId]) {
        return interaction.reply({
            content: 'You must be verified to request to join. Run `/verify` first.',
            ephemeral: true,
        });
    }

    const listings = loadListings();
    const listing  = listings[posterId];
    if (!listing) {
        return interaction.reply({ content: 'This listing is no longer active.', ephemeral: true });
    }

    const config = loadConfig();
    const chatId = listing.chatChannelId ?? config?.chatChannelId;
    if (!chatId) {
        return interaction.reply({ content: 'LFG chat channel not configured. Ask an admin to run `/setup-lfg`.', ephemeral: true });
    }

    const chatCh = await interaction.client.channels.fetch(chatId).catch(() => null);
    if (!chatCh) {
        return interaction.reply({ content: 'LFG chat channel not found.', ephemeral: true });
    }

    await chatCh.send(`🙋 <@${clickerId}> wants to join <@${posterId}>'s **${listing.mode}** squad!`);

    await interaction.reply({
        content: `✅  Request sent! Check <#${chatId}>.`,
        ephemeral: true,
    });
}

module.exports = { handleLfgWithdraw, handleLfgJoin };
