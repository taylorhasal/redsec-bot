const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { fetchPlayerStats, extractRedsecStats, buildErrorMessage } = require('../utils/api');
const { applyPlayerProfile, formatIndex } = require('../utils/profile');
const { postServerLeaderboard } = require('../utils/serverLeaderboard');
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
        .setName('update-all')
        .setDescription('Refresh stats, index, and roles for every verified player')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const players = loadPlayers();
        const entries = Object.entries(players);

        if (entries.length === 0) {
            return interaction.editReply({ embeds: [infoEmbed('No verified players found.')] });
        }

        await interaction.editReply({
            embeds: [infoEmbed(`Updating **${entries.length}** verified player(s)… this may take a moment.`)],
        });

        await interaction.guild.members.fetch();

        const results = { updated: [], notInServer: [], apiError: [], noData: [] };

        for (const [userId, record] of entries) {
            let data;
            try {
                data = await fetchPlayerStats(record.eaId, 'ea');
            } catch (err) {
                results.apiError.push(`${record.eaId} (${buildErrorMessage(err)})`);
                continue;
            }

            const stats = extractRedsecStats(data);
            if (!stats) {
                results.noData.push(record.eaId);
                continue;
            }

            const { kpm, kd, wins } = stats;
            const redsecIndex  = parseFloat(((0.40 - kpm) * 25).toFixed(1));
            const resolvedName = data.userName ?? record.eaId;

            // Update stored record
            players[userId] = {
                ...record,
                eaId:       resolvedName,
                kd:         parseFloat(kd.toFixed(2)),
                wins,
                redsecIndex,
                updatedAt:  new Date().toISOString(),
            };

            // Apply nickname + roles if member is still in the server
            const member = interaction.guild.members.cache.get(userId);
            if (member) {
                await applyPlayerProfile(interaction.guild, member, resolvedName, redsecIndex, record.displayName ?? null);
                results.updated.push(`${resolvedName} → \`${formatIndex(redsecIndex)}\``);
            } else {
                results.notInServer.push(resolvedName);
                results.updated.push(`${resolvedName} → \`${formatIndex(redsecIndex)}\` *(not in server)*`);
            }
        }

        savePlayers(players);

        // Refresh leaderboard
        const statsChannel = interaction.guild.channels.cache.find(c => c.name.includes('player-stats'));
        if (statsChannel) await postServerLeaderboard(statsChannel).catch(() => {});

        // Build summary embed
        const embed = new EmbedBuilder()
            .setColor(0x00CC44)
            .setTitle('✅  Update Complete')
            .setTimestamp();

        if (results.updated.length) {
            const lines = results.updated.join('\n');
            // Discord field value limit is 1024 chars — chunk if needed
            for (let i = 0, chunk = 1; i < lines.length; i += 1000, chunk++) {
                embed.addFields({
                    name: chunk === 1 ? `Updated (${results.updated.length})` : '​',
                    value: lines.slice(i, i + 1000),
                });
            }
        }

        if (results.apiError.length) {
            embed.addFields({
                name: `API Errors (${results.apiError.length})`,
                value: results.apiError.join('\n').slice(0, 1000),
            });
        }

        if (results.noData.length) {
            embed.addFields({
                name: `No Redsec Data (${results.noData.length})`,
                value: results.noData.join(', ').slice(0, 1000),
            });
        }

        await interaction.editReply({ embeds: [embed] });
    },
};

function infoEmbed(description) {
    return new EmbedBuilder()
        .setColor(0xCC0000)
        .setDescription(description);
}
