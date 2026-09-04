CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, name_ko TEXT NOT NULL, short_name TEXT NOT NULL, color_primary TEXT);
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY, season INTEGER NOT NULL, starts_at TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
  away_team TEXT NOT NULL, home_team TEXT NOT NULL, venue TEXT,
  status TEXT NOT NULL CHECK (status IN ('scheduled','ticket_soon','ticket_open','live','final','cancelled','postponed')),
  away_score INTEGER, home_score INTEGER, status_note TEXT, away_line TEXT, home_line TEXT,
  away_rheb TEXT, home_rheb TEXT, hitter_details TEXT, pitcher_details TEXT, holiday_name TEXT,
  source_updated_at TEXT, ingested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (away_team <> home_team), CHECK (away_score IS NULL OR away_score >= 0), CHECK (home_score IS NULL OR home_score >= 0)
);
CREATE INDEX IF NOT EXISTS idx_games_starts_at ON games(starts_at);
CREATE INDEX IF NOT EXISTS idx_games_date ON games(date);
CREATE INDEX IF NOT EXISTS idx_games_home ON games(home_team, starts_at);
CREATE INDEX IF NOT EXISTS idx_games_away ON games(away_team, starts_at);
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status, starts_at);
CREATE TABLE IF NOT EXISTS game_innings (
  game_id TEXT NOT NULL, team TEXT NOT NULL, inning INTEGER NOT NULL, runs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, team, inning), FOREIGN KEY (game_id) REFERENCES games(id)
);
CREATE TABLE IF NOT EXISTS ticket_policies (
  team_id TEXT PRIMARY KEY, vendor_name TEXT NOT NULL, official_url TEXT NOT NULL,
  general_days_before INTEGER, general_open_time TEXT, presale_description TEXT, verified_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY, job_type TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL, fetched_count INTEGER NOT NULL DEFAULT 0, accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0, error_summary TEXT
);
INSERT OR IGNORE INTO teams (id,name_ko,short_name,color_primary) VALUES
('KIA','KIA 타이거즈','KIA','#e4002b'),('KT','KT 위즈','KT','#34383c'),('LG','LG 트윈스','LG','#c9153e'),
('NC','NC 다이노스','NC','#315991'),('SSG','SSG 랜더스','SSG','#ce0e2d'),('두산','두산 베어스','두산','#16133b'),
('롯데','롯데 자이언츠','롯데','#0b2f58'),('삼성','삼성 라이온즈','삼성','#0b5cab'),('키움','키움 히어로즈','키움','#760019'),('한화','한화 이글스','한화','#f36f21');
