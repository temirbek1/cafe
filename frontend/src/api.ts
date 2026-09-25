export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(
      'Нет ответа от терминала. Проверьте Wi-Fi и обновите данные перед повтором.',
      0,
    );
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/login'))
      window.dispatchEvent(new Event('session-ended'));
    throw new ApiError(data.error || 'Не удалось выполнить действие', response.status);
  }
  return data as T;
}
export function requestKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const money = (value: unknown) =>
  new Intl.NumberFormat('ru-KG', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(
    Number(value || 0),
  ) + ' сом';
export const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString('ru-RU', {
        timeZone: 'Asia/Bishkek',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
export const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek' }).format(new Date());
export const roleNames = {
  admin: 'Администратор',
  manager: 'Менеджер',
  cashier: 'Кассир',
  waiter: 'Официант',
};
export const statusNames = {
  open: 'Открыт',
  paid: 'Оплачен',
  cancelled: 'Отменён',
  refunded: 'Возврат',
};
export const methodNames = { cash: 'Наличные', card: 'Карта', online: 'QR' };
