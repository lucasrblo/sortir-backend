const path = require("path");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const { signToken, requireAuth, optionalAuth } = require("./auth");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "db", "sortir.db");
const db = new Database(DB_PATH, { readonly: false });

const app = express();
app.use(cors());
app.use(express.json());

// Distance à vol d'oiseau (km) — équivalent JS de ST_Distance en PostGIS,
// utilisé ici faute d'extension géospatiale disponible en SQLite.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * GET /events
 * Query params (tous optionnels) :
 *   category    - slug de catégorie (ex. "concert")
 *   date        - YYYY-MM-DD, filtre les événements actifs ce jour-là
 *   price_max   - nombre
 *   rating_min  - nombre (0-5)
 *   lat, lng    - position de l'utilisateur (active le calcul de distance)
 *   radius_km   - rayon max si lat/lng fournis
 *   sort        - "date" (défaut) | "price" | "rating" | "distance"
 */
app.get("/events", (req, res) => {
  const { category, date, price_max, rating_min, lat, lng, radius_km, sort, limit } = req.query;

  let sql = `
    SELECT e.id, e.title, e.description, e.date_start, e.date_end, e.time_label,
           e.price_min, e.price_max, e.cover_image_url, e.rating_avg, e.vibe_tags,
           c.id as category_id, c.label as category_label,
           v.name as venue_name, v.city as venue_city, v.lat as venue_lat, v.lng as venue_lng
    FROM events e
    JOIN categories c ON c.id = e.category_id
    JOIN venues v ON v.id = e.venue_id
    WHERE 1=1
  `;
  const params = {};

  if (category) {
    sql += " AND e.category_id = @category";
    params.category = category;
  }
  if (date) {
    sql += " AND @date BETWEEN e.date_start AND e.date_end";
    params.date = date;
  } else {
    // Par défaut (aucune date précise demandée), on n'affiche que ce qui n'est
    // pas déjà terminé — avec un catalogue de plusieurs milliers d'événements,
    // il n'y a aucune raison de renvoyer ceux du mois dernier.
    sql += " AND e.date_end >= @today";
    params.today = new Date().toISOString().slice(0, 10);
  }
  if (price_max !== undefined) {
    sql += " AND e.price_min <= @price_max";
    params.price_max = Number(price_max);
  }
  if (rating_min !== undefined) {
    sql += " AND e.rating_avg >= @rating_min";
    params.rating_min = Number(rating_min);
  }

  let rows = db.prepare(sql).all(params);

  // Distance : calculée en JS (en Postgres/PostGIS ce serait fait en SQL, voir specs-techniques-mvp.md)
  const userLat = lat !== undefined ? Number(lat) : null;
  const userLng = lng !== undefined ? Number(lng) : null;
  if (userLat !== null && userLng !== null) {
    rows = rows.map(r => ({
      ...r,
      distance_km: Math.round(haversineKm(userLat, userLng, r.venue_lat, r.venue_lng) * 10) / 10,
    }));
    if (radius_km !== undefined) {
      rows = rows.filter(r => r.distance_km <= Number(radius_km));
    }
  }

  // Tri
  if (sort === "price") {
    rows.sort((a, b) => a.price_min - b.price_min);
  } else if (sort === "rating") {
    rows.sort((a, b) => b.rating_avg - a.rating_avg);
  } else if (sort === "distance" && userLat !== null) {
    rows.sort((a, b) => a.distance_km - b.distance_km);
  } else {
    rows.sort((a, b) => a.date_start.localeCompare(b.date_start));
  }

  // Pagination : par défaut 300 événements (largement assez pour remplir
  // l'app sans ralentir son ouverture), plafonné à 1000 même si demandé plus.
  const totalMatching = rows.length;
  const effectiveLimit = Math.min(Number(limit) || 300, 1000);
  rows = rows.slice(0, effectiveLimit);

  const events = rows.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    category: { id: r.category_id, label: r.category_label },
    venue: { name: r.venue_name, city: r.venue_city, lat: r.venue_lat, lng: r.venue_lng },
    date_start: r.date_start,
    date_end: r.date_end,
    time_label: r.time_label,
    price_min: r.price_min,
    price_max: r.price_max,
    cover_image_url: r.cover_image_url,
    rating_avg: r.rating_avg,
    vibe_tags: r.vibe_tags ? r.vibe_tags.split(",") : [],
    distance_km: r.distance_km ?? null,
  }));

  res.json({ events, total: events.length, total_matching: totalMatching });
});

