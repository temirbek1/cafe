const { spawn } = require('node:child_process');
const path = require('node:path');
const pool = require('../db');
const { transaction, fail } = require('../lib');
const { getOrder } = require('./orders');
const methods = { cash: 'Наличные', card: 'Карта', online: 'QR' };
function kitchenLines(payload) {
  return [
    payload.settings.name,
    'ЗАКАЗ НА КУХНЮ',
    `Заказ № ${payload.number}`,
    `${payload.order.table_name} · ${payload.order.waiter_name}`,
    `Гостей: ${payload.order.guest_count}`,
    new Date(payload.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' }),
    '--------------------------------',
    ...payload.items.flatMap((item) => [
      `${item.quantity} x ${item.name}`,
      ...(item.note ? [`  ${item.note}`] : []),
    ]),
    ...(payload.order.comment ? ['--------------------------------', `Комментарий: ${payload.order.comment}`] : []),
    '--------------------------------',
    '',
    '',
  ];
}
function kitchenHtml(payload) {
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Заказ №${escape(payload.number)} — кухня</title><style>@page{size:80mm auto;margin:4mm}*{box-sizing:border-box}body{font:14px Arial,sans-serif;width:72mm;max-width:100%;margin:16px auto;color:#000}h1{font-size:20px;margin:0 0 10px}p{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}.item{font-size:17px;font-weight:bold;margin-top:12px}.note{font-size:14px;margin:3px 0 0 12px}.rule{border:0;border-top:1px dashed #000;margin:10px 0}button{padding:10px 14px;font:inherit;cursor:pointer;margin-bottom:14px}@media print{body{margin:0;width:auto}button{display:none}}</style><button onclick="window.print()">Печать / сохранить PDF</button><h1>${escape(payload.settings.name)}<br>ЗАКАЗ НА КУХНЮ №${escape(payload.number)}</h1><p>${escape(payload.order.table_name)} · ${escape(payload.order.waiter_name)}</p><p>Гостей: ${escape(payload.order.guest_count)}</p><p>${escape(new Date(payload.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' }))}</p><hr class="rule">${payload.items.map((item) => `<p class="item">${escape(item.quantity)} × ${escape(item.name)}</p>${item.note ? `<p class="note">${escape(item.note)}</p>` : ''}`).join('')}${payload.order.comment ? `<hr class="rule"><p>Комментарий: ${escape(payload.order.comment)}</p>` : ''}<script>window.addEventListener('load',()=>window.print())</script></html>`;
}
async function queueKitchen(client, orderId) {
  const data = await getOrder(client, orderId);
  if (!data.items.some((item) => item.status === 'active')) fail(400, 'Добавьте блюда перед отправкой на кухню');
  const settings = (await client.query('SELECT value FROM settings WHERE id=TRUE')).rows[0].value;
  const payload = {
    kind: 'kitchen',
    number: String(orderId),
    created_at: new Date().toISOString(),
    settings,
    order: data.order,
    items: data.items.filter((item) => item.status === 'active'),
  };
  await client.query(
    "INSERT INTO print_jobs(order_id,kind,payload,status) VALUES($1,'kitchen',$2,'manual') ON CONFLICT(order_id,kind) DO UPDATE SET payload=EXCLUDED.payload,status='manual',error=NULL,updated_at=NOW()",
    [orderId, JSON.stringify(payload)],
  );
  return (await client.query("SELECT status FROM print_jobs WHERE order_id=$1 AND kind='kitchen'", [orderId])).rows[0]?.status || 'pending';
}
async function queueReceipt(client, orderId, kind) {
  const data = await getOrder(client, orderId),
    settings = (await client.query('SELECT value FROM settings WHERE id=TRUE')).rows[0].value;
  const payload = {
    kind,
    number: String(orderId),
    created_at: new Date().toISOString(),
    settings,
    order: data.order,
    items: data.items.filter((i) => i.status === 'active'),
    payments: data.payments,
    refunds: data.refunds,
  };
  await client.query(
    'INSERT INTO print_jobs(order_id,kind,payload,status) VALUES($1,$2,$3,$4) ON CONFLICT(order_id,kind) DO NOTHING',
    [
      orderId,
      kind,
      JSON.stringify(payload),
      settings.print_mode === 'windows' ? 'pending' : 'manual',
    ],
  );
}
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const money = (v) => Number(v).toFixed(2) + ' сом';
function receiptLines(p) {
  return [
    p.settings.name,
    p.settings.address,
    p.settings.phone,
    p.kind === 'refund' ? 'ВОЗВРАТ' : 'КВИТАНЦИЯ ОБ ОПЛАТЕ',
    `Заказ № ${p.number}`,
    new Date(p.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' }),
    `${p.order.table_name} · ${p.order.waiter_name}`,
    '--------------------------------',
    ...p.items.flatMap((i) => [
      i.name,
      `${i.quantity} × ${money(i.price)} = ${money(Number(i.price) * i.quantity)}`,
    ]),
    '--------------------------------',
    p.kind === 'refund'
      ? `Сумма заказа: ${money(p.order.total)}`
      : `ИТОГО: ${money(p.order.total)}`,
    ...(p.kind === 'refund'
      ? [`ВОЗВРАЩЕНО: ${money(p.refunds.reduce((sum, item) => sum + Number(item.amount), 0))}`]
      : []),
    ...(p.kind === 'refund' ? p.refunds : p.payments).map(
      (x) => `${methods[x.method]}: ${money(x.amount)}`,
    ),
    p.kind === 'refund' ? `Причина: ${p.order.cancel_reason}` : 'Спасибо за визит!',
    'НЕ ФИСКАЛЬНЫЙ ЧЕК',
  ].filter(Boolean);
}
function receiptHtml(p) {
  if (p.settings.print_mode === 'windows') {
    return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Квитанция №${escape(p.number)}</title><style>@page{size:${p.settings.receipt_width}mm auto;margin:3mm}*{box-sizing:border-box}body{font:13px monospace;width:${p.settings.receipt_width - 6}mm;max-width:calc(100% - 16px);margin:20px auto;color:#000;background:#fff}p{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}p:first-of-type{font-size:19px;font-weight:bold}</style>${receiptLines(p).map((line) => `<p>${escape(line)}</p>`).join('')}</html>`;
  }
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Квитанция №${escape(p.number)}</title><style>@page{size:${p.settings.receipt_width}mm auto;margin:3mm}*{box-sizing:border-box}body{font:13px monospace;width:${p.settings.receipt_width - 6}mm;max-width:calc(100% - 16px);margin:20px auto;color:#000;background:#fff}p{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}p:first-of-type{font-size:19px;font-weight:bold}button{padding:12px;font:inherit;cursor:pointer;width:100%;margin-bottom:18px}@media print{body{margin:0;max-width:none}button{display:none}}</style><button id="print">Печатать</button>${receiptLines(
    p,
  )
    .map((line) => `<p>${escape(line)}</p>`)
    .join('')}<script src="/receipt-print.js"></script></html>`;
}
function powershell(script, input) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32')
      return reject(new Error('Печать через Windows доступна только на Windows POS'));
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(__dirname, '..', '..', 'scripts', script),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '',
      error = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Время ожидания печати истекло. Проверьте очередь Windows перед повтором'));
    }, 30000);
    child.stdout.on('data', (d) => (output += d.toString('utf8')));
    child.stderr.on('data', (d) => (error += d.toString('utf8')));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(error.trim() || 'Не удалось передать задание Windows'));
      else {
        try {
          resolve(JSON.parse(output.replace(/^\uFEFF/, '')));
        } catch {
          reject(new Error('Не удалось подтвердить передачу задания Windows'));
        }
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input || {}));
  });
}
async function printers() {
  return process.platform === 'win32' ? powershell('List-Printers.ps1') : [];
}
async function testPrint(printer, width, cafeName) {
  return powershell('Print-Receipt.ps1', {
    printer,
    width,
    lines: [cafeName || 'Cafe POS', 'Printer test', new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek' }), 'This is a test receipt.'],
  });
}
async function startPrinter(io) {
  await pool.query(
    "UPDATE print_jobs SET status='uncertain',error='Сервер перезапущен во время печати. Проверьте принтер перед повтором' WHERE status='printing'",
  );
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const settings = (await pool.query('SELECT value FROM settings WHERE id=TRUE')).rows[0].value;
      const allowReceiptPrinting = settings.print_mode === 'windows';
      const job = await transaction(async (c) => {
        const job = (
          await c.query(
            "SELECT * FROM print_jobs WHERE status='pending' AND kind<>'kitchen' AND $1::boolean ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED",
            [allowReceiptPrinting],
          )
        ).rows[0];
        if (job)
          await c.query(
            "UPDATE print_jobs SET status='printing',attempts=attempts+1,updated_at=NOW() WHERE id=$1",
            [job.id],
          );
        return job;
      });
      if (!job) return;
      try {
        if (!settings.printer_name) fail(400, 'Выберите принтер в настройках');
        await powershell('Print-Receipt.ps1', {
          printer: settings.printer_name,
          width: job.payload.settings.receipt_width,
          lines: receiptLines(job.payload),
        });
        await pool.query(
          "UPDATE print_jobs SET status='submitted',error=NULL,updated_at=NOW() WHERE id=$1",
          [job.id],
        );
      } catch (error) {
        await pool.query(
          "UPDATE print_jobs SET status='uncertain',error=$1,updated_at=NOW() WHERE id=$2",
          [error.message.slice(0, 1000), job.id],
        );
      }
      io.emit('changed', { scope: 'printing' });
    } catch (error) {
      console.error('Printer worker:', error.message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 1500);
  timer.unref();
  return () => clearInterval(timer);
}
module.exports = { queueReceipt, queueKitchen, kitchenLines, kitchenHtml, receiptHtml, receiptLines, printers, testPrint, startPrinter };
