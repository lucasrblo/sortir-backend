// Contrairement à seed.js (qui EFFACE et recrée toujours tout, utile en
// développement), ce script ne touche à rien si la base existe déjà —
// c'est lui qu'on lance au démarrage du serveur en production, pour que
// les événements importés (Ticketmaster, PredictHQ...), les favoris et
// les avis des utilisateurs survivent aux redémarrages/redéploiements.
//
// Pour repartir de zéro volontairement, utilise `npm run seed` à la place.

const path = require("path");
const fs = require("fs");

const DB_PATH = path.join(__dirname, "sortir.db");

if (fs.existsSync(DB_PATH)) {
  console.log("Base existante trouvée — aucune réinitialisation (les données importées sont conservées).");
  process.exit(0);
}

console.log("Aucune base trouvée — première initialisation avec les données de démo...");
require("./seed.js");
