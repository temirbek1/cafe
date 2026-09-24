const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { authenticate, allowRoles, getSecret } = require("../middleware/auth");

const router = express.Router();
const roles = new Set(["admin", "manager", "cashier", "waiter"]);

function sessionCookie(res, token) {
  res.cookie("cafe_token", token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000, path: "/"
  });
}

function publicUser(user) {
  return { id: user.id, name: user.name, login: user.login, role: user.role };
}

// The first account bootstraps a new installation. Every later account needs an admin token.
router.post("/register", async (req, res, next) => {
  try {
    const { name, login, password, role = "waiter" } = req.body || {};
    if (!name || !login || typeof password !== "string" || password.length < 8 || !roles.has(role)) {
      return res.status(400).json({ error: "name, login, valid role and password (8+ chars) are required" });
    }

    const count = await pool.query("SELECT COUNT(*)::int AS count FROM users");
    if (count.rows[0].count > 0) {
      const header = req.headers.authorization || "";
      if (!header.startsWith("Bearer ")) return res.status(401).json({ error: "admin authentication required" });
      let actor;
      try { actor = jwt.verify(header.slice(7), getSecret()); } catch (_) { return res.status(401).json({ error: "invalid token" }); }
      if (actor.role !== "admin") return res.status(403).json({ error: "admin role required" });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users (name, login, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, login, role",
      [name.trim(), login.trim().toLowerCase(), hash, role]
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "login already exists" });
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { login, password } = req.body || {};
    if (!login || typeof password !== "string") return res.status(400).json({ error: "login and password are required" });
    const result = await pool.query("SELECT * FROM users WHERE login = $1 AND active = TRUE", [login.trim().toLowerCase()]);
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: "invalid login or password" });
    }
    const safeUser = publicUser(user);
    const token = jwt.sign(safeUser, getSecret(), { expiresIn: "8h" });
    sessionCookie(res, token);
    res.json({ token, user: safeUser });
  } catch (err) {
    next(err);
  }
});

router.get("/me", authenticate, (req, res) => res.json({ user: req.user }));
router.post("/logout", (req, res) => {
  res.clearCookie("cafe_token", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  res.status(204).end();
});
router.get("/users", authenticate, allowRoles("admin"), async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id, name, login, role, active, created_at FROM users ORDER BY name");
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.patch("/users/:id", authenticate, allowRoles("admin"), async (req, res, next) => {
  try {
    const { active } = req.body || {};
    if (typeof active !== "boolean") return res.status(400).json({ error: "active must be boolean" });
    if (!active && Number(req.params.id) === Number(req.user.id)) return res.status(400).json({ error: "you cannot dismiss yourself" });
    const result = await pool.query("UPDATE users SET active = $1 WHERE id = $2 RETURNING id, name, login, role, active, created_at", [active, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "user not found" });
    res.json({ user: result.rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
