// 경기 중 점수·이닝을 분 단위로 갱신한다.
// GitHub Actions의 schedule 이벤트는 10분 크론을 걸어도 실제로는 2시간대에 한 번 오기 때문에
// (2026-09-05~06 실측 간격 105~280분) 라이브 갱신을 그쪽에 의존할 수 없다.
// 이 엔드포인트는 Cloudflare Worker 크론(workers/live-cron)이 1분마다 호출한다.
import { normalizePreview, PREVIEW_UPSERT, previewValues } from './preview-ingest.js';
import { dispatchEvents } from './push/dispatch.js';

const NAVER_GAMES = 'https://api-gw.sports.naver.com/schedule/games';
const NAVER_HEADERS = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// game-polling은 진행 중인 경기에 STARTED를 준다(2026-09-06 실측). 일정 API의 BEFORE/RESULT와 다르다.
const LIVE_CODES = new Set(['INGAME', 'IN_PROGRESS', 'PLAYING', 'LIVE', 'STARTED']);
const FINAL_CODES = new Set(['RESULT', 'FINAL', 'END']);
const PREGAME_CODES = new Set(['BEFORE', 'SCHEDULED', 'PREVIEW', 'READY']);
const CLOSED_STATUSES = new Set(['final', 'cancelled', 'postponed']);

const LIVE_WINDOW_BEFORE_MS = 20 * 60 * 1000;
const LIVE_WINDOW_AFTER_MS = 6 * 60 * 60 * 1000;
const PREVIEW_WINDOW_MS = 6 * 60 * 60 * 1000;
const PREVIEW_MIN_INTERVAL_MS = 4 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;
const MAX_PREVIEW_FETCHES = 5;

export const LIVE_FIELDS = ['status', 'status_note', 'away_score', 'home_score',
  'away_line', 'home_line', 'away_rheb', 'home_rheb'];

