const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { applyPlayerProfile, formatIndex } = require('../utils/profile');
const fs   = require('fs');
const path = require('path');

const DATA_DIR     = require('../utils/dataDir');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');

function loadPlayers() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch { return {}; }
}
function savePlayers(d) { fs.writeFileSync(PLAYERS_FILE, JSON.stringify(d, null, 2), 'utf8'); }

module.exports = {
    data: new SlashCommandBuilder()
        .setName('change-name')
        .setDescription('Update your in-game display name shown on the leaderboard and roster')
        .addStringOption(o =>
            o.setName('gamertag')
                .setDescription('Your in-game name — Steam, Xbox, or PS5 username')
                .setRequired(true)),

    async execute(interaction) {
        const players = loadPlayers();
        const stored  = players[interaction.user.id];
        if (!stored) {
            return interaction.reply({
                content: "You haven't verified yet. Run `/verify` first.",
                ephemeral: true,
            });
        }

        const gamertag = interaction.options.getString('gamertag').trim();
        players[interaction.user.id] = { ...stored, displayName: gamertag };
        savePlayers(players);

        await applyPlayerProfile(interaction.guild, interaction.member, stored.eaId, stored.redsecIndex, gamertag);

        await interaction.reply({
            embeds: [new EmbedBuilder()
                .setColor(0x00CC44)
                .setTitle('🏷️  Display Name Updated')
                .setDescription('Your leaderboard name and server nickname have been updated.\n*Run `/update` if your stats have also changed.*')
                .addFields(
                    { name: '🎮 New Display Name', value: `\`${gamertag}\``,                                              inline: false },
                    { name: '🏷️ Nickname',          value: `\`[${formatIndex(stored.redsecIndex)}] ${gamertag}\``, inline: false },
                )
                .setFooter({ text: 'Redsec · Display name updated' })
                .setTimestamp()],
            ephemeral: true,
        });
    },
};