// GET /events/:id — détail complet, avec les avis
app.get("/events/:id", (req, res) => {
  const event = db.prepare(`
    SELECT e.*, c.label as category_label, v.name as venue_name, v.city as venue_city, v.lat as venue_lat, v.lng as venue_lng
    FROM events e
    JOIN categories c ON c.id = e.category_id
    JOIN venues v ON v.id = e.venue_id
    WHERE e.id = ?
  `).get(req.params.id);

  if (!event) return res.status(404).json({ error: "Événement introuvable" });

  const reviews = db.prepare("SELECT user_name, rating, text, photo_url, created_at FROM reviews WHERE event_id = ? ORDER BY created_at DESC").all(req.params.id);

  res.json({
    id: event.id,
    title: event.title,
    description: event.description,
    category: { id: event.category_id, label: event.category_label },
    venue: { name: event.venue_name, city: event.venue_city, lat: event.venue_lat, lng: event.venue_lng },
    date_start: event.date_start,
    date_end: event.date_end,
    time_label: event.time_label,
    price_min: event.price_min,
    price_max: event.price_max,
    cover_image_url: event.cover_image_url,
    rating_avg: event.rating_avg,
    vibe_tags: event.vibe_tags ? event.vibe_tags.split(",") : [],
    reviews,
  });
});

// GET /categories — utile pour construire les chips côté app sans les coder en dur
app.get("/categories", (req, res) => {
  res.json(db.prepare("SELECT * FROM categories").all());
});

// ============================================================
// Comptes utilisateurs
// ============================================================

// POST /auth/signup — { username, email, password }
app.post("/auth/signup", (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: "username, email et password sont requis" });
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return res.status(409).json({ error: "Un compte existe déjà avec cet email" });

  const password_hash = bcrypt.hashSync(password, 10);
  const info = db.prepare(
    "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)"
  ).run(username, email, password_hash);

  const user = { id: info.lastInsertRowid, username };
  res.status(201).json({ token: signToken(user), user: { id: user.id, username, email, avatar_emoji: "🦊", bio: "" } });
});

// POST /auth/login — { email, password }
app.post("/auth/login", (req, res) => {
  const { email, password } = req.body;
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!row || !bcrypt.compareSync(password || "", row.password_hash)) {
    return res.status(401).json({ error: "Email ou mot de passe incorrect" });
  }
  res.json({
    token: signToken(row),
    user: { id: row.id, username: row.username, email: row.email, avatar_emoji: row.avatar_emoji, bio: row.bio },
  });
});

// GET /me — profil de l'utilisateur connecté
app.get("/me", requireAuth, (req, res) => {
  const row = db.prepare("SELECT id, username, email, avatar_emoji, bio, created_at FROM users WHERE id = ?").get(req.userId);
  if (!row) return res.status(404).json({ error: "Utilisateur introuvable" });
  res.json(row);
});

// PATCH /me — { username?, bio?, avatar_emoji? }
app.patch("/me", requireAuth, (req, res) => {
  const { username, bio, avatar_emoji } = req.body;
  const current = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  db.prepare("UPDATE users SET username = ?, bio = ?, avatar_emoji = ? WHERE id = ?").run(
    username ?? current.username,
    bio ?? current.bio,
    avatar_emoji ?? current.avatar_emoji,
    req.userId
  );
  res.json(db.prepare("SELECT id, username, email, avatar_emoji, bio FROM users WHERE id = ?").get(req.userId));
});

// ============================================================
// Favoris
// ============================================================

// POST /events/:id/favorite — ajoute aux favoris (idempotent)
app.post("/events/:id/favorite", requireAuth, (req, res) => {
  const event = db.prepare("SELECT id FROM events WHERE id = ?").get(req.params.id);
  if (!event) return res.status(404).json({ error: "Événement introuvable" });
  db.prepare("INSERT OR IGNORE INTO favorites (user_id, event_id) VALUES (?, ?)").run(req.userId, req.params.id);
  res.status(204).end();
});

