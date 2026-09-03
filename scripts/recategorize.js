// Repasse sur les événements déjà en base, catégorisés "insolite" (le
// repli par défaut), et tente de les reclasser correctement via
// détection de mots-clés — pour que le correctif profite aussi à ce qui
// a déjà été importé, pas seulement aux prochains imports.
//
// Usage : node scripts/recategorize.js

const path = require("path");
const Database = require("better-sqlite3");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "db", "sortir.db");

const KEYWORD_OVERRIDES = [
  { cat: "cinema", words: ["cinéma", "cinema", "ciné-concert", "projection", "film en plein air"] },
  { cat: "mode", words: ["mode", "fashion", "défilé", "créateurs de mode"] },
  { cat: "love", words: ["speed dating", "célibataire", "rencontre amoureuse", "soirée coquine"] },
  { cat: "popup", words: ["pop-up", "vide-dressing", "vide dressing", "marché aux puces", "brocante"] },
  { cat: "bienetre", words: ["yoga", "méditation", "bien-être", "bien etre", "sophrologie"] },
  { cat: "famille", words: ["famille", "jeune public", "enfants", "kids"] },
  { cat: "gastronomie", words: ["dégustation", "marché gourmand", "food festival", "gastronomie", "vin", "cuisine"] },
];
function detectCategory(title, description) {
  const text = `${title || ""} ${description || ""}`.toLowerCase();
  for (const rule of KEYWORD_OVERRIDES) {
    if (rule.words.some(w => text.includes(w))) return rule.cat;
  }
  return null;
}

async function runImport() {
  const db = new Database(DB_PATH);
  try {
    const candidates = db.prepare(
      `SELECT id, title, description FROM events WHERE category_id = 'insolite'`
    ).all();

    const update = db.prepare(`UPDATE events SET category_id = ? WHERE id = ?`);
    const byCategory = {};
    let reclassified = 0;

    for (const ev of candidates) {
      const newCat = detectCategory(ev.title, ev.description);
      if (newCat) {
        update.run(newCat, ev.id);
        byCategory[newCat] = (byCategory[newCat] || 0) + 1;
        reclassified++;
      }
    }

    console.log(`Terminé — ${reclassified} événement(s) reclassé(s) sur ${candidates.length} passés en revue.`);
    return { scanned: candidates.length, reclassified, byCategory };
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
