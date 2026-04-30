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
        .setName('update')
        .setDescription('Refresh your Redsec stats, index, and roles using your verified account'),

    async execute(interaction) {
        const record = loadPlayers()[interaction.user.id];
        if (!record) {
            return interaction.reply({
                embeds: [errorEmbed('You have not verified yet. Run `/verify` first.')],
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        let data;
        try {
            data = await fetchPlayerStats(record.eaId, 'ea');
        } catch (err) {
            return interaction.editReply({ embeds: [errorEmbed(buildErrorMessage(err))] });
        }

        const s = extractRedsecStats(data);
        if (!s) {
            return interaction.editReply({
                embeds: [errorEmbed('No Redsec combat history found for your account.')],
            });
        }

        const { kpm, kd, wins } = s;
        const redsecIndex  = parseFloat(((0.40 - kpm) * 25).toFixed(1));
        const resolvedName = data.userName ?? record.eaId;

        const players = loadPlayers();
        players[interaction.user.id] = {
            ...players[interaction.user.id],
            eaId:       resolvedName,
            kd:         parseFloat(kd.toFixed(2)),
            wins,
            redsecIndex,
            updatedAt:  new Date().toISOString(),
        };
        savePlayers(players);

        await applyPlayerProfile(interaction.guild, interaction.member, resolvedName, redsecIndex);

        const embed = new EmbedBuilder()
            .setColor(0x00CC44)
            .setTitle('Profile Updated')
            .addFields(
                { name: 'EA ID',        value: `\`${resolvedName}\``,              inline: false },
                { name: 'K/D Ratio',   value: `\`${fmt(kd)}\``,                   inline: true },
                { name: 'Total Wins',  value: `\`${fmtInt(wins)}\``,              inline: true },
                { name: 'Redsec Index', value: `\`${formatIndex(redsecIndex)}\``, inline: true },
            )
            .setFooter({ text: 'Redsec · Updated' })
            .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
    },
};

const B = '​';

function errorEmbed(description) {
    return new EmbedBuilder()
        .setColor(0x1a0000)
        .setTitle('Error')
        .setDescription(description)
        .setTimestamp();
}
