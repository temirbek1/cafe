import { useState, type FormEvent } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Star,
  Archive,
  Trash2,
  UtensilsCrossed,
  LayoutGrid,
  Layers,
} from 'lucide-react';
import { api, money } from './api';
import { Badge, Empty, Field, Modal, PageHead } from './ui';
import type { Shared, Dish, Category, Table } from './types';
type Edit =
  | { kind: 'dish'; value?: Dish }
  | { kind: 'category'; value?: Category }
  | { kind: 'table'; value?: Table }
  | { kind: 'delete-category'; value: Category }
  | { kind: 'archive-table'; value: Table };
export default function Catalog({ data, busy, run }: Shared) {
  const [tab, setTab] = useState<'dishes' | 'categories' | 'tables'>('dishes'),
    [search, setSearch] = useState(''),
    [edit, setEdit] = useState<Edit | null>(null);
  const close = () => {
    if (!busy) setEdit(null);
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit) return;
    const f = new FormData(event.currentTarget);
    const ok = await run(async () => {
      const id = edit.value?.id;
      if (edit.kind === 'dish')
        await api('/menu' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', {
          name: f.get('name'),
          price: f.get('price'),
          category_id: f.get('category') || null,
          active: f.get('active') === 'on',
          is_quick: f.get('quick') === 'on',
        });
      else if (edit.kind === 'category')
        await api('/menu/categories' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', {
          name: f.get('name'),
          sort_order: Number(f.get('sort')),
        });
      else if (edit.kind === 'table')
        await api('/tables' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', {
          name: f.get('name'),
          ...(id ? { status: f.get('status') } : {}),
        });
      else if (edit.kind === 'delete-category') await api('/menu/categories/' + id, 'DELETE');
      else await api('/tables/' + id, 'PATCH', { active: false });
    }, 'Изменения сохранены');
    if (ok) setEdit(null);
  }
  const titles = {
    dish: edit?.value ? 'Редактировать блюдо' : 'Новое блюдо',
    category: edit?.value ? 'Редактировать категорию' : 'Новая категория',
    table: edit?.value ? 'Редактировать стол' : 'Новый стол',
    'delete-category': 'Удалить категорию',
    'archive-table': 'Убрать стол из зала',
  };
  return (
    <div className="page-inner">
      <PageHead eyebrow="ВАШ АССОРТИМЕНТ И ПРОСТРАНСТВО" title="Меню и зал">
        <button
          className="primary"
          onClick={() =>
            setEdit({
              kind: tab === 'dishes' ? 'dish' : tab === 'categories' ? 'category' : 'table',
            })
          }
        >
          <Plus size={18} />
          {tab === 'dishes'
            ? 'Добавить блюдо'
            : tab === 'categories'
              ? 'Добавить категорию'
              : 'Добавить стол'}
        </button>
      </PageHead>
      <div className="section-tabs">
        {(
          [
            ['dishes', 'Блюда', UtensilsCrossed],
            ['categories', 'Категории', Layers],
            ['tables', 'Столы', LayoutGrid],
          ] as const
        ).map(([id, label, Icon]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <Icon size={18} />
            {label}
            <span>
              {id === 'dishes'
                ? data.menu.length
                : id === 'categories'
                  ? data.categories.length
                  : data.tables.length}
            </span>
          </button>
        ))}
      </div>
      {tab === 'dishes' && (
        <>
          <div className="list-toolbar">
            <label className="search-field">
              <Search size={18} />
              <input
                aria-label="Найти в каталоге"
                placeholder="Поиск по названию"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <span className="hint">Скрытые блюда сохраняются в истории заказов</span>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Блюдо</th>
                  <th>Категория</th>
                  <th>Цена</th>
                  <th>В меню</th>
                  <th>Быстрое</th>
                  <th aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {data.menu
                  .filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
                  .map((d) => (
                    <tr key={d.id}>
                      <td>
                        <strong>{d.name}</strong>
                        <small>#{d.id}</small>
                      </td>
                      <td>{d.category || 'Без категории'}</td>
                      <td className="number">{money(d.price)}</td>
                      <td>
                        <button
                          className={'switch ' + (d.active ? 'on' : '')}
                          role="switch"
                          aria-checked={d.active}
                          aria-label={`Доступность ${d.name}`}
                          disabled={busy}
                          onClick={() =>
                            void run(() => api('/menu/' + d.id, 'PATCH', { active: !d.active }))
                          }
                        >
                          <span />
                        </button>
                      </td>
                      <td>
                        <button
                          className={'icon-button ' + (d.is_quick ? 'starred' : '')}
                          aria-label={`Быстрое меню ${d.name}`}
                          disabled={busy}
                          onClick={() =>
                            void run(() => api('/menu/' + d.id, 'PATCH', { is_quick: !d.is_quick }))
                          }
                        >
                          <Star size={20} fill={d.is_quick ? 'currentColor' : 'none'} />
                        </button>
                      </td>
                      <td>
                        <button
                          className="icon-button"
                          aria-label={`Редактировать ${d.name}`}
                          onClick={() => setEdit({ kind: 'dish', value: d })}
                        >
                          <Pencil size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {!data.menu.length && (
              <Empty
                title="Ваше меню начинается здесь"
                description="Создайте категории и добавьте первые блюда с ценами."
              />
            )}
          </div>
        </>
      )}
      {tab === 'categories' && (
        <div className="management-grid">
          {data.categories.map((c) => (
            <article className="management-card" key={c.id}>
              <div className="management-icon">
                <Layers size={23} />
              </div>
              <h3>{c.name}</h3>
              <p>
                {data.menu.filter((d) => d.category_id === c.id).length} позиций · порядок{' '}
                {c.sort_order}
              </p>
              <div className="card-actions">
                <button
                  className="secondary"
                  onClick={() => setEdit({ kind: 'category', value: c })}
                >
                  <Pencil size={16} />
                  Изменить
                </button>
                <button
                  className="icon-button danger-text"
                  aria-label={`Удалить ${c.name}`}
                  onClick={() => setEdit({ kind: 'delete-category', value: c })}
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </article>
          ))}
          {!data.categories.length && (
            <Empty
              title="Категорий пока нет"
              description="Например: кофе, завтраки, горячее, десерты."
            />
          )}
        </div>
      )}
      {tab === 'tables' && (
        <div className="management-grid">
          {data.tables.map((t) => (
            <article className="management-card" key={t.id}>
              <div className="card-top">
                <div className="management-icon">
                  <LayoutGrid size={23} />
                </div>
                <Badge
                  status={t.status}
                  label={t.status === 'free' ? 'Свободен' : t.status === 'busy' ? 'Занят' : 'Бронь'}
                />
              </div>
              <h3>{t.name}</h3>
              <p>{t.waiter_name || 'Готов к обслуживанию'}</p>
              <div className="card-actions">
                <button className="secondary" onClick={() => setEdit({ kind: 'table', value: t })}>
                  <Pencil size={16} />
                  Изменить
                </button>
                <button
                  className="icon-button danger-text"
                  disabled={t.status === 'busy'}
                  aria-label={`Убрать ${t.name}`}
                  onClick={() => setEdit({ kind: 'archive-table', value: t })}
                >
                  <Archive size={17} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {edit && (
        <Modal title={titles[edit.kind]} onClose={close}>
          <form onSubmit={submit}>
            {edit.kind === 'dish' ? (
              <>
                <Field label="Название блюда">
                  <input
                    name="name"
                    defaultValue={edit.value?.name}
                    required
                    maxLength={150}
                    autoFocus
                  />
                </Field>
                <div className="form-grid">
                  <Field label="Цена, сом">
                    <input
                      name="price"
                      type="number"
                      min="0"
                      step="0.01"
                      max="99999999.99"
                      defaultValue={edit.value?.price}
                      required
                    />
                  </Field>
                  <Field label="Категория">
                    <select name="category" defaultValue={edit.value?.category_id || ''}>
                      <option value="">Без категории</option>
                      {data.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <label className="check-field">
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={edit.value?.active ?? true}
                  />
                  Доступно для заказа
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    name="quick"
                    defaultChecked={edit.value?.is_quick ?? false}
                  />
                  Показывать в быстром меню
                </label>
              </>
            ) : edit.kind === 'category' ? (
              <>
                <Field label="Название категории">
                  <input
                    name="name"
                    required
                    maxLength={150}
                    defaultValue={edit.value?.name}
                    autoFocus
                  />
                </Field>
                <Field label="Порядок отображения">
                  <input
                    name="sort"
                    type="number"
                    min="0"
                    max="9999"
                    defaultValue={edit.value?.sort_order || 0}
                    required
                  />
                </Field>
              </>
            ) : edit.kind === 'table' ? (
              <>
                <Field label="Название стола">
                  <input
                    name="name"
                    required
                    maxLength={60}
                    defaultValue={edit.value?.name}
                    autoFocus
                    placeholder="Например, Стол 1 или Терраса 2"
                  />
                </Field>
                {edit.value && (
                  <Field label="Состояние">
                    <select name="status" defaultValue={edit.value.status}>
                      {edit.value.status === 'busy' ? (
                        <option value="busy">Занят открытым заказом</option>
                      ) : (
                        <>
                          <option value="free">Свободен</option>
                          <option value="reserved">Зарезервирован</option>
                        </>
                      )}
                    </select>
                  </Field>
                )}
              </>
            ) : edit.kind === 'delete-category' ? (
              <p>Удалить «{edit.value.name}»? Её блюда останутся в меню без категории.</p>
            ) : (
              <p>Убрать «{edit.value.name}» из списка столов? История заказов сохранится.</p>
            )}
            <div className="modal-actions">
              <button className="secondary" type="button" disabled={busy} onClick={close}>
                Отмена
              </button>
              <button className="primary" disabled={busy}>
                Сохранить
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
