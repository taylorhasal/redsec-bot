const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { loadAll, save } = require('./tournament');
const { createAllTeamVoiceChannels } = require('./voiceChannels');

function parseScheduledStart(dateStr, timeStr) {
    try {
        const match = timeStr.trim().match(/^(\d+):(\d+)\s*(AM|PM)$/i);
        if (!match) return null;
        let [, h, m, ap] = match;
        h = parseInt(h); m = parseInt(m);
        if (ap.toUpperCase() === 'PM' && h !== 12) h += 12;
        if (ap.toUpperCase() === 'AM' && h === 12) h = 0;
        const isoStr = `${dateStr} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00 GMT-0700`;
        const dt = new Date(isoStr);
        return isNaN(dt.getTime()) ? null : dt.toISOString();
    } catch {
        return null;
    }
}

function getIncompleteTeams(tournament) {
    return Object.entries(tournament.teams ?? {})
        .filter(([, team]) => (team.players?.length ?? 0) < 4)
        .map(([teamId, team]) => ({ teamId, team }));
}

async function sendOneHourWarning(client, tournament) {
    const incomplete = getIncompleteTeams(tournament);
    if (incomplete.length === 0) return;

    const chatChannel = await client.channels.fetch(tournament.channels?.tourneyChat).catch(() => null);
    if (!chatChannel) return;

    const lines = incomplete.map(({ team }) => {
        const mentions = team.players.map(id => `<@${id}>`).join(' · ');
        const open = 4 - team.players.length;
        return `**${team.name}** — ${mentions} · *(${open} spot${open !== 1 ? 's' : ''} open)*`;
    });

    await chatChannel.send(
        `⚠️ **Roster Warning — 1 Hour to Start**\n\n` +
        `The following teams have incomplete rosters. Captains — you have until **5 minutes before start** to fill your roster via the **Add Player** button on your roster card.\n\n` +
        lines.join('\n')
    );
}

async function sendFiveMinWarning(client, tournament) {
    const incomplete = getIncompleteTeams(tournament);
    if (incomplete.length === 0) return;

    const guild = client.guilds.cache.get(tournament.guildId);
    if (!guild) return;

    const auditChannel = guild.channels.cache.find(c => c.name.includes('admin-audit'));
    if (!auditChannel) return;

    const lines = incomplete.map(({ team }) => `**${team.name}** — ${team.players.length}/4 players`);

    const rows = incomplete.slice(0, 5).map(({ teamId, team }) =>
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`remove_team:${tournament.id}:${teamId}`)
                .setLabel(`Remove: ${team.name}`)
                .setStyle(ButtonStyle.Danger)
        )
    );

    await auditChannel.send({
        content:
            `🚨 **5-Minute Warning — Incomplete Rosters**\n` +
            `**${tournament.name}** starts in ~5 minutes.\n\n` +
            `The following teams have incomplete rosters:\n` +
            lines.join('\n') +
            `\n\nUse the buttons below to remove a team from the tournament.`,
        components: rows,
    });
}

async function checkTournamentWarnings(client) {
    const now = Date.now();
    const all = loadAll();

    for (const tournament of Object.values(all)) {
        if (!tournament.scheduledStartAt) continue;
        const startMs = new Date(tournament.scheduledStartAt).getTime();
        let changed = false;

        if (!tournament.warnings?.oneHour && now >= startMs - 60 * 60 * 1000) {
            if (!tournament.warnings) tournament.warnings = {};
            await sendOneHourWarning(client, tournament).catch(console.error);
            await createAllTeamVoiceChannels(client, tournament).catch(console.error);
            tournament.warnings.oneHour = true;
            changed = true;
        }

        if (!tournament.warnings?.fiveMin && now >= startMs - 5 * 60 * 1000) {
            if (!tournament.warnings) tournament.warnings = {};
            await sendFiveMinWarning(client, tournament).catch(console.error);
            tournament.warnings.fiveMin = true;
            changed = true;
        }

        if (changed) save(tournament);
    }
}

module.exports = { parseScheduledStart, checkTournamentWarnings, sendFiveMinWarning };
