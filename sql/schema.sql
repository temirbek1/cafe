CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, login TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'cashier', 'waiter')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE TABLE IF NOT EXISTS tables (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'busy', 'reserved')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS menu_categories (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS menu_items (
  id BIGSERIAL PRIMARY KEY, category_id BIGINT REFERENCES menu_categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL, price NUMERIC(12,2) NOT NULL CHECK (price >= 0), active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS is_quick BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS orders (
  id BIGSERIAL PRIMARY KEY, table_id BIGINT NOT NULL REFERENCES tables(id), user_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  guest_count INTEGER NOT NULL DEFAULT 1 CHECK (guest_count > 0), comment TEXT, total NUMERIC(12,2) NOT NULL DEFAULT 0,
  cancel_reason TEXT, opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_order_per_table ON orders(table_id) WHERE status = 'open';
CREATE TABLE IF NOT EXISTS order_items (
  id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id), menu_item_id BIGINT REFERENCES menu_items(id),
  name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity > 0), price NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')), cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS order_bills (
  id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0), status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid'))
);
CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id), bill_id BIGINT REFERENCES order_bills(id),
  user_id BIGINT NOT NULL REFERENCES users(id), method TEXT NOT NULL CHECK (method IN ('cash', 'card', 'online')),
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0), paid_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS shifts (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_cash >= 0),
  closing_cash NUMERIC(12,2) CHECK (closing_cash >= 0),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS one_open_shift ON shifts ((status)) WHERE status = 'open';
