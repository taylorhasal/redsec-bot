const {
    ModalBuilder, TextInputBuilder, TextInputStyle,
    StringSelectMenuBuilder, UserSelectMenuBuilder, ActionRowBuilder, EmbedBuilder,
    ButtonBuilder, ButtonStyle,
} = require('discord.js');
const fs   = require('fs');
const path = require('path');
const { loadByChannel, save, newTeamId } = require('../utils/tournament');
const { updateLeaderboard }              = require('../utils/leaderboard');
const { createTeamVoiceChannel, isPastVoiceThreshold } = require('../utils/voiceChannels');

const DATA_DIR     = require('../utils/dataDir');
const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');

// captainId → teamName (cleared after registration completes)
const pendingRegistrations = new Map();

function loadPlayers() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch { return {}; }
}

// Returns the teamId the given userId belongs to in this tournament, or null
function getRegisteredTeam(tournament, userId) {
    return Object.entries(tournament.teams ?? {})
        .find(([, t]) => Array.isArray(t.players) && t.players.includes(userId))?.[0] ?? null;
}

// Returns a flat Set of all player IDs currently on any team in the tournament
function getAllRegisteredIds(tournament) {
    const ids = new Set();
    for (const team of Object.values(tournament.teams ?? {})) {
        for (const id of team.players ?? []) ids.add(id);
    }
    return ids;
}

// Build StringSelectMenu options from verified players only, excluding given IDs
// and anyone already on any team in the tournament
async function buildVerifiedOptions(guild, tournament, excludeIds = []) {
    const players     = loadPlayers();
    const registeredIds = getAllRegisteredIds(tournament);
    await guild.members.fetch();

    const options = [];
    for (const [userId, data] of Object.entries(players)) {
        if (excludeIds.includes(userId)) continue;
        if (registeredIds.has(userId)) continue;
        const member = guild.members.cache.get(userId);
        if (!member || !member.roles.cache.has(tournament.verifiedRoleId)) continue;
        const idxStr = data.redsecIndex >= 0
            ? `+${data.redsecIndex.toFixed(1)}`
            : `${data.redsecIndex.toFixed(1)}`;
        options.push({
            label:       data.eaId.slice(0, 100),
            description: `${member.displayName} · Index: ${idxStr}`,
            value:       userId,
        });
    }
    options.sort((a, b) => a.label.localeCompare(b.label));
    return options.slice(0, 25); // Discord max
}

// Build roster embed for a single team
function buildRosterEmbed(team, players) {
    const slots = [];
    for (let i = 0; i < 4; i++) {
        const userId = team.players[i];
        if (userId && players[userId]) {
            const p      = players[userId];
            const idxStr = p.redsecIndex >= 0
                ? `+${p.redsecIndex.toFixed(1)}`
                : `${p.redsecIndex.toFixed(1)}`;
            const star   = userId === team.captainId ? ' ⭐' : '';
            slots.push(`**Slot ${i + 1}:** <@${userId}> · \`${p.eaId}\` · \`${idxStr}\`${star}`);
        } else {
            slots.push(`**Slot ${i + 1}:** *Open*`);
        }
    }
    const teamIdxStr = team.teamIndex >= 0
        ? `+${team.teamIndex.toFixed(1)}`
        : `${team.teamIndex.toFixed(1)}`;

    return new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle(`👥  ${team.name}`)
        .addFields(
            { name: 'Roster',        value: slots.join('\n'),       inline: false },
            { name: '📊 Team Index', value: `\`${teamIdxStr}\``,   inline: true  },
            { name: '👑 Captain',    value: `<@${team.captainId}>`, inline: true  },
        )
        .setFooter({ text: 'Redsec Tournament · Rosters' })
        .setTimestamp();
}

