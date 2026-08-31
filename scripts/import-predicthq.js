// Import automatique d'événements depuis PredictHQ — un agrégateur qui
// combine déjà des centaines de sources (billetteries, institutions,
// réseaux d'organisateurs) en une seule API. C'est la façon la plus large
// et la plus légitime de couvrir "plein de sites différents" sans avoir à
// écrire un scraper par plateforme.
//
// Couverture : France entière par défaut (un seul grand cercle centré
// géographiquement sur le pays), avec reprise automatique d'un appel à
// l'autre — comme pour l'import Île-de-France/OpenAgenda, chaque appel
// avance dans les résultats au lieu de toujours retélécharger les mêmes.
//
// Prérequis : PREDICTHQ_API_KEY dans les variables d'environnement.
//
// Usage : node scripts/import-predicthq.js [lat] [lng] [rayon_km]

const path = require("path");
const Database = require("better-sqlite3");

const API_BASE = "https://api.predicthq.com/v1/events/";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "db", "sortir.db");

// Centre géographique approximatif de la France métropolitaine (proche de
// Bourges), avec un rayon large pour couvrir tout le pays d'un seul cercle —
// des coins comme la pointe bretonne ou Nice sont un peu excentrés mais
// restent globalement couverts.
const DEFAULT_LAT = 46.8;
const DEFAULT_LNG = 2.4;
const DEFAULT_RADIUS_KM = 600;

// Catégories PredictHQ demandées — confirmées via la vraie liste renvoyée
// par leur API (pas de "food-drink" en réalité, contrairement à ce qu'on
// pensait — la gastronomie est compensée plus bas par détection de mots-clés).
const CATEGORY_MAP = {
  concerts: "concert",
  "performing-arts": "spectacle",
  festivals: "soiree",
  sports: "sport",
  expos: "expo",
  community: "ateliers",
  conferences: "tech",
  academic: "tech",
};
const PHQ_CATEGORIES = Object.keys(CATEGORY_MAP).join(",");

// PredictHQ n'a pas de catégorie dédiée pour certaines de nos rubriques
// (mode, love, pop-up, cinéma, bien-être, famille, gastronomie) — on les
// retrouve en examinant le titre/la description des événements déjà
// catégorisés, plutôt que de les laisser systématiquement finir dans "insolite".
const KEYWORD_OVERRIDES = [
  { cat: "gastronomie", words: ["dégustation", "marché gourmand", "food festival", "gastronomie", "vin", "cuisine"] },
  { cat: "cinema", words: ["cinéma", "cinema", "ciné-concert", "projection", "film en plein air"] },
  { cat: "mode", words: ["mode", "fashion", "défilé", "créateurs de mode"] },
  { cat: "love", words: ["speed dating", "célibataire", "rencontre amoureuse", "soirée coquine"] },
  { cat: "popup", words: ["pop-up", "vide-dressing", "vide dressing", "marché aux puces", "brocante"] },
  { cat: "bienetre", words: ["yoga", "méditation", "bien-être", "bien etre", "sophrologie"] },
  { cat: "famille", words: ["famille", "jeune public", "enfants", "kids"] },
];
function applyKeywordOverride(baseCategory, title, description) {
  const text = `${title || ""} ${description || ""}`.toLowerCase();
  for (const rule of KEYWORD_OVERRIDES) {
    if (rule.words.some(w => text.includes(w))) return rule.cat;
  }
  return baseCategory;
}
function mapCategory(phqCategory) {
  return CATEGORY_MAP[phqCategory] || "insolite";
}

// Curseur de reprise partagé avec les autres imports paginés — chaque appel
// avance automatiquement au lieu de repartir de zéro.
function ensureStateTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS import_cursor (source TEXT PRIMARY KEY, next_offset INTEGER DEFAULT 0)`);
}
function getCursor(db, source) {
  ensureStateTable(db);
  const row = db.prepare(`SELECT next_offset FROM import_cursor WHERE source = ?`).get(source);
  return row ? row.next_offset : 0;
}
function setCursor(db, source, offset) {
  ensureStateTable(db); // sécurité — au cas où reset=1 aurait sauté l'appel à getCursor()
  db.prepare(`INSERT INTO import_cursor (source, next_offset) VALUES (?, ?)
              ON CONFLICT(source) DO UPDATE SET next_offset = excluded.next_offset`).run(source, offset);
}

async function fetchEvents(lat, lng, radiusKm, apiKey, offset) {
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

  const baseCategory = mapCategory(phqEvent.category);
  const category = applyKeywordOverride(baseCategory, phqEvent.title, phqEvent.description);
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

async function runImport(lat = DEFAULT_LAT, lng = DEFAULT_LNG, radiusKm = DEFAULT_RADIUS_KM, resetCursor = false) {
  const apiKey = process.env.PREDICTHQ_API_KEY;
  if (!apiKey) {
    throw new Error("PREDICTHQ_API_KEY manquant.");
  }

  const db = new Database(DB_PATH);
  let inserted = 0, duplicates = 0, skipped = 0;
  let offset = resetCursor ? 0 : getCursor(db, "predicthq");
  const startOffset = offset;
  const PAGE_LIMIT = 5; // sécurité : 5 pages max par run (250 événements)

  try {
    for (let page = 0; page < PAGE_LIMIT; page++) {
      const data = await fetchEvents(lat, lng, radiusKm, apiKey, offset);
      const results = data.results || [];
      if (results.length === 0) { offset = 0; break; } // fin des résultats → on repart du début au prochain appel

      for (const ev of results) {
        const venueId = upsertVenue(db, ev);
        const result = upsertEvent(db, ev, venueId);
        if (result === "inserted") inserted++;
        else if (result === "duplicate") duplicates++;
        else skipped++;
      }

      offset += results.length;
      if (!data.next) { offset = 0; break; }
    }
    setCursor(db, "predicthq", offset);
    console.log(`Terminé — ${inserted} nouveaux événements, ${duplicates} déjà présents, ${skipped} ignorés.`);
    return { lat, lng, radiusKm, inserted, duplicates, skipped, rangeRead: `${startOffset}–${offset}`, nextOffset: offset };
  } catch (err) {
    throw new Error(`Échec de l'import : ${err.message}`);
  } finally {
    db.close();
  }
}

module.exports = { runImport };

if (require.main === module) {
  const lat = parseFloat(process.argv[2]) || DEFAULT_LAT;
  const lng = parseFloat(process.argv[3]) || DEFAULT_LNG;
  const radiusKm = parseInt(process.argv[4], 10) || DEFAULT_RADIUS_KM;
  const reset = process.argv.includes("--reset");
  runImport(lat, lng, radiusKm, reset)
    .then(r => console.log(r))
    .catch(err => { console.error("❌", err.message); process.exit(1); });
}
