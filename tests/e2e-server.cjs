const { Pool } = require('pg');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
if (!process.env.TEST_DATABASE_URL)
  throw new Error('TEST_DATABASE_URL is required; E2E uses a disposable schema');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_SECRET = 'e2e-only-secret-at-least-32-characters';
const schema = process.env.E2E_SCHEMA || 'pos_e2e_' + crypto.randomBytes(8).toString('hex');
if (!/^pos_e2e_[0-9a-f]{16}$/.test(schema)) throw new Error('Invalid E2E schema');
process.env.PGOPTIONS = `-c search_path=${schema}`;
const admin = new Pool({
    connectionString: process.env.DATABASE_URL,
    options: '-c search_path=public',
  }),
  db = require('../src/db');
let io,
  server,
  stopping = false;
async function start() {
  await admin.query(`CREATE SCHEMA ${schema}`);
  await require('../src/migrate')();
  const hash = await bcrypt.hash('cafe-e2e-password', 12);
  for (const [name, login, role] of [
    ['Айбек', 'e2e_admin', 'admin'],
    ['Айдана', 'e2e_waiter', 'waiter'],
    ['Тимур', 'e2e_other', 'waiter'],
  ])
    await db.query('INSERT INTO users(name,login,password,role) VALUES($1,$2,$3,$4)', [
      name,
      login,
      hash,
      role,
    ]);
  await db.query('INSERT INTO shifts(user_id,opening_cash) VALUES(1,500)');
  await db.query(
    `UPDATE settings SET value=value||'{"name":"Apricot café","address":"Бишкек","phone":""}'::jsonb`,
  );
  for (let i = 1; i <= 8; i++)
    await db.query('INSERT INTO tables(name) VALUES($1)', ['Стол ' + String(i).padStart(2, '0')]);
  for (const [i, name] of ['Кофе', 'Завтраки', 'Горячее', 'Десерты', 'Напитки'].entries())
    await db.query('INSERT INTO menu_categories(name,sort_order) VALUES($1,$2)', [name, i]);
  const dishes = [
    ['Капучино', 180, 1, true],
    ['Латте', 210, 1, true],
    ['Американо', 140, 1, true],
    ['Флэт уайт', 220, 1, false],
    ['Сырники со сметаной', 320, 2, true],
    ['Омлет с овощами', 290, 2, false],
    ['Овсяная каша', 220, 2, false],
    ['Паста карбонара', 490, 3, true],
    ['Боул с курицей', 420, 3, false],
    ['Томатный суп', 280, 3, false],
    ['Чизкейк', 260, 4, true],
    ['Круассан с миндалём', 240, 4, false],
    ['Морковный торт', 290, 4, false],
    ['Матча латте', 270, 5, false],
    ['Облепиховый чай', 230, 5, true],
    ['Апельсиновый фреш', 250, 5, false],
  ];
  for (const d of dishes)
    await db.query(
      'INSERT INTO menu_items(name,price,category_id,is_quick) VALUES($1,$2,$3,$4)',
      d,
    );
  ({ server, io } = require('../src/app').createServer());
  server.listen(Number(process.env.E2E_PORT || 31774), '127.0.0.1', () => console.log('E2E ready'));
}
async function stop() {
  if (stopping) return;
  stopping = true;
  if (io) await new Promise((resolve) => io.close(resolve));
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await admin.end();
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
start().catch(async (e) => {
  console.error(e);
  await stop();
  process.exit(1);
});
