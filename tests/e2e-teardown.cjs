const { Pool } = require('pg');
// Also clean up on Windows, where process termination does not deliver SIGTERM.
module.exports = async () => {
  const schema = process.env.E2E_SCHEMA;
  if (!process.env.TEST_DATABASE_URL || !/^pos_e2e_[0-9a-f]{16}$/.test(schema || '')) return;
  const db = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  try {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  } finally {
    await db.end();
  }
};
