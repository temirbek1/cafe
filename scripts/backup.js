require('../src/config');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL не настроен');
  const url = new URL(process.env.DATABASE_URL),
    directory = path.resolve(process.env.BACKUP_DIR || 'backups');
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(
      directory,
      'cafe-' + new Date().toISOString().replace(/[:.]/g, '-') + '.dump',
    ),
    temporary = target + '.partial';
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
  if (url.searchParams.has('sslmode')) env.PGSSLMODE = url.searchParams.get('sslmode');
  delete env.DATABASE_URL;
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.env.PG_DUMP_PATH || 'pg_dump',
        ['--format=custom', '--file', temporary],
        { env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] },
      );
      child.on('error', reject);
      child.on('close', (code) =>
        code === 0 ? resolve() : reject(new Error('pg_dump завершился с ошибкой ' + code)),
      );
    });
    const stat = await fs.stat(temporary);
    if (stat.size === 0) throw new Error('Получена пустая копия');
    await fs.rename(temporary, target);
    console.log('Резервная копия: ' + target);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
