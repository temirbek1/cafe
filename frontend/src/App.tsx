import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { io } from 'socket.io-client';
import {
  Coffee,
  LayoutGrid,
  History,
  ChartColumn,
  UtensilsCrossed,
  Clock3,
  Users,
  Settings as SettingsIcon,
  Boxes,
  LogOut,
  Wifi,
  WifiOff,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Menu,
} from 'lucide-react';
import { api, roleNames } from './api';
import type { User, Snapshot, OrderData, Page, Run } from './types';
import { Field, Modal, Spinner } from './ui';
import Pos from './Pos';
import Catalog from './Catalog';
import { HistoryPage, ReportsPage, ShiftsPage, TeamPage, SettingsPage } from './Pages';
import Warehouse from './Warehouse';

const navigation = [
  { id: 'pos', label: 'Касса', icon: LayoutGrid },
  { id: 'history', label: 'История', icon: History },
  { id: 'reports', label: 'Отчёты', icon: ChartColumn },
  { id: 'catalog', label: 'Меню и зал', icon: UtensilsCrossed },
  { id: 'shifts', label: 'Смены', icon: Clock3 },
  { id: 'team', label: 'Сотрудники', icon: Users },
  { id: 'settings', label: 'Настройки', icon: SettingsIcon },
  { id: 'warehouse', label: 'Склад', icon: Boxes },
] as const;
function permitted(page: Page, user: User) {
  if (user.role === 'waiter') return ['pos', 'history', 'warehouse'].includes(page);
  if (user.role === 'cashier')
    return ['pos', 'history', 'reports', 'shifts', 'warehouse'].includes(page);
  if (user.role === 'manager') return !['team', 'settings'].includes(page);
  return true;
}
function primaryOnPhone(page: Page, user: User) {
  return ['pos', 'history', user.role === 'cashier' ? 'reports' : 'catalog'].includes(page);
}

