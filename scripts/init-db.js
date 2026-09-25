require('../src/config');
const { Client } = require('pg');
const pool = require('../src/db');
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('Сначала создайте .env с DATABASE_URL');
  const url = new URL(process.env.DATABASE_URL),
    database = decodeURIComponent(url.pathname.slice(1));
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,62}$/.test(database))
    throw new Error('Имя базы: латинские буквы, цифры, подчёркивания');
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const client = new Client({ connectionString: maintenance.toString() });
  try {
    await client.connect();
    if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [database])).rowCount) {
      await client.query(`CREATE DATABASE "${database}"`);
      console.log('База создана.');
    }
  } finally {
    await client.end();
  }
  await require('../src/migrate')();
  console.log('Схема базы готова. Данные существующей базы сохранены.');
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
