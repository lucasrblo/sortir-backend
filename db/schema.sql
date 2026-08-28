-- Schéma de démo (SQLite) — équivalent simplifié du schéma PostgreSQL + PostGIS
-- décrit dans specs-techniques-mvp.md. Ici, lat/lng sont de simples colonnes
-- numériques et la distance est calculée côté application (Haversine),
-- exactement comme le faisait le prototype front-end.

DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS favorites;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS venues;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_emoji  TEXT DEFAULT '🦊',
  bio           TEXT DEFAULT '',
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE categories (
  id    TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  emoji TEXT NOT NULL
);

CREATE TABLE venues (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  name    TEXT NOT NULL,
  city    TEXT NOT NULL,
  lat     REAL NOT NULL,
  lng     REAL NOT NULL
);

CREATE TABLE events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  description     TEXT,
  category_id     TEXT NOT NULL REFERENCES categories(id),
  venue_id        INTEGER NOT NULL REFERENCES venues(id),
  date_start      TEXT NOT NULL,   -- format YYYY-MM-DD
  date_end        TEXT NOT NULL,
  time_label      TEXT,
  price_min       REAL DEFAULT 0,
  price_max       REAL,
  cover_image_url TEXT,
  source          TEXT DEFAULT 'manuel',  -- 'manuel' | 'ticketmaster' | 'predicthq' | ...
  external_id     TEXT,                    -- id chez la source, pour éviter les doublons
  rating_avg      REAL DEFAULT 0,
  vibe_tags       TEXT DEFAULT '',  -- ex. "solo,couple,amis"
  UNIQUE (source, external_id)
);
CREATE INDEX events_source_idx ON events(source, external_id);

CREATE TABLE favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  event_id   INTEGER NOT NULL REFERENCES events(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, event_id)
);

CREATE TABLE reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL REFERENCES events(id),
  user_id    INTEGER REFERENCES users(id),
  user_name  TEXT NOT NULL,
  rating     INTEGER NOT NULL,
  text       TEXT NOT NULL,
  photo_url  TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX events_category_idx ON events(category_id);
CREATE INDEX events_dates_idx ON events(date_start, date_end);
CREATE INDEX favorites_user_idx ON favorites(user_id);
CREATE INDEX reviews_event_idx ON reviews(event_id);