export function kstDate(now = Date.now()) {
  return new Date(now + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// 우리 game_id에 시즌을 붙이면 네이버 gameId가 된다: 20260906NCWO0 + 2026.
// preview-ingest의 검증 규칙과 같은 전제이며 프로덕션에서 확인된 형식이다.
export function naverGameId(gameId) {
  return typeof gameId === 'string' && /^\d{8}[A-Za-z]{4}\d$/.test(gameId)
    ? gameId + gameId.slice(0, 4) : null;
}

export function isLiveTarget(game, now) {
  const startsAt = Date.parse(game?.starts_at);
  if (!Number.isFinite(startsAt) || CLOSED_STATUSES.has(game.status)) return false;
  if (!naverGameId(game.id)) return false;
  return now >= startsAt - LIVE_WINDOW_BEFORE_MS && now <= startsAt + LIVE_WINDOW_AFTER_MS;
}

// 라인업이 확정될 때까지만 프리뷰를 다시 읽는다. 확정된 뒤에는 더 부르지 않는다.
export function isPreviewTarget(game, now, minIntervalMs = PREVIEW_MIN_INTERVAL_MS) {
  const startsAt = Date.parse(game?.starts_at);
  if (!Number.isFinite(startsAt) || CLOSED_STATUSES.has(game.status)) return false;
  if (!naverGameId(game.id) || game.lineup_state === 'announced') return false;
  if (now < startsAt - PREVIEW_WINDOW_MS || now > startsAt) return false;
  const checkedAt = Date.parse(game.preview_checked_at);
  return !Number.isFinite(checkedAt) || now - checkedAt >= minIntervalMs;
}

function joinCells(value) {
  return Array.isArray(value) && value.length ? value.map((cell) => String(cell)).join('|') : null;
}

function score(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// crawling.py의 normalize_naver_polling과 같은 규칙이다. 한쪽만 고치지 말 것.
export function normalizePolling(polling) {
  if (!polling || typeof polling !== 'object' || Array.isArray(polling)) return null;
  if (polling.cancel || polling.suspended) {
    return { status: 'cancelled', status_note: String(polling.statusInfo || '경기취소').slice(0, 120) };
  }
  const code = String(polling.statusCode || '').toUpperCase();
  if (PREGAME_CODES.has(code)) {
    // 경기 전 0-0을 실제 점수로 저장하면 안 된다. 명시적으로 비운다.
    return { status: 'scheduled', status_note: null, away_score: null, home_score: null,
      away_line: null, home_line: null, away_rheb: null, home_rheb: null };
  }
  const patch = {};
  if (LIVE_CODES.has(code)) patch.status = 'live';
  else if (FINAL_CODES.has(code)) patch.status = 'final';
  const away = score(polling.awayTeamScore);
  const home = score(polling.homeTeamScore);
  if (away !== null) patch.away_score = away;
  if (home !== null) patch.home_score = home;
  for (const side of ['away', 'home']) {
    const line = joinCells(polling[`${side}TeamScoreByInning`]);
    if (line) patch[`${side}_line`] = line;
    const rheb = joinCells(polling[`${side}TeamRheb`]);
    if (rheb) patch[`${side}_rheb`] = rheb;
  }
  if (polling.statusInfo) patch.status_note = String(polling.statusInfo).slice(0, 120);
  return Object.keys(patch).length ? patch : null;
}

export function buildLiveUpdate(gameId, patch, updatedAt) {
  const keys = LIVE_FIELDS.filter((key) => key in patch);
  if (!keys.length) return null;
  const assignments = keys.map((key, index) => `${key}=?${index + 1}`).join(',');
  return {
    sql: `UPDATE games SET ${assignments}, source_updated_at=?${keys.length + 1} WHERE id=?${keys.length + 2}`,
    binds: [...keys.map((key) => patch[key]), updatedAt, gameId]
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: NAVER_HEADERS, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestPost(context) {
  const expected = context.env.LIVE_REFRESH_TOKEN;
  const actual = (context.request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || actual !== expected) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const db = context.env.KBO_DB;
  const now = Date.now();
  const today = kstDate(now);
  const startedAt = new Date(now).toISOString();

  let games = [];
  try {
    const result = await db.prepare(`SELECT g.id, g.starts_at, g.status, g.away_team, g.home_team,
        p.lineup_state, p.checked_at AS preview_checked_at
      FROM games g LEFT JOIN game_previews p ON p.game_id = g.id
      WHERE g.date = ?1 ORDER BY g.starts_at ASC`).bind(today).all();
    games = result.results || [];
  } catch (error) {
    console.error('live_refresh_read_failed', String(error));
    return Response.json({ error: '경기 조회에 실패했습니다.' }, { status: 500 });
  }

  const liveTargets = games.filter((game) => isLiveTarget(game, now));
  const previewTargets = games.filter((game) => isPreviewTarget(game, now)).slice(0, MAX_PREVIEW_FETCHES);
  // 경기가 없는 시간대에는 외부 요청을 한 번도 하지 않는다.
  if (!liveTargets.length && !previewTargets.length) {
    return Response.json({ skipped: true, date: today, games: games.length });
  }

  const statements = [];
  let polled = 0;
  let previewed = 0;

  const events = [];
  for (const game of liveTargets) {
    const payload = await fetchJson(`${NAVER_GAMES}/${naverGameId(game.id)}/game-polling`);
    const patch = normalizePolling(payload?.result?.game);
    if (!patch) continue;
    polled += 1;
    // 이번 갱신에서 처음 종료로 넘어간 경기만 알린다.
    if (patch.status === 'final' && game.status !== 'final' && patch.away_score != null && patch.home_score != null) {
      events.push({ topic: 'final', game_id: game.id, away: game.away_team, home: game.home_team,
        away_score: patch.away_score, home_score: patch.home_score });
    }
    const update = buildLiveUpdate(game.id, patch, new Date().toISOString());
    if (update) statements.push(db.prepare(update.sql).bind(...update.binds));
  }

  for (const game of previewTargets) {
    const sourceGameId = naverGameId(game.id);
    const payload = await fetchJson(`${NAVER_GAMES}/${sourceGameId}/preview`);
    const previewData = payload?.result?.previewData;
    if (!previewData) continue;
    const row = normalizePreview({ game_id: game.id, source_game_id: sourceGameId,
      checked_at: new Date().toISOString(), previewData });
    if (!row) continue;
    previewed += 1;
    // 라인업이 이번에 처음 확정된 경기만 알린다.
    if (row.lineup_state === 'announced' && game.lineup_state !== 'announced') {
      events.push({ topic: 'lineup', game_id: game.id, away: game.away_team, home: game.home_team });
    }
    statements.push(db.prepare(PREVIEW_UPSERT).bind(...previewValues(row)));
  }

  // 1분마다 도는 작업이라 실행마다 행을 남기면 시즌 동안 수만 행이 쌓인다.
  // KST 시간 단위로 한 행만 두고 최신 실행 결과로 덮어쓴다.
  const id = `live-${new Date(now + KST_OFFSET_MS).toISOString().slice(0, 13)}`;
  const fetched = liveTargets.length + previewTargets.length;
  const log = (status, accepted, error = null) => db.prepare(`INSERT INTO ingestion_runs
    (id,job_type,started_at,finished_at,status,fetched_count,accepted_count,rejected_count,error_summary)
    VALUES (?1,'live',?2,?3,?4,?5,?6,0,?7)
    ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at,finished_at=excluded.finished_at,
      status=excluded.status,fetched_count=excluded.fetched_count,
      accepted_count=excluded.accepted_count,error_summary=excluded.error_summary`)
    .bind(id, startedAt, new Date().toISOString(), status, fetched, accepted, error);

  if (!statements.length) {
    // 네이버가 응답하지 않아도 기존 데이터는 그대로 둔다.
    await log('success', 0).run().catch((error) => console.error('live_log_failed', String(error)));
    return Response.json({ polled, previewed, written: 0, date: today });
  }

  try {
    await db.batch(statements);
    await log('success', statements.length).run();
    // 알림은 갱신을 막지 않는다. 실패해도 데이터는 이미 저장됐다.
    if (events.length && context.env.VAPID_PRIVATE_JWK) {
      context.waitUntil(dispatchEvents(db, context.env, events, new Date().toISOString())
        .catch((error) => console.error('push_dispatch_failed', String(error))));
    }
  } catch (error) {
    console.error('live_refresh_write_failed', String(error));
    await log('failed', 0, 'Live refresh write failed').run().catch(() => {});
    return Response.json({ error: '라이브 갱신 저장에 실패했습니다.' }, { status: 500 });
  }
  return Response.json({ polled, previewed, written: statements.length, events: events.length, date: today });
}
