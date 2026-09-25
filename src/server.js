const config = require('./config');
const pool = require('./db');
const migrate = require('./migrate');
const { createServer } = require('./app');
const { startPrinter } = require('./services/printing');

async function start() {
  config.validateConfig();
  await migrate();
  const { server, io } = createServer();
  const stopPrinter = await startPrinter(io);
  server.listen(config.port, config.host, () =>
    console.log(`Cafe POS: http://localhost:${config.port} (LAN: ${config.host})`),
  );
  server.on('error', (error) => {
    console.error(error.message);
    process.exit(1);
  });
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    stopPrinter();
    io.close();
    server.close();
    await pool.end();
  }
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
start().catch((error) => {
  console.error(error.message);
  pool.end().finally(() => process.exit(1));
});
