import { useEffect, useState, type FormEvent } from 'react';
import { Pencil, Plus, TriangleAlert } from 'lucide-react';
import { api } from './api';
import { Empty, Field, Modal, PageHead } from './ui';
import type { Run, User } from './types';

type WarehouseItem = {
  id: string;
  name: string;
  unit: string;
  quantity: string;
  min_quantity: string;
  updated_at: string;
};

export default function Warehouse({
  user,
  busy,
  run,
  revision,
}: {
  user: User;
  busy: boolean;
  run: Run;
  revision: number;
}) {
  const [items, setItems] = useState<WarehouseItem[]>([]);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<WarehouseItem | null | false>(false);
  const admin = user.role === 'admin';

  useEffect(() => {
    let active = true;
    api<WarehouseItem[]>('/warehouse')
      .then((rows) => {
        if (active) {
          setItems(rows);
          setError('');
        }
      })
      .catch((reason) => {
        if (active) setError((reason as Error).message);
      });
    return () => {
      active = false;
    };
  }, [revision]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editing === false) return;
    const form = new FormData(event.currentTarget);
    const body = {
      name: form.get('name'),
      unit: form.get('unit'),
      quantity: form.get('quantity'),
      min_quantity: form.get('min_quantity'),
    };
    const id = editing?.id;
    const saved = await run(
      () => api('/warehouse' + (id ? `/${id}` : ''), id ? 'PATCH' : 'POST', body),
      id ? 'Изменения сохранены' : 'Товар добавлен',
    );
    if (saved) setEditing(false);
  }

  return (
    <div className="page-inner">
      <PageHead eyebrow="УЧЁТ ЗАПАСОВ" title="Склад">
        {admin && (
          <button className="primary" onClick={() => setEditing(null)}>
            <Plus size={18} />
            Добавить товар
          </button>
        )}
      </PageHead>
      <section className="section-card">
        <p className="hint">
          {admin
            ? 'Указывайте текущий остаток и минимальный запас. Позиции ниже минимума будут отмечены.'
            : 'Просмотр товаров и текущих остатков. Редактировать склад может только администратор.'}
        </p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th>Единица</th>
                <th>Остаток</th>
                <th>Минимум</th>
                {admin && <th aria-label="Действия" />}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const low = Number(item.quantity) <= Number(item.min_quantity);
                return (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      {low && (
                        <small className="warehouse-low-stock">
                          <TriangleAlert size={13} /> Мало на складе
                        </small>
                      )}
                    </td>
                    <td>{item.unit}</td>
                    <td className="number">{Number(item.quantity).toFixed(2)}</td>
                    <td className="number">{Number(item.min_quantity).toFixed(2)}</td>
                    {admin && (
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Редактировать ${item.name}`}
                          disabled={busy}
                          onClick={() => setEditing(item)}
                        >
                          <Pencil size={17} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!items.length && !error && (
            <Empty
              title="На складе пока пусто"
              description={admin ? 'Добавьте первый товар и укажите его остаток.' : 'Администратор может добавить складские позиции.'}
            />
          )}
        </div>
      </section>
      {editing !== false && (
        <Modal title={editing ? 'Редактировать товар' : 'Новый товар'} onClose={() => !busy && setEditing(false)}>
          <form onSubmit={submit}>
            <Field label="Название товара">
              <input name="name" defaultValue={editing?.name || ''} maxLength={200} required autoFocus />
            </Field>
            <Field label="Единица измерения" hint="Например: шт., кг, л">
              <input name="unit" defaultValue={editing?.unit || ''} maxLength={30} required />
            </Field>
            <div className="form-grid">
              <Field label="Текущий остаток">
                <input name="quantity" type="number" min="0" max="99999999" step="0.01" defaultValue={editing?.quantity || '0'} required />
              </Field>
              <Field label="Минимальный остаток">
                <input name="min_quantity" type="number" min="0" max="99999999" step="0.01" defaultValue={editing?.min_quantity || '0'} required />
              </Field>
            </div>
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(false)}>Отмена</button>
              <button className="primary" disabled={busy}>Сохранить</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
