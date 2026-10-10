const express = require('express');
const os = require('node:os');
const pool = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');
const { text, integer, fail, transaction, audit, changed } = require('../lib');
const { printers, testPrint } = require('../services/printing');
const router = express.Router();
router.use(authenticate);
const admin = allowRoles('admin');
router.get('/', async (req, res) => {
  const settings = (await pool.query('SELECT value FROM settings WHERE id=TRUE')).rows[0].value;
  res.json({
    ...settings,
    windows_print_available: process.platform === 'win32',
    fiscal_connected: false,
    bank_connected: false,
  });
});
router.patch('/', admin, async (req, res) => {
  const old = (await pool.query('SELECT value FROM settings WHERE id=TRUE')).rows[0].value;
  const input = req.body,
    updates = { ...old };
  for (const key of ['name', 'address', 'phone', 'printer_name'])
    if (input[key] !== undefined) updates[key] = input[key] ? text(input[key], key, 200) : '';
  delete updates.kitchen_printer_name;
  if (input.qr_image !== undefined) {
    const image = input.qr_image;
    if (image === '') updates.qr_image = '';
    else {
      const match = typeof image === 'string' && image.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) fail(400, 'Загрузите QR-картинку в формате PNG или JPEG');
      const bytes = Buffer.from(match[2], 'base64');
      if (bytes.length > 1024 * 1024) fail(400, 'Размер QR-картинки не должен превышать 1 МБ');
      const isPng = match[1] === 'png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const isJpeg = match[1] === 'jpeg' && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!isPng && !isJpeg) fail(400, 'Файл не соответствует формату PNG или JPEG');
      updates.qr_image = image;
    }
  }
  if (!updates.name) fail(400, 'Введите название кафе');
  if (input.receipt_width !== undefined) {
    const width = integer(input.receipt_width, 'Ширина чека', 58, 80);
    if (![58, 80].includes(width)) fail(400, 'Ширина чека: 58 или 80 мм');
    updates.receipt_width = width;
  }
  if (input.print_mode !== undefined) {
    if (!['browser', 'windows'].includes(input.print_mode)) fail(400, 'Неверный режим печати');
    updates.print_mode = input.print_mode;
  }
  if (updates.print_mode === 'windows') {
    if (process.platform !== 'win32') fail(400, 'Этот сервер работает не на Windows');
    if (!updates.printer_name) fail(400, 'Выберите установленный Windows-принтер');
    const available = await printers();
    if (!available.some((p) => p.name === updates.printer_name))
      fail(400, 'Принтер не найден в Windows');
  }
  await transaction(async (c) => {
    await c.query('UPDATE settings SET value=$1 WHERE id=TRUE', [JSON.stringify(updates)]);
    const { qr_image, ...auditSettings } = updates;
    await audit(c, req, 'settings.update', 'cafe', {
      ...auditSettings,
      qr_image_configured: Boolean(qr_image),
    });
  });
  changed(req, 'settings');
  res.json(updates);
});
router.get('/network', admin, (req, res) => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a.address}:${process.env.PORT || 3000}`);
  res.json({ addresses });
});
router.get('/printers', admin, async (req, res) => res.json({ printers: await printers() }));
router.post('/print-test', admin, async (req, res) => {
  if (process.platform !== 'win32') fail(400, 'Windows print is available only on the POS terminal');
  const printer = text(req.body.printer, 'Printer', 200);
  const width = integer(req.body.width, 'Receipt width', 58, 80);
  if (![58, 80].includes(width)) fail(400, 'Receipt width must be 58 or 80 mm');
  if (!(await printers()).some((item) => item.name === printer)) fail(400, 'Printer not found in Windows');
  const settings = (await pool.query('SELECT value FROM settings WHERE id=TRUE')).rows[0].value;
  await testPrint(printer, width, settings.name);
  res.json({ submitted: true });
});
router.get('/print-jobs', allowRoles('admin', 'manager', 'cashier'), async (req, res) =>
  res.json(
    (
      await pool.query(
        'SELECT id,order_id,kind,status,error,attempts,created_at FROM print_jobs ORDER BY id DESC LIMIT 100',
      )
    ).rows,
  ),
);
router.post(
  '/print-jobs/:id/retry',
  allowRoles('admin', 'manager', 'cashier'),
  async (req, res) => {
    if (req.body.confirm !== true)
      fail(400, 'Подтвердите, что проверили принтер и очередь Windows');
    const job = await transaction(async (c) => {
      const printSettings = (await c.query('SELECT value FROM settings WHERE id=TRUE')).rows[0].value;
      const jobKind = (await c.query('SELECT kind FROM print_jobs WHERE id=$1', [req.params.id])).rows[0]?.kind;
      const mode = jobKind === 'kitchen'
        ? (process.platform === 'win32' && printSettings.print_mode === 'windows' && printSettings.printer_name ? 'windows' : 'browser')
        : printSettings.print_mode;
      const job = (
        await c.query(
          "UPDATE print_jobs SET status=$1,error=NULL,updated_at=NOW() WHERE id=$2 AND status NOT IN ('pending','printing') RETURNING id",
          [mode === 'windows' ? 'pending' : 'manual', req.params.id],
        )
      ).rows[0];
      if (!job) fail(409, 'Задание уже ожидает печати или не найдено');
      await audit(c, req, 'print.retry', job.id);
      return job;
    });
    changed(req, 'printing');
    res.json(job);
  },
);
module.exports = router;
