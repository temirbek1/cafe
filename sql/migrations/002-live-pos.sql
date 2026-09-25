CREATE TABLE sessions (
  id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sessions_user ON sessions(user_id);
ALTER TABLE tables ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE orders ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('open','paid','cancelled','refunded'));
ALTER TABLE payments ADD COLUMN shift_id BIGINT REFERENCES shifts(id);
ALTER TABLE payments ADD COLUMN request_key UUID UNIQUE;
UPDATE payments p SET shift_id = (SELECT s.id FROM shifts s WHERE p.paid_at >= s.opened_at
  AND (s.closed_at IS NULL OR p.paid_at <= s.closed_at) ORDER BY s.opened_at DESC LIMIT 1);
CREATE INDEX payments_shift ON payments(shift_id);
CREATE INDEX payments_date ON payments(paid_at);
CREATE INDEX orders_user_date ON orders(user_id, opened_at DESC);
CREATE INDEX order_items_order ON order_items(order_id);
CREATE TABLE refunds (
  id BIGSERIAL PRIMARY KEY, payment_id BIGINT NOT NULL UNIQUE REFERENCES payments(id),
  order_id BIGINT NOT NULL REFERENCES orders(id), shift_id BIGINT NOT NULL REFERENCES shifts(id),
  user_id BIGINT NOT NULL REFERENCES users(id), amount NUMERIC(12,2) NOT NULL CHECK (amount>0),
  method TEXT NOT NULL CHECK (method IN ('cash','card','online')), reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT REFERENCES users(id), action TEXT NOT NULL,
  entity_id TEXT, details JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE settings (id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(id), value JSONB NOT NULL);
INSERT INTO settings(value) VALUES ('{"name":"Моё кафе","address":"","phone":"","currency":"KGS","timezone":"Asia/Bishkek","receipt_width":80,"print_mode":"browser","printer_name":""}');
CREATE TABLE print_jobs (
  id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id),
  kind TEXT NOT NULL CHECK (kind IN ('payment','refund')), payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','printing','submitted','failed','uncertain','manual')),
  error TEXT, attempts INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(order_id, kind)
);
