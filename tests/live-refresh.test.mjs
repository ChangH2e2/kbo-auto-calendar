import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { naverGameId, isLiveTarget, isPreviewTarget, normalizePolling, buildLiveUpdate, kstDate }
  from '../functions/api/live-refresh.js';

const START = '2026-09-06T17:00:00+09:00';
const startsAt = Date.parse(START);
const game = (extra = {}) => ({ id: '20260906HHLT0', starts_at: START, status: 'scheduled', ...extra });

test('네이버 gameId는 우리 game_id에 시즌을 붙여 만든다; 폴백 id는 거부한다', () => {
  assert.equal(naverGameId('20260906HHLT0'), '20260906HHLT02026');
  assert.equal(naverGameId('20260906-한화-롯데-noid'), null);
  assert.equal(naverGameId(undefined), null);
});

test('라이브 대상은 시작 20분 전 ~ 6시간 뒤이고 종료된 경기는 제외한다', () => {
  assert.equal(isLiveTarget(game(), startsAt - 19 * 60 * 1000), true);
  assert.equal(isLiveTarget(game(), startsAt - 21 * 60 * 1000), false);
  assert.equal(isLiveTarget(game(), startsAt + 6 * 60 * 60 * 1000), true);
  assert.equal(isLiveTarget(game(), startsAt + 6 * 60 * 60 * 1000 + 1), false);
  for (const status of ['final', 'cancelled', 'postponed']) {
    assert.equal(isLiveTarget(game({ status }), startsAt + 60 * 1000), false, status);
  }
  assert.equal(isLiveTarget(game({ id: 'bad-id' }), startsAt), false);
});

test('프리뷰는 라인업이 확정되면 더 부르지 않고, 4분 간격을 지킨다', () => {
  const now = startsAt - 60 * 60 * 1000;
  assert.equal(isPreviewTarget(game(), now), true);
  assert.equal(isPreviewTarget(game({ lineup_state: 'announced' }), now), false);
  assert.equal(isPreviewTarget(game({ lineup_state: 'starter_only' }), now), true);
  const recent = new Date(now - 60 * 1000).toISOString();
  assert.equal(isPreviewTarget(game({ preview_checked_at: recent }), now), false);
  const old = new Date(now - 5 * 60 * 1000).toISOString();
  assert.equal(isPreviewTarget(game({ preview_checked_at: old }), now), true);
  assert.equal(isPreviewTarget(game(), startsAt - 6 * 60 * 60 * 1000 - 1), false, '6시간보다 이르면 제외');
  assert.equal(isPreviewTarget(game(), startsAt + 1), false, '시작 후에는 제외');
});

test('STARTED는 live다 — 이게 빠지면 status가 scheduled에 머문다', () => {
  assert.equal(normalizePolling({ statusCode: 'STARTED', statusInfo: '5회초' }).status, 'live');
  assert.equal(normalizePolling({ statusCode: 'RESULT' }).status, 'final');
  assert.equal(normalizePolling({ statusCode: 'INGAME' }).status, 'live');
});

test('경기 전에는 0-0을 저장하지 않고 이닝·점수를 비운다', () => {
  const patch = normalizePolling({ statusCode: 'BEFORE', awayTeamScore: 0, homeTeamScore: 0 });
  assert.equal(patch.status, 'scheduled');
  for (const key of ['away_score', 'home_score', 'away_line', 'home_line', 'away_rheb', 'home_rheb', 'status_note']) {
    assert.equal(patch[key], null, key);
  }
});

test('취소·중단은 상태와 사유만 남긴다', () => {
  assert.deepEqual(normalizePolling({ cancel: true, statusInfo: '우천취소' }), { status: 'cancelled', status_note: '우천취소' });
  assert.equal(normalizePolling({ suspended: true }).status_note, '경기취소');
});

test('이닝·RHEB는 파이프로 잇고 빈 배열은 무시한다', () => {
  const patch = normalizePolling({ statusCode: 'STARTED', awayTeamScore: 4, homeTeamScore: 2,
    awayTeamScoreByInning: ['0', '3', '1'], homeTeamRheb: [2, 5, 1, 0], homeTeamScoreByInning: [] });
  assert.equal(patch.away_line, '0|3|1');
  assert.equal(patch.home_rheb, '2|5|1|0');
  assert.equal('home_line' in patch, false);
  assert.equal(patch.away_score, 4);
  assert.equal(normalizePolling({}), null);
  assert.equal(normalizePolling(null), null);
});

test('KST 날짜는 UTC 자정 전후에도 어긋나지 않는다', () => {
  assert.equal(kstDate(Date.parse('2026-09-06T14:59:00Z')), '2026-09-06');
  assert.equal(kstDate(Date.parse('2026-09-06T15:01:00Z')), '2026-09-07');
});

test('실제 SQLite에서 UPDATE가 대상 경기만 정확히 바꾼다', () => {
  const patch = normalizePolling({ statusCode: 'STARTED', statusInfo: '5회초', awayTeamScore: 4,
    homeTeamScore: 2, awayTeamScoreByInning: ['0', '3', '1'] });
  const update = buildLiveUpdate('20260906HHLT0', patch, '2026-09-06T08:00:00.000Z');
  assert.ok(update.sql.startsWith('UPDATE games SET '));
  assert.equal(buildLiveUpdate('x', {}, 'now'), null);

  const seed = `INSERT INTO games(id,season,starts_at,date,time,away_team,home_team,status,home_line)
    VALUES ('20260906HHLT0',2026,'${START}','2026-09-06','17:00','한화','롯데','scheduled','9|9|9'),
           ('20260906NCWO0',2026,'2026-09-06T14:00:00+09:00','2026-09-06','14:00','NC','키움','final','1|1|1')`;
  const code = `import sqlite3,json,sys
x=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.executescript(x['schema'])
db.executescript(x['seed'])
db.execute(x['sql'].replace('?1','?').replace('?2','?').replace('?3','?').replace('?4','?').replace('?5','?').replace('?6','?').replace('?7','?'), x['binds'])
print(json.dumps([list(r) for r in db.execute("SELECT id,status,status_note,away_score,home_score,away_line,home_line,source_updated_at FROM games ORDER BY id")]))`;
  const proc = spawnSync('python3', ['-c', code], { input: JSON.stringify({
    schema: readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8'),
    seed, sql: update.sql, binds: update.binds }), encoding: 'utf8' });
  assert.equal(proc.status, 0, proc.stderr);
  const [hhlt, ncwo] = JSON.parse(proc.stdout);
  assert.deepEqual(hhlt, ['20260906HHLT0', 'live', '5회초', 4, 2, '0|3|1', '9|9|9', '2026-09-06T08:00:00.000Z']);
  assert.deepEqual(ncwo, ['20260906NCWO0', 'final', null, null, null, null, '1|1|1', null], '다른 경기는 그대로');
});
