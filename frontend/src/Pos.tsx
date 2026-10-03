import { useEffect, useState, type FormEvent } from 'react';
import {
  Search,
  Plus,
  Minus,
  Users,
  ArrowLeft,
  ChevronRight,
  Star,
  ReceiptText,
  Trash2,
  Split,
  Coins,
  CreditCard,
  QrCode,
  Printer,
  NotebookPen,
  Check,
  LockKeyhole,
  UtensilsCrossed,
} from 'lucide-react';
import { api, money, methodNames, requestKey, statusNames, date } from './api';
import { Badge, Empty, Field, Modal } from './ui';
import type { User, Snapshot, OrderData, Run } from './types';
type Props = {
  user: User;
  data: Snapshot;
  busy: boolean;
  run: Run;
  order: OrderData | null;
  selectedTable: string | null;
  onSelect: (id: string) => Promise<void>;
  onOrder: (o: OrderData) => void;
  onShift: () => void;
};
type Dialog =
  'create' | 'details' | 'pay' | 'split' | 'cancel' | 'remove' | 'refund' | 'receipt' | null;

function Payment({
  order,
  bill,
  qrImage,
  busy,
  run,
  done,
  close,
}: {
  order: OrderData;
  bill: string | null;
  qrImage: string;
  busy: boolean;
  run: Run;
  done: (o: OrderData) => void;
  close: () => void;
}) {
  const remaining =
    Math.round(
      (Number(order.order.total) - order.payments.reduce((s, p) => s + Number(p.amount), 0)) * 100,
    ) / 100;
  const [method, setMethod] = useState<'cash' | 'card' | 'online'>('cash'),
    [amount, setAmount] = useState(
      bill ? order.bills.find((b) => b.id === bill)!.amount : remaining.toFixed(2),
    ),
    [received, setReceived] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [key, setKey] = useState(requestKey),
    [attempted, setAttempted] = useState(false);
  const tender = received === '' ? Number(amount) : Number(received),
    change = Math.max(0, tender - Number(amount));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setAttempted(true);
    await run(async () => {
      const value = await api<OrderData>(`/orders/${order.order.id}/payments`, 'POST', {
        method,
        amount,
        bill_id: bill,
        request_key: key,
      });
      done(value);
    }, 'Оплата записана');
  }
  return (
    <Modal title={bill ? 'Оплата части счёта' : 'Принять оплату'} onClose={close}>
      <form onSubmit={submit}>
        <div className="payment-summary">
          <span>
            {order.order.table_name} · Заказ №{order.order.id}
          </span>
          <strong>{money(amount)}</strong>
          <small>Остаток по заказу: {money(remaining)}</small>
        </div>
        <div className="payment-methods">
          {(
            [
              ['cash', 'Наличные', Coins],
              ['card', 'Карта', CreditCard],
              ['online', 'QR', QrCode],
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              disabled={busy || attempted}
              className={method === m ? 'selected' : ''}
              onClick={() => {
                setMethod(m);
                setConfirmed(false);
                setKey(requestKey());
              }}
            >
              <Icon size={24} />
              {label}
            </button>
          ))}
        </div>
        <Field
          label="Сумма оплаты, сом"
          hint={
            bill
              ? 'Разделённый счёт оплачивается целиком'
              : 'Можно принять часть суммы другим способом'
          }
        >
          <input
            type="number"
            min="0.01"
            max={attempted ? undefined : remaining}
            step="0.01"
            value={amount}
            required
            disabled={Boolean(bill) || attempted}
            onChange={(e) => {
              setAmount(e.target.value);
              setKey(requestKey());
            }}
          />
        </Field>
        {method === 'cash' ? (
          <>
            <Field label="Получено от гостя, сом">
              <input
                type="number"
                min={amount}
                step="0.01"
                placeholder={amount}
                value={received}
                onChange={(e) => setReceived(e.target.value)}
              />
            </Field>
            <div className="payment-change">
              <span>Сдача</span>
              <b>{money(change)}</b>
            </div>
          </>
        ) : (
          <>
            {method === 'online' && (
              <div className="payment-qr">
                {qrImage ? (
                  <img src={qrImage} alt="QR-код для оплаты заказа" />
                ) : (
                  <p className="hint">Добавьте изображение QR-кода в настройках печати.</p>
                )}
                {qrImage && <p>Отсканируйте QR-код банковским приложением</p>}
              </div>
            )}
            <label className="check-field">
              <input
                type="checkbox"
                required
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              <span>
                Оплата {method === 'card' ? 'на банковском терминале' : 'по QR'} успешно подтверждена.
                Деньги получены.
              </span>
            </label>
          </>
        )}
        {method !== 'cash' && (
          <p className="hint">
            Эта кнопка фиксирует оплату в кассе. Списание в банке выполняется отдельно.
          </p>
        )}
        {attempted && (
          <p className="notice">
            При потере ответа повторное подтверждение проверит эту же операцию и не создаст второй
            платёж.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" disabled={busy} onClick={close}>
            Назад
          </button>
          <button
            className="primary"
            disabled={busy || !Number(amount) || (method === 'cash' && tender < Number(amount))}
          >
            {attempted ? 'Подтвердить результат' : 'Подтвердить оплату'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Pos({
  user,
  data,
  busy,
  run,
  order,
  selectedTable,
  onSelect,
  onOrder,
  onShift,
}: Props) {
  const [tab, setTab] = useState<'tables' | 'menu' | 'order'>('tables'),
    [filter, setFilter] = useState('all'),
    [category, setCategory] = useState('all'),
    [search, setSearch] = useState(''),
    [dialog, setDialog] = useState<Dialog>(null),
    [bill, setBill] = useState<string | null>(null),
    [removeId, setRemoveId] = useState<string | null>(null);
  const table = data.tables.find((t) => t.id === selectedTable),
    cashier = user.role !== 'waiter',
    manager = ['admin', 'manager'].includes(user.role);
  const current = order?.order,
    items = order?.items.filter((i) => i.status === 'active') || [],
    paid = order?.payments.reduce((s, p) => s + Number(p.amount), 0) || 0;
  const editable = current?.status === 'open' && !order?.bills.length && !order?.payments.length;
  const kitchenSent = Boolean(order?.kitchen_print_status);
  const activeMenu = data.menu.filter(
    (d) =>
      d.active &&
      (category === 'all' || (category === 'quick' && d.is_quick) || d.category_id === category) &&
      d.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  const free = data.tables.filter((t) => t.status === 'free').length;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);
  useEffect(() => {
    const focus = (e: KeyboardEvent) => {
      if (
        e.key === '/' &&
        !document.querySelector('dialog[open]') &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)
      ) {
        e.preventDefault();
        setTab('menu');
        document.querySelector<HTMLInputElement>('input[aria-label="Поиск блюда"]')?.focus();
      }
    };
    window.addEventListener('keydown', focus);
    return () => window.removeEventListener('keydown', focus);
  }, []);
  useEffect(() => {
    if (current && current.status === 'open' && current.user_id === user.id && tab === 'tables')
      setTab('menu');
  }, [current?.id]);
  const close = () => {
    if (!busy) setDialog(null);
  };
  async function mutate(path: string, body: unknown, method = 'POST') {
    await run(async () => {
      onOrder(await api<OrderData>(path, method, body));
    });
  }
  async function form(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const kind = dialog;
    const ok = await run(async () => {
      let result: OrderData;
      if (kind === 'create')
        result = await api('/orders', 'POST', {
          table_id: selectedTable,
          guest_count: Number(f.get('guests')),
          comment: f.get('comment'),
        });
      else if (kind === 'details')
        result = await api(`/orders/${current!.id}`, 'PATCH', {
          guest_count: Number(f.get('guests')),
          comment: f.get('comment'),
          version: current!.version,
        });
      else if (kind === 'split')
        result = await api(`/orders/${current!.id}/split`, 'POST', {
          count: Number(f.get('count')),
          version: current!.version,
        });
      else
        result = await api(
          `/orders/${current!.id}/${kind === 'remove' ? `items/${removeId}/cancel` : kind}`,
          'POST',
          {
            reason: f.get('reason'),
            external_confirmed: f.get('confirmed') === 'on',
            version: current!.version,
          },
        );
      onOrder(result);
    });
    if (ok) {
      setDialog(null);
      if (kind === 'create') setTab('menu');
    }
  }
  return (
    <>
      <div className="pos-heading">
        <div>
          <p className="eyebrow">ОБСЛУЖИВАНИЕ ГОСТЕЙ</p>
          <h1>Касса и зал</h1>
        </div>
        <span className="pos-date">
          {new Date().toLocaleDateString('ru-RU', {
            timeZone: 'Asia/Bishkek',
            day: 'numeric',
            month: 'long',
            weekday: 'short',
          })}
        </span>
      </div>
      {!data.shift && (
        <div className="shift-notice">
          <ClockIcon />
          <span>
            Смена закрыта.{' '}
            {cashier
              ? 'Откройте смену, чтобы принимать заказы.'
              : 'Попросите администратора открыть смену.'}
          </span>
          {cashier && (
            <button onClick={onShift}>
              Открыть смену <ChevronRight size={15} />
            </button>
          )}
        </div>
      )}
      <div className="mobile-sections" aria-label="Раздел кассы">
        {(
          [
            ['tables', 'Столы'],
            ['menu', 'Меню'],
            ['order', `Заказ${items.length ? ' · ' + items.length : ''}`],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className={'pos-grid mobile-' + tab}>
        <section className="tables-pane">
          <div className="pane-heading">
            <h2>
              Столы <span>{data.tables.length}</span>
            </h2>
            <span className="free-count">{free} свободно</span>
          </div>
          <div className="small-tabs">
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              Все
            </button>
            <button className={filter === 'mine' ? 'active' : ''} onClick={() => setFilter('mine')}>
              Мои
            </button>
            <button className={filter === 'free' ? 'active' : ''} onClick={() => setFilter('free')}>
              Свободные
            </button>
          </div>
          <div className="table-grid">
            {data.tables
              .filter(
                (t) =>
                  filter === 'all' ||
                  (filter === 'free' && t.status === 'free') ||
                  (filter === 'mine' && t.order_user_id === user.id),
              )
              .map((t) => {
                const locked =
                  user.role === 'waiter' && t.status === 'busy' && t.order_user_id !== user.id;
                return (
                  <button
                    key={t.id}
                    disabled={busy || locked}
                    className={`table-card ${t.status} ${selectedTable === t.id ? 'selected' : ''}`}
                    onClick={() => {
                      void onSelect(t.id);
                      setTab(t.open_order_id ? 'order' : 'menu');
                    }}
                  >
                    <div>
                      <span className="table-symbol">
                        <UtensilsCrossed size={19} />
                      </span>
                      {selectedTable === t.id ? (
                        <Check size={16} />
                      ) : locked ? (
                        <LockKeyhole size={14} />
                      ) : (
                        <span className="status-dot" />
                      )}
                    </div>
                    <strong>{t.name}</strong>
                    <span>
                      {t.status === 'free'
                        ? 'Готов к новым гостям'
                        : t.status === 'reserved'
                          ? 'Зарезервирован'
                          : t.waiter_name}
                    </span>
                    <b>
                      {t.status === 'busy'
                        ? money(t.open_order_total)
                        : t.status === 'free'
                          ? 'Свободен'
                          : 'Бронь'}
                    </b>
                  </button>
                );
              })}
          </div>
          {!data.tables.length && (
            <Empty
              title="Добавьте столы"
              description="Администратор может создать их в разделе «Меню и зал»."
            />
          )}
        </section>
        <section className="menu-pane">
          <div className="pane-heading">
            <h2>Меню</h2>
            <span>{data.menu.filter((d) => d.active).length} позиций</span>
          </div>
          <label className="search-field">
            <Search size={19} />
            <input
              aria-label="Поиск блюда"
              placeholder="Найти блюдо или напиток"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <kbd>/</kbd>
          </label>
          <div className="category-tabs">
            <button
              className={category === 'all' ? 'active' : ''}
              onClick={() => setCategory('all')}
            >
              Все блюда
            </button>
            <button
              className={category === 'quick' ? 'active' : ''}
              onClick={() => setCategory('quick')}
            >
              <Star size={15} />
              Быстрое меню
            </button>
            {data.categories.map((c) => (
              <button
                key={c.id}
                className={category === c.id ? 'active' : ''}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </button>
            ))}
          </div>
          {table && !current && table.status === 'free' && (
            <div className="start-order-inline">
              <span>
                <b>{table.name}</b> выбран
              </span>
              <button
                className="primary"
                disabled={busy || !data.shift}
                onClick={() => setDialog('create')}
              >
                <Plus size={18} />
                Создать заказ
              </button>
            </div>
          )}
          {!selectedTable && <p className="menu-tip">Выберите стол, чтобы начать заказ</p>}
          <div className="dish-grid">
            {activeMenu.map((dish) => {
              const count = items
                .filter((i) => i.menu_item_id === dish.id)
                .reduce((s, i) => s + i.quantity, 0);
              return (
                <button
                  key={dish.id}
                  className={'dish-card tone-' + (Number(dish.category_id || 0) % 5)}
                  disabled={busy || !editable}
                  onClick={() =>
                    void mutate(`/orders/${current!.id}/items`, {
                      menu_item_id: dish.id,
                      quantity: 1,
                      version: current!.version,
                    })
                  }
                >
                  <div className="dish-card-top">
                    <span>{dish.category || 'Без категории'}</span>
                    {dish.is_quick && <Star size={15} fill="currentColor" />}
                  </div>
                  <span className="dish-monogram" aria-hidden="true">
                    {dish.name
                      .split(' ')
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join('')}
                  </span>
                  <strong>{dish.name}</strong>
                  <div className="dish-card-bottom">
                    <b>{money(dish.price)}</b>
                    <span className={'add-dish ' + (count ? 'has-count' : '')}>
                      {count || <Plus size={19} />}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          {!activeMenu.length && (
            <Empty
              title={search ? 'Ничего не найдено' : 'В этой категории пока пусто'}
              description={
                search ? 'Попробуйте другое название.' : 'Добавьте блюда в разделе «Меню и зал».'
              }
            />
          )}
        </section>
        <section className="order-pane">
          <div className="order-pane-title">
            <ReceiptText size={20} />
            <h2>Текущий заказ</h2>
            {current && <span>№{current.id}</span>}
          </div>
          {!current ? (
            <Empty
              title={table ? table.name : 'Заказ начинается со стола'}
              description={
                table
                  ? table.status === 'reserved'
                    ? 'Стол зарезервирован. Снять бронь можно в разделе «Меню и зал».'
                    : 'Создайте заказ и выберите блюда из меню.'
                  : 'Выберите стол в зале. Здесь появятся блюда, количество и итоговая сумма.'
              }
            >
              {table?.status === 'free' && (
                <button
                  className="primary"
                  disabled={busy || !data.shift}
                  onClick={() => setDialog('create')}
                >
                  <Plus size={18} />
                  Создать заказ
                </button>
              )}
              {!table && (
                <button className="secondary mobile-only" onClick={() => setTab('tables')}>
                  Выбрать стол
                </button>
              )}
            </Empty>
          ) : (
            <>
              <div className="order-meta">
                <div>
                  <h3>{current.table_name}</h3>
                  <Badge status={current.status} label={statusNames[current.status]} />
                </div>
                <p>
                  <Users size={15} />
                  {current.guest_count} {current.guest_count === 1 ? 'гость' : 'гостей'}
                  <span>·</span>
                  {current.waiter_name}
                </p>
                {current.comment && <div className="order-comment">{current.comment}</div>}
                {editable && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setDialog('details')}
                  >
                    <NotebookPen size={15} />
                    Гости и комментарий
                  </button>
                )}
              </div>
              <div className="order-items">
                {!items.length ? (
                  <Empty
                    title="Что будут гости?"
                    description="Добавляйте блюда из меню — они появятся здесь."
                  />
                ) : (
                  items.map((item) => (
                    <div className="order-line" key={item.id}>
                      <div className="order-line-name">
                        <strong>{item.name}</strong>
                        <b>{money(Number(item.price) * item.quantity)}</b>
                      </div>
                      <div className="order-line-controls">
                        <span>{money(item.price)}</span>
                        <div className="quantity-control">
                          <button
                            aria-label={`Уменьшить ${item.name}`}
                            disabled={busy || !editable || item.quantity <= 1}
                            onClick={() =>
                              void mutate(
                                `/orders/${current.id}/items/${item.id}`,
                                { quantity: item.quantity - 1, version: current.version },
                                'PATCH',
                              )
                            }
                          >
                            <Minus size={15} />
                          </button>
                          <b>{item.quantity}</b>
                          <button
                            aria-label={`Добавить ${item.name}`}
                            disabled={busy || !editable}
                            onClick={() =>
                              void mutate(
                                `/orders/${current.id}/items/${item.id}`,
                                { quantity: item.quantity + 1, version: current.version },
                                'PATCH',
                              )
                            }
                          >
                            <Plus size={15} />
                          </button>
                        </div>
                        {editable && (
                          <button
                            className="icon-button danger-text"
                            aria-label={`Убрать ${item.name}`}
                            disabled={busy}
                            onClick={() => {
                              setRemoveId(item.id);
                              setDialog('remove');
                            }}
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="order-footer">
                <div className="total-row">
                  <span>Итого</span>
                  <strong>{money(current.total)}</strong>
                </div>
                {paid > 0 && (
                  <div className="sub-total">
                    <span>{current.status === 'refunded' ? 'Возвращено' : 'Оплачено'}</span>
                    <b>{money(paid)}</b>
                  </div>
                )}
                {current.status === 'open' && paid > 0 && (
                  <div className="sub-total">
                    <span>К оплате</span>
                    <b>{money(Number(current.total) - paid)}</b>
                  </div>
                )}
                {order!.bills.length > 0 && (
                  <div className="bill-list">
                    {order!.bills.map((b, i) => (
                      <button
                        key={b.id}
                        disabled={
                          busy || !cashier || b.status === 'paid' || current.status !== 'open'
                        }
                        onClick={() => {
                          setBill(b.id);
                          setDialog('pay');
                        }}
                      >
                        <span>
                          Счёт {i + 1} · {money(b.amount)}
                        </span>
                        {b.status === 'paid' ? <Check size={17} /> : <ChevronRight size={17} />}
                      </button>
                    ))}
                    {cashier && current.status === 'open' && !paid && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void mutate(`/orders/${current.id}/unsplit`, { version: current.version })
                        }
                      >
                        Отменить разделение
                      </button>
                    )}
                  </div>
                )}
                {current.status === 'open' ? (
                  <>
                    <button
                      className="secondary full-width kitchen-send"
                      disabled={busy || !items.length || !data.settings.kitchen_printer_ip || kitchenSent}
                      onClick={() => void mutate(`/orders/${current.id}/kitchen`, { version: current.version })}
                    >
                      <UtensilsCrossed size={18} />
                      {kitchenSent ? 'Отправлено на кухню' : 'Отправить заказ на кухню'}
                    </button>
                    {!data.settings.kitchen_printer_ip && (
                      <small className="hint">Укажите IP принтера в настройках печати.</small>
                    )}
                    {cashier ? (
                      <>
                        {!order!.bills.length && (
                          <button
                            className="primary pay-button"
                            disabled={busy || Number(current.total) <= 0 || !data.shift}
                            onClick={() => {
                              setBill(null);
                              setDialog('pay');
                            }}
                          >
                            <CreditCard size={19} />К оплате{' '}
                            <span>{money(Number(current.total) - paid)}</span>
                          </button>
                        )}
                        <div className="order-secondary">
                          {editable && (
                            <button
                              className="secondary"
                              disabled={busy || !items.length || Number(current.total) <= 0}
                              onClick={() => setDialog('split')}
                            >
                              <Split size={17} />
                              Разделить
                            </button>
                          )}
                          {manager && (
                            <button
                              className="quiet danger-text"
                              disabled={busy}
                              onClick={() => setDialog(paid ? 'refund' : 'cancel')}
                            >
                              {paid ? 'Возврат' : 'Отменить заказ'}
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="waiter-saved">
                        <Check size={18} />
                        Заказ сохранён на кассе
                      </div>
                    )}
                    {!editable && (
                      <small className="hint">
                        Состав зафиксирован после разделения или оплаты.
                      </small>
                    )}
                  </>
                ) : (
                  <>
                    <div className="closed-note">
                      <Check size={18} />
                      {statusNames[current.status]} · {date(current.closed_at)}
                    </div>
                    {['paid', 'refunded'].includes(current.status) && cashier && (
                      <button
                        className="secondary full-width"
                        onClick={() =>
                          data.settings.print_mode === 'windows'
                            ? run(
                                () => api(`/orders/${current.id}/print`, 'POST'),
                                'Чек отправлен на принтер терминала',
                              )
                            : setDialog('receipt')
                        }
                      >
                        <Printer size={18} />
                        Квитанция и печать
                      </button>
                    )}
                    {manager && current.status === 'paid' && (
                      <button
                        className="text-button danger-text"
                        disabled={busy || !data.shift}
                        onClick={() => setDialog('refund')}
                      >
                        Оформить полный возврат
                      </button>
                    )}
                    {current.cancel_reason && (
                      <p className="hint">Причина: {current.cancel_reason}</p>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>
      {dialog === 'pay' && order && (
        <Payment
          key={current!.id + '-' + bill}
          order={order}
          bill={bill}
          qrImage={data.settings.qr_image || ''}
          busy={busy}
          run={run}
          close={close}
          done={(result) => {
            onOrder(result);
            setDialog(result.order.status === 'paid' && data.settings.print_mode !== 'windows' ? 'receipt' : null);
          }}
        />
      )}
      {dialog === 'receipt' && order && (
        <Modal title={`Квитанция · заказ №${current!.id}`} onClose={close}>
          <p className="hint">
            {data.settings.print_mode === 'windows'
              ? 'Задание отправляется на принтер терминала. Состояние доступно в настройках печати.'
              : 'Нажмите «Печатать» на терминале и выберите установленный USB-принтер.'}
          </p>
          <iframe
            className="receipt-preview"
            title="Квитанция"
            src={`/orders/${current!.id}/receipt?kind=${current!.status === 'refunded' ? 'refund' : 'payment'}`}
          />
          <div className="modal-actions">
            <button className="primary" onClick={close}>
              Готово
            </button>
          </div>
        </Modal>
      )}
      {dialog && !['pay', 'receipt'].includes(dialog) && (
        <Modal
          title={
            {
              create: 'Новый заказ',
              details: 'Детали заказа',
              split: 'Разделить счёт',
              cancel: 'Отменить заказ',
              remove: 'Убрать блюдо',
              refund: 'Полный возврат',
            }[dialog as Exclude<Dialog, 'pay' | 'receipt' | null>]
          }
          onClose={close}
        >
          <form onSubmit={form}>
            {['create', 'details'].includes(dialog) ? (
              <>
                <Field label="Количество гостей">
                  <input
                    name="guests"
                    type="number"
                    min="1"
                    max="1000"
                    defaultValue={dialog === 'details' ? current?.guest_count : 1}
                    required
                  />
                </Field>
                <Field label="Комментарий к заказу">
                  <textarea
                    name="comment"
                    maxLength={1000}
                    placeholder="Например, без сахара или особые пожелания"
                    defaultValue={dialog === 'details' ? current?.comment || '' : ''}
                  />
                </Field>
              </>
            ) : dialog === 'split' ? (
              <>
                <p>
                  Сумма {money(current!.total)} будет разделена поровну. Тыйыны распределятся без
                  потери суммы.
                </p>
                <Field label="Количество счетов">
                  <input name="count" type="number" min="2" max="20" defaultValue="2" required />
                </Field>
                <p className="hint">До отмены разделения состав заказа будет зафиксирован.</p>
              </>
            ) : (
              <>
                <Field label="Причина">
                  <textarea
                    name="reason"
                    required
                    maxLength={500}
                    autoFocus
                    placeholder="Укажите причину для истории действий"
                  />
                </Field>
                {dialog === 'refund' && (
                  <>
                    <p className="notice">
                      Будет зарегистрирован возврат всех принятых платежей: {money(paid)}.
                    </p>
                    <label className="check-field">
                      <input name="confirmed" type="checkbox" required />
                      <span>
                        Я вернул гостю деньги. Для карты или QR возврат также выполнен в банковском
                        сервисе.
                      </span>
                    </label>
                  </>
                )}
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={busy} onClick={close}>
                Назад
              </button>
              <button
                className={['cancel', 'remove', 'refund'].includes(dialog) ? 'danger' : 'primary'}
                disabled={busy}
              >
                {['create', 'details', 'split'].includes(dialog) ? 'Сохранить' : 'Подтвердить'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function ClockIcon() {
  return <ReceiptText size={19} />;
}
