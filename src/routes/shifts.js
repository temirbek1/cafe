const express = require("express");
const pool = require("../db");
const { authenticate, allowRoles } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate, allowRoles("admin", "manager", "cashier"));

const decimal = value => Number(value || 0);

async function withTotals(shift) {
  if (!shift) return null;
  const totals = await pool.query(`SELECT COALESCE(SUM(amount), 0) AS total,
    COALESCE(SUM(amount) FILTER (WHERE method = 'cash'), 0) AS cash,
    COALESCE(SUM(amount) FILTER (WHERE method = 'card'), 0) AS card,
    COALESCE(SUM(amount) FILTER (WHERE method = 'online'), 0) AS online
    FROM payments WHERE paid_at >= $1 AND ($2::timestamptz IS NULL OR paid_at <= $2)`,
    [shift.opened_at, shift.closed_at]);
  return { ...shift, sales: Object.fromEntries(Object.entries(totals.rows[0]).map(([key, value]) => [key, decimal(value)])) };
}

router.get("/current", async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT s.*, u.name AS opened_by FROM shifts s
      JOIN users u ON u.id = s.user_id WHERE s.status = 'open' ORDER BY s.opened_at DESC LIMIT 1`);
    res.json({ shift: await withTotals(result.rows[0]) });
  } catch (err) { next(err); }
});

router.post("/open", async (req, res, next) => {
  try {
    const openingCash = Number(req.body?.opening_cash || 0);
    if (!Number.isFinite(openingCash) || openingCash < 0) return res.status(400).json({ error: "opening_cash must be non-negative" });
    const result = await pool.query(`INSERT INTO shifts (user_id, opening_cash) VALUES ($1, $2)
      RETURNING *`, [req.user.id, openingCash]);
    req.app.get("io").emit("shift:update");
    res.status(201).json({ shift: await withTotals(result.rows[0]) });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "an open shift already exists" });
    next(err);
  }
});

router.post("/:id/close", async (req, res, next) => {
  try {
    const closingCash = req.body?.closing_cash;
    if (closingCash !== undefined && (!Number.isFinite(Number(closingCash)) || Number(closingCash) < 0)) return res.status(400).json({ error: "closing_cash must be non-negative" });
    const result = await pool.query(`UPDATE shifts SET status = 'closed', closed_at = NOW(), closing_cash = $1
      WHERE id = $2 AND status = 'open' RETURNING *`, [closingCash === undefined ? null : Number(closingCash), req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "open shift not found" });
    req.app.get("io").emit("shift:update");
    res.json({ shift: await withTotals(result.rows[0]) });
  } catch (err) { next(err); }
});

router.get("/history", async (req, res, next) => {
  try {
    const result = await pool.query(`SELECT s.*, u.name AS opened_by FROM shifts s
      JOIN users u ON u.id = s.user_id ORDER BY s.opened_at DESC LIMIT 100`);
    res.json({ shifts: await Promise.all(result.rows.map(withTotals)) });
  } catch (err) { next(err); }
});

module.exports = router;
