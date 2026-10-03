CREATE TABLE warehouse_items (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  min_quantity NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
