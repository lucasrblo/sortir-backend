// Import automatique d'événements depuis PredictHQ — un agrégateur qui
// combine déjà des centaines de sources (billetteries, institutions,
// réseaux d'organisateurs) en une seule API. C'est la façon la plus large
// et la plus légitime de couvrir "plein de sites différents" sans avoir à
// écrire un scraper par plateforme.
//
// Prérequis : PREDICTHQ_API_KEY dans les variables d'environnement
// (compte gratuit sur predicthq.com — 14 jours d'essai puis un plan
// gratuit permanent avec quota réduit).
//
// Usage : node scripts/import-predicthq.js [lat] [lng] [rayon_km]
//   node scripts/import-predicthq.js 48.8566 2.3522 15
//
// Comme pour le script Ticketmaster, cet import n'a pas pu être testé
// avec un vrai appel réseau depuis cet environnement de développement —
// il suit fidèlement la documentation officielle de l'API Events de
// PredictHQ, mais un premier essai réel reste à faire une fois déployé.

const path = require("path");
const Database = require("better-sqlite3");

const API_BASE = "https://api.predicthq.com/v1/events/";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "db", "sortir.db");

// PredictHQ utilise des catégories génériques anglaises — correspondance
// grossière vers nos catégories maison, à affiner en observant les
// vraies données une fois l'import testé.
const CATEGORY_MAP = {
  concerts: "concert",
  "performing-arts": "spectacle",
  festivals: "soiree",
  sports: "sport",
  expos: "expo",
  community: "ateliers",
  conferences: "tech",
};
const PHQ_CATEGORIES = Object.keys(CATEGORY_MAP).join(",");

function mapCategory(phqCategory) {
  return CATEGORY_MAP[phqCategory] || "insolite";
}

async function fetchEvents(lat, lng, radiusKm, apiKey, offset = 0) {
  const url = new URL(API_BASE);
  url.searchParams.set("within", `${radiusKm}km@${lat},${lng}`);
  url.searchParams.set("category", PHQ_CATEGORIES);
  url.searchParams.set("active.gte", new Date().toISOString().slice(0, 10));
  url.searchParams.set("limit", "50");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("sort", "start");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`PredictHQ a répondu ${res.status} : ${body.slice(0, 300)}`);
  }
  return res.json();
}

function upsertVenue(db, phqEvent) {
  // PredictHQ donne les coordonnées de l'événement lui-même (location: [lng, lat]
  // au format GeoJSON — attention à l'ordre, inversé par rapport à d'habitude).
  const coords = phqEvent.location;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const [lng, lat] = coords;

  // Le nom du lieu est rarement structuré proprement dans PredictHQ — on
  // retombe sur le nom de l'événement si aucune entité "venue" n'est fournie.
  const venueEntity = (phqEvent.entities || []).find(e => e.type === "venue");
  const name = venueEntity?.name || phqEvent.title;
  const city = phqEvent.geo?.address?.locality || "";

  const existing = db.prepare(`SELECT id FROM venues WHERE name = ? AND city = ?`).get(name, city);
  if (existing) return existing.id;

  const info = db.prepare(`
    INSERT INTO venues (name, city, lat, lng)
    VALUES (?, ?, ?, ?)
  `).run(name, city, lat, lng);
  return info.lastInsertRowid;
}

function upsertEvent(db, phqEvent, venueId) {
  if (!venueId || !phqEvent.start) return "skipped";

  const existing = db.prepare(`SELECT id FROM events WHERE source = 'predicthq' AND external_id = ?`).get(phqEvent.id);
  if (existing) return "duplicate";

  const category = mapCategory(phqEvent.category);
  const dateStart = phqEvent.start.slice(0, 10);
  const dateEnd = (phqEvent.end || phqEvent.start).slice(0, 10);
  const timeLabel = phqEvent.start.includes("T") ? phqEvent.start.slice(11, 16).replace(":", "H") : null;

  db.prepare(`
    INSERT INTO events (
      title, description, category_id, venue_id,
      date_start, date_end, time_label, price_min, price_max,
      cover_image_url, source, external_id, rating_avg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 'predicthq', ?, 0)
  `).run(
    phqEvent.title,
    phqEvent.description || "",
    category,
    venueId,
    dateStart,
    dateEnd,
    timeLabel,
    phqEvent.id
  );
  return "inserted";
}

async function runImport(lat = 48.8566, lng = 2.3522, radiusKm = 15) {
  const apiKey = process.env.PREDICTHQ_API_KEY;
  if (!apiKey) {
    throw new Error("PREDICTHQ_API_KEY manquant.");
  }

  const db = new Database(DB_PATH);
  let inserted = 0, duplicates = 0, skipped = 0, offset = 0;
  const PAGE_LIMIT = 5; // sécurité : 5 pages max par run (250 événements)

  try {
    for (let page = 0; page < PAGE_LIMIT; page++) {
      const data = await fetchEvents(lat, lng, radiusKm, apiKey, offset);
      const results = data.results || [];
      if (results.length === 0) break;

      for (const ev of results) {
        const venueId = upsertVenue(db, ev);
        const result = upsertEvent(db, ev, venueId);
        if (result === "inserted") inserted++;
        else if (result === "duplicate") duplicates++;
        else skipped++;
      }

      if (!data.next) break;
      offset += results.length;
    }
    console.log(`Terminé — ${inserted} nouveaux événements, ${duplicates} déjà présents, ${skipped} ignorés.`);
    return { lat, lng, radiusKm, inserted, duplicates, skipped };
  } catch (err) {
    throw new Error(`Échec de l'import : ${err.message}`);
  } finally {
    db.close();
  }
}

module.exports = { runImport };

if (require.main === module) {
  const lat = parseFloat(process.argv[2]) || 48.8566;
  const lng = parseFloat(process.argv[3]) || 2.3522;
  const radiusKm = parseInt(process.argv[4], 10) || 15;
  runImport(lat, lng, radiusKm)
    .then(r => console.log(r))
    .catch(err => { console.error("❌", err.message); process.exit(1); });
}
