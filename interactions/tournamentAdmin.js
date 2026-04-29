const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const { loadAll, save } = require('../utils/tournament');
const { updateLeaderboard } = require('../utils/leaderboard');

const DEADLINE_MS = (2 * 60 + 35) * 60 * 1000; // 2 h 35 m

async function handleStartTournamentButton(interaction) {
    const [, tournamentId] = interaction.customId.split(':');
    const client = interaction.client;

    const all = loadAll();
    const tournament = all[tournamentId];
    if (!tournament) {
        return interaction.update({ content: 'Tournament not found.', components: [] });
    }
    if (tournament.startedAt) {
        const ts = Math.floor(new Date(tournament.startedAt).getTime() / 1000);
        return interaction.update({
            content: `**${tournament.name}** was already started <t:${ts}:R>.`,
            components: [],
        });
    }

    tournament.startedAt = new Date().toISOString();
    save(tournament);

    const startTs    = Math.floor(new Date(tournament.startedAt).getTime() / 1000);
    const deadlineTs = startTs + DEADLINE_MS / 1000;

    // Post started embed to score-submissions
    if (tournament.channels?.scoreSubmissions) {
        const scoreCh = await client.channels.fetch(tournament.channels.scoreSubmissions).catch(() => null);
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
            }).catch(() => {});
        }
    }

    // Announce in tourney-chat
    if (tournament.channels?.tourneyChat) {
        const chatCh = await client.channels.fetch(tournament.channels.tourneyChat).catch(() => null);
        if (chatCh) {
            await chatCh.send(
                `🚨 **${tournament.name} has started!**\n` +
                `The clock is running — lobby up with your team and start farming. ` +
                `Submission deadline: <t:${deadlineTs}:F>  (<t:${deadlineTs}:R>)`
            ).catch(() => {});
        }
    }

    await interaction.update({
        content: `✅ **${tournament.name}** started by <@${interaction.user.id}>. Deadline: <t:${deadlineTs}:F>`,
        components: [],
    });
}

async function handleRemoveTeamButton(interaction) {
    const [, tournamentId, teamId] = interaction.customId.split(':');
    const client = interaction.client;

    const all = loadAll();
    const tournament = all[tournamentId];
    if (!tournament) {
        return interaction.update({ content: 'Tournament not found.', components: [] });
    }

    const team = tournament.teams[teamId];
    if (!team) {
        return interaction.update({ content: 'That team has already been removed.', components: [] });
    }

    const teamName       = team.name;
    const playerMentions = team.players.map(id => `<@${id}>`).join(', ');

    // Delete roster card message
    if (tournament.channels?.rosters && team.rosterMessageId) {
        const rosterCh = await client.channels.fetch(tournament.channels.rosters).catch(() => null);
        if (rosterCh) {
            const msg = await rosterCh.messages.fetch(team.rosterMessageId).catch(() => null);
            if (msg) await msg.delete().catch(() => {});
        }
    }

    // Delete team voice channel
    if (team.voiceChannelId) {
        const vc = await client.channels.fetch(team.voiceChannelId).catch(() => null);
        if (vc) await vc.delete().catch(() => {});
    }

    delete tournament.teams[teamId];
    save(tournament);
    await updateLeaderboard(client, tournament);

    // Announce removal in tourney-chat
    if (tournament.channels?.tourneyChat) {
        const chatChannel = await client.channels.fetch(tournament.channels.tourneyChat).catch(() => null);
        if (chatChannel) {
            await chatChannel.send(
                `❌ **${teamName}** (${playerMentions}) has been removed from **${tournament.name}** due to an incomplete roster.`
            ).catch(() => {});
        }
    }

    // Rebuild admin message with remaining incomplete teams
    const remaining = Object.entries(tournament.teams)
        .filter(([, t]) => (t.players?.length ?? 0) < 4);

    if (remaining.length === 0) {
        return interaction.update({
            content: `✅ **${teamName}** removed. No more incomplete rosters for **${tournament.name}**.`,
            components: [],
        });
    }

    const lines = remaining.map(([, t]) => `**${t.name}** — ${t.players.length}/4 players`);
    const rows  = remaining.slice(0, 5).map(([tid, t]) =>
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`remove_team:${tournamentId}:${tid}`)
                .setLabel(`Remove: ${t.name}`)
                .setStyle(ButtonStyle.Danger)
        )
    );

    await interaction.update({
        content:
            `🚨 **Incomplete Rosters — ${tournament.name}**\n\n` +
            `✅ **${teamName}** removed.\n\n` +
            `Remaining:\n` + lines.join('\n') +
            `\n\nUse the buttons below to remove additional teams.`,
        components: rows,
    });
}

module.exports = { handleRemoveTeamButton, handleStartTournamentButton };