// Post or edit the roster message in #rosters
async function postOrUpdateRoster(client, tournament, teamId) {
    const team = tournament.teams[teamId];
    if (!tournament.channels.rosters) return;
    const rosterCh = await client.channels.fetch(tournament.channels.rosters).catch(() => null);
    if (!rosterCh) return;

    const players     = loadPlayers();
    const embed       = buildRosterEmbed(team, players);
    const isFull      = team.players.length >= 4;
    const hasNonCaptain = team.players.some(id => id !== team.captainId);

    const buttons = [];
    if (!isFull) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`roster_add:${teamId}`)
                .setLabel('Add Player')
                .setStyle(ButtonStyle.Secondary)
        );
    }
    if (hasNonCaptain) {
        buttons.push(
            new ButtonBuilder()
                .setCustomId(`roster_remove:${teamId}`)
                .setLabel('Remove Player')
                .setStyle(ButtonStyle.Danger)
        );
    }
    buttons.push(
        new ButtonBuilder()
            .setCustomId(`roster_unregister:${teamId}`)
            .setLabel('Disband Team')
            .setStyle(ButtonStyle.Danger)
    );
    const components = [new ActionRowBuilder().addComponents(...buttons)];

    if (team.rosterMessageId) {
        const msg = await rosterCh.messages.fetch(team.rosterMessageId).catch(() => null);
        if (msg) {
            await msg.edit({ embeds: [embed], components }).catch(err => console.error('[ROSTER] Failed to edit roster message:', err));
            return;
        }
    }

    const msg = await rosterCh.send({ embeds: [embed], components });
    team.rosterMessageId = msg.id;
    save(tournament);
}

// Shared: create team with captain + any additional validated player IDs
async function finalizeTeam(interaction, client, additionalIds) {
    const captainId = interaction.user.id;
    const teamName  = pendingRegistrations.get(captainId);
    if (!teamName) {
        return interaction.editReply({ content: 'Registration timed out. Click **Register Team** again.', components: [] });
    }

    const tournament = loadByChannel(interaction.channelId);
    if (!tournament) {
        return interaction.editReply({ content: 'No active tournament found.', components: [] });
    }

    const players = loadPlayers();
    const guild   = interaction.guild;
    const valid   = [captainId];
    const invalid = [];

    for (const userId of additionalIds) {
        if (userId === captainId) continue;
        if (valid.length >= 4) break;
        const member   = await guild.members.fetch(userId).catch(() => null);
        const hasRole  = member?.roles.cache.has(tournament.verifiedRoleId);
        const hasData  = !!players[userId];
        const onTeamId = getRegisteredTeam(tournament, userId);
        if (!hasRole || !hasData) {
            invalid.push(`<@${userId}> — ${!hasRole ? 'missing @Verified role' : 'has not run /verify'}`);
        } else if (onTeamId) {
            invalid.push(`<@${userId}> — already registered on **${tournament.teams[onTeamId].name}**`);
        } else {
            valid.push(userId);
        }
    }

    let teamIndex = 0;
    for (const userId of valid) teamIndex += players[userId]?.redsecIndex ?? 0;
    teamIndex = parseFloat(teamIndex.toFixed(1));

    const teamId = newTeamId();
    tournament.teams[teamId] = {
        name:            teamName,
        captainId,
        players:         valid,
        teamIndex,
        rosterMessageId: null,
        scores:          { game1: null, game2: null },
    };
    save(tournament);
    pendingRegistrations.delete(captainId);

    await updateLeaderboard(client, tournament);
    await postOrUpdateRoster(client, tournament, teamId);

    if (isPastVoiceThreshold(tournament)) {
        await createTeamVoiceChannel(client, tournament, teamId, tournament.teams[teamId]).catch(console.error);
    }

    const teamIdxStr = teamIndex >= 0 ? `+${teamIndex.toFixed(1)}` : `${teamIndex.toFixed(1)}`;
    const embed = new EmbedBuilder()
        .setColor(0xCC0000)
        .setTitle('✅  Team Registered')
        .addFields(
            { name: '🏷️ Team Name',  value: `\`${teamName}\``,                      inline: true },
            { name: '👑 Captain',     value: `<@${captainId}>`,                      inline: true },
            { name: '​',         value: '​',                              inline: true },
            { name: '👥 Players',     value: valid.map(id => `<@${id}>`).join('\n'), inline: true },
            { name: '📊 Team Index',  value: `\`${teamIdxStr}\``,                    inline: true },
        )
        .setFooter({ text: 'Redsec Tournament · Registration confirmed' })
        .setTimestamp();

    if (invalid.length > 0) {
        embed.addFields({ name: '⚠️ Could not add', value: invalid.join('\n'), inline: false });
    }

    await interaction.editReply({ content: '', embeds: [embed], components: [] });
}

