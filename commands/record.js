const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { loadRecords, loadPlayers, playerName, sortRecords, winRateLabel } = require('../utils/killRace');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('record')
        .setDescription('View a 2v2 Kill Race record')
        .addStringOption(option =>
            option.setName('player')
                .setDescription('Whose record to view (default: yours)')
                .setRequired(false)
                .setAutocomplete(true)),

    async autocomplete(interaction) {
        const typed   = interaction.options.getFocused().toLowerCase();
        const players = loadPlayers();

        const choices = Object.entries(players)
            .filter(([, r]) =>
                r.eaId?.toLowerCase().includes(typed) ||
                r.displayName?.toLowerCase().includes(typed)
            )
            .slice(0, 25)
            .map(([discordId, r]) => ({
                name:  r.displayName ?? r.eaId,
                value: discordId,
            }));

        await interaction.respond(choices);
    },

    async execute(interaction) {
        const records = loadRecords();
        const players = loadPlayers();
        const userId  = interaction.options.getString('player') ?? interaction.user.id;
        const isSelf  = userId === interaction.user.id;
        const r       = records[userId];
        const name    = playerName(userId, players);

        if (!r) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x1a0000)
                        .setTitle('No record yet')
                        .setDescription(isSelf
                            ? 'You haven\'t played a 2v2 Kill Race match yet. Queue up to get on the leaderboard.'
                            : `**${name}** hasn't played a 2v2 Kill Race match yet.`)
                        .setTimestamp(),
                ],
                ephemeral: true,
            });
        }

        const sorted = sortRecords(records);
        const rank   = sorted.findIndex(([uid]) => uid === userId) + 1;
        const total  = sorted.length;

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
