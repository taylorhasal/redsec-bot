const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { loadRatings, loadPlayers, playerName } = require('../utils/xpMatch');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('xp')
        .setDescription('View your XP Ranked stats'),

    async execute(interaction) {
        const ratings = loadRatings();
        const players = loadPlayers();
        const userId  = interaction.user.id;
        const r       = ratings[userId];

        if (!r) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x1a0000)
                        .setTitle('❌ Not Ranked')
                        .setDescription('You don\'t have an XP rating yet. Verify your account and complete a match to appear on the leaderboard.')
                        .setTimestamp(),
                ],
                ephemeral: true,
            });
        }

        // Calculate rank
        const sorted = Object.entries(ratings).sort(([, a], [, b]) => b.xp - a.xp);
        const rank   = sorted.findIndex(([uid]) => uid === userId) + 1;
        const total  = sorted.length;
        const name   = playerName(userId, players);

        const embed = new EmbedBuilder()
            .setColor(0xCC0000)
            .setTitle(`📊  XP Ranked — ${name}`)
            .addFields(
                { name: 'Rank',   value: `#${rank} of ${total}`, inline: true },
                { name: 'XP',     value: r.xp.toLocaleString(),  inline: true },
                { name: 'Record', value: `${r.wins}W  ${r.losses}L`, inline: true },
            )
            .setFooter({ text: 'Redsec · XP Ranked' })
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    },
};
