const express = require('express');
const pool = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');
const { cents, decimal, fail, transaction, audit, changed } = require('../lib');
const { withTotals } = require('../services/shifts');
const router = express.Router();
router.use(authenticate);
const cashier = allowRoles('admin', 'manager', 'cashier');
router.get('/current', async (req, res) => {
  const shift = (
    await pool.query(
      "SELECT s.*,u.name AS opened_by FROM shifts s JOIN users u ON u.id=s.user_id WHERE s.status='open'",
    )
  ).rows[0];
  if (req.user.role === 'waiter')
    return res.json({
      shift: shift ? { id: shift.id, status: shift.status, opened_at: shift.opened_at } : null,
    });
  res.json({ shift: await withTotals(pool, shift) });
});
router.post('/open', cashier, async (req, res) => {
  const cash = decimal(cents(req.body.opening_cash ?? 0, 'Наличные при открытии', true));
  const shift = await transaction(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(90251003)');
    if ((await c.query("SELECT 1 FROM shifts WHERE status='open'")).rowCount)
      fail(409, 'Смена уже открыта');
    const row = (
      await c.query('INSERT INTO shifts(user_id,opening_cash) VALUES($1,$2) RETURNING *', [
        req.user.id,
        cash,
      ])
    ).rows[0];
    await audit(c, req, 'shift.open', row.id, { cash });
    return withTotals(c, row);
  });
  changed(req, 'shifts');
  res.status(201).json({ shift });
});
router.post('/:id/close', cashier, async (req, res) => {
  const cash = decimal(cents(req.body.closing_cash, 'Фактические наличные', true));
  const shift = await transaction(async (c) => {
    const row = (
      await c.query("SELECT * FROM shifts WHERE id=$1 AND status='open' FOR UPDATE", [
        req.params.id,
      ])
    ).rows[0];
    if (!row) fail(409, 'Смена уже закрыта');
    const count = (await c.query("SELECT COUNT(*)::int AS count FROM orders WHERE status='open'"))
      .rows[0].count;
    if (count) fail(409, `Сначала закройте открытые заказы (${count})`);
    const updated = (
      await c.query(
        "UPDATE shifts SET status='closed',closed_at=NOW(),closing_cash=$1 WHERE id=$2 RETURNING *",
        [cash, row.id],
      )
    ).rows[0];
    await audit(c, req, 'shift.close', row.id, { cash });
    return withTotals(c, updated);
  });
  changed(req, 'shifts');
  res.json({ shift });
});
router.get('/history', cashier, async (req, res) => {
  const rows = (
    await pool.query(
      'SELECT s.*,u.name AS opened_by FROM shifts s JOIN users u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 100',
    )
  ).rows;
  res.json({ shifts: await Promise.all(rows.map((r) => withTotals(pool, r))) });
});
module.exports = router;
