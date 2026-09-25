const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.DATABASE_URL
    ? {}
    : {
        user: process.env.DB_USER || 'postgres',
        host: process.env.DB_HOST || 'localhost',
        database: process.env.DB_NAME || 'cafe',
        password: process.env.DB_PASSWORD,
        port: Number(process.env.DB_PORT || 5432),
      }),
});

pool.on('error', (err) => console.error('Unexpected PostgreSQL error', err));

module.exports = pool;