// ── Step 1: Button — register_open ──────────────────────────────────────────
async function handleRegisterButton(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('register_team_modal')
        .setTitle('Register Your Team');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('team_name')
                .setLabel('Team Name')
                .setStyle(TextInputStyle.Short)
                .setMinLength(2)
                .setMaxLength(32)
                .setRequired(true)
        )
    );

    await interaction.showModal(modal);
}

// ── Step 2: Modal — register_team_modal ─────────────────────────────────────
async function handleTeamNameModal(interaction, client) {
    const teamName = interaction.fields.getTextInputValue('team_name').trim();
    pendingRegistrations.set(interaction.user.id, teamName);

    await interaction.deferReply({ ephemeral: true });

    const tournament = loadByChannel(interaction.channelId);
    if (!tournament) {
        return interaction.editReply({ content: 'No active tournament found.' });
    }

    // Block if caller is already on a team
    const existingTeamId = getRegisteredTeam(tournament, interaction.user.id);
    if (existingTeamId) {
        const existingTeam = tournament.teams[existingTeamId];
        pendingRegistrations.delete(interaction.user.id);
        return interaction.editReply({
            content: `You are already registered on **${existingTeam.name}**. Use **Disband Team** on your roster card first.`,
        });
    }

    const select = new UserSelectMenuBuilder()
        .setCustomId('team_player_select')
        .setPlaceholder('Search and select up to 3 teammates')
        .setMinValues(1)
        .setMaxValues(3);

    const soloBtn = new ButtonBuilder()
        .setCustomId('register_solo')
        .setLabel('Register without teammates')
        .setStyle(ButtonStyle.Secondary);

    await interaction.editReply({
        content: `**${teamName}** — You are automatically added as captain.\nSelect teammates below, or skip and register solo.`,
        components: [
            new ActionRowBuilder().addComponents(select),
            new ActionRowBuilder().addComponents(soloBtn),
        ],
    });
}

// ── Step 3a: StringSelectMenu — team_player_select ──────────────────────────
async function handleTeamPlayerSelect(interaction, client) {
    await interaction.deferUpdate();
    await finalizeTeam(interaction, client, interaction.values);
}

// ── Step 3b: Button — register_solo ─────────────────────────────────────────
async function handleRegisterSolo(interaction, client) {
    await interaction.deferUpdate();
    await finalizeTeam(interaction, client, []);
}

// ── Add player later: Button — roster_add:{teamId} ──────────────────────────
async function handleRosterAddButton(interaction) {
    const teamId     = interaction.customId.split(':')[1];
    const tournament = loadByChannel(interaction.channelId);
    if (!tournament) return interaction.reply({ content: 'No active tournament found.', ephemeral: true });

    const team = tournament.teams[teamId];
    if (!team) return interaction.reply({ content: 'Team not found.', ephemeral: true });

    if (interaction.user.id !== team.captainId) {
        return interaction.reply({ content: 'Only the team captain can add players.', ephemeral: true });
    }
    if (team.players.length >= 4) {
        return interaction.reply({ content: 'Your team is already full (4/4).', ephemeral: true });
    }

    const remainingSlots = 4 - team.players.length;
    const select = new UserSelectMenuBuilder()
        .setCustomId(`roster_add_select:${teamId}`)
        .setPlaceholder('Search and select a player to add')
        .setMinValues(1)
        .setMaxValues(remainingSlots);

    await interaction.reply({
        content: `**${team.name}** — ${team.players.length}/4 players. Select who to add:`,
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true,
    });
}

