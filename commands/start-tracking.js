const { SlashCommandBuilder } = require('discord.js');
const fs   = require('fs');
const path = require('path');
const DATA_DIR = require('../utils/dataDir');
const { fetchPlayerStats, buildErrorMessage } = require('../utils/api');
const {
    loadTrackers, saveTrackers, loadConfig,
    extractRedsecSquadSnapshot, addTrackingRole, MAX_TRACKERS,
} = require('../utils/liveTracker');

const PLAYERS_FILE = path.join(DATA_DIR, 'players.json');

function loadPlayers() {
    try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
    catch { return {}; }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('start-tracking')
        .setDescription('Auto-detect your Redsec Squad games (polls every 5 min)'),

    async execute(interaction) {
        const userId = interaction.user.id;

        const players = loadPlayers();
        if (!players[userId]) {
            return interaction.reply({
                content: 'You must be verified to enable live tracking. Run `/verify` first.',
                ephemeral: true,
            });
        }

        const config = loadConfig();
        if (!config?.channelId) {
            return interaction.reply({
                content: 'Live tracker is not set up yet. Ask an admin to run `/setup-live-tracker`.',
                ephemeral: true,
            });
        }

        const trackers = loadTrackers();

        if (trackers[userId]) {
            const lastDetected = trackers[userId].lastDetectedAt;
            const lastStr = lastDetected
                ? `last game detected <t:${Math.floor(new Date(lastDetected).getTime() / 1000)}:R>`
                : 'no games detected yet';
            return interaction.reply({
                content: `You're already being tracked — ${lastStr}. Use \`/stop-tracking\` to stop.`,
                ephemeral: true,
            });
        }

        if (Object.keys(trackers).length >= MAX_TRACKERS) {
            return interaction.reply({
                content: `Live tracker is at capacity (${MAX_TRACKERS} active). Try again later.`,
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const eaId = players[userId].eaId;
        let data;
        try {
            data = await fetchPlayerStats(eaId, 'ea');
        } catch (err) {
            return interaction.editReply({ content: `Couldn't take initial snapshot: ${buildErrorMessage(err)}` });
        }

        const snapshot = extractRedsecSquadSnapshot(data);
        if (!snapshot) {
            return interaction.editReply({
                content: 'No Redsec Squad data found on your account. Play at least one Redsec Squad match first.',
            });
        }

        trackers[userId] = {
            eaId,
            guildId:        interaction.guild.id,
            snapshot,
            startedAt:      new Date().toISOString(),
            lastDetectedAt: null,
            idleStrikes:    0,
            errorStrikes:   0,
        };
        saveTrackers(trackers);

        await addTrackingRole(interaction.guild, interaction.member);

        await interaction.editReply({
            content: `✅  Tracking started for **${eaId}**. Your Redsec Squad games will appear in <#${config.channelId}> within 5 min of finishing.\n*Auto-stops after 45 min of inactivity. Use \`/stop-tracking\` to stop manually.*`,
        });
    },
};
