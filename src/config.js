require('dotenv').config({ quiet: true });
const crypto = require('node:crypto');

function validateConfig() {
  if (!process.env.DATABASE_URL)
    throw new Error('Задайте DATABASE_URL в файле .env. См. README.md');
  const secret = process.env.JWT_SECRET || '';
  if (secret.length < 32 || /replace_this|development-only/.test(secret)) {
    throw new Error(
      "JWT_SECRET должен содержать не менее 32 случайных символов. Создайте его: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
    );
  }
}

module.exports = {
  validateConfig,
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  secureCookie: process.env.COOKIE_SECURE === 'true',
  sessionHours: 12,
  randomId: () => crypto.randomUUID(),
};
