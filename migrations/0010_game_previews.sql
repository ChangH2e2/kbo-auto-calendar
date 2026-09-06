CREATE TABLE IF NOT EXISTS game_previews (
  game_id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'naver',
  source_game_id TEXT,
  lineup_state TEXT NOT NULL CHECK (lineup_state IN ('none','starter_only','announced')),
  away_starter TEXT,
  home_starter TEXT,
  away_lineup TEXT,
  home_lineup TEXT,
  away_bullpen TEXT,
  home_bullpen TEXT,
  away_bench TEXT,
  home_bench TEXT,
  away_standing TEXT,
  home_standing TEXT,
  season_vs TEXT,
  checked_at TEXT NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_game_previews_checked_at ON game_previews(checked_at);
