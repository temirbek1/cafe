const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const pool = require('../db');
const {
  authenticate,
  allowRoles,
  getSecret,
  tokenFrom,
  userFromToken,
} = require('../middleware/auth');
const { transaction, fail, text, audit, changed, boolean } = require('../lib');
const { secureCookie, sessionHours, randomId } = require('../config');
const router = express.Router();
const roles = ['admin', 'manager', 'cashier', 'waiter'];
const cookie = { httpOnly: true, sameSite: 'strict', secure: secureCookie, path: '/' };
const safe = (u) => ({ id: u.id, name: u.name, login: u.login, role: u.role });
function passwordValue(value) {
  if (typeof value !== 'string' || value.length < 8 || Buffer.byteLength(value) > 72) {
    fail(400, 'Пароль: не менее 8 символов и не более 72 байт');
  }
  return value;
}
const local = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Слишком много попыток входа. Повторите через 15 минут' },
});

router.get('/status', async (req, res) =>
  res.json({
    configured: (await pool.query('SELECT EXISTS(SELECT 1 FROM users) AS value')).rows[0].value,
    can_setup: local(req),
  }),
);
router.post('/register', loginLimit, async (req, res) => {
  const name = text(req.body.name, 'Имя'),
    login = text(req.body.login, 'Логин', 60).toLowerCase();
  const password = passwordValue(req.body.password),
    role = req.body.role || 'waiter';
  if (!/^[a-z0-9_.-]{2,60}$/.test(login))
    fail(400, 'Логин: 2–60 латинских букв, цифр, точек, дефисов');
  if (!roles.includes(role)) fail(400, 'Неизвестная роль');
  if (tokenFrom(req)) req.user = await userFromToken(tokenFrom(req));
  const hash = await bcrypt.hash(password, 12);
  const user = await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(90251002)');
    const configured = (await client.query('SELECT EXISTS(SELECT 1 FROM users) AS value')).rows[0]
      .value;
    if (!configured) {
      if (!local(req)) fail(403, 'Первую настройку выполните на терминале через localhost');
      if (role !== 'admin') fail(400, 'Первый пользователь должен быть администратором');
    } else if (req.user?.role !== 'admin') fail(403, 'Сотрудников добавляет администратор');
    const user = (
      await client.query(
        'INSERT INTO users(name,login,password,role) VALUES($1,$2,$3,$4) RETURNING id,name,login,role',
        [name, login, hash, role],
      )
    ).rows[0];
    await audit(client, req, 'user.create', user.id, { name, login, role });
    return user;
  });
  changed(req, 'users');
  res.status(201).json({ user });
});
router.post('/login', loginLimit, async (req, res) => {
  const login = text(req.body.login, 'Логин', 60).toLowerCase();
  if (typeof req.body.password !== 'string' || req.body.password.length > 200)
    fail(400, 'Введите пароль');
  const user = (await pool.query('SELECT * FROM users WHERE login=$1 AND active=TRUE', [login]))
    .rows[0];
  if (!user || !(await bcrypt.compare(req.body.password, user.password)))
    fail(401, 'Неверный логин или пароль');
  const sessionId = randomId();
  await pool.query(
    "INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,NOW()+$3*INTERVAL '1 hour')",
    [sessionId, user.id, sessionHours],
  );
  await pool.query('DELETE FROM sessions WHERE expires_at<NOW()');
  const token = jwt.sign({}, getSecret(), {
    algorithm: 'HS256',
    subject: String(user.id),
    jwtid: sessionId,
    expiresIn: `${sessionHours}h`,
  });
  res.cookie('cafe_token', token, { ...cookie, maxAge: sessionHours * 60 * 60 * 1000 });
  res.json({ user: safe(user), token });
});
router.get('/me', authenticate, (req, res) => res.json({ user: safe(req.user) }));
router.post('/logout', authenticate, async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE id=$1', [req.user.session_id]);
  req.app.get('io')?.in(`session:${req.user.session_id}`).disconnectSockets(true);
  res.clearCookie('cafe_token', cookie);
  res.status(204).end();
});
router.get('/users', authenticate, allowRoles('admin'), async (req, res) =>
  res.json(
    (
      await pool.query(
        'SELECT id,name,login,role,active,created_at FROM users ORDER BY active DESC,name',
      )
    ).rows,
  ),
);
router.patch('/users/:id', authenticate, allowRoles('admin'), async (req, res) => {
  const input = req.body,
    updates = {};
  if (input.name !== undefined) updates.name = text(input.name, 'Имя');
  if (input.role !== undefined) {
    if (!roles.includes(input.role)) fail(400, 'Неизвестная роль');
    updates.role = input.role;
  }
  if (input.active !== undefined) updates.active = boolean(input.active, 'Активность');
  if (
    String(req.user.id) === req.params.id &&
    (updates.active === false || (updates.role && updates.role !== 'admin'))
  )
    fail(400, 'Нельзя отключить собственную запись или снять с себя права администратора');
  if (input.password !== undefined)
    updates.password = await bcrypt.hash(passwordValue(input.password), 12);
  if (!Object.keys(updates).length) fail(400, 'Нет изменений');
  const user = await transaction(async (client) => {
    const fields = Object.keys(updates),
      values = Object.values(updates);
    const user = (
      await client.query(
        `UPDATE users SET ${fields.map((f, i) => `${f}=$${i + 1}`).join(',')} WHERE id=$${fields.length + 1} RETURNING id,name,login,role,active`,
        [...values, req.params.id],
      )
    ).rows[0];
    if (!user) fail(404, 'Сотрудник не найден');
    await client.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    await audit(client, req, 'user.update', user.id, {
      ...updates,
      password: updates.password ? 'changed' : undefined,
    });
    return user;
  });
  req.app.get('io')?.in(`user:${user.id}`).disconnectSockets(true);
  changed(req, 'users');
  res.json({ user });
});
module.exports = router;
