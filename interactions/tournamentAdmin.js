const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { loadAll, save } = require('../utils/tournament');
const { updateLeaderboard } = require('../utils/leaderboard');

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

module.exports = { handleRemoveTeamButton };
