// Import depuis "Que faire à Paris ?" — l'agenda participatif officiel de
// la Ville de Paris (bibliothèques, musées, parcs, salles de concert,
// associations...), publié en open data. Aucune clé API requise — c'est
// une donnée publique en accès libre.
//
// Usage : node scripts/import-paris-opendata.js
//
// Noms de champs confirmés via un vrai appel à l'API le 28/08/2026 —
// contrairement aux autres scripts, celui-ci a été corrigé après un premier
// essai réel qui a révélé la vraie structure (lat_lon en {lat,lon}, prix
// dans price_type/price_detail, tags dans qfap_tags en chaîne simple...).

const path = require("path");
const Database = require("better-sqlite3");

const API_URL = "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/que-faire-a-paris-/records";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "db", "sortir.db");
const PAGE_SIZE = 100;
const MAX_PAGES = 35; // jusqu'à 3500 événements par run — la source en a ~3128 au total

// Correspondance grossière entre les tags de "Que faire à Paris" (qfap_tags,
// une chaîne, parfois plusieurs séparés par virgule) et nos catégories maison.
const CATEGORY_MAP = {
  "concert": "concert", "musique": "concert",
  "exposition": "expo", "exposition permanente": "expo", "exposition temporaire": "expo", "arts visuels": "expo",
  "spectacle": "spectacle", "théâtre": "spectacle", "danse": "spectacle", "cirque": "spectacle", "humour": "spectacle",
  "cinéma": "cinema", "projection": "cinema", "film": "cinema",
  "visite": "musee", "musée": "musee", "patrimoine": "musee", "balade urbaine": "musee", "histoire": "musee",
  "atelier": "ateliers", "stage": "ateliers", "cours": "ateliers", "artisanat": "ateliers",
  "sport": "sport", "sport et loisirs": "sport",
  "famille": "famille", "enfants": "famille", "jeune public": "famille",
  "fête": "soiree", "bal": "soiree", "soirée": "soiree", "nuit": "soiree",
  "conférence": "tech", "rencontre": "tech", "salon": "tech", "numérique": "tech",
  "marché": "gastronomie", "dégustation": "gastronomie", "cuisine": "gastronomie",
};
function mapCategory(qfapTags) {
  if (!qfapTags) return "insolite";
  const tags = String(qfapTags).split(",").map(t => t.trim().toLowerCase());
  for (const t of tags) {
    if (CATEGORY_MAP[t]) return CATEGORY_MAP[t];
  }
  return "insolite";
}

// Extrait un prix min/max à partir du texte libre "price_detail" (ex.
// "De 0€ à 12€", "15€", "Entre 8€ et 20€") — on ne devine jamais un prix
// qui ne serait pas écrit noir sur blanc dans la donnée source.
function parsePriceDetail(priceType, priceDetail) {
  if (/gratuit/i.test(priceType || "")) return { min: 0, max: 0 };
  if (!priceDetail) return { min: null, max: null };
  const numbers = [...priceDetail.matchAll(/(\d+(?:[.,]\d+)?)\s*€/g)].map(m => parseFloat(m[1].replace(",", ".")));
  if (numbers.length === 0) return { min: null, max: null };
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

function upsertVenue(db, record) {
  const lat = record.lat_lon?.lat;
  const lng = record.lat_lon?.lon; // attention : l'API donne "lon", pas "lng"
  if (typeof lat !== "number" || typeof lng !== "number" || (lat === 0 && lng === 0)) return null;

  const name = record.address_name || "Lieu à Paris";
  const city = record.address_city || "Paris";
  const existing = db.prepare(`SELECT id FROM venues WHERE name = ? AND city = ?`).get(name, city);
  if (existing) return existing.id;
  const info = db.prepare(`INSERT INTO venues (name, city, lat, lng) VALUES (?, ?, ?, ?)`)
    .run(name, city, lat, lng);
  return info.lastInsertRowid;
}

function upsertEvent(db, record, venueId) {
  if (!venueId || !record.id) return "skipped";
  if (!record.date_start) return "skipped"; // certaines fiches sont des offres permanentes sans date précise

  const existing = db.prepare(`SELECT id FROM events WHERE source = 'paris-opendata' AND external_id = ?`).get(String(record.id));
  if (existing) return "duplicate";

  const dateStart = record.date_start.slice(0, 10);
  const dateEnd = (record.date_end || record.date_start).slice(0, 10);
  const timeLabel = record.date_start.slice(11, 16) ? record.date_start.slice(11, 16).replace(":", "H") : null;
  const { min, max } = parsePriceDetail(record.price_type, record.price_detail);

  db.prepare(`
    INSERT INTO events (
      title, description, category_id, venue_id,
      date_start, date_end, time_label, price_min, price_max,
      cover_image_url, source, external_id, rating_avg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'paris-opendata', ?, 0)
  `).run(
    record.title || "Événement à Paris",
    record.lead_text || "",
    mapCategory(record.qfap_tags),
    venueId,
    dateStart,
    dateEnd,
    timeLabel,
    min,
    max,
    record.cover_url || null,
    String(record.id)
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
        const venueId = upsertVenue(db, record);
        const result = upsertEvent(db, record, venueId);
        if (result === "inserted") inserted++;
        else if (result === "duplicate") duplicates++;
        else skipped++;
      }

      if (records.length < PAGE_SIZE) break; // dernière page atteinte
    }
    console.log(`Terminé — ${inserted} nouveaux événements, ${duplicates} déjà présents, ${skipped} ignorés (sans date ou sans coordonnées valides).`);
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
