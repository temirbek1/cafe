const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { io: connect } = require('socket.io-client');
let db, adminDb, server, io, base, migrate, admin, waiter, other, dish, table;
const schema = 'pos_test_' + crypto.randomBytes(8).toString('hex');
const password = 'test-pass-12345';
async function request(method, path, body, token = admin, headers = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { status: response.status, data, headers: response.headers };
}
async function good(method, path, body, token = admin) {
  const r = await request(method, path, body, token);
  assert.ok(r.status < 300, JSON.stringify(r));
  return r.data;
}
async function open() {
  return good('POST', '/shifts/open', { opening_cash: '500.00' });
}
async function order(quantity = 2, actor = admin, tableId = table.id) {
  const created = await good('POST', '/orders', { table_id: tableId }, actor);
  return good(
    'POST',
    `/orders/${created.order.id}/items`,
    { menu_item_id: dish.id, quantity },
    actor,
  );
}
async function pay(o, amount = o.order.total, extra = {}) {
  return good('POST', `/orders/${o.order.id}/payments`, {
    method: 'cash',
    amount,
    request_key: crypto.randomUUID(),
    ...extra,
  });
}
before(async () => {
  if (!process.env.TEST_DATABASE_URL)
    throw new Error(
      'Set TEST_DATABASE_URL to a disposable PostgreSQL database. Tests use a separate random schema.',
    );
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.JWT_SECRET = 'test-only-secret-at-least-32-characters';
  adminDb = new Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    options: '-c search_path=public',
  });
  await adminDb.query(`CREATE SCHEMA ${schema}`);
  process.env.PGOPTIONS = `-c search_path=${schema}`;
  db = require('../src/db');
  migrate = require('../src/migrate');
  await migrate();
  ({ server, io } = require('../src/app').createServer());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => {
  await db.query(
    'TRUNCATE users,tables,menu_categories,menu_items,orders,shifts,audit_log RESTART IDENTITY CASCADE',
  );
  admin = null;
  await good(
    'POST',
    '/auth/register',
    { name: 'Admin', login: 'admin', password, role: 'admin' },
    null,
  );
  admin = (await good('POST', '/auth/login', { login: 'admin', password }, null)).token;
  for (const login of ['waiter', 'other'])
    await good('POST', '/auth/register', { name: login, login, password, role: 'waiter' });
  waiter = (await good('POST', '/auth/login', { login: 'waiter', password }, null)).token;
  other = (await good('POST', '/auth/login', { login: 'other', password }, null)).token;
  dish = await good('POST', '/menu', { name: 'Кофе', price: '100.00' });
  table = await good('POST', '/tables', { name: 'Стол 1' });
});
after(async () => {
  if (io) await new Promise((resolve) => io.close(resolve));
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  if (db) await db.end();
  if (adminDb) {
    await adminDb.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await adminDb.end();
  }
});

