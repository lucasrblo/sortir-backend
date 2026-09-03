// Relance automatiquement tous les imports de données à intervalle
// régulier, pour que le catalogue s'enrichisse tout seul sans jamais avoir
// à cliquer sur les routes d'admin manuellement.
//
// Chaque source est indépendante : si l'une échoue (clé API manquante,
// service temporairement indisponible...), les autres continuent quand
// même. Tout est journalisé dans les logs Railway (onglet "Deployments" →
// "View Logs") pour pouvoir suivre ce qui se passe.

const INTERVAL_HOURS = 6;
const DELAY_BEFORE_FIRST_RUN_MS = 60 * 1000; // on laisse le serveur finir de démarrer avant le premier passage

async function runSource(name, fn) {
  const startedAt = new Date().toISOString();
  try {
    const result = await fn();
    console.log(`[auto-import ${startedAt}] ${name} — OK :`, JSON.stringify(result));
  } catch (err) {
    console.log(`[auto-import ${startedAt}] ${name} — échec (pas bloquant) : ${err.message}`);
  }
}

async function runAllSources() {
  console.log(`[auto-import] Passage automatique démarré — ${new Date().toISOString()}`);

  await runSource("ticketmaster", async () => {
    const { runImport } = require("../scripts/import-ticketmaster");
    return runImport("Paris");
  });

  await runSource("predicthq", async () => {
    const { runImport } = require("../scripts/import-predicthq");
    return runImport(); // valeurs par défaut = France entière
  });

  await runSource("paris-opendata", async () => {
    const { runImport } = require("../scripts/import-paris-opendata");
    return runImport();
  });

  await runSource("idf-opendata", async () => {
    const { runImport } = require("../scripts/import-idf-opendata");
    return runImport(); // reprend automatiquement où il s'était arrêté
  });

  await runSource("sports-fr", async () => {
    const { runImport } = require("../scripts/import-sports-fr");
    return runImport();
  });

  await runSource("fetch-photos", async () => {
    const { runFetchPhotos } = require("../scripts/fetch-photos");
    return runFetchPhotos(); // seulement les événements sans photo — pas de gaspillage d'appels
  });

  console.log(`[auto-import] Passage terminé — prochain dans ${INTERVAL_HOURS}h.`);
}

function startScheduler() {
  setTimeout(() => {
    runAllSources();
    setInterval(runAllSources, INTERVAL_HOURS * 60 * 60 * 1000);
  }, DELAY_BEFORE_FIRST_RUN_MS);
  console.log(`[auto-import] Planificateur activé — un passage toutes les ${INTERVAL_HOURS}h, premier passage dans 1 min.`);
}

module.exports = { startScheduler };
