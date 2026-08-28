# Sortir — Backend de démo

Serveur qui prouve que l'architecture décrite dans `specs-techniques-mvp.md`
fonctionne réellement : comptes utilisateurs, événements filtrables, favoris,
et avis (avec photo) — tout testé de bout en bout.

C'est une version simplifiée pour tester vite : **SQLite** au lieu de
PostgreSQL/PostGIS (pas besoin d'installer un serveur de base de données),
et la distance est calculée en JavaScript (formule de Haversine) au lieu
d'une vraie requête géospatiale. La logique et la forme des données restent
les mêmes — c'est la même API qu'on brancherait sur Postgres plus tard.

## Installation

Il faut [Node.js](https://nodejs.org) installé (version 18 ou plus récente).

```bash
cd sortir-backend
npm install
npm run seed      # crée et remplit la base db/sortir.db
npm start         # démarre le serveur sur http://localhost:3000
```

Un compte de démo est créé automatiquement par le seed :
**email `lucas@example.com`, mot de passe `password123`**.

## Tester

### Sans authentification
```
GET  http://localhost:3000/events
GET  http://localhost:3000/events?category=concert&sort=price
GET  http://localhost:3000/events?lat=48.8430&lng=2.5520&radius_km=20&sort=distance
GET  http://localhost:3000/events/1
GET  http://localhost:3000/categories
```

### Avec authentification (JWT)
```bash
# 1. Se connecter et récupérer un token
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"lucas@example.com","password":"password123"}'

# 2. Utiliser le token pour les routes protégées
curl http://localhost:3000/me -H "Authorization: Bearer <TOKEN>"
curl -X POST http://localhost:3000/events/1/favorite -H "Authorization: Bearer <TOKEN>"
curl http://localhost:3000/me/favorites -H "Authorization: Bearer <TOKEN>"
curl -X POST http://localhost:3000/events/1/reviews \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"rating":5,"text":"Super soirée !","photo_url":"https://..."}'
```

## Structure

```
sortir-backend/
  db/
    schema.sql     → structure des tables (users, events, favorites, reviews...)
    seed.js        → remplit la base + crée le compte de démo
    sortir.db      → généré par `npm run seed` (pas versionné)
  src/
    auth.js        → signature/vérification des tokens JWT
    server.js       → le serveur Express et toutes les routes
  package.json
```

## Endpoints disponibles

| Méthode | Route | Auth | Description |
|---|---|---|---|
| GET | `/events` | non | Liste filtrée (catégorie, date, prix, note, distance, tri) |
| GET | `/events/:id` | non | Détail + avis |
| GET | `/categories` | non | Liste des catégories |
| POST | `/auth/signup` | non | Créer un compte |
| POST | `/auth/login` | non | Se connecter |
| GET | `/me` | oui | Profil de l'utilisateur connecté |
| PATCH | `/me` | oui | Modifier username/bio/avatar |
| POST | `/events/:id/favorite` | oui | Ajouter aux favoris |
| DELETE | `/events/:id/favorite` | oui | Retirer des favoris |
| GET | `/me/favorites` | oui | Liste des favoris |
| POST | `/events/:id/reviews` | oui | Poster un avis (recalcule la note moyenne) |

## Prochaine étape

1. Migration vers PostgreSQL + PostGIS pour la vraie distance géospatiale
2. Premier job d'import automatique depuis l'API Ticketmaster
3. Upload de photos (avatar, avis) vers Cloudinary/S3 plutôt qu'une simple URL passée à la main
4. Endpoints pour masquer une activité/catégorie (`hidden_preferences`) et les préférences de notifications
