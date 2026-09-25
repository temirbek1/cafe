export type User = {
  id: string;
  name: string;
  login: string;
  role: 'admin' | 'manager' | 'cashier' | 'waiter';
  active?: boolean;
};
export type Table = {
  id: string;
  name: string;
  status: 'free' | 'busy' | 'reserved';
  open_order_id: string | null;
  open_order_total: string | null;
  order_user_id: string | null;
  waiter_name: string | null;
  opened_at: string | null;
};
export type Category = { id: string; name: string; sort_order: number };
export type Dish = {
  id: string;
  name: string;
  price: string;
  category_id: string | null;
  category: string | null;
  active: boolean;
  is_quick: boolean;
};
export type Item = {
  id: string;
  menu_item_id: string;
  name: string;
  price: string;
  quantity: number;
  status: 'active' | 'cancelled';
  cancel_reason?: string;
};
export type Payment = {
  id: string;
  method: 'cash' | 'card' | 'online';
  amount: string;
  paid_at: string;
  bill_id: string | null;
};
export type Order = {
  id: string;
  table_id: string;
  user_id: string;
  status: 'open' | 'paid' | 'cancelled' | 'refunded';
  guest_count: number;
  comment: string | null;
  total: string;
  table_name: string;
  waiter_name: string;
  version: number;
  opened_at: string;
  closed_at: string | null;
  cancel_reason: string | null;
};
export type OrderData = {
  order: Order;
  items: Item[];
  payments: Payment[];
  bills: { id: string; amount: string; status: 'open' | 'paid' }[];
  refunds: { id: string; amount: string; method: string }[];
};
export type Shift = {
  id: string;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  opened_by: string;
  opening_cash: string;
  closing_cash: string | null;
  expected_cash: number;
  difference: number | null;
  sales: { total: number; cash: number; card: number; online: number };
  refunds: { total: number; cash: number };
  net: number;
};
export type Settings = {
  name: string;
  address: string;
  phone: string;
  currency: string;
  timezone: string;
  receipt_width: number;
  print_mode: 'browser' | 'windows';
  printer_name: string;
  windows_print_available: boolean;
  fiscal_connected: boolean;
  bank_connected: boolean;
};
export type Snapshot = {
  tables: Table[];
  menu: Dish[];
  categories: Category[];
  shift: Shift | null;
  settings: Settings;
};
export type Run = (task: () => Promise<unknown>, success?: string) => Promise<boolean>;
export type Page = 'pos' | 'history' | 'reports' | 'catalog' | 'shifts' | 'team' | 'settings';
export type Shared = { user: User; data: Snapshot; busy: boolean; run: Run; revision: number };
