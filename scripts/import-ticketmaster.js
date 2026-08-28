// Import automatique d'événements réels depuis l'API Discovery de Ticketmaster.
//
// Prérequis : la variable d'environnement TICKETMASTER_API_KEY doit être définie
// (voir .env.example). Sans elle, le script s'arrête proprement avec un message clair.
//
// Usage : node scripts/import-ticketmaster.js [ville]
//   node scripts/import-ticketmaster.js Paris
//
// Ce script n'a pas pu être testé avec une vraie requête réseau depuis cet
// environnement de développement (accès à app.ticketmaster.com bloqué ici) —
// il suit fidèlement le contrat documenté de la Discovery API v2, mais un
// premier test réel (une fois déployé, avec une vraie clé) reste à faire.

const path = require("path");
const Database = require("better-sqlite3");

const API_BASE = "https://app.ticketmaster.com/discovery/v2/events.json";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "db", "sortir.db");

// Correspondance grossière entre les classifications Ticketmaster (en anglais)
// et nos catégories maison — à affiner avec le temps en observant les vraies données.
const CATEGORY_MAP = {
  music: "concert",
  sports: "sport",
  arts: "spectacle",
  theatre: "spectacle",
  film: "cinema",
  family: "famille",
  comedy: "spectacle",
};

function mapCategory(classificationName) {
  const key = (classificationName || "").toLowerCase();
  return CATEGORY_MAP[key] || "insolite"; // repli si aucune correspondance connue
}

async function fetchEvents(city, apiKey, page = 0) {
  const url = new URL(API_BASE);
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("city", city);
  url.searchParams.set("countryCode", "FR");
  url.searchParams.set("size", "50");
  url.searchParams.set("page", String(page));

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ticketmaster a répondu ${res.status} : ${body.slice(0, 300)}`);
  }
  return res.json();
}

function upsertVenue(db, venue) {
  if (!venue) return null;
  const lat = venue.location?.latitude ? parseFloat(venue.location.latitude) : null;
  const lng = venue.location?.longitude ? parseFloat(venue.location.longitude) : null;
  if (lat == null || lng == null) return null;

  const existing = db.prepare(`SELECT id FROM venues WHERE name = ? AND city = ?`).get(venue.name, venue.city?.name || "");
  if (existing) return existing.id;

  const info = db.prepare(`
    INSERT INTO venues (name, city, lat, lng)
    VALUES (?, ?, ?, ?)
  `).run(venue.name, venue.city?.name || "", lat, lng);
  return info.lastInsertRowid;
}

function upsertEvent(db, ev, venueId) {
  const category = mapCategory(ev.classifications?.[0]?.segment?.name);
  const priceRange = ev.priceRanges?.[0];
  const start = ev.dates?.start?.localDate;
  if (!start || !venueId) return "skipped"; // pas assez d'infos exploitables

  const existing = db.prepare(`SELECT id FROM events WHERE source = 'ticketmaster' AND external_id = ?`).get(ev.id);
  if (existing) return "duplicate";

  db.prepare(`
    INSERT INTO events (
      title, description, category_id, venue_id,
      date_start, date_end, time_label, price_min, price_max,
      cover_image_url, source, external_id, rating_avg
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ticketmaster', ?, 0)
  `).run(
    ev.name,
    ev.info || ev.pleaseNote || "",
    category,
    venueId,
    start,
    ev.dates?.end?.localDate || start,
    ev.dates?.start?.localTime ? ev.dates.start.localTime.slice(0, 5).replace(":", "H") : null,
    priceRange?.min ?? null,
    priceRange?.max ?? null,
    ev.images?.[0]?.url || null,
    ev.id
  );
  return "inserted";
}

async function main() {
  const apiKey = process.env.TICKETMASTER_API_KEY;
  if (!apiKey) {
    console.error("❌ TICKETMASTER_API_KEY manquant. Ajoute-le dans tes variables d'environnement (voir .env.example) puis relance.");
    process.exit(1);
  }

  const city = process.argv[2] || "Paris";
  const db = new Database(DB_PATH);

  console.log(`Import Ticketmaster pour "${city}"...`);
  let inserted = 0, duplicates = 0, skipped = 0, page = 0, totalPages = 1;

  try {
    do {
      const data = await fetchEvents(city, apiKey, page);
      const events = data._embedded?.events || [];

      for (const ev of events) {
        const venue = ev._embedded?.venues?.[0];
        const venueId = upsertVenue(db, venue);
        const result = upsertEvent(db, ev, venueId);
        if (result === "inserted") inserted++;
        else if (result === "duplicate") duplicates++;
        else skipped++;
      }

      totalPages = data.page?.totalPages || 1;
      page++;
    } while (page < totalPages && page < 5); // limite de sécurité : 5 pages max par run

    console.log(`Terminé — ${inserted} nouveaux événements, ${duplicates} déjà présents, ${skipped} ignorés (infos incomplètes).`);
  } catch (err) {
    console.error("❌ Échec de l'import :", err.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();
