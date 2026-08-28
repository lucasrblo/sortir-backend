// Peuple la base SQLite locale avec les mêmes catégories/lieux/événements
// que ceux utilisés dans le prototype front-end (city-events-prototype.html),
// pour qu'on puisse comparer les deux facilement.

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "sortir.db");
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const db = new Database(DB_PATH);
db.exec(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));

// Utilisateur de démo, pour tester login/favoris/avis sans repartir de zéro.
// Identifiants : lucas@example.com / password123
const insertUser = db.prepare(
  "INSERT INTO users (username, email, password_hash, avatar_emoji, bio) VALUES (?, ?, ?, ?, ?)"
);
insertUser.run("Lucas", "lucas@example.com", bcrypt.hashSync("password123", 10), "🦊", "Toujours partant pour découvrir un nouveau spot.");

const CATEGORIES = [
  { id: "concert", label: "🎵 Concerts", emoji: "🎵" },
  { id: "soiree", label: "🌙 Soirées", emoji: "🌙" },
  { id: "spectacle", label: "🎭 Spectacles", emoji: "🎭" },
  { id: "sport", label: "⚽ Sport", emoji: "⚽" },
  { id: "expo", label: "🖼 Expos", emoji: "🖼" },
  { id: "musee", label: "🏛 Musées", emoji: "🏛" },
  { id: "popup", label: "🛍 Pop-up", emoji: "🛍" },
  { id: "mode", label: "👗 Mode/Défilé", emoji: "👗" },
  { id: "insolite", label: "✨ Insolite", emoji: "✨" },
  { id: "tech", label: "🎮 Tech/Gaming", emoji: "🎮" },
  { id: "bienetre", label: "🧘 Bien-être", emoji: "🧘" },
  { id: "gastronomie", label: "🍽 Gastronomie", emoji: "🍽" },
  { id: "cinema", label: "🎬 Cinéma", emoji: "🎬" },
  { id: "famille", label: "👨‍👩‍👧 Famille", emoji: "👨‍👩‍👧" },
  { id: "ateliers", label: "🛠 Ateliers", emoji: "🛠" },
  { id: "love", label: "💘 Love", emoji: "💘" },
];

const insertCat = db.prepare("INSERT INTO categories (id, label, emoji) VALUES (?, ?, ?)");
CATEGORIES.forEach(c => insertCat.run(c.id, c.label, c.emoji));

const insertVenue = db.prepare("INSERT INTO venues (name, city, lat, lng) VALUES (?, ?, ?, ?)");
const insertEvent = db.prepare(`
  INSERT INTO events (title, description, category_id, venue_id, date_start, date_end, time_label, price_min, rating_avg, vibe_tags)
  VALUES (@title, @description, @category_id, @venue_id, @date_start, @date_end, @time_label, @price_min, @rating_avg, @vibe_tags)
`);
const insertReview = db.prepare(`
  INSERT INTO reviews (event_id, user_name, rating, text) VALUES (?, ?, ?, ?)
`);

function venue(name, city, lat, lng) {
  const info = insertVenue.run(name, city, lat, lng);
  return info.lastInsertRowid;
}

const EVENTS = [
  {
    title: "Fauve Nocturne — Tournée Corps Chaud", category_id: "concert",
    venue: venue("La Cigale", "Paris", 48.8823, 2.3413),
    date_start: "2026-08-18", date_end: "2026-08-18", time_label: "20H30", price_min: 32,
    rating_avg: 4.6, vibe_tags: "amis,solo",
    description: "Retour tant attendu du groupe sur scène parisienne, tourné autour de leur dernier album.",
    reviews: [["Inès", 5, "Son impeccable, salle en fusion du premier au dernier titre."]]
  },
  {
    title: "Session Acoustique — Bar Le Perchoir", category_id: "concert",
    venue: venue("Le Perchoir", "Paris", 48.8686, 2.3907),
    date_start: "2026-08-19", date_end: "2026-08-19", time_label: "19H00", price_min: 10,
    rating_avg: 4.5, vibe_tags: "solo,couple",
    description: "Petite jauge, gros son : trois artistes émergents en rooftop.",
    reviews: [["Nora", 5, "Cadre parfait pour découvrir de nouveaux artistes."]]
  },
  {
    title: "Neon Garden — Open Air Terrasse", category_id: "soiree",
    venue: venue("Wanderlust", "Paris", 48.8329, 2.3736),
    date_start: "2026-08-18", date_end: "2026-08-18", time_label: "23H00", price_min: 15,
    rating_avg: 4.3, vibe_tags: "amis,rencontre",
    description: "Soirée électro en plein air sur les quais, line-up house/techno jusqu'au bout de la nuit.",
    reviews: [["Léa", 4, "Cadre magnifique, très bonne ambiance en début de soirée."]]
  },
  {
    title: "Lumières Fractales — Exposition immersive", category_id: "expo",
    venue: venue("Atelier des Lumières", "Paris", 48.8625, 2.3796),
    date_start: "2026-08-10", date_end: "2026-08-30", time_label: "10H–19H", price_min: 18,
    rating_avg: 4.8, vibe_tags: "couple,solo,amis",
    description: "Un parcours visuel à 360° mêlant art génératif et musique live.",
    reviews: [["Marc", 5, "Visuellement bluffant, on en prend plein les yeux."]]
  },
  {
    title: "Speed Dating Estival — 8 rendez-vous, 4 minutes chacun", category_id: "love",
    venue: venue("Rooftop Sunset Bar", "Paris", 48.8670, 2.3610),
    date_start: "2026-08-20", date_end: "2026-08-20", time_label: "19H30", price_min: 22,
    rating_avg: 4.3, vibe_tags: "rencontre,solo",
    description: "Huit rendez-vous éclair de quatre minutes autour d'un verre, en terrasse.",
    reviews: [["Pauline", 4, "Format sympa, bien organisé, on ne voit pas le temps passer."]]
  },
  {
    title: "LAN Party Rétro — Nuit Gaming", category_id: "tech",
    venue: venue("Cyber Arena", "Paris", 48.8480, 2.5450),
    date_start: "2026-08-18", date_end: "2026-08-18", time_label: "19H00", price_min: 18,
    rating_avg: 4.4, vibe_tags: "solo,amis",
    description: "Tournois sur bornes rétro et setups modernes, cash prize à la clé.",
    reviews: [["Enzo", 4, "Super organisation, bon mix rétro/moderne."]]
  },
];

EVENTS.forEach(e => {
  const info = insertEvent.run({
    title: e.title,
    description: e.description,
    category_id: e.category_id,
    venue_id: e.venue,
    date_start: e.date_start,
    date_end: e.date_end,
    time_label: e.time_label,
    price_min: e.price_min,
    rating_avg: e.rating_avg,
    vibe_tags: e.vibe_tags,
  });
  e.reviews.forEach(([name, rating, text]) => insertReview.run(info.lastInsertRowid, name, rating, text));
});

console.log(`Seed terminé : ${CATEGORIES.length} catégories, ${EVENTS.length} événements insérés dans ${DB_PATH}`);
db.close();
