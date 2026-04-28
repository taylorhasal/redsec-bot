require('dotenv').config();
const { Client, GatewayIntentBits, Collection, ChannelType } = require('discord.js');
const fs   = require('fs');
const path = require('path');

const {
    handleRegisterButton, handleTeamNameModal,
    handleTeamPlayerSelect, handleRegisterSolo,
    handleRosterAddButton, handleRosterAddSelect,
    handleRosterRemoveButton, handleRosterRemoveSelect,
    handleRosterUnregisterButton,
    handleRosterDisbandConfirm,
    handleRosterDisbandCancel,
} = require('./interactions/registration');
const { handleSubmitScoreButton, handleScoreModal, handleEvidenceMessage, handleManageScoresButton, handleScoreEditButton, handleScoreDeleteButton } = require('./interactions/scoreSubmission');
const { handleAuditApprove, handleAuditReject, handleAuditAdjust, handleAuditAdjustModal } = require('./interactions/audit');
const { handleRemoveTeamButton } = require('./interactions/tournamentAdmin');
const { handleVerifyPlatformButton, handleVerifyModal } = require('./interactions/verify');
const { checkTournamentWarnings } = require('./utils/warnings');

// NOTE: GuildMembers and MessageContent are Privileged Intents.
// Enable both in the Discord Developer Portal → Bot → Privileged Gateway Intents.
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
    const command = require(path.join(commandsPath, file));
    if (command.data && command.execute) {
        client.commands.set(command.data.name, command);
    } else {
        console.warn(`[WARN] ${file} is missing a data or execute export — skipped.`);
    }
}

client.once('ready', () => {
    console.log(`[Redsec] Online as ${client.user.tag}`);
    console.log(`[Redsec] ${client.commands.size} command(s) loaded: ${[...client.commands.keys()].join(', ')}`);
    setInterval(() => checkTournamentWarnings(client).catch(console.error), 60 * 1000);
});

client.on('interactionCreate', async interaction => {
    try {
        // ── Autocomplete ──────────────────────────────────────────────────────
        if (interaction.isAutocomplete()) {
            const command = client.commands.get(interaction.commandName);
            if (command?.autocomplete) await command.autocomplete(interaction);
            return;
        }

        // ── Slash commands ────────────────────────────────────────────────────
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (command) await command.execute(interaction, client);
            return;
        }

        // ── Buttons ───────────────────────────────────────────────────────────
        if (interaction.isButton()) {
            if (interaction.customId === 'register_open')  return handleRegisterButton(interaction);
            if (interaction.customId === 'register_solo')  return handleRegisterSolo(interaction, client);
            if (interaction.customId === 'submit_score')         return handleSubmitScoreButton(interaction);
            if (interaction.customId === 'manage_scores')        return handleManageScoresButton(interaction);
            if (interaction.customId.startsWith('remove_team:'))  return handleRemoveTeamButton(interaction);
            if (interaction.customId.startsWith('score_edit:'))   return handleScoreEditButton(interaction);
            if (interaction.customId.startsWith('score_delete:')) return handleScoreDeleteButton(interaction);
            if (interaction.customId.startsWith('roster_add:'))         return handleRosterAddButton(interaction);
            if (interaction.customId.startsWith('roster_remove:'))      return handleRosterRemoveButton(interaction);
            if (interaction.customId.startsWith('roster_unregister:'))      return handleRosterUnregisterButton(interaction);
            if (interaction.customId.startsWith('roster_disband_confirm:')) return handleRosterDisbandConfirm(interaction);
            if (interaction.customId.startsWith('roster_disband_cancel:'))  return handleRosterDisbandCancel(interaction);

            if (interaction.customId.startsWith('audit_approve:')) return handleAuditApprove(interaction);
            if (interaction.customId.startsWith('audit_reject:'))  return handleAuditReject(interaction);
            if (interaction.customId.startsWith('audit_adjust:') && !interaction.customId.includes('modal')) {
                return handleAuditAdjust(interaction);
            }
            if (interaction.customId.startsWith('verify_platform:')) return handleVerifyPlatformButton(interaction);
            return;
        }

        // ── Modals ────────────────────────────────────────────────────────────
        if (interaction.isModalSubmit()) {
            if (interaction.customId === 'register_team_modal')         return handleTeamNameModal(interaction, client);
            if (interaction.customId === 'score_modal')                 return handleScoreModal(interaction, client);
            if (interaction.customId.startsWith('audit_adjust_modal:')) return handleAuditAdjustModal(interaction);
            if (interaction.customId.startsWith('verify_modal:'))       return handleVerifyModal(interaction);
            return;
        }

        // ── Select menus ──────────────────────────────────────────────────────
        if (interaction.isStringSelectMenu()) {
            if (interaction.customId === 'team_player_select')              return handleTeamPlayerSelect(interaction, client);
            if (interaction.customId.startsWith('roster_add_select:'))    return handleRosterAddSelect(interaction, client);
            if (interaction.customId.startsWith('roster_remove_select:')) return handleRosterRemoveSelect(interaction, client);
            return;
        }
    } catch (err) {
        console.error('[ERROR] Interaction handler:', err);
        const payload = { content: 'Something went wrong. Please try again.', ephemeral: true };
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(payload).catch(() => {});
        } else {
            await interaction.reply(payload).catch(() => {});
        }
    }
});

// ── Evidence screenshot detection ─────────────────────────────────────────────
client.on('messageCreate', message => handleEvidenceMessage(message, client));

// ── Dynamic voice channels ─────────────────────────────────────────────────────
const tempVoiceChannels = new Set();

const SKILL_TIERS = ['Phantom', 'Operator', 'Vanguard', 'Sentinel', 'Scout', 'Recruit'];
function getMemberTier(member) {
    return SKILL_TIERS.find(t => member.roles.cache.some(r => r.name === t)) ?? null;
}

client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
        // User joined ➕ Create Voice — spin up a temp channel
        if (newState.channelId && newState.channel?.name === '➕ Create Voice') {
            const member  = newState.member;
            const tier    = getMemberTier(member);
            const label   = tier ? `[${tier}] ${member.displayName}'s Squad` : `${member.displayName}'s Squad`;

            const trigger = newState.channel;
            const temp    = await newState.guild.channels.create({
                name:                label,
                type:                ChannelType.GuildVoice,
                parent:              trigger.parentId,
                permissionOverwrites: trigger.permissionOverwrites.cache.map(po => ({
                    id:    po.id,
                    allow: po.allow,
                    deny:  po.deny,
                })),
            });

            tempVoiceChannels.add(temp.id);
            await member.voice.setChannel(temp).catch(() => {});
        }

        // User left a temp channel — delete it when empty
        if (oldState.channelId && tempVoiceChannels.has(oldState.channelId)) {
            const ch = oldState.channel;
            if (ch && ch.members.size === 0) {
                await ch.delete().catch(() => {});
                tempVoiceChannels.delete(oldState.channelId);
            }
        }
    } catch (err) {
        console.error('[ERROR] voiceStateUpdate:', err);
    }
});

process.on('unhandledRejection', err => console.error('[FATAL] Unhandled rejection:', err));

console.log('[Redsec] Logging in...');
client.login(process.env.TOKEN).catch(err => console.error('[FATAL] Login failed:', err));
