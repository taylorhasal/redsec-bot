const fs   = require('fs');
const path = require('path');
const DATA_DIR = require('./dataDir');

const LISTINGS_FILE = path.join(DATA_DIR, 'lfg-listings.json');

function loadListings() {
    try { return JSON.parse(fs.readFileSync(LISTINGS_FILE, 'utf8')); }
    catch { return {}; }
}
function saveListings(d) { fs.writeFileSync(LISTINGS_FILE, JSON.stringify(d, null, 2), 'utf8'); }

async function checkLfgExpiry(client) {
    const listings = loadListings();
    const now      = Date.now();
    let   changed  = false;

    for (const [userId, listing] of Object.entries(listings)) {
        if (now < listing.expiresAt) continue;

        // Delete the Discord message
        try {
            const ch  = await client.channels.fetch(listing.feedChannelId);
            const msg = await ch.messages.fetch(listing.messageId);
            await msg.delete();
        } catch { /* already deleted or channel gone */ }

        delete listings[userId];
        changed = true;
    }

    if (changed) saveListings(listings);
}

module.exports = { loadListings, saveListings, checkLfgExpiry };
