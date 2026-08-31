// Applique les évolutions de schéma qui ont eu lieu depuis la création
// initiale de la base, SANS jamais effacer ou toucher aux données déjà là.
// Chaque migration vérifie elle-même si elle est nécessaire avant d'agir
// (idempotent) — on peut relancer ce script autant de fois que voulu sans
// risque.
//
// Pour ajouter une évolution de schéma à l'avenir : ajoute une entrée à la
// liste MIGRATIONS ci-dessous, elle sera appliquée automatiquement au
// prochain démarrage du serveur.

function columnExists(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}
function tableExists(db, table) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
}

const MIGRATIONS = [
  {
    name: "events.price_max / cover_image_url / source / external_id",
    needed: db => !columnExists(db, "events", "source"),
    apply: db => {
      db.exec(`
        ALTER TABLE events ADD COLUMN price_max REAL;
        ALTER TABLE events ADD COLUMN cover_image_url TEXT;
        ALTER TABLE events ADD COLUMN source TEXT DEFAULT 'manuel';
        ALTER TABLE events ADD COLUMN external_id TEXT;
      `);
    },
  },
  {
    name: "events.ticket_url",
    needed: db => !columnExists(db, "events", "ticket_url"),
    apply: db => db.exec(`ALTER TABLE events ADD COLUMN ticket_url TEXT;`),
  },
  {
    name: "ticket_clicks table",
    needed: db => !tableExists(db, "ticket_clicks"),
    apply: db => db.exec(`
      CREATE TABLE ticket_clicks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id    INTEGER NOT NULL REFERENCES events(id),
        clicked_at  TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `),
  },
  {
    name: "import_cursor table",
    needed: db => !tableExists(db, "import_cursor"),
    apply: db => db.exec(`
      CREATE TABLE import_cursor (
        source      TEXT PRIMARY KEY,
        next_offset INTEGER DEFAULT 0
      );
    `),
  },
];

function runMigrations(db) {
  let applied = 0;
  for (const migration of MIGRATIONS) {
    if (migration.needed(db)) {
      console.log(`Migration : ${migration.name}...`);
      migration.apply(db);
      applied++;
    }
  }
  if (applied > 0) console.log(`${applied} migration(s) appliquée(s).`);
  else console.log("Schéma déjà à jour, aucune migration nécessaire.");
  return applied;
}

module.exports = { runMigrations };
