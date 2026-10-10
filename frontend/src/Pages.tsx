import { useEffect, useState, type FormEvent } from 'react';
import {
  ArrowDownToLine,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Coins,
  Plus,
  Printer,
  RefreshCw,
  ShieldCheck,
  Users,
  Wallet,
  Wifi,
} from 'lucide-react';
import { api, money, date, today, statusNames, roleNames, methodNames } from './api';
import { Badge, Empty, Field, Modal, PageHead } from './ui';
import type { Shared, Order, Shift, User, Settings } from './types';
function Range({
  from,
  to,
  onFrom,
  onTo,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
}) {
  return (
    <div className="date-range">
      <label>
        С
        <input
          aria-label="Начало периода"
          type="date"
          value={from}
          max={to}
          onChange={(e) => onFrom(e.target.value)}
        />
      </label>
      <span>—</span>
      <label>
        По
        <input
          aria-label="Конец периода"
          type="date"
          value={to}
          min={from}
          onChange={(e) => onTo(e.target.value)}
        />
      </label>
    </div>
  );
}
function useRemote<T>(url: string, revision: number) {
  const [value, setValue] = useState<T | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    api<T>(url)
      .then((v) => {
        if (!cancelled) {
          setValue(v);
          setError('');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [url, revision]);
  return { value, error };
}

export function HistoryPage({
  user,
  revision,
  onOrder,
}: Shared & { onOrder: (id: string) => Promise<void> }) {
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    [status, setStatus] = useState(''),
    [offset, setOffset] = useState(0);
  const params = new URLSearchParams({ from, to, status, limit: '30', offset: String(offset) }),
    { value, error } = useRemote<{ orders: (Order & { employee: string })[]; total: number }>(
      '/orders/history?' + params,
      revision,
    );
  return (
    <div className="page-inner">
      <PageHead
        eyebrow="КАЖДЫЙ ЗАКАЗ НА СВОЁМ МЕСТЕ"
        title={user.role === 'waiter' ? 'Моя история' : 'История заказов'}
      >
        <a
          className="button secondary"
          href={'/orders/history.csv?' + new URLSearchParams({ from, to, status })}
        >
          <ArrowDownToLine size={18} />
          Скачать CSV
        </a>
      </PageHead>
      <div className="list-toolbar">
        <Range
          from={from}
          to={to}
          onFrom={(v) => {
            setFrom(v);
            setOffset(0);
          }}
          onTo={(v) => {
            setTo(v);
            setOffset(0);
          }}
        />
        <select
          aria-label="Статус заказа"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">Все статусы</option>
          {Object.entries(statusNames).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Заказ</th>
              <th>Стол</th>
              <th>Сотрудник</th>
              <th>Статус</th>
              <th>Сумма</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {value?.orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <strong>№{o.id}</strong>
                  <small>{date(o.opened_at)}</small>
                </td>
                <td>{o.table_name}</td>
                <td>{o.employee}</td>
                <td>
                  <Badge status={o.status} label={statusNames[o.status]} />
                </td>
                <td className="number">{money(o.total)}</td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Открыть заказ ${o.id}`}
                    onClick={() => void onOrder(o.id)}
                  >
                    <ArrowUpRight size={19} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {value && !value.orders.length && (
          <Empty
            title="Заказов за этот период нет"
            description="Выберите другой период или начните новый заказ в кассе."
          />
        )}
      </div>
      <div className="pagination">
        <span>{value?.total || 0} заказов</span>
        <button
          className="icon-button"
          aria-label="Предыдущая страница"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 30))}
        >
          <ChevronLeft size={18} />
        </button>
        <span>{Math.floor(offset / 30) + 1}</span>
        <button
          className="icon-button"
          aria-label="Следующая страница"
          disabled={!value || offset + 30 >= value.total}
          onClick={() => setOffset(offset + 30)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
type Report = {
  sales: number;
  refunds: number;
  net: number;
  paid_orders: number;
  average: number;
  payments: { method: keyof typeof methodNames; amount: string }[];
  top: { name: string; quantity: number; revenue: string }[];
  daily: { day: string; sales: string; refunds: string }[];
  unassigned_payments: number;
};
export function ReportsPage({ revision }: Shared) {
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(today),
    params = new URLSearchParams({ from, to }),
    { value: r, error } = useRemote<Report>('/reports/sales?' + params, revision);
  return (
    <div className="page-inner">
      <PageHead eyebrow="КАК ИДУТ ДЕЛА В КАФЕ" title="Отчёты">
        <a className="button secondary" href={'/reports/sales.csv?' + params}>
          <ArrowDownToLine size={18} />
          Скачать отчёт
        </a>
      </PageHead>
      <div className="list-toolbar">
        <Range from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <span className="hint">Время Бишкека · суммы в сомах</span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="metric-grid">
        {[
          {
            title: 'Выручка',
            value: money(r?.net),
            icon: Wallet,
            note: 'Поступления минус возвраты',
          },
          {
            title: 'Оплаченные заказы',
            value: r?.paid_orders || 0,
            icon: ReceiptIcon,
            note: 'Полная оплата за период, до возвратов',
          },
          {
            title: 'Средний чек',
            value: money(r?.average),
            icon: Coins,
            note: 'По полной оплате, до возвратов',
          },
          {
            title: 'Возвраты',
            value: money(r?.refunds),
            icon: RefreshCw,
            note: 'Возвращено за выбранный период',
          },
        ].map((m) => (
          <article className="metric-card" key={m.title}>
            <div>
              <span>{m.title}</span>
              <m.icon size={20} />
            </div>
            <strong>{m.value}</strong>
            <small>{m.note}</small>
          </article>
        ))}
      </div>
      {Boolean(r?.unassigned_payments) && (
        <p className="notice">
          В периоде есть {r!.unassigned_payments} платежей старой версии без привязки к смене. Они
          включены в этот отчёт, но не в отчёты смен.
        </p>
      )}
      <div className="report-grid">
        <section className="section-card">
          <h2>Способы оплаты</h2>
          <p className="hint">Все поступления, включая частичные оплаты</p>
          {(['cash', 'card', 'online'] as const).map((method) => {
            const amount = Number(r?.payments.find((p) => p.method === method)?.amount || 0);
            return (
              <div className="payment-stat" key={method}>
                <div>
                  <span>{methodNames[method]}</span>
                  <b>{money(amount)}</b>
                </div>
                <div className="bar-track">
                  <span style={{ width: `${r?.sales ? (amount / r.sales) * 100 : 0}%` }} />
                </div>
              </div>
            );
          })}
          <div className="sub-total">
            <span>Всего принято</span>
            <b>{money(r?.sales)}</b>
          </div>
        </section>
        <section className="section-card">
          <h2>Популярные блюда</h2>
          <p className="hint">Полностью оплаченные заказы за период, до возвратов</p>
          {r?.top.length ? (
            r.top.map((item, i) => (
              <div className="top-dish" key={item.name}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <b>{item.name}</b>
                  <small>{item.quantity} шт.</small>
                </div>
                <strong>{money(item.revenue)}</strong>
              </div>
            ))
          ) : (
            <Empty
              title="Продажи ещё впереди"
              description="Здесь появятся блюда из оплаченных заказов."
            />
          )}
        </section>
      </div>
      {Boolean(r?.daily.length) && (
        <section className="section-card">
          <h2>По дням</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Поступления</th>
                  <th>Возвраты</th>
                  <th>Выручка</th>
                </tr>
              </thead>
              <tbody>
                {r!.daily.map((d) => (
                  <tr key={d.day}>
                    <td>{String(d.day).slice(0, 10)}</td>
                    <td>{money(d.sales)}</td>
                    <td>{money(d.refunds)}</td>
                    <td>
                      <b>{money(Number(d.sales) - Number(d.refunds))}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
function ReceiptIcon({ size }: { size: number }) {
  return <Clock3 size={size} />;
}

export function ShiftsPage({ data, busy, run, revision }: Shared) {
  const { value, error } = useRemote<{ shifts: Shift[] }>('/shifts/history', revision),
    [modal, setModal] = useState<'open' | 'close' | null>(null),
    shift = data.shift;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const ok = await run(
      () =>
        modal === 'open'
          ? api('/shifts/open', 'POST', { opening_cash: f.get('cash') })
          : api('/shifts/' + shift!.id + '/close', 'POST', { closing_cash: f.get('cash') }),
      modal === 'open' ? 'Смена открыта' : 'Смена закрыта',
    );
    if (ok) setModal(null);
  }
  return (
    <div className="page-inner">
      <PageHead eyebrow="КОНТРОЛЬ КАССЫ" title="Кассовые смены">
        <button
          className="primary"
          disabled={busy}
          onClick={() => setModal(shift ? 'close' : 'open')}
        >
          <Clock3 size={18} />
          {shift ? 'Закрыть смену' : 'Открыть смену'}
        </button>
      </PageHead>
      {shift ? (
        <>
          <div className="shift-overview">
            <Badge status="open" label={`Смена №${shift.id} открыта`} />
            <span>
              {date(shift.opened_at)} · {shift.opened_by}
            </span>
          </div>
          <div className="metric-grid">
            <div className="metric-card">
              <span>Выручка смены</span>
              <strong>{money(shift.net)}</strong>
              <small>После возвратов</small>
            </div>
            <div className="metric-card">
              <span>Наличные в кассе</span>
              <strong>{money(shift.expected_cash)}</strong>
              <small>Ожидаемый остаток</small>
            </div>
            <div className="metric-card">
              <span>Безналичные оплаты</span>
              <strong>{money(shift.sales.card + shift.sales.online)}</strong>
              <small>Карта и QR до возвратов</small>
            </div>
            <div className="metric-card">
              <span>В начале смены</span>
              <strong>{money(shift.opening_cash)}</strong>
              <small>Разменные наличные</small>
            </div>
          </div>
        </>
      ) : (
        <div className="section-card">
          <Empty
            title="Готовы начать рабочий день?"
            description="Пересчитайте наличные в кассе и откройте смену. После этого команда сможет создавать заказы."
          />
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <h2 className="section-title">История смен</h2>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Смена</th>
              <th>Открыл</th>
              <th>Выручка</th>
              <th>Ожидалось наличных</th>
              <th>Фактически</th>
              <th>Расхождение</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {value?.shifts.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>№{s.id}</strong>
                  <small>{date(s.opened_at)}</small>
                </td>
                <td>{s.opened_by}</td>
                <td>{money(s.net)}</td>
                <td>{money(s.expected_cash)}</td>
                <td>{s.closing_cash === null ? '—' : money(s.closing_cash)}</td>
                <td className={s.difference ? 'danger-text' : ''}>
                  {s.difference === null ? '—' : money(s.difference)}
                </td>
                <td>
                  <Badge
                    status={s.status === 'open' ? 'open' : 'paid'}
                    label={s.status === 'open' ? 'Открыта' : 'Закрыта'}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {modal && (
        <Modal
          title={modal === 'open' ? 'Открыть смену' : 'Закрыть смену'}
          onClose={() => {
            if (!busy) setModal(null);
          }}
        >
          <form onSubmit={submit}>
            {modal === 'close' && (
              <div className="notice">
                Ожидается наличных: <b>{money(shift?.expected_cash)}</b>. Все открытые заказы должны
                быть оплачены или отменены.
              </div>
            )}
            <Field
              label={modal === 'open' ? 'Разменные наличные, сом' : 'Фактические наличные, сом'}
            >
              <input
                name="cash"
                type="number"
                min="0"
                step="0.01"
                required
                autoFocus
                defaultValue={modal === 'open' ? '0' : undefined}
              />
            </Field>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                Отмена
              </button>
              <button className="primary" disabled={busy}>
                Подтвердить
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function TeamPage({ user, busy, run, revision }: Shared) {
  const { value: users, error } = useRemote<User[]>('/auth/users', revision),
    [editing, setEditing] = useState<User | 'new' | null>(null),
    [toggle, setToggle] = useState<User | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget),
      body = {
        name: f.get('name'),
        role: f.get('role'),
        ...(f.get('password') ? { password: f.get('password') } : {}),
        ...(editing === 'new' ? { login: f.get('login') } : {}),
      };
    const ok = await run(
      () =>
        api(
          editing === 'new' ? '/auth/register' : '/auth/users/' + (editing as User).id,
          editing === 'new' ? 'POST' : 'PATCH',
          body,
        ),
      'Сотрудник сохранён',
    );
    if (ok) setEditing(null);
  }
  return (
    <div className="page-inner">
      <PageHead eyebrow="ЛЮДИ, КОТОРЫЕ ДЕЛАЮТ ВАШЕ КАФЕ" title="Команда">
        <button className="primary" onClick={() => setEditing('new')}>
          <Plus size={18} />
          Добавить сотрудника
        </button>
      </PageHead>
      {error && <p className="form-error">{error}</p>}
      <div className="management-grid">
        {users?.map((u) => (
          <article className={'management-card ' + (!u.active ? 'muted-card' : '')} key={u.id}>
            <div className="card-top">
              <div className="team-avatar">{u.name.slice(0, 1).toUpperCase()}</div>
              <Badge
                status={u.active ? 'paid' : 'cancelled'}
                label={u.active ? 'Работает' : 'Отключён'}
              />
            </div>
            <h3>{u.name}</h3>
            <p>
              {roleNames[u.role]} · {u.login}
            </p>
            <div className="card-actions">
              <button className="secondary" onClick={() => setEditing(u)}>
                Изменить
              </button>
              {u.id !== user.id && (
                <button className="text-button" disabled={busy} onClick={() => setToggle(u)}>
                  {u.active ? 'Отключить' : 'Вернуть доступ'}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {editing && (
        <Modal
          title={editing === 'new' ? 'Новый сотрудник' : 'Изменить сотрудника'}
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <form onSubmit={submit}>
            <Field label="Имя">
              <input
                name="name"
                defaultValue={editing === 'new' ? '' : editing.name}
                required
                autoFocus
              />
            </Field>
            {editing === 'new' && (
              <Field label="Логин" hint="Латинские буквы, цифры, точки и дефисы">
                <input name="login" required pattern="[a-zA-Z0-9_.-]{2,60}" autoComplete="off" />
              </Field>
            )}
            <Field label="Роль">
              <select name="role" defaultValue={editing === 'new' ? 'waiter' : editing.role}>
                {Object.entries(roleNames).map(([r, name]) => (
                  <option key={r} value={r}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={editing === 'new' ? 'Пароль' : 'Новый пароль'}
              hint={
                editing === 'new'
                  ? 'Не менее 8 символов'
                  : 'Оставьте пустым, чтобы сохранить пароль'
              }
            >
              <input
                name="password"
                type="password"
                minLength={8}
                required={editing === 'new'}
                autoComplete="new-password"
              />
            </Field>
            <p className="hint">После изменения сотруднику потребуется войти заново.</p>
            <div className="modal-actions">
              <button
                className="secondary"
                type="button"
                onClick={() => setEditing(null)}
                disabled={busy}
              >
                Отмена
              </button>
              <button className="primary" disabled={busy}>
                Сохранить
              </button>
            </div>
          </form>
        </Modal>
      )}
      {toggle && (
        <Modal
          title={toggle.active ? 'Отключить сотрудника' : 'Вернуть доступ'}
          onClose={() => setToggle(null)}
        >
          <p>
            {toggle.active
              ? `${toggle.name} потеряет доступ на всех устройствах.`
              : `${toggle.name} сможет снова войти со своим паролем.`}
          </p>
          <div className="modal-actions">
            <button className="secondary" disabled={busy} onClick={() => setToggle(null)}>
              Отмена
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api('/auth/users/' + toggle.id, 'PATCH', { active: !toggle.active }),
                ).then((ok) => {
                  if (ok) setToggle(null);
                })
              }
            >
              Подтвердить
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

type PrintJob = {
  id: string;
  order_id: string;
  kind: string;
  status: string;
  error: string | null;
  attempts: number;
  created_at: string;
};
const printNames: Record<string, string> = {
  pending: 'В очереди',
  printing: 'Передача Windows',
  submitted: 'Передано Windows',
  manual: 'Ручная печать',
  failed: 'Ошибка',
  uncertain: 'Проверьте принтер',
};
export function SettingsPage({ data, busy, run, revision }: Shared) {
  const { value: network } = useRemote<{ addresses: string[] }>('/settings/network', 0),
    { value: printers } = useRemote<{ printers: { name: string; port: string }[] }>(
      '/settings/printers',
      0,
    ),
    { value: jobs, error } = useRemote<PrintJob[]>('/settings/print-jobs', revision),
    { value: audit } = useRemote<
      { id: string; action: string; employee: string; created_at: string; entity_id: string }[]
    >('/reports/audit', revision);
  const [draft, setDraft] = useState<Settings>(data.settings),
    [retry, setRetry] = useState<PrintJob | null>(null),
    [tab, setTab] = useState('general'),
    [qrError, setQrError] = useState('');
  function change(key: keyof Settings, value: unknown) {
    setDraft((s) => ({ ...s, [key]: value }));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    await run(() => api('/settings', 'PATCH', draft), 'Настройки сохранены');
  }
  return (
    <div className="page-inner">
      <PageHead eyebrow="ПОДГОТОВКА РАБОЧЕГО МЕСТА" title="Настройки" />
      <div className="section-tabs">
        {[
          ['general', 'Кафе и подключение'],
          ['printing', 'Печать'],
          ['audit', 'Журнал действий'],
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'general' && (
        <div className="settings-grid">
          <form className="section-card" onSubmit={submit}>
            <h2>Ваше кафе</h2>
            <Field label="Название">
              <input value={draft.name} onChange={(e) => change('name', e.target.value)} required />
            </Field>
            <Field label="Адрес для квитанции">
              <input value={draft.address} onChange={(e) => change('address', e.target.value)} />
            </Field>
            <Field label="Телефон">
              <input value={draft.phone} onChange={(e) => change('phone', e.target.value)} />
            </Field>
            <p className="hint">Валюта: кыргызский сом (KGS) · Часовой пояс: Бишкек</p>
            <button className="primary" disabled={busy}>
              Сохранить
            </button>
          </form>
          <div>
            <section className="section-card">
              <div className="section-icon">
                <Wifi size={23} />
              </div>
              <h2>Телефоны официантов</h2>
              <p>Подключите телефон к Wi-Fi кафе и откройте в Chrome один из адресов терминала:</p>
              {network?.addresses.length ? (
                network.addresses.map((url) => (
                  <code className="network-address" key={url}>
                    {url}
                  </code>
                ))
              ) : (
                <p className="hint">Проверьте подключение терминала к локальной сети.</p>
              )}
              <p className="hint">
                Терминал должен оставаться включённым. Доступ по Wi-Fi настройте в брандмауэре
                Windows.
              </p>
            </section>
            <section className="section-card">
              <div className="section-icon">
                <ShieldCheck size={23} />
              </div>
              <h2>Банк и фискальные чеки</h2>
              <Badge status="reserved" label="Ещё не подключены" />
              <p>
                Карта и QR фиксируются после подтверждения оплаты на внешнем устройстве. Печатная
                квитанция этого приложения не является фискальным чеком.
              </p>
              <p className="hint">
                Подключение MBANK или другого провайдера выполняется отдельно после выбора сервиса.
              </p>
            </section>
          </div>
        </div>
      )}
      {tab === 'printing' && (
        <>
          <form className="section-card" onSubmit={submit}>
            <h2>Принтер чеков кассы</h2>
            <div className="form-grid">
              <Field label="Способ печати">
                <select
                  value={draft.print_mode}
                  onChange={(e) => change('print_mode', e.target.value)}
                >
                  <option value="browser">Через диалог браузера</option>
                  <option value="windows" disabled={!data.settings.windows_print_available}>
                    Автоматически через Windows
                  </option>
                </select>
              </Field>
              <Field label="Ширина ленты">
                <select
                  value={draft.receipt_width}
                  onChange={(e) => change('receipt_width', Number(e.target.value))}
                >
                  <option value="80">80 мм</option>
                  <option value="58">58 мм</option>
                </select>
              </Field>
            </div>
            {draft.print_mode === 'windows' && (
              <>
                <Field label="Установленный принтер">
                  <select
                    value={draft.printer_name}
                    onChange={(e) => change('printer_name', e.target.value)}
                    required
                  >
                    <option value="">Выберите принтер</option>
                    {printers?.printers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.name} · {p.port}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !draft.printer_name}
                  onClick={() =>
                    run(
                      () =>
                        api('/settings/print-test', 'POST', {
                          printer: draft.printer_name,
                          width: draft.receipt_width,
                        }),
                      'Тестовый чек отправлен на принтер',
                    )
                  }
                >
                  Тестовая печать
                </button>
                <p className="hint">
                  После выбора сохраните настройки. Телефоны будут отправлять чеки на этот принтер
                  без диалога печати.
                </p>
              </>
            )}
            <h2 className="printer-section-title">Чек кухни</h2>
            <Field label="Установленный кухонный принтер">
              <select
                value={draft.kitchen_printer_name || ''}
                onChange={(e) => change('kitchen_printer_name', e.target.value)}
                disabled={!data.settings.windows_print_available}
              >
                <option value="">Печатать вручную в браузере</option>
                {printers?.printers.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} · {p.port}
                  </option>
                ))}
              </select>
            </Field>
            <p className="hint">Выберите принтер кухни из установленных в Windows. Список такой же, как у принтера чеков кассы.</p>
            <h2 className="printer-section-title">QR-код для оплаты</h2>
            <p className="hint">
              Загрузите изображение QR-кода из банка. Оно появится в окне оплаты, когда выбран способ «QR».
            </p>
            <Field label="Изображение QR-кода (PNG или JPEG, до 1 МБ)">
              <input
                type="file"
                accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (!file) return;
                  setQrError('');
                  if (!['image/png', 'image/jpeg'].includes(file.type)) {
                    setQrError('Выберите файл PNG или JPEG.');
                    event.currentTarget.value = '';
                    return;
                  }
                  if (file.size > 1024 * 1024) {
                    setQrError('Размер файла не должен превышать 1 МБ.');
                    event.currentTarget.value = '';
                    return;
                  }
                  const reader = new FileReader();
                  event.currentTarget.value = '';
                  reader.onload = () => {
                    if (typeof reader.result === 'string') change('qr_image', reader.result);
                  };
                  reader.onerror = () => setQrError('Не удалось прочитать файл.');
                  reader.readAsDataURL(file);
                }}
              />
            </Field>
            {qrError && <p className="form-error">{qrError}</p>}
            {draft.qr_image && (
              <div className="qr-image-preview">
                <img src={draft.qr_image} alt="Предварительный просмотр QR-кода оплаты" />
                <button type="button" className="secondary" onClick={() => change('qr_image', '')}>
                  Удалить QR-код
                </button>
              </div>
            )}
            <p className="hint">
              Заказ отправляется на кухню по кнопке в заказе. Печать на кухне настроена отдельно от чеков оплаты.
            </p>
            <p className="hint">
              Сначала установите драйвер USB-принтера и распечатайте тестовую страницу Windows.
              Автоматическая печать выполняется на терминале, в том числе для действий с телефона.
            </p>
            <button className="primary" disabled={busy}>
              Сохранить
            </button>
          </form>
          <h2 className="section-title">Очередь квитанций</h2>
          {error && <p className="form-error">{error}</p>}
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Операция</th>
                  <th>Состояние</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {jobs?.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <b>№{j.order_id}</b>
                      <small>{date(j.created_at)}</small>
                    </td>
                    <td>{j.kind === 'refund' ? 'Возврат' : j.kind === 'kitchen' ? 'Кухня' : 'Оплата'}</td>
                    <td>
                      <span>{printNames[j.status]}</span>
                      {j.error && <small className="danger-text">{j.error}</small>}
                    </td>
                    <td>
                      <a
                        className="icon-button"
                        title={j.kind === 'kitchen' ? 'Открыть заказ' : 'Открыть квитанцию'}
                        href={j.kind === 'kitchen' ? `/orders/${j.order_id}/kitchen-ticket` : `/orders/${j.order_id}/receipt?kind=${j.kind}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Printer size={17} />
                      </a>
                      {!['pending', 'printing'].includes(j.status) &&
                        (j.kind === 'kitchen' || draft.print_mode === 'windows') && (
                          <button
                            className="icon-button"
                            aria-label={`Повторить печать ${j.id}`}
                            disabled={busy}
                            onClick={() => setRetry(j)}
                          >
                            <RefreshCw size={17} />
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!jobs?.length && (
              <Empty
                title="Очередь пуста"
                description="После полной оплаты здесь появится квитанция."
              />
            )}
          </div>
        </>
      )}
      {tab === 'audit' && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Сотрудник</th>
                <th>Действие</th>
                <th>Запись</th>
              </tr>
            </thead>
            <tbody>
              {audit?.map((a) => (
                <tr key={a.id}>
                  <td>{date(a.created_at)}</td>
                  <td>{a.employee || 'Первая настройка'}</td>
                  <td>{a.action}</td>
                  <td>#{a.entity_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint table-note">Последние 200 действий. Полный журнал хранится в базе.</p>
        </div>
      )}
      {retry && (
        <Modal title="Повторить печать" onClose={() => setRetry(null)}>
          <p>
            Проверьте бумагу, принтер и очередь Windows. Если квитанция уже напечатана, повтор
            создаст её копию.
          </p>
          <div className="modal-actions">
            <button className="secondary" disabled={busy} onClick={() => setRetry(null)}>
              Отмена
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    api('/settings/print-jobs/' + retry.id + '/retry', 'POST', { confirm: true }),
                  'Задание добавлено в очередь',
                ).then((ok) => {
                  if (ok) setRetry(null);
                })
              }
            >
              Проверил, повторить
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
