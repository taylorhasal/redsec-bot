const { ChannelType } = require('discord.js');
const { save } = require('./tournament');

async function getOrCreateVoiceCategory(client, tournament) {
    if (tournament.voiceCategoryId) {
        const existing = client.channels.cache.get(tournament.voiceCategoryId);
        if (existing) return existing;
    }

    const guild = client.guilds.cache.get(tournament.guildId);
    if (!guild) return null;

    const verifiedRole = guild.roles.cache.find(r => r.name === 'Verified');
    const permissionOverwrites = [
        { id: guild.id,           deny:  ['ViewChannel'] },
        { id: client.user.id,     allow: ['ViewChannel', 'ManageChannels'] },
    ];
    if (verifiedRole) {
        permissionOverwrites.push({ id: verifiedRole.id, allow: ['ViewChannel'] });
    }

    const category = await guild.channels.create({
        name: '🎙️ Tourney Team Voice Chats',
        type: ChannelType.GuildCategory,
        permissionOverwrites,
    }).catch(() => null);

    if (category) {
        tournament.voiceCategoryId = category.id;
        save(tournament);
    }

    return category;
}

async function createTeamVoiceChannel(client, tournament, teamId, team) {
    if (team.voiceChannelId) return null; // already exists

    const guild = client.guilds.cache.get(tournament.guildId);
    if (!guild) return null;

    const voiceCategory = await getOrCreateVoiceCategory(client, tournament);
    const parentId = voiceCategory?.id ?? tournament.categoryId;

    const vc = await guild.channels.create({
        name: team.name,
        type: ChannelType.GuildVoice,
        parent: parentId,
    }).catch(() => null);

    if (vc) {
        tournament.teams[teamId].voiceChannelId = vc.id;
        save(tournament);
    }

    return vc;
}

async function createAllTeamVoiceChannels(client, tournament) {
    for (const [teamId, team] of Object.entries(tournament.teams ?? {})) {
        await createTeamVoiceChannel(client, tournament, teamId, team).catch(console.error);
    }
}

function isPastVoiceThreshold(tournament) {
    if (!tournament.scheduledStartAt) return false;
    return Date.now() >= new Date(tournament.scheduledStartAt).getTime() - 60 * 60 * 1000;
}

module.exports = { createTeamVoiceChannel, createAllTeamVoiceChannels, isPastVoiceThreshold };
