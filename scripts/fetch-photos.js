// Associe une vraie photo (Pexels, gratuit) à chaque événement qui n'en a
// pas déjà une (la plupart, puisque PredictHQ n'en fournit pas en version
// gratuite). Stratégie : une recherche par catégorie (pas par événement,
// pour rester sobre en appels API), on récupère un lot de photos pertinentes
// par thème, puis on les répartit sur les événements de cette catégorie —
// bon compromis entre pertinence thématique et variété visuelle.
//
// Prérequis : PEXELS_API_KEY dans les variables d'environnement (gratuit
// sur pexels.com/api).
//
// Usage : node scripts/fetch-photos.js

const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "db", "sortir.db");
const PHOTOS_PER_CATEGORY = 40; // Pexels autorise jusqu'à 80 par requête — on vise large pour éviter la répétition

// Termes de recherche en anglais (l'index Pexels y est bien plus riche
// qu'en français) choisis pour évoquer l'ambiance de chaque catégorie.
const CATEGORY_QUERY = {
  concert: "live concert crowd",
  soiree: "nightclub party lights",
  spectacle: "theater stage performance",
  sport: "sports stadium crowd",
  expo: "art exhibition gallery",
  musee: "museum interior",
  popup: "pop-up store fashion",
  mode: "fashion runway show",
  insolite: "unusual experience atmosphere",
  tech: "gaming esports neon",
  bienetre: "yoga wellness sunrise",
  gastronomie: "food festival market",
  cinema: "outdoor cinema night",
  famille: "family fun outdoor",
  ateliers: "craft workshop hands",
  love: "romantic couple date",
};

async function fetchCategoryPhotos(query, apiKey) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${PHOTOS_PER_CATEGORY}&orientation=landscape`;
  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Pexels a répondu ${res.status} : ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.photos || []).map(p => p.src.large);
}

async function runFetchPhotos(force = false) {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) throw new Error("PEXELS_API_KEY manquant.");

  const db = new Database(DB_PATH);
  const results = { categories: {}, updated: 0, errors: [] };

  try {
    for (const [categoryId, query] of Object.entries(CATEGORY_QUERY)) {
      const events = force
        ? db.prepare(`SELECT id FROM events WHERE category_id = ?`).all(categoryId)
        : db.prepare(`SELECT id FROM events WHERE category_id = ? AND (cover_image_url IS NULL OR cover_image_url = '')`).all(categoryId);
      if (events.length === 0) { results.categories[categoryId] = { photos: 0, updated: 0 }; continue; }

      let photos = [];
      try {
        photos = await fetchCategoryPhotos(query, apiKey);
      } catch (err) {
        results.errors.push(`${categoryId}: ${err.message}`);
        continue;
      }
      if (photos.length === 0) { results.categories[categoryId] = { photos: 0, updated: 0 }; continue; }

      const update = db.prepare(`UPDATE events SET cover_image_url = ? WHERE id = ?`);
      events.forEach((ev, i) => {
        update.run(photos[i % photos.length], ev.id);
        results.updated++;
      });
      results.categories[categoryId] = { photos: photos.length, updated: events.length };
    }
    return results;
  } finally {
    db.close();
  }
}

module.exports = { runFetchPhotos };

if (require.main === module) {
  const force = process.argv.includes("--force");
  runFetchPhotos(force)
    .then(r => console.log(JSON.stringify(r, null, 2)))
    .catch(err => { console.error("❌", err.message); process.exit(1); });
}
