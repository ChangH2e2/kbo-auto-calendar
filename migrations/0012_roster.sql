-- 1군 등록 현황과 등록/말소 이력.
-- KBO Player/Register.aspx는 날짜를 지정해 과거도 조회할 수 있으므로 하루를 놓쳐도 복구된다.

CREATE TABLE IF NOT EXISTS roster_entries (
  team_id     TEXT NOT NULL,
  player_name TEXT NOT NULL,
  back_number TEXT NOT NULL DEFAULT '',
  position    TEXT NOT NULL,
  bats_throws TEXT,
  birth       TEXT,
  physique    TEXT,
  as_of       TEXT NOT NULL,
  PRIMARY KEY (team_id, player_name, back_number)
);
CREATE INDEX IF NOT EXISTS idx_roster_entries_team ON roster_entries(team_id, position);

CREATE TABLE IF NOT EXISTS roster_transactions (
  id          TEXT PRIMARY KEY,
  occurred_on TEXT NOT NULL,
  team_id     TEXT NOT NULL,
  player_name TEXT NOT NULL,
  back_number TEXT,
  position    TEXT,
  kind        TEXT NOT NULL CHECK (kind IN ('register','remove')),
  detected_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roster_tx_team_date ON roster_transactions(team_id, occurred_on DESC);
CREATE INDEX IF NOT EXISTS idx_roster_tx_date ON roster_transactions(occurred_on DESC);

-- 조회했는데 변동이 0건인 날과, 아예 조회하지 않은 날을 구분하기 위한 기록.
-- 이게 없으면 화면이 '변동 없음'과 '수집 안 됨'을 같게 보여준다.
CREATE TABLE IF NOT EXISTS roster_checks (
  team_id    TEXT NOT NULL,
  checked_on TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (team_id, checked_on)
);
