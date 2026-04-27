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
    if (p === 1) return 20;
    if (p === 2) return 16;
    if (p === 3) return 12;
    if (p <= 5)  return 10;
    return 0;
}

function calculateGamePoints(kills, placement) {
    return parseInt(kills) + getPlacementPoints(placement);
}

function teamScoreSummary(team) {
    const allScores = Object.values(team.scores ?? {}).filter(g => g != null);
    const confirmed  = allScores.filter(g => !g.pending);

    // Top 2 confirmed games by game points (the rule)
    const top2 = [...confirmed].sort((a, b) => b.gamePoints - a.gamePoints).slice(0, 2);

    const gross    = top2.reduce((sum, g) => sum + g.gamePoints, 0);
    const handicap = parseFloat((team.teamIndex * 2).toFixed(2));
    const net      = parseFloat((gross + handicap).toFixed(2));

    // Tie-breaker reference: highest-kill game in top 2, then best placement
    const tieRef = [...top2].sort((a, b) => b.kills - a.kills || a.placement - b.placement)[0];

    return {
        gross,
        net,
        handicap,
        submitted:         allScores.length,
        confirmed:         confirmed.length,
        bestGameKills:     tieRef?.kills     ?? 0,
        bestGamePlacement: tieRef?.placement ?? 99,
    };
}

function newTeamId() {
    return randomUUID();
}

module.exports = {
    loadAll, loadById, loadByChannel, save, remove,
    getPlacementPoints, calculateGamePoints, teamScoreSummary, newTeamId,
};
