// Contrairement à seed.js (qui EFFACE et recrée toujours tout, utile en
// développement), ce script ne touche à rien si la base existe déjà —
// c'est lui qu'on lance au démarrage du serveur en production, pour que
// les événements importés (Ticketmaster, PredictHQ...), les favoris et
// les avis des utilisateurs survivent aux redémarrages/redéploiements.
//
// Pour repartir de zéro volontairement, utilise `npm run seed` à la place.

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { runMigrations } = require("./migrate.js");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "sortir.db");

if (fs.existsSync(DB_PATH)) {
  console.log("Base existante trouvée — vérification du schéma (les données importées sont conservées)...");
  const db = new Database(DB_PATH);
  runMigrations(db);
  db.close();
  process.exit(0);
}

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
console.log("Aucune base trouvée — première initialisation avec les données de démo...");
require("./seed.js");
