const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const DATA_DIR = require('./dataDir');
const FILE = path.join(DATA_DIR, 'tournaments.json');

// ── Storage (multi-tournament keyed by ID) ───────────────────────────────────

function loadAll() {
    try {
        const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        if (!parsed) return {};
        // Migrate legacy format: single tournament with 'name' at root — persist immediately
        if (typeof parsed.name === 'string') {
            const id       = randomUUID();
            const migrated = { [id]: { ...parsed, id } };
            fs.writeFileSync(FILE, JSON.stringify(migrated, null, 2), 'utf8');
            return migrated;
        }
        return parsed;
    } catch {
        return {};
    }
}

function loadById(id) {
    return loadAll()[id] ?? null;
}

// Find tournament whose channels include the given channel ID
function loadByChannel(channelId) {
    return Object.values(loadAll()).find(t =>
        t.channels?.registration      === channelId ||
        t.channels?.scoreSubmissions  === channelId ||
        t.channels?.liveLeaderboard   === channelId ||
        t.channels?.rosters           === channelId
    ) ?? null;
}

function save(data) {
    const all = loadAll();
    all[data.id] = data;
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8');
}

function remove(id) {
    const all = loadAll();
    delete all[id];
    fs.writeFileSync(FILE, JSON.stringify(all, null, 2), 'utf8');
}

// ── Scoring helpers ──────────────────────────────────────────────────────────

function getPlacementPoints(placement) {
    const p = parseInt(placement);
    if (p === 1)  return 15;
    if (p === 2)  return 12;
    if (p === 3)  return 10;
    if (p === 4)  return 8;
    if (p === 5)  return 6;
    if (p <= 10)  return 4;
    return 0;
}

function calculateGamePoints(kills, placement) {
    return parseInt(kills) + getPlacementPoints(placement);
}

function teamScoreSummary(team) {
    const allScores = Object.values(team.scores ?? {}).filter(g => g != null);

    // Top 2 by gamePoints across ALL submitted scores (any status)
    const top2 = [...allScores].sort((a, b) => b.gamePoints - a.gamePoints).slice(0, 2);

    const gross    = top2.reduce((sum, g) => sum + g.gamePoints, 0);
    const handicap = parseFloat((team.teamIndex * 2).toFixed(2));
    const net      = parseFloat((gross + handicap).toFixed(2));

    // Tie-breaker reference: highest-kill game in top 2, then best placement
    const tieRef = [...top2].sort((a, b) => b.kills - a.kills || a.placement - b.placement)[0];

    // Backward compat: legacy scores use pending:boolean, new scores use status:string
    const isOfficial = g => g.status === 'official' || g.pending === false;
    const official   = allScores.filter(isOfficial).length;

    return {
        gross,
        net,
        handicap,
        submitted:         allScores.length,
        official,
        bestGameKills:     tieRef?.kills     ?? 0,
        bestGamePlacement: tieRef?.placement ?? 99,
    };
}

function newTeamId() {
    return randomUUID();
}

// Recomputes teamIndex for every team in every tournament from current player
// records, persists changes, and refreshes any tournament UI (leaderboard +
// roster cards) for teams whose total changed. Call this after any flow that
// mutates a player's redsecIndex (verify/update/stats) so tournament displays
// always reflect the latest values.
async function recomputeAndRefreshAllTeams(client, players) {
    // Lazy requires to avoid circular dependency with interactions/registration
    const { updateLeaderboard }   = require('./leaderboard');
    const { postOrUpdateRoster }  = require('../interactions/registration');

    const all = loadAll();

    for (const tournament of Object.values(all)) {
        const changedTeams = [];
        for (const [teamId, team] of Object.entries(tournament.teams ?? {})) {
            let newIndex = 0;
            for (const pid of team.players ?? []) {
                newIndex += players[pid]?.redsecIndex ?? 0;
            }
            newIndex = parseFloat(newIndex.toFixed(1));
            if (newIndex !== team.teamIndex) {
                team.teamIndex = newIndex;
                changedTeams.push(teamId);
            }
        }
        if (changedTeams.length === 0) continue;
        save(tournament);
        await updateLeaderboard(client, tournament).catch(err =>
            console.error('[recomputeAndRefreshAllTeams] leaderboard refresh failed:', err)
        );
        for (const teamId of changedTeams) {
            await postOrUpdateRoster(client, tournament, teamId).catch(err =>
                console.error('[recomputeAndRefreshAllTeams] roster refresh failed:', err)
            );
        }
    }
}

module.exports = {
    loadAll, loadById, loadByChannel, save, remove,
    getPlacementPoints, calculateGamePoints, teamScoreSummary, newTeamId,
    recomputeAndRefreshAllTeams,
};
