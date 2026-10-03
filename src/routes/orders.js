const express = require('express');
const pool = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');
const {
  fail,
  text,
  integer,
  cents,
  decimal,
  transaction,
  audit,
  changed,
  dateRange,
  csv,
} = require('../lib');
const {
  getOrder,
  access,
  lockOrder,
  refresh,
  activeShift,
  paidCents,
} = require('../services/orders');
const { queueReceipt, queueKitchen, receiptHtml, kitchenHtml } = require('../services/printing');
const { randomId } = require('../config');
const router = express.Router();
router.use(authenticate);
const cashier = allowRoles('admin', 'manager', 'cashier'),
  manager = allowRoles('admin', 'manager');

async function history(req, limit, offset = 0) {
  const [from, to] = dateRange(req.query);
  const status = req.query.status || null;
  if (status && !['open', 'paid', 'cancelled', 'refunded'].includes(status))
    fail(400, 'Неизвестный статус');
  return (
    await pool.query(
      `SELECT o.*,t.name AS table_name,u.name AS employee,COUNT(*) OVER() AS row_count
    FROM orders o JOIN tables t ON t.id=o.table_id JOIN users u ON u.id=o.user_id
    WHERE o.opened_at >= ($1::date::timestamp AT TIME ZONE 'Asia/Bishkek')
      AND o.opened_at < (($2::date+1)::timestamp AT TIME ZONE 'Asia/Bishkek')
      AND ($3::text IS NULL OR o.status=$3) AND ($4::bigint IS NULL OR o.user_id=$4)
    ORDER BY o.opened_at DESC,o.id DESC LIMIT $5 OFFSET $6`,
      [from, to, status, req.user.role === 'waiter' ? req.user.id : null, limit, offset],
    )
  ).rows;
}
router.get('/history', async (req, res) => {
  const limit = integer(req.query.limit || 50, 'Лимит', 1, 200),
    offset = integer(req.query.offset || 0, 'Смещение', 0, 10000000);
  const rows = await history(req, limit, offset);
  res.json({ orders: rows, total: Number(rows[0]?.row_count || 0) });
});
router.get('/history.csv', async (req, res) => {
  const rows = await history(req, 20001);
  if (rows.length > 20000) fail(400, 'Сузьте период: больше 20 000 заказов');
  res
    .attachment('orders.csv')
    .type('text/csv')
    .send(
      csv([
        ['Заказ', 'Дата', 'Стол', 'Сотрудник', 'Статус', 'Сумма, сом'],
        ...rows.map((o) => [
          o.id,
          new Date(o.opened_at).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' }),
          o.table_name,
          o.employee,
          o.status,
          o.total,
        ]),
      ]),
    );
});
router.get('/table/:tableId/open', async (req, res) => {
  const row = (
    await pool.query("SELECT * FROM orders WHERE table_id=$1 AND status='open'", [
      req.params.tableId,
    ])
  ).rows[0];
  if (!row) return res.json({ order: null, items: [], payments: [], bills: [], refunds: [] });
  access(req.user, row);
  const data = await getOrder(pool, row.id);
  data.kitchen_print_status = (await pool.query("SELECT status FROM print_jobs WHERE order_id=$1 AND kind='kitchen'", [row.id])).rows[0]?.status || null;
  res.json(data);
});
router.post('/', async (req, res) => {
  const tableId = integer(req.body.table_id, 'Стол'),
    guests = integer(req.body.guest_count || 1, 'Гости', 1, 1000);
  const comment = req.body.comment ? text(req.body.comment, 'Комментарий', 1000) : null;
  const data = await transaction(async (client) => {
    await activeShift(client);
    const table = (await client.query('SELECT * FROM tables WHERE id=$1 FOR UPDATE', [tableId]))
      .rows[0];
    if (!table || !table.active) fail(404, 'Стол не найден');
    if (table.status !== 'free') fail(409, 'Стол занят или зарезервирован. Обновите список столов');
    const order = (
      await client.query(
        'INSERT INTO orders(table_id,user_id,guest_count,comment) VALUES($1,$2,$3,$4) RETURNING id',
        [tableId, req.user.id, guests, comment],
      )
    ).rows[0];
    await client.query("UPDATE tables SET status='busy' WHERE id=$1", [tableId]);
    await audit(client, req, 'order.create', order.id, { tableId, guests });
    return getOrder(client, order.id);
  });
  changed(req);
  res.status(201).json(data);
});
router.get('/:id', async (req, res) => {
  const data = await getOrder(pool, req.params.id);
  access(req.user, data.order);
  data.kitchen_print_status = (await pool.query("SELECT status FROM print_jobs WHERE order_id=$1 AND kind='kitchen'", [req.params.id])).rows[0]?.status || null;
  res.json(data);
});
router.patch('/:id', async (req, res) => {
  const data = await transaction(async (client) => {
    const order = await lockOrder(client, req, { editable: true });
    const guests =
      req.body.guest_count === undefined
        ? order.guest_count
        : integer(req.body.guest_count, 'Гости', 1, 1000);
    const comment =
      req.body.comment === undefined
        ? order.comment
        : req.body.comment
          ? text(req.body.comment, 'Комментарий', 1000)
          : null;
    await client.query(
      'UPDATE orders SET guest_count=$1,comment=$2,version=version+1 WHERE id=$3',
      [guests, comment, order.id],
    );
    await audit(client, req, 'order.update', order.id, { guests, comment });
    return getOrder(client, order.id);
  });
  changed(req);
  res.json(data);
});
router.post('/:id/kitchen', async (req, res) => {
  const data = await transaction(async (client) => {
    const order = await lockOrder(client, req);
    const kitchenStatus = await queueKitchen(client, order.id);
    await audit(client, req, 'order.kitchen_print', order.id);
    return { ...(await getOrder(client, order.id)), kitchen_print_status: kitchenStatus };
  });
  changed(req, 'printing');
  res.json(data);
});
router.post('/:id/items', async (req, res) => {
  const menuId = integer(req.body.menu_item_id, 'Блюдо'),
    quantity = integer(req.body.quantity || 1, 'Количество', 1, 10000);
  const data = await transaction(async (client) => {
    const order = await lockOrder(client, req, { editable: true });
    const dish = (
      await client.query('SELECT * FROM menu_items WHERE id=$1 AND active=TRUE FOR SHARE', [menuId])
    ).rows[0];
    if (!dish) fail(409, 'Блюдо больше не доступно');
    const existing = (
      await client.query(
        "SELECT * FROM order_items WHERE order_id=$1 AND menu_item_id=$2 AND price=$3 AND name=$4 AND status='active' ORDER BY id LIMIT 1",
        [order.id, menuId, dish.price, dish.name],
      )
    ).rows[0];
    if (existing) {
      integer(existing.quantity + quantity, 'Количество', 1, 10000);
      await client.query('UPDATE order_items SET quantity=quantity+$1 WHERE id=$2', [
        quantity,
        existing.id,
      ]);
    } else
      await client.query(
        'INSERT INTO order_items(order_id,menu_item_id,name,price,quantity) VALUES($1,$2,$3,$4,$5)',
        [order.id, menuId, dish.name, dish.price, quantity],
      );
    await refresh(client, order.id);
    await audit(client, req, 'item.add', order.id, { menuId, quantity });
    return getOrder(client, order.id);
  });
  changed(req);
  res.status(201).json(data);
});
router.patch('/:id/items/:itemId', async (req, res) => {
  const quantity = integer(req.body.quantity, 'Количество', 1, 10000);
  const data = await transaction(async (client) => {
    const order = await lockOrder(client, req, { editable: true });
    const item = (
      await client.query(
        "SELECT * FROM order_items WHERE id=$1 AND order_id=$2 AND status='active'",
        [req.params.itemId, order.id],
      )
    ).rows[0];
    if (!item) fail(404, 'Позиция не найдена');
    await client.query('UPDATE order_items SET quantity=$1 WHERE id=$2', [quantity, item.id]);
    await refresh(client, order.id);
    await audit(client, req, 'item.quantity', order.id, {
      itemId: item.id,
      from: item.quantity,
      to: quantity,
    });
    return getOrder(client, order.id);
  });
  changed(req);
  res.json(data);
});
router.post('/:id/items/:itemId/cancel', async (req, res) => {
  const reason = text(req.body.reason, 'Причина отмены', 500);
  const data = await transaction(async (client) => {
    const order = await lockOrder(client, req, { editable: true });
    const item = (
      await client.query(
        "UPDATE order_items SET status='cancelled',cancel_reason=$1 WHERE id=$2 AND order_id=$3 AND status='active' RETURNING id",
        [reason, req.params.itemId, order.id],
      )
    ).rows[0];
    if (!item) fail(404, 'Позиция не найдена');
    await refresh(client, order.id);
    await audit(client, req, 'item.cancel', order.id, { itemId: item.id, reason });
    return getOrder(client, order.id);
  });
  changed(req);
  res.json(data);
});
router.post('/:id/cancel', manager, async (req, res) => {
  const reason = text(req.body.reason, 'Причина отмены', 500);
  const data = await transaction(async (client) => {
    const order = await lockOrder(client, req);
    if ((await client.query('SELECT 1 FROM payments WHERE order_id=$1', [order.id])).rowCount)
      fail(409, 'В заказе есть оплата. Используйте возврат');
    await client.query(
      "UPDATE orders SET status='cancelled',cancel_reason=$1,closed_at=NOW(),version=version+1 WHERE id=$2",
      [reason, order.id],
    );
    await client.query("UPDATE tables SET status='free' WHERE id=$1", [order.table_id]);
    await audit(client, req, 'order.cancel', order.id, { reason });
    return getOrder(client, order.id);
  });
  changed(req);
  res.json(data);
});
router.post('/:id/split', cashier, async (req, res) => {
  const count = integer(req.body.count, 'Количество счетов', 2, 20);
  const data = await transaction(async (client) => {
    const order = await lockOrder(client, req, { editable: true }),
      total = cents(order.total);
    if (total < count) fail(400, 'Сумма слишком мала для такого разделения');
    for (let i = 0; i < count; i++)
      await client.query('INSERT INTO order_bills(order_id,amount) VALUES($1,$2)', [
        order.id,
        decimal(Math.floor(total / count) + (i < total % count ? 1 : 0)),
      ]);
    await client.query('UPDATE orders SET version=version+1 WHERE id=$1', [order.id]);
    await audit(client, req, 'order.split', order.id, { count });
    return getOrder(client, order.id);
  });
  changed(req);
  res.json(data);
});
router.post('/:id/unsplit', cashier, async (req, res) => {
  const data = await transaction(async (client) => {
    const order = await lockOrder(client, req);
    if ((await client.query('SELECT 1 FROM payments WHERE order_id=$1', [order.id])).rowCount)
      fail(409, 'Отменить разделение после оплаты нельзя');
    await client.query('DELETE FROM order_bills WHERE order_id=$1', [order.id]);
    await client.query('UPDATE orders SET version=version+1 WHERE id=$1', [order.id]);
    await audit(client, req, 'order.unsplit', order.id);
    return getOrder(client, order.id);
  });
  changed(req);
  res.json(data);
});
router.post('/:id/payments', cashier, async (req, res) => {
  const amount = cents(req.body.amount),
    method = req.body.method,
    billId = req.body.bill_id ? integer(req.body.bill_id, 'Счёт') : null;
  if (!['cash', 'card', 'online'].includes(method)) fail(400, 'Выберите способ оплаты');
  const key = req.body.request_key || randomId();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key))
    fail(400, 'Неверный ключ операции');
  const replay = async (client) => {
    const old = (await client.query('SELECT * FROM payments WHERE request_key=$1', [key])).rows[0];
    if (!old) return null;
    if (
      String(old.order_id) !== req.params.id ||
      old.method !== method ||
      cents(old.amount) !== amount ||
      String(old.bill_id || '') !== String(billId || '')
    )
      fail(409, 'Ключ операции уже использован для другого платежа');
    return getOrder(client, old.order_id);
  };
  let data = await replay(pool);
  if (!data)
    data = await transaction(async (client) => {
      const shift = await activeShift(client);
      // Shift is locked first, consistently with close/refund/create.
      const order = await lockOrder(client, req, { open: false });
      const prior = await replay(client);
      if (prior) return prior;
      if (order.status !== 'open') fail(409, 'Заказ уже закрыт');
      const current = await getOrder(client, order.id),
        total = cents(order.total),
        received = paidCents(current.payments);
      if (amount > total - received) fail(400, 'Сумма превышает остаток к оплате');
      if (current.bills.length && !billId) fail(400, 'Выберите один из разделённых счетов');
      if (billId) {
        const bill = current.bills.find((b) => String(b.id) === String(billId));
        if (!bill || bill.status !== 'open') fail(409, 'Счёт уже оплачен или не найден');
        if (cents(bill.amount) !== amount) fail(400, 'Разделённый счёт оплачивается полностью');
        await client.query("UPDATE order_bills SET status='paid' WHERE id=$1", [billId]);
      }
      await client.query(
        'INSERT INTO payments(order_id,bill_id,user_id,method,amount,shift_id,request_key) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [order.id, billId, req.user.id, method, decimal(amount), shift.id, key],
      );
      const complete = received + amount === total;
      await client.query(
        "UPDATE orders SET version=version+1,status=CASE WHEN $2 THEN 'paid' ELSE status END,closed_at=CASE WHEN $2 THEN NOW() ELSE closed_at END WHERE id=$1",
        [order.id, complete],
      );
      if (complete)
        await client.query("UPDATE tables SET status='free' WHERE id=$1", [order.table_id]);
      await audit(client, req, 'payment.create', order.id, {
        amount: decimal(amount),
        method,
        shift: shift.id,
        key,
      });
      if (complete) await queueReceipt(client, order.id, 'payment');
      return getOrder(client, order.id);
    });
  changed(req);
  res.json(data);
});
router.post('/:id/refund', manager, async (req, res) => {
  const reason = text(req.body.reason, 'Причина возврата', 500);
  const data = await transaction(async (client) => {
    const shift = await activeShift(client),
      order = await lockOrder(client, req, { open: false });
    if (!['open', 'paid'].includes(order.status)) fail(409, 'Заказ уже отменён или возвращён');
    const current = await getOrder(client, order.id);
    if (!current.payments.length) fail(400, 'Нет платежей для возврата');
    if (current.payments.some((p) => p.method !== 'cash') && req.body.external_confirmed !== true)
      fail(400, 'Сначала подтвердите возврат в банковском сервисе');
    for (const p of current.payments)
      await client.query(
        'INSERT INTO refunds(payment_id,order_id,shift_id,user_id,amount,method,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [p.id, order.id, shift.id, req.user.id, p.amount, p.method, reason],
      );
    await client.query(
      "UPDATE orders SET status='refunded',cancel_reason=$1,closed_at=NOW(),version=version+1 WHERE id=$2",
      [reason, order.id],
    );
    if (order.status === 'open')
      await client.query("UPDATE tables SET status='free' WHERE id=$1", [order.table_id]);
    await audit(client, req, 'order.refund', order.id, { reason });
    await queueReceipt(client, order.id, 'refund');
    return getOrder(client, order.id);
  });
  changed(req);
  res.json(data);
});
router.get('/:id/receipt', cashier, async (req, res) => {
  const kind = req.query.kind === 'refund' ? 'refund' : 'payment';
  const job = (
    await pool.query('SELECT payload FROM print_jobs WHERE order_id=$1 AND kind=$2', [
      req.params.id,
      kind,
    ])
  ).rows[0];
  if (!job) fail(404, 'Квитанция появится после полной оплаты или возврата');
  const settings = (await pool.query('SELECT value FROM settings WHERE id=TRUE')).rows[0].value;
  const payload = {
    ...job.payload,
    settings: { ...job.payload.settings, print_mode: settings.print_mode },
  };
  res.set('Cache-Control', 'no-store').type('html').send(receiptHtml(payload));
});
router.get('/:id/kitchen-ticket', cashier, async (req, res) => {
  const job = (
    await pool.query("SELECT payload FROM print_jobs WHERE order_id=$1 AND kind='kitchen'", [
      req.params.id,
    ])
  ).rows[0];
  if (!job) fail(404, 'Кухонный чек не найден');
  res.set('Cache-Control', 'no-store').type('html').send(kitchenHtml(job.payload));
});
router.post('/:id/print', cashier, async (req, res) => {
  const result = await transaction(async (client) => {
    const order = await lockOrder(client, req, { open: false });
    if (!['paid', 'refunded'].includes(order.status)) fail(400, 'Only paid orders can be printed');
    const settings = (await client.query('SELECT value FROM settings WHERE id=TRUE')).rows[0].value;
    if (settings.print_mode !== 'windows') fail(400, 'Automatic Windows printing is not enabled');
    const kind = order.status === 'refunded' ? 'refund' : 'payment';
    const job = (await client.query(
      "UPDATE print_jobs SET status='pending',error=NULL,updated_at=NOW() WHERE order_id=$1 AND kind=$2 AND status NOT IN ('pending','printing') RETURNING id",
      [order.id, kind],
    )).rows[0];
    if (!job) fail(409, 'Print job is already queued or is not available');
    await audit(client, req, 'print.request', job.id);
    return { submitted: true };
  });
  changed(req, 'printing');
  res.json(result);
});
module.exports = router;
