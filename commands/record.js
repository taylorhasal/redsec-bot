const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { loadRecords, loadPlayers, playerName, sortRecords, winRateLabel } = require('../utils/killRace');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('record')
        .setDescription('View your 2v2 Kill Race record'),

    async execute(interaction) {
        const records = loadRecords();
        const players = loadPlayers();
        const userId  = interaction.user.id;
        const r       = records[userId];

        if (!r) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x1a0000)
                        .setTitle('No record yet')
                        .setDescription('You haven\'t played a 2v2 Kill Race match yet. Queue up to get on the leaderboard.')
                        .setTimestamp(),
                ],
                ephemeral: true,
            });
        }

        const sorted = sortRecords(records);
        const rank   = sorted.findIndex(([uid]) => uid === userId) + 1;
        const total  = sorted.length;
        const name   = playerName(userId, players);

        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle(`⚔️  2v2 Kill Race — ${name}`)
            .addFields(
                { name: 'Rank',     value: `#${rank} of ${total}`,    inline: true },
                { name: 'Wins',     value: String(r.wins),             inline: true },
                { name: 'Losses',   value: String(r.losses),           inline: true },
                { name: 'Win Rate', value: winRateLabel(r),            inline: true },
            )
            .setFooter({ text: 'Redsec · 2v2 Kill Race' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
