ALTER TABLE print_jobs DROP CONSTRAINT print_jobs_kind_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_kind_check
  CHECK (kind IN ('payment','refund','kitchen'));
UPDATE settings SET value = value || '{"kitchen_printer_ip":"","kitchen_printer_port":9100}'::jsonb WHERE id=TRUE;
