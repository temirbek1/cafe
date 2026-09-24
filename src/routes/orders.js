const express = require("express");
const pool = require("../db");
const { authenticate, allowRoles } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate);
const money = (value) => Math.round(Number(value) * 100) / 100;

async function refreshTotal(client, orderId) {
  const result = await client.query(`UPDATE orders SET total = COALESCE((
    SELECT SUM(quantity * price) FROM order_items WHERE order_id = $1 AND status = 'active'
  ), 0) WHERE id = $1 RETURNING total`, [orderId]);
  return Number(result.rows[0].total);
}

async function getOrder(client, orderId) {
  const order = await client.query(`SELECT o.*, t.name AS table_name, u.name AS waiter_name
    FROM orders o JOIN tables t ON t.id = o.table_id JOIN users u ON u.id = o.user_id WHERE o.id = $1`, [orderId]);
  if (!order.rows[0]) return null;
  const [items, payments, bills] = await Promise.all([
    client.query(`SELECT oi.*, mi.name AS current_menu_name FROM order_items oi LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
      WHERE oi.order_id = $1 ORDER BY oi.id`, [orderId]),
    client.query("SELECT * FROM payments WHERE order_id = $1 ORDER BY paid_at", [orderId]),
    client.query("SELECT * FROM order_bills WHERE order_id = $1 ORDER BY id", [orderId]),
  ]);
  return { order: order.rows[0], items: items.rows, payments: payments.rows, bills: bills.rows };
}

function emitOrder(req, orderId) { req.app.get("io").emit("order:update", { order_id: Number(orderId) }); }

// Waiters may see and edit only orders which they opened themselves. Managers,
// administrators and cashiers need access to all orders for their work.
async function requireOrderAccess(req, res, next) {
  try {
    if (["admin", "manager", "cashier"].includes(req.user.role)) return next();
    const result = await pool.query("SELECT user_id FROM orders WHERE id = $1", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "order not found" });
    if (Number(result.rows[0].user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: "you can access only your own orders" });
    }
    next();
  } catch (err) { next(err); }
}

router.get("/history", allowRoles("admin", "manager"), async (req, res, next) => {
  try {
    const { from, to, status } = req.query;
    const result = await pool.query(`SELECT o.id, o.status, o.total, o.opened_at, o.closed_at, t.name AS table_name, u.name AS employee
      FROM orders o JOIN tables t ON t.id = o.table_id JOIN users u ON u.id = o.user_id
      WHERE ($1::timestamptz IS NULL OR o.opened_at >= $1) AND ($2::timestamptz IS NULL OR o.opened_at < $2)
      AND ($3::text IS NULL OR o.status = $3) ORDER BY o.opened_at DESC LIMIT 500`, [from || null, to || null, status || null]);
    res.json(result.rows);
  } catch (err) { next(err); }
});

router.get("/table/:tableId/open", async (req, res, next) => {
  try {
    const result = await pool.query("SELECT id, user_id FROM orders WHERE table_id = $1 AND status = 'open'", [req.params.tableId]);
    if (!result.rows[0]) return res.json({ order: null, items: [], payments: [], bills: [] });
    if (req.user.role === "waiter" && Number(result.rows[0].user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: "you can access only your own orders" });
    }
    res.json(await getOrder(pool, result.rows[0].id));
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  const { table_id, guest_count = 1, comment = null } = req.body || {};
  if (!Number.isInteger(Number(table_id)) || !Number.isInteger(Number(guest_count)) || Number(guest_count) < 1) {
    return res.status(400).json({ error: "valid table_id and guest_count are required" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const table = await client.query("SELECT * FROM tables WHERE id = $1 FOR UPDATE", [table_id]);
    if (!table.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "table not found" }); }
    if (table.rows[0].status !== "free") { await client.query("ROLLBACK"); return res.status(409).json({ error: "table is not free" }); }
    const existing = await client.query("SELECT id FROM orders WHERE table_id = $1 AND status = 'open'", [table_id]);
    if (existing.rows[0]) { await client.query("ROLLBACK"); return res.status(409).json({ error: "table already has an open order", order_id: existing.rows[0].id }); }
    const result = await client.query(`INSERT INTO orders (table_id, user_id, guest_count, comment)
      VALUES ($1, $2, $3, $4) RETURNING *`, [table_id, req.user.id, guest_count, comment]);
    await client.query("UPDATE tables SET status = 'busy' WHERE id = $1", [table_id]);
    await client.query("COMMIT");
    req.app.get("io").emit("table:update", { table_id: Number(table_id), status: "busy" });
    res.status(201).json(await getOrder(pool, result.rows[0].id));
  } catch (err) { await client.query("ROLLBACK"); next(err); } finally { client.release(); }
});

