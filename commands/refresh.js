const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { fetchPlayerStats, extractRedsecStats, buildErrorMessage, fmt, fmtInt } = require('../utils/api');
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
        .setName('refresh')
        .setDescription('Update your in-game display name and re-sync your Redsec stats')
        .addStringOption(o =>
            o.setName('gamertag')
                .setDescription('Your in-game name — Steam, Xbox, or PS5 username')
                .setRequired(true)),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const players = loadPlayers();
        const stored  = players[interaction.user.id];
        if (!stored) {
            return interaction.editReply({ content: "You haven't verified yet. Run `/verify` first." });
        }

        const gamertag = interaction.options.getString('gamertag').trim();

        let data;
        try {
            data = await fetchPlayerStats(stored.eaId, 'ea');
        } catch (err) {
            return interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setColor(0x1a0000)
                    .setTitle('❌ Error')
                    .setDescription(buildErrorMessage(err))
                    .setTimestamp()],
            });
        }

        const redsec = extractRedsecStats(data);
        if (!redsec) {
            return interaction.editReply({ content: 'No Redsec combat history found for your EA ID.' });
        }

        const { kpm, kd, wins } = redsec;
        const redsecIndex  = parseFloat(((0.40 - kpm) * 25).toFixed(1));
        const resolvedEaId = data.userName ?? stored.eaId;

        players[interaction.user.id] = {
            ...stored,
            eaId:        resolvedEaId,
            displayName: gamertag,
            kd:          parseFloat(kd.toFixed(2)),
            wins,
            redsecIndex,
        };
        savePlayers(players);

        await applyPlayerProfile(interaction.guild, interaction.member, resolvedEaId, redsecIndex, gamertag);

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0x00CC44)
                .setTitle('🔄  Profile Refreshed')
                .addFields(
                    { name: '🎮 In-Game Name',   value: `\`${gamertag}\``,              inline: false },
                    { name: '🪪 EA ID',           value: `\`${resolvedEaId}\``,          inline: false },
                    { name: '🏷️ Nickname',        value: `\`[${formatIndex(redsecIndex)}] ${gamertag}\``, inline: false },
                    { name: '⚔️ K/D Ratio',       value: `\`${fmt(kd)}\``,               inline: true },
                    { name: '🏆 Total Wins',      value: `\`${fmtInt(wins)}\``,           inline: true },
                    { name: '📊 Redsec Index',    value: `\`${formatIndex(redsecIndex)}\``, inline: true },
                )
                .setFooter({ text: 'Redsec · Profile updated' })
                .setTimestamp()],
        });
    },
};
