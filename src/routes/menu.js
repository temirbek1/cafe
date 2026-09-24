const express = require("express");
const pool = require("../db");
const { authenticate, allowRoles } = require("../middleware/auth");

const router = express.Router();
const managerOnly = [authenticate, allowRoles("admin", "manager")];

router.get("/", authenticate, async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT mi.id, mi.name, mi.price, mi.active, mi.is_quick, mi.category_id,
      mc.name AS category FROM menu_items mi LEFT JOIN menu_categories mc ON mc.id = mi.category_id
      WHERE mi.active = TRUE ORDER BY mc.sort_order NULLS LAST, mi.name`);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get("/categories", authenticate, async (req, res, next) => {
  try { res.json((await pool.query("SELECT * FROM menu_categories ORDER BY sort_order, name")).rows); }
  catch (err) { next(err); }
});

router.post("/categories", ...managerOnly, async (req, res, next) => {
  try {
    const { name, sort_order = 0 } = req.body || {};
    if (!name) return res.status(400).json({ error: "category name is required" });
    const result = await pool.query("INSERT INTO menu_categories (name, sort_order) VALUES ($1, $2) RETURNING *", [name.trim(), sort_order]);
    res.status(201).json(result.rows[0]);
  } catch (err) { if (err.code === "23505") return res.status(409).json({ error: "category already exists" }); next(err); }
});

router.post("/", ...managerOnly, async (req, res, next) => {
  try {
    const { name, price, category_id = null, active = true, is_quick = false } = req.body || {};
    if (!name || !Number.isFinite(Number(price)) || Number(price) < 0) return res.status(400).json({ error: "valid name and price are required" });
    const result = await pool.query(
      "INSERT INTO menu_items (name, price, category_id, active, is_quick) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name.trim(), Number(price), category_id, Boolean(active), Boolean(is_quick)]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
});

router.patch("/:id", ...managerOnly, async (req, res, next) => {
  try {
    const { name, price, category_id, active, is_quick } = req.body || {};
    if (price !== undefined && (!Number.isFinite(Number(price)) || Number(price) < 0)) return res.status(400).json({ error: "price must be non-negative" });
    const result = await pool.query(`UPDATE menu_items SET
      name = COALESCE($1, name), price = COALESCE($2, price), category_id = COALESCE($3, category_id),
      active = COALESCE($4, active), is_quick = COALESCE($5, is_quick) WHERE id = $6 RETURNING *`,
      [name?.trim(), price === undefined ? null : Number(price), category_id === undefined ? null : category_id, active, is_quick, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "menu item not found" });
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
