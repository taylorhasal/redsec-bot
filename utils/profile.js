const SKILL_ROLES = ['Recruit', 'Scout', 'Sentinel', 'Vanguard', 'Operator', 'Phantom'];

function getSkillRoleName(index) {
    if (index >= 6)   return 'Recruit';
    if (index >= 2)   return 'Scout';
    if (index > -2)   return 'Sentinel';
    if (index > -6)   return 'Vanguard';
    if (index > -10)  return 'Operator';
    return 'Phantom';
}

function formatIndex(index) {
    return (index >= 0 ? '+' : '') + index.toFixed(1);
}

async function applyPlayerProfile(guild, member, eaId, redsecIndex, displayName = null) {
    const indexStr     = formatIndex(redsecIndex);
    const newSkillName = getSkillRoleName(redsecIndex);

    // Nickname: "[+1.2] DisplayName"  (explicit gamertag, or falls back to Discord name)
    const prefix    = `[${indexStr}] `;
    const nameToUse = (displayName ?? member.user.globalName ?? member.user.username).slice(0, 32 - prefix.length);
    await member.setNickname(`${prefix}${nameToUse}`).catch(() => {});

    // Assign @Verified role if it exists in this guild (created by /setup)
    const verifiedRole = guild.roles.cache.find(r => r.name === 'Verified');
    if (verifiedRole && !member.roles.cache.has(verifiedRole.id)) {
        await member.roles.add(verifiedRole).catch(() => {});
    }

    // Remove old skill roles, add new one
    for (const name of SKILL_ROLES) {
        const role = guild.roles.cache.find(r => r.name === name);
        if (!role) continue;
        if (name === newSkillName) {
            if (!member.roles.cache.has(role.id)) await member.roles.add(role).catch(() => {});
        } else {
            if (member.roles.cache.has(role.id)) await member.roles.remove(role).catch(() => {});
        }
    }
    // Create skill role if it doesn't exist yet
    if (!guild.roles.cache.find(r => r.name === newSkillName)) {
        const created = await guild.roles.create({ name: newSkillName, reason: 'Redsec skill tier' }).catch(() => null);
        if (created) await member.roles.add(created).catch(() => {});
    }

    // Remove old Index: role
    const oldIndexRole = member.roles.cache.find(r => r.name.startsWith('Index: '));
    if (oldIndexRole) {
        await member.roles.remove(oldIndexRole).catch(() => {});
        // Delete the role entirely if no other member holds it
        if (oldIndexRole.members.size === 0) {
            await oldIndexRole.delete('Redsec index updated').catch(() => {});
        }
    }

    // Assign new Index: role (create if missing)
    const newIndexName = `Index: ${indexStr}`;
    let indexRole = guild.roles.cache.find(r => r.name === newIndexName);
    if (!indexRole) {
        indexRole = await guild.roles.create({ name: newIndexName, reason: 'Redsec index role' }).catch(() => null);
    }
    if (indexRole) await member.roles.add(indexRole).catch(() => {});

    // Remove old EA: role
    const oldEaRole = member.roles.cache.find(r => r.name.startsWith('EA: '));
    if (oldEaRole && oldEaRole.name !== `EA: ${eaId}`) {
        await member.roles.remove(oldEaRole).catch(() => {});
        if (oldEaRole.members.size === 0) {
            await oldEaRole.delete('Redsec EA ID changed').catch(() => {});
        }
    }

    // Assign new EA: role (create if missing)
    const newEaName = `EA: ${eaId}`;
    let eaRole = guild.roles.cache.find(r => r.name === newEaName);
    if (!eaRole) {
        eaRole = await guild.roles.create({
            name:        newEaName,
            mentionable: false,
            hoist:       false,
            reason:      'Redsec EA ID role',
        }).catch(() => null);
    }
    if (eaRole && !member.roles.cache.has(eaRole.id)) {
        await member.roles.add(eaRole).catch(() => {});
    }
}

module.exports = { applyPlayerProfile, getSkillRoleName, formatIndex };
