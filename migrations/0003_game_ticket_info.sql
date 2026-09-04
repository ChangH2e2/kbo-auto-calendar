CREATE TABLE IF NOT EXISTS game_ticket_info (
  game_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('scheduled', 'open', 'closed', 'sold_out')),
  opens_at TEXT,
  source_url TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_game_ticket_info_checked_at ON game_ticket_info(checked_at);
