const GAMETOOLS_BASE = 'https://api.gametools.network/bf6/stats/';

// Stable mode IDs for Redsec Duo and Redsec Squad
const REDSEC_MODE_IDS = new Set(['gm_graniteDuo', 'gm_brsquad']);

async function fetchPlayerStats(playerName, platform = 'pc') {
    const url = `${GAMETOOLS_BASE}?name=${encodeURIComponent(playerName)}&platform=${platform}`;
    const res = await fetch(url, {
        headers: { 'Accept': 'application/json' },
    });

    if (res.status === 403) throw new Error('PROFILE_PRIVATE');
    if (res.status === 404) throw new Error('PLAYER_NOT_FOUND');
    if (res.status === 429) throw new Error('RATE_LIMITED');
    if (!res.ok) {
        const body = await res.text().catch(() => '(unreadable)');
        console.error(`[Gametools] HTTP ${res.status} — ${url}\n${body}`);
        throw new Error(`API_ERROR:${res.status}`);
    }

    const json = await res.json();

    // Gametools returns errors as { errors: [...] } with a 200 status
    if (json.errors?.length) {
        const msg = (json.errors[0]?.message ?? '').toLowerCase();
        if (msg.includes('private'))   throw new Error('PROFILE_PRIVATE');
        if (msg.includes('not found')) throw new Error('PLAYER_NOT_FOUND');
        throw new Error('API_ERROR:' + msg);
    }

    return json;
}

function extractRedsecStats(data) {
    const gameModes = data?.gameModes;
    if (!Array.isArray(gameModes) || gameModes.length === 0) return null;

    let kills = 0, deaths = 0, wins = 0, losses = 0, matches = 0, secondsPlayed = 0, revives = 0;
    let found = false;

    for (const m of gameModes) {
        if (!REDSEC_MODE_IDS.has(m.id)) continue;
        found          = true;
        kills         += m.kills         ?? 0;
        deaths        += m.deaths        ?? 0;
        wins          += m.wins          ?? 0;
        losses        += m.losses        ?? 0;
        matches       += m.matches       ?? 0;
        secondsPlayed += m.secondsPlayed ?? 0;
        revives       += m.revives       ?? 0;
    }

    if (!found) return null;

    const minutesPlayed  = secondsPlayed / 60;
    const kpm            = minutesPlayed > 0 ? kills  / minutesPlayed : 0;
    const dpm            = minutesPlayed > 0 ? deaths / minutesPlayed : 0;
    const kd             = deaths  > 0 ? kills  / deaths  : kills;
    const winRate        = matches > 0 ? wins   / matches : 0;
    const winPercent     = matches > 0 ? (wins / matches * 100).toFixed(1) + '%' : '0.0%';
    const killsPerMatch  = matches > 0 ? kills  / matches : null;
    const deathsPerMatch = matches > 0 ? deaths / matches : null;

    return {
        kills, deaths, wins, losses, matches, revives,
        timePlayed: secondsPlayed,
        kpm, dpm, kd, winRate, winPercent,
        killsPerMatch, deathsPerMatch,
    };
}

function formatTime(seconds) {
    if (seconds == null) return 'N/A';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

function fmt(value, decimals = 2) {
    if (value == null) return 'N/A';
    return typeof value === 'number' ? value.toFixed(decimals) : String(value);
}

function fmtInt(value) {
    if (value == null) return 'N/A';
    return Math.round(value).toLocaleString();
}

function buildErrorMessage(err) {
    const msg = err.message ?? '';
    if (msg === 'PROFILE_PRIVATE')  return 'This profile is private. Ask the player to make their stats public in BF6 settings.';
    if (msg === 'PLAYER_NOT_FOUND') return 'Player not found. Double-check the EA ID — or the stats API may be temporarily down. Try again in a few minutes.';
    if (msg === 'RATE_LIMITED')     return 'The stats API is rate-limited. Please wait a moment and try again.';
    return `The stats API returned an unexpected error (${msg}). Check the bot console for details.`;
}

module.exports = { fetchPlayerStats, extractRedsecStats, buildErrorMessage, formatTime, fmt, fmtInt };
