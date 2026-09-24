const jwt = require("jsonwebtoken");

function getSecret() {
  return process.env.JWT_SECRET || "development-only-change-me";
}

function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const cookieToken = (req.headers.cookie || "").split(";").map(value => value.trim())
    .find(value => value.startsWith("cafe_token="))?.slice("cafe_token=".length);
  const token = header.startsWith("Bearer ") ? header.slice(7) : cookieToken;

  if (!token) return res.status(401).json({ error: "authentication required" });

  try {
    req.user = jwt.verify(token, getSecret());
    next();
  } catch (_) {
    res.status(401).json({ error: "invalid or expired token" });
  }
}

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "insufficient permissions" });
    }
    next();
  };
}

module.exports = { authenticate, allowRoles, getSecret };
