const jwt = require('jsonwebtoken');
const pool = require('../db');
const { fail } = require('../lib');
const getSecret = () => process.env.JWT_SECRET;
function tokenFrom(request) {
  const header = request.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return (request.headers.cookie || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('cafe_token='))
    ?.slice(11);
}
async function userFromToken(token) {
  if (!token) fail(401, 'Войдите в систему');
  let claims;
  try {
    claims = jwt.verify(token, getSecret(), { algorithms: ['HS256'] });
  } catch {
    fail(401, 'Сессия истекла. Войдите снова');
  }
  if (!claims.jti || !claims.sub) fail(401, 'Войдите снова');
  const result = await pool.query(
    `SELECT u.id,u.name,u.login,u.role,s.id AS session_id,s.expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.id=$1 AND u.id=$2 AND u.active=TRUE AND s.expires_at>NOW()`,
    [claims.jti, claims.sub],
  );
  if (!result.rows[0]) fail(401, 'Сессия завершена или доступ отключён');
  return result.rows[0];
}
async function authenticate(req, res, next) {
  try {
    req.user = await userFromToken(tokenFrom(req));
    next();
  } catch (error) {
    next(error);
  }
}
function allowRoles(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role))
      return res.status(403).json({ error: 'Недостаточно прав для этого действия' });
    next();
  };
}
module.exports = { authenticate, allowRoles, getSecret, userFromToken, tokenFrom };
