// Import depuis "Que faire à Paris ?" — l'agenda participatif officiel de
// la Ville de Paris (bibliothèques, musées, parcs, salles de concert,
// associations...), publié en open data. Aucune clé API requise — c'est
// une donnée publique en accès libre.
//
// Usage : node scripts/import-paris-opendata.js
//
// Comme pour les autres imports, ce script n'a pas pu être testé avec un
// vrai appel réseau depuis cet environnement de développement (domaine non
// accessible ici). Les noms de champs utilisés ci-dessous correspondent à
// la structure connue et documentée du jeu de données "que-faire-a-paris-",
// mais un premier essai réel (via la route /admin) reste à faire pour les
// confirmer — comme on l'a fait pour Ticketmaster et PredictHQ.

const path = require("path");
const Database = require("better-sqlite3");

const API_URL = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/que-faire-a-paris-/records";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "db", "sortir.db");
const PAGE_SIZE = 100;
const MAX_PAGES = 10; // sécurité : jusqu'à 1000 événements par run

// Correspondance grossière entre les tags/catégories de "Que faire à Paris"
// et nos catégories maison.
const CATEGORY_MAP = {
  "concert": "concert", "musique": "concert",
  "exposition": "expo", "exposition permanente": "expo", "exposition temporaire": "expo",
  "spectacle": "spectacle", "théâtre": "spectacle", "danse": "spectacle", "cirque": "spectacle",
  "cinéma": "cinema", "projection": "cinema",
  "visite": "musee", "musée": "musee", "patrimoine": "musee",
  "atelier": "ateliers", "stage": "ateliers", "cours": "ateliers",
  "sport": "sport", "sport et loisirs": "sport",
  "famille": "famille", "enfants": "famille", "jeune public": "famille",
  "fête": "soiree", "bal": "soiree", "soirée": "soiree",
  "conférence": "tech", "rencontre": "tech", "salon": "tech",
  "marché": "gastronomie", "dégustation": "gastronomie",
};
function mapCategory(tags) {
  if (!Array.isArray(tags)) return "insolite";
  for (const t of tags) {
    const key = (t || "").toLowerCase().trim();
    if (CATEGORY_MAP[key]) return CATEGORY_MAP[key];
  }
  return "insolite"; // repli si aucun tag connu ne correspond
}

function extractLatLng(record) {
  // Le champ géographique est généralement "geo_point_2d": {lat, lon} —
  // avec repli sur d'autres formes possibles selon l'export du dataset.
  const geo = record.geo_point_2d || record.location;
  if (geo && typeof geo.lat === "number" && typeof geo.lon === "number") {
    return { lat: geo.lat, lng: geo.lon };
  }
  if (Array.isArray(geo) && geo.length === 2) {
    return { lat: geo[0], lng: geo[1] };
  }
  return null;
}

function upsertVenue(db, record, coords) {
  const name = record.address_name || record.title || "Lieu à Paris";
  const city = record.address_city || "Paris";
  const existing = db.prepare(`SELECT id FROM venues WHERE name = ? AND city = ?`).get(name, city);
  if (existing) return existing.id;
  const info = db.prepare(`INSERT INTO venues (name, city, lat, lng) VALUES (?, ?, ?, ?)`)
    .run(name, city, coords.lat, coords.lng);
  return info.lastInsertRowid;
}

function upsertEvent(db, record, venueId) {
  const externalId = record.id || record.recordid;
  if (!externalId) return "skipped";
  const existing = db.prepare(`SELECT id FROM events WHERE source = 'paris-opendata' AND external_id = ?`).get(String(externalId));
  if (existing) return "duplicate";

  const dateStart = (record.date_start || "").slice(0, 10);
  const dateEnd = (record.date_end || record.date_start || "").slice(0, 10);
  if (!dateStart) return "skipped";

  // Le jeu de données indique parfois explicitement si c'est gratuit —
  // on ne devine jamais un prix, on ne renseigne que ce qui est écrit noir sur blanc.
  const isFree = /gratuit/i.test(record.access_type || record.price_type || "");

  db.prepare(`
    INSERT INTO events (
      title, description, category_id, venue_id,
      date_start, date_end, time_label, price_min, price_max,
      cover_image_url, source, external_id, rating_avg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'paris-opendata', ?, 0)
  `).run(
    record.title || "Événement à Paris",
    record.lead_text || record.description || "",
    mapCategory(record.tags),
    venueId,
    dateStart,
    dateEnd,
    (record.date_start || "").slice(11, 16).replace(":", "H") || null,
    isFree ? 0 : null,
    record.cover_url || record.image || null,
    String(externalId)
  );
  return "inserted";
}

async function runImport() {
  const db = new Database(DB_PATH);
  let inserted = 0, duplicates = 0, skipped = 0;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `${API_URL}?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Paris Open Data a répondu ${res.status} : ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      const records = data.results || [];
      if (records.length === 0) break;

      for (const record of records) {
        const coords = extractLatLng(record);
        if (!coords) { skipped++; continue; }
        const venueId = upsertVenue(db, record, coords);
        const result = upsertEvent(db, record, venueId);
        if (result === "inserted") inserted++;
        else if (result === "duplicate") duplicates++;
        else skipped++;
      }

      if (records.length < PAGE_SIZE) break; // dernière page atteinte
    }
    console.log(`Terminé — ${inserted} nouveaux événements, ${duplicates} déjà présents, ${skipped} ignorés (infos incomplètes).`);
    return { inserted, duplicates, skipped };
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
