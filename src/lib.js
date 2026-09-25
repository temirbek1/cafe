const pool = require('./db');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function fail(status, message) {
  throw new HttpError(status, message);
}
function text(value, label, max = 150) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    fail(400, `${label}: заполните поле (до ${max} символов)`);
  return value.trim();
}
function integer(value, label, min = 1, max = 1000000) {
  if (value === null || value === '' || typeof value === 'boolean')
    fail(400, `${label}: неверное число`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    fail(400, `${label}: число от ${min} до ${max}`);
  return n;
}
function cents(value, label = 'Сумма', allowZero = false) {
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(String(value)))
    fail(400, `${label}: введите сумму с точностью до тыйынов`);
  const [whole, fraction = ''] = String(value).split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!allowZero && result === 0) fail(400, `${label} должна быть больше нуля`);
  return result;
}
function decimal(value) {
  return (value / 100).toFixed(2);
}
function boolean(value, label) {
  if (typeof value !== 'boolean') fail(400, `${label}: неверное значение`);
  return value;
}
async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
async function audit(client, req, action, entityId, details = {}) {
  await client.query(
    'INSERT INTO audit_log (user_id, action, entity_id, details) VALUES ($1,$2,$3,$4)',
    [
      req.user?.id || null,
      action,
      entityId == null ? null : String(entityId),
      JSON.stringify(details),
    ],
  );
}
function changed(req, scope = 'orders') {
  req.app.get('io')?.emit('changed', { scope });
}
function dateRange(query) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek' }).format(new Date());
  const from = query.from || today,
    to = query.to || today;
  for (const d of [from, to]) {
    if (
      typeof d !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
      !Number.isFinite(Date.parse(d)) ||
      new Date(d).toISOString().slice(0, 10) !== d
    )
      fail(400, 'Неверная дата');
  }
  if (from > to) fail(400, 'Начальная дата больше конечной');
  return [from, to];
}
function csv(rows) {
  return (
    '\ufeff' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let str = value == null ? '' : String(value);
            if (/^[\s]*[=+\-@]/.test(str)) str = "'" + str;
            return '"' + str.replaceAll('"', '""') + '"';
          })
          .join(';'),
      )
      .join('\r\n')
  );
}
module.exports = {
  fail,
  text,
  integer,
  cents,
  decimal,
  boolean,
  transaction,
  audit,
  changed,
  dateRange,
  csv,
};
