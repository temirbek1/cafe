const express = require('express');
const pool = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');
const {
  text,
  cents,
  decimal,
  integer,
  boolean,
  fail,
  transaction,
  audit,
  changed,
} = require('../lib');
const router = express.Router();
router.use(authenticate);
const managers = allowRoles('admin', 'manager');
router.get('/', async (req, res) => {
  const all = req.query.all === 'true' && ['admin', 'manager'].includes(req.user.role);
  res.json(
    (
      await pool.query(
        `SELECT mi.*,mc.name AS category FROM menu_items mi LEFT JOIN menu_categories mc ON mc.id=mi.category_id WHERE ($1 OR mi.active=TRUE) ORDER BY mc.sort_order NULLS LAST,mi.name`,
        [all],
      )
    ).rows,
  );
});
router.get('/categories', async (req, res) =>
  res.json((await pool.query('SELECT * FROM menu_categories ORDER BY sort_order,name')).rows),
);
router.post('/categories', managers, async (req, res) => {
  const name = text(req.body.name, 'Категория'),
    sort = integer(req.body.sort_order || 0, 'Порядок', 0, 9999);
  const data = await transaction(async (c) => {
    const row = (
      await c.query('INSERT INTO menu_categories(name,sort_order) VALUES($1,$2) RETURNING *', [
        name,
        sort,
      ])
    ).rows[0];
    await audit(c, req, 'category.create', row.id, { name });
    return row;
  });
  changed(req, 'menu');
  res.status(201).json(data);
});
router.patch('/categories/:id', managers, async (req, res) => {
  const name = text(req.body.name, 'Категория'),
    sort = integer(req.body.sort_order || 0, 'Порядок', 0, 9999);
  const data = await transaction(async (c) => {
    const row = (
      await c.query('UPDATE menu_categories SET name=$1,sort_order=$2 WHERE id=$3 RETURNING *', [
        name,
        sort,
        req.params.id,
      ])
    ).rows[0];
    if (!row) fail(404, 'Категория не найдена');
    await audit(c, req, 'category.update', row.id, { name, sort });
    return row;
  });
  changed(req, 'menu');
  res.json(data);
});
router.delete('/categories/:id', managers, async (req, res) => {
  await transaction(async (c) => {
    if (
      !(await c.query('DELETE FROM menu_categories WHERE id=$1 RETURNING id', [req.params.id]))
        .rowCount
    )
      fail(404, 'Категория не найдена');
    await audit(c, req, 'category.delete', req.params.id);
  });
  changed(req, 'menu');
  res.status(204).end();
});
router.post('/', managers, async (req, res) => {
  const name = text(req.body.name, 'Название'),
    price = decimal(cents(req.body.price, 'Цена', true)),
    category = req.body.category_id ? integer(req.body.category_id, 'Категория') : null;
  const active = req.body.active === undefined ? true : boolean(req.body.active, 'Доступность'),
    quick = req.body.is_quick === undefined ? false : boolean(req.body.is_quick, 'Быстрое меню');
  const data = await transaction(async (c) => {
    const row = (
      await c.query(
        'INSERT INTO menu_items(name,price,category_id,active,is_quick) VALUES($1,$2,$3,$4,$5) RETURNING *',
        [name, price, category, active, quick],
      )
    ).rows[0];
    await audit(c, req, 'menu.create', row.id, { name, price });
    return row;
  });
  changed(req, 'menu');
  res.status(201).json(data);
});
router.patch('/:id', managers, async (req, res) => {
  const values = {};
  if (req.body.name !== undefined) values.name = text(req.body.name, 'Название');
  if (req.body.price !== undefined) values.price = decimal(cents(req.body.price, 'Цена', true));
  if (req.body.category_id !== undefined)
    values.category_id = req.body.category_id ? integer(req.body.category_id, 'Категория') : null;
  for (const key of ['active', 'is_quick'])
    if (req.body[key] !== undefined) values[key] = boolean(req.body[key], key);
  if (!Object.keys(values).length) fail(400, 'Нет изменений');
  const data = await transaction(async (c) => {
    const keys = Object.keys(values);
    const row = (
      await c.query(
        `UPDATE menu_items SET ${keys.map((k, i) => `${k}=$${i + 1}`).join(',')} WHERE id=$${keys.length + 1} RETURNING *`,
        [...Object.values(values), req.params.id],
      )
    ).rows[0];
    if (!row) fail(404, 'Блюдо не найдено');
    await audit(c, req, 'menu.update', row.id, values);
    return row;
  });
  changed(req, 'menu');
  res.json(data);
});
module.exports = router;
