import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { normalizeEntry, normalizeTransaction, normalizeCheck, teamsWithFullRoster } from '../functions/api/roster-ingest.js';
import { positionCounts, summarizeChanges } from '../functions/api/roster.js';

const entry = (extra = {}) => ({ team: '한화', name: '문현빈', back_number: '51', position: '외야수',
  bats_throws: '우투좌타', birth: '2004-04-20', physique: '174cm, 82kg', ...extra });

test('알 수 없는 구단·포지션·빈 이름은 버린다', () => {
  assert.ok(normalizeEntry(entry()));
  assert.equal(normalizeEntry(entry({ team: '삼미' })), null);
  assert.equal(normalizeEntry(entry({ position: '감독' })), null, '감독·코치는 선수 명단이 아니다');
  assert.equal(normalizeEntry(entry({ name: '  ' })), null);
});

test('등번호가 없어도 명단에 남긴다 — 육성·군보류가 그렇다', () => {
  const row = normalizeEntry(entry({ back_number: null }));
  assert.equal(row.back_number, '');
});

test('변동 id는 같은 입력에 같은 값이라 재수집해도 중복되지 않는다', () => {
  const raw = { team: '한화', date: '2026-09-03', kind: 'register', name: '왕옌청', back_number: '19', position: '투수' };
  const first = normalizeTransaction(raw);
  assert.equal(first.id, normalizeTransaction({ ...raw }).id);
  assert.equal(first.kind, 'register', '날짜에 하이픈이 있어 id에서 kind를 되뽑으면 어긋난다');
  assert.equal(normalizeTransaction({ ...raw, kind: 'traded' }), null);
  assert.equal(normalizeTransaction({ ...raw, date: '2026-9-3' }), null);
});

test('조회 기록은 팀과 날짜 형식을 지킨 것만 받는다', () => {
  assert.deepEqual(normalizeCheck({ team: 'LG', date: '2026-09-06' }), { team_id: 'LG', checked_on: '2026-09-06' });
  assert.equal(normalizeCheck({ team: 'LG', date: '어제' }), null);
});

test('명단이 20명 미만인 팀은 통째로 뺀다 — 반쪽 명단으로 덮어쓰지 않는다', () => {
  const many = Array.from({ length: 25 }, (_, i) => normalizeEntry(entry({ name: `선수${i}` })));
  const few = Array.from({ length: 3 }, (_, i) => normalizeEntry(entry({ team: 'LG', name: `엘지${i}` })));
  const full = teamsWithFullRoster([...many, ...few]);
  assert.ok(full.has('한화'));
  assert.equal(full.has('LG'), false);
});

test('포지션 집계는 선수 구분을 그대로 센다', () => {
  const counts = positionCounts([{ position: '투수' }, { position: '투수' }, { position: '포수' }, { position: '외야수' }]);
  assert.deepEqual(counts, { 투수: 2, 포수: 1, 내야수: 0, 외야수: 1, total: 4 });
});

test('변동 없는 날과 수집하지 않은 날을 구분한다', () => {
  const transactions = [{ occurred_on: '2026-09-05' }, { occurred_on: '2026-09-05' }, { occurred_on: '2026-09-03' }];
  const checked = summarizeChanges(transactions, [{ checked_on: '2026-09-06' }], '2026-09-06');
  assert.equal(checked.checked_today, true);
  assert.deepEqual(checked.today, []);
  assert.equal(checked.last_change_on, '2026-09-05');
  assert.equal(checked.last_change_count, 2);
  const notChecked = summarizeChanges(transactions, [{ checked_on: '2026-09-04' }], '2026-09-06');
  assert.equal(notChecked.checked_today, false, '수집하지 않은 날을 변동 없음으로 보이면 안 된다');
});

test('실제 SQLite에서 오래된 명단만 지우고 다른 팀은 건드리지 않는다', () => {
  const code = `import sqlite3,json,sys
x=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.executescript(x['schema'])
db.executescript(x['seed'])
db.execute("DELETE FROM roster_entries WHERE team_id = ? AND as_of < ?", ('한화','2026-09-06'))
print(json.dumps([list(r) for r in db.execute('SELECT team_id,player_name,as_of FROM roster_entries ORDER BY team_id,player_name')]))`;
  const seed = `INSERT INTO roster_entries(team_id,player_name,back_number,position,as_of) VALUES
    ('한화','문현빈','51','외야수','2026-09-06'),
    ('한화','떠난선수','99','투수','2026-09-05'),
    ('LG','오지환','10','내야수','2026-09-05')`;
  const proc = spawnSync('python3', ['-c', code], { encoding: 'utf8', input: JSON.stringify({
    schema: readFileSync(new URL('../migrations/0012_roster.sql', import.meta.url), 'utf8'), seed }) });
  assert.equal(proc.status, 0, proc.stderr);
  assert.deepEqual(JSON.parse(proc.stdout), [['LG', '오지환', '2026-09-05'], ['한화', '문현빈', '2026-09-06']]);
});
