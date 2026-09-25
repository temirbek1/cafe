const fs = require('node:fs/promises');
const path = require('node:path');
const { transaction } = require('./lib');

async function migrate() {
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(90251001)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())',
    );
    const applied = new Set(
      (await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const directory = path.join(__dirname, '..', 'sql');
    if (!applied.has('001-original')) {
      await client.query(await fs.readFile(path.join(directory, 'schema.sql'), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', ['001-original']);
    }
    for (const filename of (await fs.readdir(path.join(directory, 'migrations')))
      .filter((f) => f.endsWith('.sql'))
      .sort()) {
      if (applied.has(filename)) continue;
      await client.query(await fs.readFile(path.join(directory, 'migrations', filename), 'utf8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [filename]);
    }
  });
}
module.exports = migrate;
