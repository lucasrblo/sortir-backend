// Import depuis "Événements publics en Île-de-France (via Open Agenda)" —
// le portail open data de la Région Île-de-France, qui republie les
// événements de nombreux organisateurs utilisant OpenAgenda. Aucune clé
// API requise.
//
// Usage : node scripts/import-idf-opendata.js
//
// Ce jeu de données est un export OpenAgenda générique (pas une structure
// maison comme "Que faire à Paris"), donc plus d'incertitude sur les noms
// exacts de champs — le code teste plusieurs noms probables en cascade
// pour chaque valeur. Comme d'habitude, non testé avec un vrai appel réseau
// depuis cet environnement ; le premier essai réel via /admin nous dira
// immédiatement, grâce au détail des raisons de rejet, ce qu'il faut ajuster.

const path = require("path");
const Database = require("better-sqlite3");

const API_URL = "https://data.iledefrance.fr/api/explore/v2.1/catalog/datasets/evenements-publics-cibul/records";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "db", "sortir.db");
const PAGE_SIZE = 100;
const MAX_PAGES = 35;

// Cette source republie en réalité un export OpenAgenda MONDIAL (malgré son
// nom sur le portail régional) — sans filtre, on importerait des événements
// du monde entier. Pour l'instant on couvre la France métropolitaine ; le
// jour où on veut passer à l'échelle mondiale, il suffira de supprimer ce
// filtre (aucune autre source à brancher, les données sont déjà là).
const FRANCE_BOUNDS = { latMin: 41.0, latMax: 51.5, lngMin: -5.5, lngMax: 9.8 };
function isInFrance(lat, lng) {
  return lat >= FRANCE_BOUNDS.latMin && lat <= FRANCE_BOUNDS.latMax && lng >= FRANCE_BOUNDS.lngMin && lng <= FRANCE_BOUNDS.lngMax;
}

const CATEGORY_MAP = {
  "musique": "concert", "concert": "concert",
  "exposition": "expo", "arts visuels": "expo", "arts-visuels": "expo",
  "spectacle": "spectacle", "théâtre": "spectacle", "theatre": "spectacle", "danse": "spectacle", "cirque": "spectacle", "humour": "spectacle",
  "cinéma": "cinema", "cinema": "cinema", "film": "cinema",
  "visite": "musee", "musée": "musee", "musee": "musee", "patrimoine": "musee",
  "atelier": "ateliers", "stage": "ateliers", "cours": "ateliers",
  "sport": "sport",
  "famille": "famille", "enfants": "famille", "jeune-public": "famille",
  "fête": "soiree", "fete": "soiree", "bal": "soiree", "soirée": "soiree", "soiree": "soiree", "clubbing": "soiree",
  "conférence": "tech", "conference": "tech", "rencontre-débat": "tech", "numérique": "tech",
  "marché": "gastronomie", "gastronomie": "gastronomie", "dégustation": "gastronomie",
};
function firstNonEmpty(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== "") return v;
  return null;
}
function mapCategory(record) {
  const raw = firstNonEmpty(record.keywords, record.category, record.tags, record.keyword);
  const list = Array.isArray(raw) ? raw : (typeof raw === "string" ? raw.split(",") : []);
  for (const item of list) {
    const key = String(item).trim().toLowerCase();
    if (CATEGORY_MAP[key]) return CATEGORY_MAP[key];
  }
  return "insolite";
}

function extractCoords(record) {
  const geo = firstNonEmpty(record.location_coordinates, record.location, record.geo, record.coordinates);
  if (geo && typeof geo.lat === "number") return { lat: geo.lat, lng: geo.lon ?? geo.lng };
  if (Array.isArray(geo) && geo.length === 2) return { lat: geo[0], lng: geo[1] };
  const lat = firstNonEmpty(record.location_latitude, record.latitude, record.lat);
  const lng = firstNonEmpty(record.location_longitude, record.longitude, record.lng, record.lon);
  if (typeof lat === "number" && typeof lng === "number") return { lat, lng };
  return null;
}

function extractDateStart(record) {
  return firstNonEmpty(record.firstdate_begin, record.date_start, record.datestart, record.first_date_begin);
}
function extractDateEnd(record) {
  return firstNonEmpty(record.lastdate_end, record.date_end, record.dateend, record.last_date_end) || extractDateStart(record);
}

