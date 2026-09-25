const express = require('express');
const pool = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');
const { dateRange, csv, transaction } = require('../lib');
const router = express.Router();
router.use(authenticate, allowRoles('admin', 'manager', 'cashier'));
const range = (field) =>
  `${field}>=($1::date::timestamp AT TIME ZONE 'Asia/Bishkek') AND ${field}<(($2::date+1)::timestamp AT TIME ZONE 'Asia/Bishkek')`;
// Payment records are immutable. A later refund must not move or erase the original sale.
const settled = `WITH settled AS (
  SELECT o.id,o.total,MAX(p.paid_at) AS paid_at
  FROM orders o JOIN payments p ON p.order_id=o.id
  WHERE o.status IN ('paid','refunded') AND o.total>0
  GROUP BY o.id HAVING SUM(p.amount)=o.total
)`;
async function report(query) {
  const dates = dateRange(query);
  return transaction(async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    const payments = await client.query(
      `SELECT method,SUM(amount) AS amount,COUNT(*)::int AS count FROM payments WHERE ${range('paid_at')} GROUP BY method`,
      dates,
    );
    const refunds = await client.query(
      `SELECT method,SUM(amount) AS amount FROM refunds WHERE ${range('created_at')} GROUP BY method`,
      dates,
    );
    const paid = (
      await client.query(
        `${settled} SELECT COUNT(*)::int AS count,COALESCE(SUM(total),0) AS total FROM settled WHERE ${range('paid_at')}`,
        dates,
      )
    ).rows[0];
    const orders = await client.query(
      `SELECT status,COUNT(*)::int AS count,COALESCE(SUM(total),0) AS total FROM orders WHERE ${range('closed_at')} GROUP BY status`,
      dates,
    );
    const top = await client.query(
      `${settled} SELECT oi.name,SUM(oi.quantity)::int AS quantity,SUM(oi.price*oi.quantity) AS revenue FROM order_items oi JOIN settled s ON s.id=oi.order_id WHERE oi.status='active' AND ${range('s.paid_at')} GROUP BY oi.name ORDER BY revenue DESC LIMIT 20`,
      dates,
    );
    const daily = await client.query(
      `SELECT day::text AS day,SUM(sales) AS sales,SUM(refunds) AS refunds FROM (SELECT (paid_at AT TIME ZONE 'Asia/Bishkek')::date AS day,amount AS sales,0::numeric AS refunds FROM payments WHERE ${range('paid_at')} UNION ALL SELECT (created_at AT TIME ZONE 'Asia/Bishkek')::date,0,amount FROM refunds WHERE ${range('created_at')}) entries GROUP BY day ORDER BY day`,
      dates,
    );
    const unassigned = await client.query(
      `SELECT COUNT(*)::int AS count FROM payments WHERE shift_id IS NULL AND ${range('paid_at')}`,
      dates,
    );
    const sales = Math.round(payments.rows.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
    const returned = Math.round(refunds.rows.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;
    return {
      from: dates[0],
      to: dates[1],
      sales,
      refunds: returned,
      net: Math.round((sales - returned) * 100) / 100,
      paid_orders: paid.count,
      average: paid.count ? Number(paid.total) / paid.count : 0,
      payments: payments.rows,
      refund_methods: refunds.rows,
      orders: orders.rows,
      top: top.rows,
      daily: daily.rows,
      unassigned_payments: unassigned.rows[0].count,
    };
  });
}
router.get('/sales', async (req, res) => res.json(await report(req.query)));
router.get('/sales.csv', async (req, res) => {
  const r = await report(req.query);
  const methods = { cash: 'Наличные', card: 'Карта', online: 'QR' };
  res
    .attachment(`sales-${r.from}-${r.to}.csv`)
    .type('text/csv')
    .send(
      csv([
        ['Период', r.from, r.to],
        ['Показатель', 'Сумма, сом'],
        ['Принято', r.sales],
        ['Возвраты', r.refunds],
        ['Выручка за вычетом возвратов', r.net],
        ['Полностью оплачено заказов (до возвратов)', r.paid_orders],
        ['Средний чек полностью оплаченных заказов (до возвратов)', r.average.toFixed(2)],
        [],
        ['Способ', 'Принято, сом'],
        ...r.payments.map((p) => [methods[p.method], p.amount]),
        [],
        ['Способ', 'Возвращено, сом'],
        ...r.refund_methods.map((p) => [methods[p.method], p.amount]),
        [],
        ['Дата', 'Поступления', 'Возвраты'],
        ...r.daily.map((d) => [d.day, d.sales, d.refunds]),
        [],
        ['Блюдо', 'Количество', 'Продажи по полностью оплаченным заказам (до возвратов)'],
        ...r.top.map((t) => [t.name, t.quantity, t.revenue]),
      ]),
    );
});
router.get('/audit', allowRoles('admin', 'manager'), async (req, res) =>
  res.json(
    (
      await pool.query(
        'SELECT a.*,u.name AS employee FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200',
      )
    ).rows,
  ),
);
module.exports = router;