function Login({
  onLogin,
  configured,
  canSetup,
  retry,
}: {
  onLogin: (user: User) => void;
  configured: boolean;
  canSetup: boolean;
  retry: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const f = new FormData(event.currentTarget);
    try {
      const login = String(f.get('login')),
        password = String(f.get('password'));
      if (!configured)
        await api('/auth/register', 'POST', {
          name: f.get('name'),
          login,
          password,
          role: 'admin',
        });
      const data = await api<{ user: User }>('/auth/login', 'POST', { login, password });
      onLogin(data.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-page">
      <div className="login-story">
        <div className="login-brand">
          <div className="brand-icon">
            <Coffee size={27} />
          </div>
          Cafe POS
        </div>
        <div>
          <p className="eyebrow">КАЖДЫЙ ДЕНЬ ВАШЕГО КАФЕ</p>
          <h1>
            Всё готово.
            <br />
            Встречайте гостей.
          </h1>
          <p>
            Столы, заказы и команда —<br />в одном удобном пространстве.
          </p>
          <div className="login-illustration" aria-hidden="true">
            <div className="illustration-table">
              <Coffee size={62} />
              <span>
                Хороший день
                <br />
                начинается здесь
              </span>
            </div>
            <div className="illustration-note">
              01<span>новая смена</span>
            </div>
          </div>
        </div>
        <small>Локальная сеть · Кыргызский сом · Cafe POS</small>
      </div>
      <main className="login-side">
        <div className="login-form">
          <span className="eyebrow">ВАШЕ РАБОЧЕЕ МЕСТО</span>
          <h2>{configured ? 'С возвращением' : 'Настроим вашу кассу'}</h2>
          <p>
            {configured
              ? 'Войдите под своей учётной записью'
              : 'Создайте первого администратора на этом терминале.'}
          </p>
          {!configured && !canSetup ? (
            <div className="notice">
              Первую настройку нужно выполнить на POS-терминале: откройте http://localhost:3000.
              <button onClick={retry}>Проверить снова</button>
            </div>
          ) : (
            <form onSubmit={submit}>
              {!configured && (
                <Field label="Имя администратора">
                  <input name="name" required autoComplete="name" placeholder="Например, Айбек" />
                </Field>
              )}
              <Field label="Логин">
                <input
                  name="login"
                  required
                  autoComplete="username"
                  autoFocus={window.matchMedia('(min-width: 951px) and (pointer: fine)').matches}
                  placeholder="Ваш логин"
                  pattern={configured ? undefined : '[a-zA-Z0-9_.-]{2,60}'}
                />
              </Field>
              <Field label="Пароль">
                <input
                  name="password"
                  type="password"
                  required
                  minLength={configured ? undefined : 8}
                  autoComplete={configured ? 'current-password' : 'new-password'}
                  placeholder={configured ? 'Ваш пароль' : 'Не менее 8 символов'}
                />
              </Field>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary login-submit" disabled={busy}>
                {busy ? <Spinner /> : configured ? 'Войти в систему' : 'Создать администратора'}
              </button>
            </form>
          )}
          <div className="login-help">
            <Wifi size={16} />
            <span>Телефон и POS должны быть в одной сети</span>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null),
    [data, setData] = useState<Snapshot | null>(null),
    [order, setOrder] = useState<OrderData | null>(null),
    [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('pos'),
    [booting, setBooting] = useState(true),
    [configured, setConfigured] = useState(true),
    [canSetup, setCanSetup] = useState(false),
    [busy, setBusy] = useState(false),
    [connected, setConnected] = useState(true),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [revision, setRevision] = useState(0),
    [moreOpen, setMoreOpen] = useState(false);
  const userRef = useRef(user),
    contentRef = useRef<HTMLElement>(null),
    orderRef = useRef<string | null>(null),
    busyRef = useRef(false),
    sequence = useRef(0);
  userRef.current = user;
  function reset() {
    userRef.current = null;
    orderRef.current = null;
    sequence.current++;
    setUser(null);
    setData(null);
    setOrder(null);
    setSelectedTable(null);
    setPage('pos');
    setMoreOpen(false);
  }
  const refresh = useCallback(async () => {
    if (!userRef.current) return;
    const seq = ++sequence.current;
    try {
      const [tables, menu, categories, shift, settings] = await Promise.all([
        api<Snapshot['tables']>('/tables'),
        api<Snapshot['menu']>('/menu?all=true'),
        api<Snapshot['categories']>('/menu/categories'),
        api<{ shift: Snapshot['shift'] }>('/shifts/current'),
        api<Snapshot['settings']>('/settings'),
      ]);
      if (seq !== sequence.current || !userRef.current) return;
      setData({ tables, menu, categories, shift: shift.shift, settings });
      setConnected(true);
      setRevision((n) => n + 1);
      const id = orderRef.current;
      if (id) {
        const loaded = await api<OrderData>('/orders/' + id);
        if (seq === sequence.current && id === orderRef.current) setOrder(loaded);
      }
    } catch (e) {
      if (seq === sequence.current) {
        setConnected(false);
        throw e;
      }
    }
  }, []);
  async function bootstrap() {
    setBooting(true);
    try {
      const status = await api<{ configured: boolean; can_setup: boolean }>('/auth/status');
      setConfigured(status.configured);
      setCanSetup(status.can_setup);
      if (status.configured) {
        try {
          const me = await api<{ user: User }>('/auth/me');
          userRef.current = me.user;
          setUser(me.user);
        } catch {
          /* Login is shown for a missing session. */
        }
      }
      setConnected(true);
    } catch (e) {
      setConnected(false);
      setError((e as Error).message);
    } finally {
      setBooting(false);
    }
  }
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  }, [page]);
  useEffect(() => {
    void bootstrap();
    const ended = () => {
      reset();
      setError('Сессия завершена. Войдите снова');
    };
    window.addEventListener('session-ended', ended);
    return () => window.removeEventListener('session-ended', ended);
  }, []);
  useEffect(() => {
    if (!user) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh().catch((e) => setError(e.message));
      }, 100);
    };
    const socket = io({ withCredentials: true });
    socket.on('connect', reload);
    socket.on('changed', reload);
    socket.on('disconnect', (reason) => {
      setConnected(false);
      if (reason === 'io server disconnect')
        void api('/auth/me')
          .then(() => socket.connect())
          .catch(() => {});
    });
    socket.on('connect_error', () => {
      setConnected(false);
      void api('/auth/me').catch(() => {});
    });
    void refresh().catch((e) => setError(e.message));
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, 15000);
    window.addEventListener('online', reload);
    window.addEventListener('focus', reload);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      socket.disconnect();
      window.removeEventListener('online', reload);
      window.removeEventListener('focus', reload);
    };
  }, [user?.id, refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const run: Run = async (task, success) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError('');
    window.dispatchEvent(new CustomEvent('operation-error', { detail: '' }));
    let ok = false;
    try {
      await task();
      ok = true;
      if (success) setToast(success);
    } catch (e) {
      setError((e as Error).message);
      window.dispatchEvent(new CustomEvent('operation-error', { detail: (e as Error).message }));
    } finally {
      try {
        await refresh();
      } catch (e) {
        setError((e as Error).message);
      }
      busyRef.current = false;
      setBusy(false);
    }
    return ok;
  };
  function adopt(value: OrderData | null) {
    orderRef.current = value?.order.id || null;
    setOrder(value);
    if (value) setSelectedTable(value.order.table_id);
  }
  async function selectTable(id: string) {
    const table = data?.tables.find((t) => t.id === id);
    if (!table) return;
    setSelectedTable(id);
    adopt(null);
    if (table.open_order_id)
      await run(async () => {
        const loaded = await api<OrderData>('/orders/' + table.open_order_id);
        adopt(loaded);
      });
  }
  async function showOrder(id: string) {
    await run(async () => {
      const loaded = await api<OrderData>('/orders/' + id);
      adopt(loaded);
      setPage('pos');
    });
  }
  if (booting)
    return (
      <div className="boot">
        <Coffee size={40} />
        <Spinner />
        <p>Подключаемся к кассе…</p>
      </div>
    );
  if (!user)
    return (
      <>
        <Login
          configured={configured}
          canSetup={canSetup}
          retry={() => void bootstrap()}
          onLogin={(u) => {
            setError('');
            setConfigured(true);
            userRef.current = u;
            setUser(u);
          }}
        />
        {!connected && (
          <div className="connection-banner">
            <WifiOff size={18} />
            {error}
            <button onClick={() => void bootstrap()}>Повторить</button>
          </div>
        )}
      </>
    );
  if (!data)
    return (
      <div className="boot">
        <Coffee size={40} />
        <h2>Загружаем рабочее место</h2>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => void refresh().catch((e) => setError(e.message))}>
              Повторить
            </button>
          </>
        ) : (
          <Spinner />
        )}
      </div>
    );
  const common = { user, data, busy, run, revision };
  const pages = navigation.filter((n) => permitted(n.id, user));
  const morePages = pages.filter((n) => !primaryOnPhone(n.id, user));
  return (
    <div className="shell">
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          aria-label="Cafe POS — касса"
          onClick={(e) => {
            e.preventDefault();
            setPage('pos');
          }}
        >
          <Coffee size={27} />
          <span>
            Cafe<span>POS</span>
          </span>
        </a>
        <nav aria-label="Основное меню">
          {pages.map((n) => (
            <button
              key={n.id}
              className={`nav-item${page === n.id ? ' active' : ''}${primaryOnPhone(n.id, user) ? '' : ' secondary-nav'}`}
              onClick={() => setPage(n.id)}
              aria-current={page === n.id ? 'page' : undefined}
            >
              <n.icon size={21} />
              <span>{n.label}</span>
            </button>
          ))}
          {morePages.length > 0 && (
            <button
              className={`nav-item more-nav${morePages.some((n) => n.id === page) ? ' active' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(true)}
            >
              <Menu size={21} />
              <span>Ещё</span>
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <span className="sidebar-dot" />
          Локальная касса
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="cafe-name">
            {data.settings.name}
            <span>Рабочее пространство</span>
          </div>
          <div className="topbar-actions">
            <span className={'connection ' + (connected ? '' : 'offline')}>
              {connected ? <Wifi size={15} /> : <WifiOff size={15} />}
              <span>{connected ? 'В сети' : 'Нет связи'}</span>
            </span>
            <button
              className={'shift-pill ' + (data.shift ? 'open' : '')}
              onClick={() => {
                if (user.role !== 'waiter') setPage('shifts');
              }}
              disabled={user.role === 'waiter'}
            >
              <span />
              {data.shift ? 'Смена открыта' : 'Смена закрыта'}
            </button>
            <div className="user-avatar">{user.name.slice(0, 1).toUpperCase()}</div>
            <div className="user-label">
              <b>{user.name}</b>
              <small>{roleNames[user.role]}</small>
            </div>
            <button
              className="icon-button"
              title="Выйти"
              aria-label="Выйти"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await api('/auth/logout', 'POST');
                  reset();
                })
              }
            >
              <LogOut size={19} />
            </button>
          </div>
        </header>
        {(!connected || error) && (
          <div className="error-banner" role="alert">
            <AlertCircle size={18} />
            <span>{error || 'Нет связи с терминалом. Действия временно недоступны.'}</span>
            <button
              className="icon-button"
              aria-label="Обновить данные"
              onClick={() =>
                void refresh()
                  .then(() => setError(''))
                  .catch((e) => setError(e.message))
              }
            >
              <RefreshCw size={17} />
            </button>
            {connected && (
              <button onClick={() => setError('')} aria-label="Скрыть сообщение">
                ×
              </button>
            )}
          </div>
        )}
        <main ref={contentRef} className={'content ' + (page === 'pos' ? 'pos-content' : '')}>
          {page === 'pos' && (
            <Pos
              {...common}
              busy={busy || !connected}
              order={order}
              selectedTable={selectedTable}
              onSelect={selectTable}
              onOrder={adopt}
              onShift={() => setPage('shifts')}
            />
          )}{' '}
          {page === 'catalog' && <Catalog {...common} />}{' '}
          {page === 'history' && <HistoryPage {...common} onOrder={showOrder} />}{' '}
          {page === 'reports' && <ReportsPage {...common} />}{' '}
          {page === 'shifts' && <ShiftsPage {...common} />}{' '}
          {page === 'team' && <TeamPage {...common} />}{' '}
          {page === 'settings' && <SettingsPage {...common} />}
          {page === 'warehouse' && <Warehouse {...common} />}
        </main>
      </div>
      {moreOpen && (
        <Modal title="Разделы" onClose={() => setMoreOpen(false)}>
          <div className="navigation-menu">
            {pages.map((n) => (
              <button
                key={n.id}
                className={page === n.id ? 'selected' : ''}
                aria-current={page === n.id ? 'page' : undefined}
                onClick={() => {
                  setPage(n.id);
                  setMoreOpen(false);
                }}
              >
                <n.icon size={22} />
                {n.label}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
        </div>
      )}
      {busy && <div className="activity" aria-label="Выполняется операция" />}
    </div>
  );
}