function upsertVenue(db, record, coords) {
  const name = firstNonEmpty(record.location_name, record.venue_name, record.location, "Lieu en Île-de-France");
  const city = firstNonEmpty(record.location_city, record.city, "Île-de-France");
  const existing = db.prepare(`SELECT id FROM venues WHERE name = ? AND city = ?`).get(String(name), String(city));
  if (existing) return existing.id;
  const info = db.prepare(`INSERT INTO venues (name, city, lat, lng) VALUES (?, ?, ?, ?)`)
    .run(String(name), String(city), coords.lat, coords.lng);
  return info.lastInsertRowid;
}

function upsertEvent(db, record, venueId) {
  const externalId = firstNonEmpty(record.uid, record.id, record.recordid);
  if (!externalId) return "skipped_no_id";
  const dateStart = extractDateStart(record);
  if (!dateStart) return "skipped_no_date";
  if (!venueId) return "skipped_no_location";

  const existing = db.prepare(`SELECT id FROM events WHERE source = 'idf-opendata' AND external_id = ?`).get(String(externalId));
  if (existing) return "duplicate";

  const dateEnd = extractDateEnd(record) || dateStart;
  const title = firstNonEmpty(record.title, record.title_fr) || "Événement en Île-de-France";
  const desc = firstNonEmpty(record.description, record.longdescription, record.description_fr) || "";
  const image = firstNonEmpty(record.image, record.thumbnail, record.cover);
  const url = firstNonEmpty(record.canonicalurl, record.url, record.link);
  const isFree = record.free === true || record.free === "true" || record.free === 1;

  db.prepare(`
    INSERT INTO events (
      title, description, category_id, venue_id,
      date_start, date_end, time_label, price_min, price_max,
      cover_image_url, ticket_url, source, external_id, rating_avg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'idf-opendata', ?, 0)
  `).run(
    String(title),
    String(desc).replace(/<[^>]+>/g, "").slice(0, 1000), // on retire le HTML éventuel
    mapCategory(record),
    venueId,
    String(dateStart).slice(0, 10),
    String(dateEnd).slice(0, 10),
    String(dateStart).length > 10 ? String(dateStart).slice(11, 16).replace(":", "H") : null,
    isFree ? 0 : null,
    image || null,
    url || null,
    String(externalId)
  );
  return "inserted";
}

// Le curseur de reprise est stocké directement dans la base (table
// import_cursor), pour que chaque appel reprenne là où le précédent
// s'est arrêté au lieu de toujours retélécharger les mêmes 3500 premiers
// événements sur les 195 000 disponibles.
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

async function runImport(resetCursor = false) {
  const db = new Database(DB_PATH);
  let inserted = 0, duplicates = 0, totalCount = null;
  const skipReasons = { skipped_no_id: 0, skipped_no_date: 0, skipped_no_location: 0, skipped_out_of_region: 0 };
  let offset = resetCursor ? 0 : getCursor(db, "idf-opendata");
  const startOffset = offset;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${API_URL}?limit=${PAGE_SIZE}&offset=${offset}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Île-de-France Open Data a répondu ${res.status} : ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      if (totalCount === null) totalCount = data.total_count ?? null;
      const records = data.results || [];
      if (records.length === 0) { offset = 0; break; } // fin du jeu de données atteinte → on repart du début au prochain appel

      for (const record of records) {
        const coords = extractCoords(record);
        if (coords && !isInFrance(coords.lat, coords.lng)) { skipReasons.skipped_out_of_region++; continue; }
        const venueId = coords ? upsertVenue(db, record, coords) : null;
        const result = upsertEvent(db, record, venueId);
        if (result === "inserted") inserted++;
        else if (result === "duplicate") duplicates++;
        else if (skipReasons[result] !== undefined) skipReasons[result]++;
      }

      offset += records.length;
      if (records.length < PAGE_SIZE) { offset = 0; break; } // dernière page → on repart du début au prochain appel
    }
    setCursor(db, "idf-opendata", offset);
    const skipped = Object.values(skipReasons).reduce((a, b) => a + b, 0);
    console.log(`Terminé — ${inserted} nouveaux événements, ${duplicates} déjà présents, ${skipped} ignorés.`);
    return { inserted, duplicates, skipped, skipReasons, totalCount, rangeRead: `${startOffset}–${startOffset + MAX_PAGES * PAGE_SIZE}`, nextOffset: offset };
  } catch (err) {
    throw new Error(`Échec de l'import : ${err.message}`);
  } finally {
    db.close();
  }
}

module.exports = { runImport };

if (require.main === module) {
  const reset = process.argv.includes("--reset");
  runImport(reset)
    .then(r => console.log(r))
    .catch(err => { console.error("❌", err.message); process.exit(1); });
}
