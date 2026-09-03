// Import des matchs de Ligue 1 et Ligue 2 depuis API-Football (api-sports.io)
// — pour garantir que les grandes compétitions nationales apparaissent
// vraiment dans l'app, ce que les agendas participatifs/agrégateurs
// génériques (PredictHQ, OpenAgenda...) ne couvrent pas de façon fiable.
//
// Prérequis : API_FOOTBALL_KEY dans les variables d'environnement (gratuit
// sur api-sports.io, ~100 requêtes/jour).
//
// Usage : node scripts/import-sports-fr.js

const path = require("path");
const Database = require("better-sqlite3");

const API_BASE = "https://v3.football.api-sports.io";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "db", "sortir.db");
const CURRENT_SEASON = new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1; // une saison de foot commence en été

// On ne connaît pas forcément les coordonnées exactes de chaque stade —
// repli sur le centre-ville correspondant si l'API n'en fournit pas.
const CITY_FALLBACK_COORDS = {
  "paris": { lat: 48.8566, lng: 2.3522 },
  "marseille": { lat: 43.2965, lng: 5.3698 },
  "lyon": { lat: 45.7640, lng: 4.8357 },
  "lille": { lat: 50.6292, lng: 3.0573 },
  "monaco": { lat: 43.7384, lng: 7.4246 },
  "nice": { lat: 43.7102, lng: 7.2620 },
  "rennes": { lat: 48.1173, lng: -1.6778 },
  "lens": { lat: 50.4327, lng: 2.8305 },
  "nantes": { lat: 47.2184, lng: -1.5536 },
  "strasbourg": { lat: 48.5734, lng: 7.7521 },
  "reims": { lat: 49.2583, lng: 4.0317 },
  "toulouse": { lat: 43.6047, lng: 1.4442 },
  "montpellier": { lat: 43.6108, lng: 3.8767 },
  "brest": { lat: 48.3904, lng: -4.4861 },
  "le havre": { lat: 49.4944, lng: 0.1079 },
  "angers": { lat: 47.4784, lng: -0.5632 },
  "auxerre": { lat: 47.7982, lng: 3.5731 },
  "metz": { lat: 49.1193, lng: 6.1757 },
};

async function apiGet(pathname, params) {
  const url = new URL(API_BASE + pathname);
  Object.entries(params || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API-Football a répondu ${res.status} : ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.errors && Object.keys(data.errors).length > 0) {
    throw new Error(`API-Football : ${JSON.stringify(data.errors)}`);
  }
  return data.response;
}

// On résout les identifiants de Ligue 1 / Ligue 2 en interrogeant l'API par
// nom plutôt que de les coder en dur — évite de se tromper de championnat.
async function resolveLeagueIds() {
  const leagues = await apiGet("/leagues", { country: "France" });
  const ids = {};
  for (const entry of leagues) {
    const name = entry.league?.name;
    if (name === "Ligue 1") ids.ligue1 = entry.league.id;
    if (name === "Ligue 2") ids.ligue2 = entry.league.id;
  }
  return ids;
}

function upsertVenue(db, fixture) {
  const venueName = fixture.fixture.venue?.name || `${fixture.teams.home.name} (domicile)`;
  const city = fixture.fixture.venue?.city || "";
  const cityKey = city.toLowerCase().trim();
  const coords = CITY_FALLBACK_COORDS[cityKey];
  if (!coords) return null; // ville inconnue de notre table de repli — on ignore plutôt que placer au hasard

  const existing = db.prepare(`SELECT id FROM venues WHERE name = ? AND city = ?`).get(venueName, city);
  if (existing) return existing.id;
  const info = db.prepare(`INSERT INTO venues (name, city, lat, lng) VALUES (?, ?, ?, ?)`)
    .run(venueName, city, coords.lat, coords.lng);
  return info.lastInsertRowid;
}

function upsertEvent(db, fixture, venueId, leagueLabel) {
  if (!venueId) return "skipped_no_location";
  const externalId = `fb-${fixture.fixture.id}`;
  const existing = db.prepare(`SELECT id FROM events WHERE source = 'api-football' AND external_id = ?`).get(externalId);
  if (existing) return "duplicate";

  const kickoff = fixture.fixture.date; // ISO 8601
  const title = `${fixture.teams.home.name} – ${fixture.teams.away.name}`;

  db.prepare(`
    INSERT INTO events (
      title, description, category_id, venue_id,
      date_start, date_end, time_label, price_min, price_max,
      cover_image_url, ticket_url, source, external_id, rating_avg
    ) VALUES (?, ?, 'sport', ?, ?, ?, ?, NULL, NULL, ?, NULL, 'api-football', ?, 0)
  `).run(
    title,
    `${leagueLabel} — journée ${fixture.league.round || ""}`.trim(),
    venueId,
    kickoff.slice(0, 10),
    kickoff.slice(0, 10),
    kickoff.slice(11, 16).replace(":", "H"),
    fixture.teams.home.logo || null, // à défaut d'une vraie affiche, le logo du club fait une couverture correcte
    externalId
  );
  return "inserted";
}

async function runImport() {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new Error("API_FOOTBALL_KEY manquant.");

  const db = new Database(DB_PATH);
  let inserted = 0, duplicates = 0;
  const skipReasons = { skipped_no_location: 0 };

  try {
    const { ligue1, ligue2 } = await resolveLeagueIds();
    if (!ligue1 && !ligue2) throw new Error("Impossible de trouver les identifiants Ligue 1 / Ligue 2 dans la réponse API-Football.");

    const leaguesToImport = [
      ligue1 ? { id: ligue1, label: "Ligue 1" } : null,
      ligue2 ? { id: ligue2, label: "Ligue 2" } : null,
    ].filter(Boolean);

    for (const league of leaguesToImport) {
      const fixtures = await apiGet("/fixtures", {
        league: league.id,
        season: CURRENT_SEASON,
        next: 30, // les 30 prochains matchs de ce championnat
      });
      for (const fixture of fixtures) {
        const venueId = upsertVenue(db, fixture);
        const result = upsertEvent(db, fixture, venueId, league.label);
        if (result === "inserted") inserted++;
        else if (result === "duplicate") duplicates++;
        else if (skipReasons[result] !== undefined) skipReasons[result]++;
      }
    }

    const skipped = Object.values(skipReasons).reduce((a, b) => a + b, 0);
    console.log(`Terminé — ${inserted} nouveaux matchs, ${duplicates} déjà présents, ${skipped} ignorés.`);
    return { inserted, duplicates, skipped, skipReasons, leaguesFound: leaguesToImport.map(l => l.label) };
  } catch (err) {
    throw new Error(`Échec de l'import : ${err.message}`);
  } finally {
    db.close();
  }
}

module.exports = { runImport };

if (require.main === module) {
  runImport()
    .then(r => console.log(r))
    .catch(err => { console.error("❌", err.message); process.exit(1); });
}
