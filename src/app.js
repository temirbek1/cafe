const express = require('express');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { Server } = require('socket.io');
const pool = require('./db');
const { userFromToken, tokenFrom } = require('./middleware/auth');

function allowedOrigin(origin, host) {
  if (!origin) return true;
  try {
    return (
      new URL(origin).host === host || (process.env.CORS_ORIGIN || '').split(',').includes(origin)
    );
  } catch {
    return false;
  }
}
function createServer() {
  const app = express(),
    server = http.createServer(app);
  app.disable('x-powered-by');
  const io = new Server(server, {
    allowRequest: (req, callback) =>
      callback(null, allowedOrigin(req.headers.origin, req.headers.host)),
  });
  app.set('io', io);
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    res.set('Referrer-Policy', 'same-origin');
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; font-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    );
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !allowedOrigin(req.headers.origin, req.headers.host)
    )
      return res.status(403).json({ error: 'Запрос с другого сайта запрещён' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json'))
      return res.status(415).json({ error: 'Ожидается JSON' });
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use((req, res, next) => {
    req.body ??= {};
    next();
  });
  app.get('/health', async (req, res) => {
    await pool.query('SELECT 1');
    res.json({ app: 'cafe-pos', status: 'ok' });
  });
  for (const route of ['auth', 'orders', 'menu', 'tables', 'shifts', 'reports', 'settings'])
    app.use(
      '/' + route,
      (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
      },
      require('./routes/' + route),
    );
  app.get('/cashier', (req, res) => res.redirect('/'));
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist, { index: false }));
  app.get('/', (req, res) => {
    if (!fs.existsSync(path.join(dist, 'index.html')))
      return res.status(503).type('text').send('Сначала выполните npm run build');
    res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html'));
  });
  app.use((req, res) => res.status(404).json({ error: 'Страница не найдена' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const mapped = {
      23505: [409, 'Такая запись уже существует или операция уже выполнена'],
      23503: [400, 'Связанная запись отсутствует или используется'],
      23514: [400, 'Значение не соответствует правилам'],
      '22P02': [400, 'Неверный идентификатор или формат данных'],
      22003: [400, 'Число слишком велико'],
    };
    const known = mapped[error.code];
    const status = error.status || known?.[0] || 500;
    if (status >= 500) console.error('Request failed:', error.code || error.message);
    res.status(status).json({
      error:
        known?.[1] ||
        (status < 500 ? error.message : 'Ошибка сервера. Обновите данные и повторите действие'),
    });
  });
  io.use(async (socket, next) => {
    try {
      socket.data.user = await userFromToken(
        socket.handshake.auth.token || tokenFrom(socket.request),
      );
      next();
    } catch {
      next(new Error('Войдите снова'));
    }
  });
  io.on('connection', (socket) => {
    const user = socket.data.user;
    socket.join(`user:${user.id}`);
    socket.join(`session:${user.session_id}`);
    const timeout = setTimeout(
      () => socket.disconnect(true),
      Math.max(1, new Date(user.expires_at).getTime() - Date.now()),
    );
    timeout.unref();
    socket.on('disconnect', () => clearTimeout(timeout));
  });
  return { app, server, io };
}
module.exports = { createServer, allowedOrigin };
