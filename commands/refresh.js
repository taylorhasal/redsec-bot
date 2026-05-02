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
        .setDescription('Re-sync your Redsec stats and update your server nickname'),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const players = loadPlayers();
        const stored  = players[interaction.user.id];
        if (!stored) {
            return interaction.editReply({ content: "You haven't verified yet. Run `/verify` first." });
        }

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
        const redsecIndex = parseFloat(((0.40 - kpm) * 25).toFixed(1));
        const resolvedName = data.userName ?? stored.eaId;

        players[interaction.user.id] = {
            ...stored,
            eaId:        resolvedName,
            kd:          parseFloat(kd.toFixed(2)),
            wins,
            redsecIndex,
            verifiedAt:  stored.verifiedAt,
        };
        savePlayers(players);

        await applyPlayerProfile(interaction.guild, interaction.member, resolvedName, redsecIndex);

        const discordName = interaction.member.user.globalName ?? interaction.member.user.username;

        await interaction.editReply({
            embeds: [new EmbedBuilder()
                .setColor(0x00CC44)
                .setTitle('🔄  Profile Refreshed')
                .addFields(
                    { name: '🪪 EA ID',          value: `\`${resolvedName}\``,          inline: false },
                    { name: '🏷️ Nickname',        value: `\`[${formatIndex(redsecIndex)}] ${discordName}\``, inline: false },
                    { name: '⚔️ K/D Ratio',       value: `\`${fmt(kd)}\``,               inline: true },
                    { name: '🏆 Total Wins',      value: `\`${fmtInt(wins)}\``,           inline: true },
                    { name: '📊 Redsec Index',    value: `\`${formatIndex(redsecIndex)}\``, inline: true },
                )
                .setFooter({ text: 'Redsec · Profile updated' })
                .setTimestamp()],
        });
    },
};