// ── Add player later: StringSelectMenu — roster_add_select:{teamId} ─────────
async function handleRosterAddSelect(interaction, client) {
    const teamId = interaction.customId.split(':')[1];
    await interaction.deferUpdate();

    const tournament = loadByChannel(interaction.channelId);
    if (!tournament) {
        return interaction.editReply({ content: 'Tournament not found.', components: [] });
    }

    const team = tournament.teams[teamId];
    if (!team) {
        return interaction.editReply({ content: 'Team not found.', components: [] });
    }

    const players = loadPlayers();
    const guild   = interaction.guild;
    const added   = [];
    const onOtherTeam = [];

    for (const userId of interaction.values) {
        if (team.players.includes(userId)) continue;
        if (team.players.length >= 4) break;
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member?.roles.cache.has(tournament.verifiedRoleId)) continue;
        if (!players[userId]) continue;
        const existingTeamId = getRegisteredTeam(tournament, userId);
        if (existingTeamId && existingTeamId !== teamId) {
            onOtherTeam.push(`<@${userId}> (on **${tournament.teams[existingTeamId].name}**)`);
            continue;
        }
        team.players.push(userId);
        team.teamIndex += players[userId].redsecIndex ?? 0;
        added.push(userId);
    }

    team.teamIndex = parseFloat(team.teamIndex.toFixed(1));
    save(tournament);

    await updateLeaderboard(client, tournament);
    await postOrUpdateRoster(client, tournament, teamId);

    const lines = [];
    if (added.length > 0)       lines.push(`✅ Added ${added.map(id => `<@${id}>`).join(', ')} to **${team.name}**.`);
    if (onOtherTeam.length > 0) lines.push(`⛔ Already on another team: ${onOtherTeam.join(', ')}`);
    if (lines.length === 0)     lines.push('⚠️ No new players could be added.');

    await interaction.editReply({ content: lines.join('\n'), components: [] });
}

// ── Remove player: Button — roster_remove:{teamId} ──────────────────────────
async function handleRosterRemoveButton(interaction) {
    const teamId     = interaction.customId.split(':')[1];
    const tournament = loadByChannel(interaction.channelId);
    if (!tournament) return interaction.reply({ content: 'No active tournament found.', ephemeral: true });

    const team = tournament.teams[teamId];
    if (!team) return interaction.reply({ content: 'Team not found.', ephemeral: true });

    if (interaction.user.id !== team.captainId) {
        return interaction.reply({ content: 'Only the team captain can remove players.', ephemeral: true });
    }

    const removable = team.players.filter(id => id !== team.captainId);
    if (removable.length === 0) {
        return interaction.reply({ content: 'No players to remove.', ephemeral: true });
    }

    const players = loadPlayers();
    const options  = removable.map(userId => {
        const p      = players[userId];
        const idxStr = p?.redsecIndex >= 0
            ? `+${p.redsecIndex.toFixed(1)}`
            : `${p?.redsecIndex.toFixed(1)}`;
        return {
            label:       (p?.eaId ?? userId).slice(0, 100),
            description: `Index: ${idxStr}`,
            value:       userId,
        };
    });

    const select = new StringSelectMenuBuilder()
        .setCustomId(`roster_remove_select:${teamId}`)
        .setPlaceholder('Select a player to remove')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options);

    await interaction.reply({
        content: `**${team.name}** — Select a player to remove:`,
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true,
    });
}

