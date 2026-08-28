const jwt = require("jsonwebtoken");

// Le secret vient obligatoirement d'une variable d'environnement — jamais
// codé en dur. En local (npm run dev), une valeur de secours est utilisée
// pour ne pas bloquer le développement ; en production (Railway), la vraie
// variable JWT_SECRET doit être définie dans les paramètres du projet.
const JWT_SECRET = process.env.JWT_SECRET || "sortir-dev-secret-local-uniquement";
if (!process.env.JWT_SECRET) {
  console.warn("⚠️  JWT_SECRET non défini — valeur de secours utilisée (OK en local, à corriger en production).");
}

function signToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, JWT_SECRET, { expiresIn: "30d" });
}

// Middleware : exige un token valide (Authorization: Bearer <token>).
// Rejette la requête avec 401 si absent ou invalide.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Authentification requise" });
  try {
    req.userId = jwt.verify(token, JWT_SECRET).sub;
    next();
  } catch {
    res.status(401).json({ error: "Token invalide ou expiré" });
  }
}

// Middleware : lit le token s'il existe mais n'exige rien (utile pour des routes
// publiques qui se comportent différemment si l'utilisateur est connecté).
function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (token) {
    try { req.userId = jwt.verify(token, JWT_SECRET).sub; } catch { /* ignoré */ }
  }
  next();
}

module.exports = { signToken, requireAuth, optionalAuth };
