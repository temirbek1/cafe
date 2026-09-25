const express = require('express');
const pool = require('../db');
const { authenticate, allowRoles } = require('../middleware/auth');
const { text, boolean, fail, transaction, audit, changed } = require('../lib');
const router = express.Router();
router.use(authenticate);
const managers = allowRoles('admin', 'manager');
router.get('/', async (req, res) =>
  res.json(
    (
      await pool.query(
        `SELECT t.*,o.id AS open_order_id,o.total AS open_order_total,o.user_id AS order_user_id,u.name AS waiter_name,o.opened_at FROM tables t LEFT JOIN orders o ON o.table_id=t.id AND o.status='open' LEFT JOIN users u ON u.id=o.user_id WHERE t.active=TRUE ORDER BY t.id`,
      )
    ).rows,
  ),
);
router.post('/', managers, async (req, res) => {
  const name = text(req.body.name, 'Название стола', 60);
  const row = await transaction(async (c) => {
    const row = (await c.query('INSERT INTO tables(name) VALUES($1) RETURNING *', [name])).rows[0];
    await audit(c, req, 'table.create', row.id, { name });
    return row;
  });
  changed(req, 'tables');
  res.status(201).json(row);
});
router.patch('/:id', managers, async (req, res) => {
  const row = await transaction(async (c) => {
    const old = (await c.query('SELECT * FROM tables WHERE id=$1 FOR UPDATE', [req.params.id]))
      .rows[0];
    if (!old) fail(404, 'Стол не найден');
    const busy =
      (await c.query("SELECT 1 FROM orders WHERE table_id=$1 AND status='open'", [old.id]))
        .rowCount > 0;
    const name = req.body.name === undefined ? old.name : text(req.body.name, 'Название стола', 60),
      active = req.body.active === undefined ? old.active : boolean(req.body.active, 'Доступность');
    let status = req.body.status || old.status;
    if (!['free', 'busy', 'reserved'].includes(status)) fail(400, 'Неверное состояние стола');
    if ((busy && (status !== 'busy' || !active)) || (!busy && status === 'busy'))
      fail(409, 'Сначала закройте заказ; занятость определяется заказами');
    const row = (
      await c.query('UPDATE tables SET name=$1,status=$2,active=$3 WHERE id=$4 RETURNING *', [
        name,
        status,
        active,
        old.id,
      ])
    ).rows[0];
    await audit(c, req, 'table.update', old.id, { name, status, active });
    return row;
  });
  changed(req, 'tables');
  res.json(row);
});
module.exports = router;
