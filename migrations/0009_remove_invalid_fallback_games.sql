-- Fallback IDs are valid only for cancellation rows whose source has no game ID.
DELETE FROM games WHERE id LIKE '%-noid' AND status <> 'cancelled';
