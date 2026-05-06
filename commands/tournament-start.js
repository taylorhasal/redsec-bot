const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { loadAll, loadById, save } = require('../utils/tournament');
const { startTournamentTracking } = require('../utils/tournamentTracker');

const DEADLINE_MS = (2 * 60 + 35) * 60 * 1000; // 2 h 35 m total window

module.exports = {
    data: new SlashCommandBuilder()
        .setName('tournament-start')
        .setDescription('Start the tournament clock — teams have 2 h 35 m to submit scores')
        .addStringOption(o =>
            o.setName('tournament')
                .setDescription('Tournament to start')
                .setAutocomplete(true)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async autocomplete(interaction) {
        const all     = loadAll();
        const focused = interaction.options.getFocused().toLowerCase();
        const choices = Object.entries(all)
            .filter(([, t]) => t.name.toLowerCase().includes(focused))
            .slice(0, 25)
            .map(([id, t]) => ({ name: t.name, value: id }));
        await interaction.respond(choices);
    },

    async execute(interaction, client) {
        await interaction.deferReply({ ephemeral: true });

        const tournamentId = interaction.options.getString('tournament');
        const tournament   = loadById(tournamentId);

        if (!tournament) {
            return interaction.editReply({ content: 'Tournament not found.' });
        }
        if (tournament.startedAt) {
            const ts = Math.floor(new Date(tournament.startedAt).getTime() / 1000);
            return interaction.editReply({
                content: `**${tournament.name}** is already running (started <t:${ts}:R>).`,
            });
        }

        tournament.startedAt = new Date().toISOString();
        save(tournament);

        // Auto-start live tracking for all registered team members
        startTournamentTracking(client, tournament).catch(err =>
            console.error('[tournament-start] startTournamentTracking failed:', err)
        );

        const startTs    = Math.floor(new Date(tournament.startedAt).getTime() / 1000);
        const deadlineTs = startTs + DEADLINE_MS / 1000;

        // Announce in score-submissions channel
        const scoreChId = tournament.channels?.scoreSubmissions;
        if (scoreChId) {
            const scoreCh = await client.channels.fetch(scoreChId).catch(() => null);
            if (scoreCh) {
                await scoreCh.send({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0xCC0000)
                            .setTitle(`🚨  ${tournament.name} — TOURNAMENT STARTED`)
                            .setDescription('The clock is running. Submit your scores using **Submit Game Score** below.')
                            .addFields({
                                name:   '⏱️  Submission Deadline',
                                value:  `<t:${deadlineTs}:F>  ·  <t:${deadlineTs}:R>\n*All scores must be submitted within **2 hours and 35 minutes** of this message.*`,
                                inline: false,
                            })
                            .setFooter({ text: 'Redsec Tournament · Good luck, operators.' })
                            .setTimestamp(),
                    ],
                });
            }
        }

        await interaction.editReply({
            content: `✅  **${tournament.name}** started! Submission deadline: <t:${deadlineTs}:F>  (<t:${deadlineTs}:R>)`,
        });
    },
};