router.get("/:id", requireOrderAccess, async (req, res, next) => {
  try {
    const data = await getOrder(pool, req.params.id);
    if (!data) return res.status(404).json({ error: "order not found" });
    res.json(data);
  } catch (err) { next(err); }
});

router.post("/:id/items", requireOrderAccess, async (req, res, next) => {
  const { menu_item_id, quantity = 1 } = req.body || {};
  if (!Number.isInteger(Number(menu_item_id)) || !Number.isInteger(Number(quantity)) || Number(quantity) < 1) return res.status(400).json({ error: "valid menu_item_id and positive quantity are required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query("SELECT status FROM orders WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!order.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "order not found" }); }
    if (order.rows[0].status !== "open") { await client.query("ROLLBACK"); return res.status(409).json({ error: "only open orders can be edited" }); }
    const dish = await client.query("SELECT id, name, price FROM menu_items WHERE id = $1 AND active = TRUE", [menu_item_id]);
    if (!dish.rows[0]) { await client.query("ROLLBACK"); return res.status(404).json({ error: "active menu item not found" }); }
    await client.query("INSERT INTO order_items (order_id, menu_item_id, name, quantity, price) VALUES ($1, $2, $3, $4, $5)", [req.params.id, dish.rows[0].id, dish.rows[0].name, quantity, dish.rows[0].price]);
    await refreshTotal(client, req.params.id);
    await client.query("COMMIT");
    emitOrder(req, req.params.id);
    res.status(201).json(await getOrder(pool, req.params.id));
  } catch (err) { await client.query("ROLLBACK"); next(err); } finally { client.release(); }
});

router.patch("/:id/items/:itemId", requireOrderAccess, async (req, res, next) => {
  const { quantity } = req.body || {};
  if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1) return res.status(400).json({ error: "quantity must be a positive integer" });
  try {
    const result = await pool.query(`UPDATE order_items oi SET quantity = $1 FROM orders o
      WHERE oi.id = $2 AND oi.order_id = $3 AND oi.order_id = o.id AND o.status = 'open' AND oi.status = 'active' RETURNING oi.id`, [quantity, req.params.itemId, req.params.id]);
    if (!result.rows[0]) return res.status(409).json({ error: "active item in an open order not found" });
    await refreshTotal(pool, req.params.id);
    emitOrder(req, req.params.id);
    res.json(await getOrder(pool, req.params.id));
  } catch (err) { next(err); }
});

router.post("/:id/items/:itemId/cancel", allowRoles("admin", "manager"), async (req, res, next) => {
  try {
    const { reason } = req.body || {};
    if (!reason) return res.status(400).json({ error: "cancellation reason is required" });
    const result = await pool.query(`UPDATE order_items oi SET status = 'cancelled', cancel_reason = $1 FROM orders o
      WHERE oi.id = $2 AND oi.order_id = $3 AND oi.order_id = o.id AND o.status = 'open' AND oi.status = 'active' RETURNING oi.id`, [reason, req.params.itemId, req.params.id]);
    if (!result.rows[0]) return res.status(409).json({ error: "active item in an open order not found" });
    await refreshTotal(pool, req.params.id);
    emitOrder(req, req.params.id);
    res.json(await getOrder(pool, req.params.id));
  } catch (err) { next(err); }
});

