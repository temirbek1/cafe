const { fail, cents, integer, transaction } = require('../lib');
const pool = require('../db');
async function getOrder(client, id) {
  if (client === pool)
    return transaction(async (connection) => {
      await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
      return getOrder(connection, id);
    });
  const order = (
    await client.query(
      `SELECT o.*,t.name AS table_name,u.name AS waiter_name FROM orders o JOIN tables t ON t.id=o.table_id JOIN users u ON u.id=o.user_id WHERE o.id=$1`,
      [id],
    )
  ).rows[0];
  if (!order) fail(404, 'Заказ не найден');
  const items = await client.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [id]);
  const payments = await client.query('SELECT * FROM payments WHERE order_id=$1 ORDER BY id', [id]);
  const bills = await client.query('SELECT * FROM order_bills WHERE order_id=$1 ORDER BY id', [id]);
  const refunds = await client.query('SELECT * FROM refunds WHERE order_id=$1 ORDER BY id', [id]);
  return {
    order,
    items: items.rows,
    payments: payments.rows,
    bills: bills.rows,
    refunds: refunds.rows,
  };
}
function access(user, order) {
  if (user.role === 'waiter' && String(order.user_id) !== String(user.id))
    fail(403, 'Доступны только ваши заказы');
}
async function lockOrder(client, req, { open = true, editable = false } = {}) {
  const order = (await client.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [req.params.id]))
    .rows[0];
  if (!order) fail(404, 'Заказ не найден');
  access(req.user, order);
  if (open && order.status !== 'open') fail(409, 'Заказ уже закрыт');
  if (req.body.version !== undefined && integer(req.body.version, 'Версия') !== order.version)
    fail(409, 'Заказ изменился на другом устройстве. Обновите его и повторите действие');
  if (editable) {
    const locked = (
      await client.query(
        `SELECT EXISTS(SELECT 1 FROM payments WHERE order_id=$1) OR EXISTS(SELECT 1 FROM order_bills WHERE order_id=$1) AS value`,
        [order.id],
      )
    ).rows[0].value;
    if (locked) fail(409, 'После разделения счёта или начала оплаты состав заказа менять нельзя');
  }
  return order;
}
async function refresh(client, id) {
  const order = (
    await client.query(
      `UPDATE orders SET total=COALESCE((SELECT SUM(quantity*price) FROM order_items WHERE order_id=$1 AND status='active'),0),version=version+1 WHERE id=$1 RETURNING *`,
      [id],
    )
  ).rows[0];
  cents(order.total, 'Сумма заказа', true);
  return order;
}
async function activeShift(client) {
  const shift = (await client.query("SELECT * FROM shifts WHERE status='open' FOR SHARE")).rows[0];
  if (!shift) fail(409, 'Сначала откройте кассовую смену');
  return shift;
}
function paidCents(payments) {
  return payments.reduce((s, p) => s + cents(p.amount), 0);
}
module.exports = { getOrder, access, lockOrder, refresh, activeShift, paidCents };
