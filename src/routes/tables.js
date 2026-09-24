const express = require("express");
const pool = require("../db");
const { authenticate, allowRoles } = require("../middleware/auth");

const router = express.Router();

router.get("/", authenticate, async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT t.*, o.id AS open_order_id, o.total AS open_order_total
      FROM tables t LEFT JOIN orders o ON o.table_id = t.id AND o.status = 'open' ORDER BY t.name`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.post("/", authenticate, allowRoles("admin", "manager"), async (req, res, next) => {
  try {
    const { name } = req.body || {};
    if (!name) return res.status(400).json({ error: "table name is required" });
    const result = await pool.query("INSERT INTO tables (name) VALUES ($1) RETURNING *", [name.trim()]);
    res.status(201).json(result.rows[0]);
  } catch (err) { if (err.code === "23505") return res.status(409).json({ error: "table already exists" }); next(err); }
});

router.patch("/:id", authenticate, allowRoles("admin", "manager"), async (req, res, next) => {
  try {
    const { name, status } = req.body || {};
    if (status !== undefined && !["free", "busy", "reserved"].includes(status)) return res.status(400).json({ error: "invalid table status" });
    const result = await pool.query("UPDATE tables SET name = COALESCE($1, name), status = COALESCE($2, status) WHERE id = $3 RETURNING *", [name?.trim(), status, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "table not found" });
    req.app.get("io").emit("table:update", result.rows[0]);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
