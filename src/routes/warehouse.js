const express = require('express');
const pool = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');
const { text, fail, transaction, audit, changed } = require('../lib');

const router = express.Router();
router.use(authenticate);
const admin = allowRoles('admin');

function stockValue(value, label) {
  if (!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(String(value)))
    fail(400, `${label}: укажите число от 0 до 99999999 с точностью до сотых`);
  return Number(value).toFixed(2);
}

function itemInput(body) {
  return {
    name: text(body.name, 'Название товара', 200),
    unit: text(body.unit, 'Единица измерения', 30),
    quantity: stockValue(body.quantity, 'Остаток'),
    min_quantity: stockValue(body.min_quantity, 'Минимальный остаток'),
  };
}

router.get('/', async (req, res) => {
  const items = (await pool.query('SELECT * FROM warehouse_items ORDER BY name')).rows;
  res.json(items);
});

router.post('/', admin, async (req, res) => {
  const values = itemInput(req.body);
  const item = await transaction(async (client) => {
    const row = (await client.query(
      'INSERT INTO warehouse_items(name,unit,quantity,min_quantity) VALUES($1,$2,$3,$4) RETURNING *',
      [values.name, values.unit, values.quantity, values.min_quantity],
    )).rows[0];
    await audit(client, req, 'warehouse.create', row.id, values);
    return row;
  });
  changed(req, 'warehouse');
  res.status(201).json(item);
});

router.patch('/:id', admin, async (req, res) => {
  const values = itemInput(req.body);
  const item = await transaction(async (client) => {
    const row = (await client.query(
      'UPDATE warehouse_items SET name=$1,unit=$2,quantity=$3,min_quantity=$4,updated_at=NOW() WHERE id=$5 RETURNING *',
      [values.name, values.unit, values.quantity, values.min_quantity, req.params.id],
    )).rows[0];
    if (!row) fail(404, 'Товар не найден');
    await audit(client, req, 'warehouse.update', row.id, values);
    return row;
  });
  changed(req, 'warehouse');
  res.json(item);
});

router.delete('/:id', admin, async (req, res) => {
  await transaction(async (client) => {
    const row = (await client.query(
      'DELETE FROM warehouse_items WHERE id=$1 RETURNING id,name',
      [req.params.id],
    )).rows[0];
    if (!row) fail(404, 'Товар не найден');
    await audit(client, req, 'warehouse.delete', row.id, { name: row.name });
  });
  changed(req, 'warehouse');
  res.status(204).end();
});

module.exports = router;