// ── Remove player: StringSelectMenu — roster_remove_select:{teamId} ──────────
async function handleRosterRemoveSelect(interaction, client) {
    const teamId = interaction.customId.split(':')[1];
    await interaction.deferUpdate();

    const tournament = loadByChannel(interaction.channelId);
    if (!tournament) {
        return interaction.editReply({ content: 'Tournament not found.', components: [] });
    }

    const team    = tournament.teams[teamId];
    const players = loadPlayers();
    const userId  = interaction.values[0];

    if (!team || userId === team.captainId) {
        return interaction.editReply({ content: 'Unable to remove that player.', components: [] });
    }

    team.players = team.players.filter(id => id !== userId);

    let teamIndex = 0;
    for (const id of team.players) teamIndex += players[id]?.redsecIndex ?? 0;
    team.teamIndex = parseFloat(teamIndex.toFixed(1));

    save(tournament);

    await updateLeaderboard(client, tournament);
    await postOrUpdateRoster(client, tournament, teamId);

    await interaction.editReply({
        content: `✅ Removed <@${userId}> from **${team.name}**.`,
        components: [],
    });
}

// ── Disband team: Button — roster_unregister:{teamId} ───────────────────────
async function handleRosterUnregisterButton(interaction) {
    const teamId     = interaction.customId.split(':')[1];
    const tournament = loadByChannel(interaction.channelId);
    if (!tournament) return interaction.reply({ content: 'No active tournament found.', ephemeral: true });

    const team = tournament.teams[teamId];
    if (!team) return interaction.reply({ content: 'Team not found.', ephemeral: true });

    if (interaction.user.id !== team.captainId) {
        return interaction.reply({ content: 'Only the team captain can disband the team.', ephemeral: true });
    }

    await interaction.reply({
        content: `⚠️ Are you sure you want to disband **${team.name}**? This cannot be undone.`,
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`roster_disband_confirm:${teamId}`)
                    .setLabel('Yes, Disband')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`roster_disband_cancel:${teamId}`)
                    .setLabel('Cancel')
                    .setStyle(ButtonStyle.Secondary)
            ),
        ],
        ephemeral: true,
    });
}

// ── Disband confirm: Button — roster_disband_confirm:{teamId} ────────────────
async function handleRosterDisbandConfirm(interaction) {
    const teamId     = interaction.customId.split(':')[1];
    const tournament = loadByChannel(interaction.channelId);
    if (!tournament) return interaction.update({ content: 'No active tournament found.', components: [] });

    const team = tournament.teams[teamId];
    if (!team) return interaction.update({ content: 'Team not found.', components: [] });

    if (interaction.user.id !== team.captainId) {
        return interaction.update({ content: 'Only the team captain can disband the team.', components: [] });
    }

    const teamName = team.name;

    if (tournament.channels?.rosters && team.rosterMessageId) {
        const rosterCh = await interaction.client.channels.fetch(tournament.channels.rosters).catch(() => null);
        if (rosterCh) {
            const msg = await rosterCh.messages.fetch(team.rosterMessageId).catch(() => null);
            if (msg) await msg.delete().catch(() => {});
        }
    }

    delete tournament.teams[teamId];
    save(tournament);

    await updateLeaderboard(interaction.client, tournament);

    await interaction.update({
        content: `✅  **${teamName}** has been disbanded. You are free to register a new team.`,
        components: [],
    });
}

// ── Disband cancel: Button — roster_disband_cancel:{teamId} ─────────────────
async function handleRosterDisbandCancel(interaction) {
    await interaction.update({ content: '❌ Disband cancelled.', components: [] });
}

module.exports = {
    handleRegisterButton,
    handleTeamNameModal,
    handleTeamPlayerSelect,
    handleRegisterSolo,
    handleRosterAddButton,
    handleRosterAddSelect,
    handleRosterRemoveButton,
    handleRosterRemoveSelect,
    handleRosterUnregisterButton,
    handleRosterDisbandConfirm,
    handleRosterDisbandCancel,
};
