UPDATE settings SET value = value || '{"qr_image":""}'::jsonb WHERE id=TRUE;
