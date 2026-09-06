-- 웹 푸시 구독과 대기 중인 알림.
-- 페이로드를 암호화해 실어 보내는 대신(aes128gcm+ECDH) 빈 푸시를 보내고
-- 서비스 워커가 내용을 받아 간다. 암호화 구현을 직접 들고 있지 않아도 된다.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint    TEXT PRIMARY KEY,
  team_id     TEXT NOT NULL,
  topics      TEXT NOT NULL DEFAULT 'lineup,final',
  created_at  TEXT NOT NULL,
  last_sent_at TEXT,
  failures    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_team ON push_subscriptions(team_id);

CREATE TABLE IF NOT EXISTS push_alerts (
  id          TEXT PRIMARY KEY,
  endpoint    TEXT NOT NULL,
  topic       TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  url         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_alerts_endpoint ON push_alerts(endpoint, delivered_at);

-- 같은 사건으로 두 번 알리지 않기 위한 표식. (경기, 주제) 단위로 한 번만 남는다.
CREATE TABLE IF NOT EXISTS push_events (
  id         TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