router.post("/:id/cancel", allowRoles("admin", "manager"), async (req, res, next) => {
  const { reason } = req.body || {};
  if (!reason) return res.status(400).json({ error: "cancellation reason is required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`UPDATE orders SET status = 'cancelled', cancel_reason = $1, closed_at = NOW()
      WHERE id = $2 AND status = 'open' RETURNING table_id`, [reason, req.params.id]);
    if (!result.rows[0]) { await client.query("ROLLBACK"); return res.status(409).json({ error: "open order not found" }); }
    await client.query("UPDATE tables SET status = 'free' WHERE id = $1", [result.rows[0].table_id]);
    await client.query("COMMIT");
    req.app.get("io").emit("table:update", { table_id: result.rows[0].table_id, status: "free" });
    emitOrder(req, req.params.id);
    res.json(await getOrder(pool, req.params.id));
  } catch (err) { await client.query("ROLLBACK"); next(err); } finally { client.release(); }
});

// Split an unpaid check either equally ({ count: 3 }) or by explicit amounts ({ amounts: [1000, 1500] }).
router.post("/:id/split", allowRoles("admin", "manager", "cashier"), async (req, res, next) => {
  const { count, amounts } = req.body || {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query("SELECT status FROM orders WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!order.rows[0] || order.rows[0].status !== "open") { await client.query("ROLLBACK"); return res.status(409).json({ error: "only open orders can be split" }); }
    const previous = await client.query("SELECT COUNT(*)::int AS count FROM order_bills WHERE order_id = $1", [req.params.id]);
    const payments = await client.query("SELECT COUNT(*)::int AS count FROM payments WHERE order_id = $1", [req.params.id]);
    if (previous.rows[0].count || payments.rows[0].count) { await client.query("ROLLBACK"); return res.status(409).json({ error: "check is already split or partially paid" }); }
    const totalCents = Math.round((await refreshTotal(client, req.params.id)) * 100);
    if (totalCents < 1) { await client.query("ROLLBACK"); return res.status(400).json({ error: "cannot split an empty check" }); }
    let billCents;
    if (Array.isArray(amounts)) {
      billCents = amounts.map((amount) => Math.round(Number(amount) * 100));
      if (!billCents.length || billCents.some((amount) => !Number.isInteger(amount) || amount < 1) || billCents.reduce((a, b) => a + b, 0) !== totalCents) {
        await client.query("ROLLBACK"); return res.status(400).json({ error: "amounts must be positive and add up to the check total" });
      }
    } else if (Number.isInteger(Number(count)) && Number(count) > 1 && Number(count) <= 20) {
      const parts = Number(count); const base = Math.floor(totalCents / parts); const remainder = totalCents % parts;
      billCents = Array.from({ length: parts }, (_, index) => base + (index < remainder ? 1 : 0));
    } else { await client.query("ROLLBACK"); return res.status(400).json({ error: "provide count (2-20) or amounts" }); }
    for (const amount of billCents) await client.query("INSERT INTO order_bills (order_id, amount) VALUES ($1, $2)", [req.params.id, amount / 100]);
    await client.query("COMMIT");
    emitOrder(req, req.params.id);
    res.json(await getOrder(pool, req.params.id));
  } catch (err) { await client.query("ROLLBACK"); next(err); } finally { client.release(); }
});

router.post("/:id/payments", allowRoles("admin", "manager", "cashier"), async (req, res, next) => {
  const { method, amount, bill_id = null } = req.body || {};
  const paidAmount = money(amount);
  if (!["cash", "card", "online"].includes(method) || !Number.isFinite(paidAmount) || paidAmount <= 0) return res.status(400).json({ error: "valid method and positive amount are required" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [req.params.id]);
    if (!order.rows[0] || order.rows[0].status !== "open") { await client.query("ROLLBACK"); return res.status(409).json({ error: "only open orders can be paid" }); }
    const total = await refreshTotal(client, req.params.id);
    const existing = await client.query("SELECT COALESCE(SUM(amount), 0) AS amount FROM payments WHERE order_id = $1", [req.params.id]);
    const billCount = await client.query("SELECT COUNT(*)::int AS count FROM order_bills WHERE order_id = $1", [req.params.id]);
    if (billCount.rows[0].count && !bill_id) { await client.query("ROLLBACK"); return res.status(400).json({ error: "choose a split bill for payment" }); }
    if (bill_id) {
      const bill = await client.query("SELECT * FROM order_bills WHERE id = $1 AND order_id = $2 FOR UPDATE", [bill_id, req.params.id]);
      if (!bill.rows[0] || bill.rows[0].status !== "open") { await client.query("ROLLBACK"); return res.status(409).json({ error: "open bill not found" }); }
      if (money(bill.rows[0].amount) !== paidAmount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "split bill must be paid in full" }); }
      await client.query("UPDATE order_bills SET status = 'paid' WHERE id = $1", [bill_id]);
    } else if (Number(existing.rows[0].amount) + paidAmount > total) { await client.query("ROLLBACK"); return res.status(400).json({ error: "payment exceeds remaining balance" }); }
    await client.query("INSERT INTO payments (order_id, bill_id, user_id, method, amount) VALUES ($1, $2, $3, $4, $5)", [req.params.id, bill_id, req.user.id, method, paidAmount]);
    const received = Number((await client.query("SELECT COALESCE(SUM(amount), 0) AS amount FROM payments WHERE order_id = $1", [req.params.id])).rows[0].amount);
    if (money(received) === money(total)) {
      await client.query("UPDATE orders SET status = 'paid', closed_at = NOW() WHERE id = $1", [req.params.id]);
      await client.query("UPDATE tables SET status = 'free' WHERE id = $1", [order.rows[0].table_id]);
    }
    await client.query("COMMIT");
    if (money(received) === money(total)) req.app.get("io").emit("table:update", { table_id: order.rows[0].table_id, status: "free" });
    emitOrder(req, req.params.id);
    res.json(await getOrder(pool, req.params.id));
  } catch (err) { await client.query("ROLLBACK"); next(err); } finally { client.release(); }
});

module.exports = router;