// DELETE /events/:id/favorite — retire des favoris
app.delete("/events/:id/favorite", requireAuth, (req, res) => {
  db.prepare("DELETE FROM favorites WHERE user_id = ? AND event_id = ?").run(req.userId, req.params.id);
  res.status(204).end();
});

// GET /me/favorites — liste des événements favoris de l'utilisateur
app.get("/me/favorites", requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.title, e.date_start, e.time_label, e.price_min,
           c.label as category_label, v.name as venue_name
    FROM favorites f
    JOIN events e ON e.id = f.event_id
    JOIN categories c ON c.id = e.category_id
    JOIN venues v ON v.id = e.venue_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).all(req.userId);
  res.json({ favorites: rows });
});

// ============================================================
// Avis (avec photo optionnelle — l'app enverrait ici une URL déjà
// uploadée sur Cloudinary/S3, jamais l'image elle-même en base64)
// ============================================================

// POST /events/:id/reviews — { rating, text, photo_url? }
app.post("/events/:id/reviews", requireAuth, (req, res) => {
  const { rating, text, photo_url } = req.body;
  if (!rating || !text) return res.status(400).json({ error: "rating et text sont requis" });

  const event = db.prepare("SELECT id FROM events WHERE id = ?").get(req.params.id);
  if (!event) return res.status(404).json({ error: "Événement introuvable" });

  const user = db.prepare("SELECT username FROM users WHERE id = ?").get(req.userId);
  db.prepare(
    "INSERT INTO reviews (event_id, user_id, user_name, rating, text, photo_url) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(req.params.id, req.userId, user.username, rating, text, photo_url || null);

  // Recalcule la note moyenne de l'événement
  const avg = db.prepare("SELECT AVG(rating) as avg FROM reviews WHERE event_id = ?").get(req.params.id).avg;
  db.prepare("UPDATE events SET rating_avg = ? WHERE id = ?").run(Math.round(avg * 10) / 10, req.params.id);

  res.status(201).json({ ok: true });
});

// ============================================================
// Import de données réelles (Ticketmaster, PredictHQ) — déclenché
// via une route plutôt que par un script séparé, pour être certain
// que l'import s'exécute dans CE processus, celui qui a réellement
// le volume persistant monté (contrairement à une session Console,
// qui tourne dans un conteneur à part).
//
// Protégé par une clé simple (ADMIN_KEY) passée en paramètre d'URL —
// suffisant pour un usage interne/développement, mais à durcir
// (header + vraie auth) avant un usage public.
// ============================================================
function requireAdminKey(req, res, next) {
  const key = req.query.key;
  if (!process.env.ADMIN_KEY) return res.status(503).json({ error: "ADMIN_KEY non configuré sur le serveur" });
  if (key !== process.env.ADMIN_KEY) return res.status(401).json({ error: "Clé admin invalide" });
  next();
}

app.get("/admin/import/ticketmaster", requireAdminKey, async (req, res) => {
  try {
    const { runImport } = require("../scripts/import-ticketmaster");
    const result = await runImport(req.query.city || "Paris");
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/admin/import/predicthq", requireAdminKey, async (req, res) => {
  try {
    const { runImport } = require("../scripts/import-predicthq");
    const lat = parseFloat(req.query.lat) || 48.8566;
    const lng = parseFloat(req.query.lng) || 2.3522;
    const radiusKm = parseInt(req.query.radius_km, 10) || 15;
    const result = await runImport(lat, lng, radiusKm);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/admin/fetch-photos", requireAdminKey, async (req, res) => {
  try {
    const { runFetchPhotos } = require("../scripts/fetch-photos");
    const force = req.query.force === "1";
    const result = await runFetchPhotos(force);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/admin/import/paris-opendata", requireAdminKey, async (req, res) => {
  try {
    const { runImport } = require("../scripts/import-paris-opendata");
    const result = await runImport();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sortir API démarrée sur http://localhost:${PORT}`);
  console.log(`Essaie : http://localhost:${PORT}/events?category=concert&sort=price`);
});