test('authentication, role checks, HttpOnly cookie and logout revoke access', async () => {
  assert.equal((await request('GET', '/tables', undefined, null)).status, 401);
  assert.equal(
    (await request('POST', '/menu', { name: 'Forbidden', price: 10 }, waiter)).status,
    403,
  );
  const login = await request('POST', '/auth/login', { login: 'waiter', password }, null);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/);
  await good('POST', '/auth/logout', {}, waiter);
  assert.equal((await request('GET', '/auth/me', undefined, waiter)).status, 401);
});
test('dismissal immediately revokes existing sessions and prevents new logins', async () => {
  await open();
  const o = await order(1, waiter);
  await good('PATCH', '/auth/users/2', { active: false });
  assert.equal(
    (await request('POST', `/orders/${o.order.id}/items`, { menu_item_id: dish.id }, waiter))
      .status,
    401,
  );
  assert.equal(
    (await request('POST', '/auth/login', { login: 'waiter', password }, null)).status,
    401,
  );
});
test('password reset preserves spaces, enforces the bcrypt byte limit, and revokes old sessions', async () => {
  const nextPassword = '  café-password  ';
  await good('PATCH', '/auth/users/2', { password: nextPassword });
  assert.equal((await request('GET', '/auth/me', undefined, waiter)).status, 401);
  assert.equal(
    (await request('POST', '/auth/login', { login: 'waiter', password: nextPassword }, null))
      .status,
    200,
  );
  assert.equal(
    (await request('POST', '/auth/login', { login: 'waiter', password: nextPassword.trim() }, null))
      .status,
    401,
  );
  assert.equal((await request('PATCH', '/auth/users/2', { password: 'я'.repeat(37) })).status, 400);
});
test('first setup cannot be repeated without administrator privileges', async () => {
  assert.equal(
    (
      await request(
        'POST',
        '/auth/register',
        { name: 'Intruder', login: 'intruder', password, role: 'admin' },
        null,
      )
    ).status,
    403,
  );
  assert.equal((await request('PATCH', '/auth/users/1', { active: false })).status, 400);
});
test('an open shift is required and only one shift can be open', async () => {
  assert.equal((await request('POST', '/orders', { table_id: table.id })).status, 409);
  const shifts = await Promise.all([
    request('POST', '/shifts/open', { opening_cash: 0 }),
    request('POST', '/shifts/open', { opening_cash: 0 }),
  ]);
  assert.deepEqual(shifts.map((r) => r.status).sort(), [201, 409]);
  const o = await order();
  await db.query("UPDATE shifts SET status='closed',closed_at=NOW()");
  assert.equal(
    (await request('POST', `/orders/${o.order.id}/payments`, { method: 'cash', amount: 200 }))
      .status,
    409,
  );
});
test('concurrent order creation reserves a table exactly once', async () => {
  await open();
  const results = await Promise.all([
    request('POST', '/orders', { table_id: table.id }),
    request('POST', '/orders', { table_id: table.id }, waiter),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM orders')).rows[0].n, 1);
});
test('waiters edit and see only their own orders and cannot accept payment', async () => {
  await open();
  const o = await order(1, waiter);
  assert.equal((await request('GET', `/orders/${o.order.id}`, undefined, other)).status, 403);
  assert.equal(
    (await request('PATCH', `/orders/${o.order.id}/items/${o.items[0].id}`, { quantity: 4 }, other))
      .status,
    403,
  );
  assert.equal(
    (
      await request(
        'POST',
        `/orders/${o.order.id}/payments`,
        { method: 'cash', amount: 100 },
        waiter,
      )
    ).status,
    403,
  );
  assert.equal((await good('GET', '/orders/history', undefined, waiter)).total, 1);
  assert.equal((await good('GET', '/orders/history', undefined, other)).total, 0);
});
test('optimistic versions prevent concurrent quantity overwrite', async () => {
  await open();
  const o = await order();
  const results = await Promise.all(
    [3, 4].map((quantity) =>
      request('PATCH', `/orders/${o.order.id}/items/${o.items[0].id}`, {
        quantity,
        version: o.order.version,
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const current = await good('GET', `/orders/${o.order.id}`);
  assert.equal(Number(current.order.total), current.items[0].quantity * 100);
});
test('split checks preserve minor units, prohibit edits, and can be unsplit before payment', async () => {
  await open();
  await good('PATCH', '/menu/' + dish.id, { price: '100.01' });
  const o = await order(1);
  let split = await good('POST', `/orders/${o.order.id}/split`, { count: 3 });
  assert.deepEqual(
    split.bills.map((b) => b.amount),
    ['33.34', '33.34', '33.33'],
  );
  assert.equal(
    (await request('POST', `/orders/${o.order.id}/items`, { menu_item_id: dish.id })).status,
    409,
  );
  assert.equal(
    (await request('PATCH', `/orders/${o.order.id}/items/${o.items[0].id}`, { quantity: 4 }))
      .status,
    409,
  );
  await good('POST', `/orders/${o.order.id}/unsplit`, {});
  split = await good('POST', `/orders/${o.order.id}/split`, { count: 3 });
  for (const b of split.bills) await pay(o, b.amount, { bill_id: b.id });
  assert.equal((await good('GET', `/orders/${o.order.id}`)).order.status, 'paid');
});
test('payment retries are idempotent even when requests race', async () => {
  await open();
  const o = await order(),
    body = { method: 'cash', amount: '200.00', request_key: crypto.randomUUID() };
  const results = await Promise.all([
    request('POST', `/orders/${o.order.id}/payments`, body),
    request('POST', `/orders/${o.order.id}/payments`, body),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [200, 200],
  );
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM payments')).rows[0].n, 1);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM print_jobs')).rows[0].n, 1);
  assert.equal(
    (await request('POST', `/orders/${o.order.id}/payments`, { ...body, amount: '100.00' })).status,
    409,
  );
});
test('partial payments freeze edits, reject overpayments, and require a refund to cancel', async () => {
  await open();
  const o = await order();
  await pay(o, '50.00');
  assert.equal(
    (await request('POST', `/orders/${o.order.id}/cancel`, { reason: 'Test' })).status,
    409,
  );
  assert.equal(
    (
      await request('POST', `/orders/${o.order.id}/items/${o.items[0].id}/cancel`, {
        reason: 'Test',
      })
    ).status,
    409,
  );
  assert.equal(
    (await request('POST', `/orders/${o.order.id}/payments`, { method: 'cash', amount: '151.00' }))
      .status,
    400,
  );
  const refunded = await good('POST', `/orders/${o.order.id}/refund`, {
    reason: 'Customer cancelled',
  });
  assert.equal(refunded.order.status, 'refunded');
  assert.equal(refunded.refunds[0].amount, '50.00');
});
test('refund of an old paid order does not free a table occupied by a new order', async () => {
  await open();
  const first = await order(1);
  await pay(first, '100.00', { method: 'card' });
  const second = await order(1);
  assert.equal(
    (await request('POST', `/orders/${first.order.id}/refund`, { reason: 'Return' })).status,
    400,
  );
  await good('POST', `/orders/${first.order.id}/refund`, {
    reason: 'Return',
    external_confirmed: true,
  });
  const t = (await good('GET', '/tables'))[0];
  assert.equal(t.status, 'busy');
  assert.equal(t.open_order_id, second.order.id);
  assert.equal(
    (
      await request('POST', `/orders/${first.order.id}/refund`, {
        reason: 'Again',
        external_confirmed: true,
      })
    ).status,
    409,
  );
});
test('shift closing rejects open orders and computes cash and refunds correctly', async () => {
  const s = await open(),
    o = await order();
  assert.equal(
    (await request('POST', `/shifts/${s.shift.id}/close`, { closing_cash: 500 })).status,
    409,
  );
  await pay(o);
  await good('POST', `/orders/${o.order.id}/refund`, { reason: 'Return' });
  const closed = await good('POST', `/shifts/${s.shift.id}/close`, { closing_cash: '500.00' });
  assert.equal(closed.shift.expected_cash, 500);
  assert.equal(closed.shift.net, 0);
  assert.equal(closed.shift.difference, 0);
});
test('catalog changes preserve historic order names and prices', async () => {
  await open();
  const o = await order();
  await good('PATCH', '/menu/' + dish.id, { name: 'Новое имя', price: 999, active: false });
  const old = await good('GET', `/orders/${o.order.id}`);
  assert.equal(old.items[0].name, 'Кофе');
  assert.equal(old.items[0].price, '100.00');
  assert.equal((await good('GET', '/menu')).length, 0);
  assert.equal((await good('GET', '/menu?all=true')).length, 1);
  assert.equal((await request('PATCH', '/tables/' + table.id, { active: false })).status, 409);
});
test('reports include net receipts and exports neutralize spreadsheet formulas', async () => {
  await open();
  await good('PATCH', '/tables/' + table.id, { name: '=2+2' });
  const o = await order();
  await pay(o, '200.00', { method: 'online' });
  const report = await good('GET', '/reports/sales');
  assert.equal(report.net, 200);
  assert.equal(report.paid_orders, 1);
  assert.equal(report.payments[0].method, 'online');
  const exported = await request('GET', '/orders/history.csv');
  assert.match(exported.data, /'=2\+2/);
  assert.match(exported.headers.get('content-type'), /text\/csv/);
  assert.equal((await request('GET', '/reports/sales', undefined, waiter)).status, 403);
  assert.equal((await request('GET', '/reports/sales?from=2026-02-30')).status, 400);
});
test('a later refund preserves the original sales date, ticket count, and top dishes', async () => {
  await open();
  const o = await order();
  await pay(o);
  await db.query("UPDATE payments SET paid_at='2026-01-10T12:00:00+06:00' WHERE order_id=$1", [
    o.order.id,
  ]);
  await good('POST', `/orders/${o.order.id}/refund`, { reason: 'Returned later' });
  await db.query("UPDATE refunds SET created_at='2026-01-11T12:00:00+06:00' WHERE order_id=$1", [
    o.order.id,
  ]);
  const sales = await good('GET', '/reports/sales?from=2026-01-10&to=2026-01-10');
  assert.equal(sales.sales, 200);
  assert.equal(sales.net, 200);
  assert.equal(sales.paid_orders, 1);
  assert.equal(sales.average, 200);
  assert.equal(sales.top[0].quantity, 2);
  assert.equal(sales.daily[0].day, '2026-01-10');
  const returns = await good('GET', '/reports/sales?from=2026-01-11&to=2026-01-11');
  assert.equal(returns.net, -200);
  assert.equal(returns.paid_orders, 0);
});
test('receipts escape untrusted text and are labeled as nonfiscal', async () => {
  await open();
  await good('PATCH', '/menu/' + dish.id, { name: '<script>alert(1)</script>' });
  const o = await order(1);
  await pay(o);
  const r = await request('GET', `/orders/${o.order.id}/receipt`);
  assert.equal(r.status, 200);
  assert.match(r.data, /НЕ ФИСКАЛЬНЫЙ ЧЕК/);
  assert.match(r.data, /&lt;script&gt;/);
  assert.doesNotMatch(r.data, /<script>alert/);
});
test('origin protection rejects cross-site mutations and socket updates require authentication', async () => {
  assert.equal(
    (
      await request('POST', '/tables', { name: 'Cross site' }, admin, {
        Origin: 'https://attacker.example',
      })
    ).status,
    403,
  );
  const unauthorized = connect(base, { transports: ['websocket'], reconnection: false });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Expected auth rejection')), 3000);
    unauthorized.on('connect_error', () => {
      clearTimeout(timer);
      unauthorized.close();
      resolve();
    });
  });
  const socket = connect(base, {
    transports: ['websocket'],
    auth: { token: waiter },
    reconnection: false,
  });
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  const event = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Missing invalidation')), 3000);
    socket.once('changed', (value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
  await good('POST', '/tables', { name: 'Стол 2' });
  assert.equal((await event).scope, 'tables');
  socket.close();
});
test('migrations are repeatable without changing existing data', async () => {
  await migrate();
  assert.equal((await good('GET', '/tables'))[0].name, 'Стол 1');
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM schema_migrations')).rows[0].n, 2);
});
