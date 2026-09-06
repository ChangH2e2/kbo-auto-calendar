import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBatters, normalizePitchers, normalizeBoxscore } from '../functions/api/boxscore.js';

// 2026-09-06 삼성@LG 라이브 응답에서 그대로 가져온 모양.
const batter = (extra = {}) => ({ batOrder: 1, name: '김지찬', pos: '중', ab: 5, hit: 1, rbi: 0, hra: '0.327', ...extra });
const pitcher = (extra = {}) => ({ name: '후라도', inn: '5.2', bf: 102, kk: 4, er: 4, wls: '', ...extra });

test('타자 기록은 화면이 쓰는 모양 그대로 나온다', () => {
  const [row] = normalizeBatters([batter()]);
  assert.deepEqual(row, { order: '[1번]', pos: '중', name: '김지찬',
    ab: '5', hit: '1', rbi: '0', avg: '0.327', records: '-' });
});

test('대타·대주자는 같은 타순으로 여러 줄이 오고 순서를 지킨다', () => {
  const rows = normalizeBatters([
    batter({ batOrder: 4, name: '최형우', pos: '지' }),
    batter({ batOrder: 4, name: '양우현', pos: '주' }),
    batter({ batOrder: 4, name: '이창용', pos: '대' })
  ]);
  assert.deepEqual(rows.map((r) => r.name), ['최형우', '양우현', '이창용']);
  assert.deepEqual(rows.map((r) => r.order), ['[4번]', '[4번]', '[4번]']);
});

test('타순이 없으면 대타로 본다', () => {
  assert.equal(normalizeBatters([batter({ batOrder: 0 })])[0].order, '[대타]');
  assert.equal(normalizeBatters([batter({ batOrder: undefined })])[0].order, '[대타]');
});

test('이닝별 결과는 있을 때만 붙인다 — 네이버는 보통 비워 보낸다', () => {
  assert.equal(normalizeBatters([batter()])[0].records, '-');
  assert.equal(normalizeBatters([batter({ inn1: '안타', inn3: '삼진' })])[0].records, '1회:안타 | 3회:삼진');
});

test('투구수는 bf다 — 5.2이닝 102구로 확인했다', () => {
  const [row] = normalizePitchers([pitcher()]);
  assert.deepEqual(row, { name: '후라도', result: '-', ip: '5.2', np: '102', so: '4', er: '4' });
  assert.equal(normalizePitchers([pitcher({ wls: '승' })])[0].result, '승');
});

test('이름 없는 행은 버리고 0은 살린다', () => {
  assert.equal(normalizeBatters([{ ab: 3 }, batter()]).length, 1);
  assert.equal(normalizeBatters([batter({ hit: 0 })])[0].hit, '0', '0을 - 로 바꾸지 않는다');
  assert.equal(normalizeBatters([batter({ hit: null })])[0].hit, '-');
  assert.deepEqual(normalizeBatters(null), []);
});

test('양쪽 다 비면 null — 기존 기록을 빈 값으로 덮지 않는다', () => {
  assert.equal(normalizeBoxscore({ battersBoxscore: { away: [], home: [] }, pitchersBoxscore: { away: [], home: [] } }), null);
  assert.equal(normalizeBoxscore(null), null);
  assert.equal(normalizeBoxscore({}), null);
  const result = normalizeBoxscore({ battersBoxscore: { away: [batter()], home: [] },
    pitchersBoxscore: { away: [pitcher()], home: [] } });
  assert.equal(result.hitter_details.away.length, 1);
  assert.deepEqual(result.hitter_details.home, []);
  assert.equal(result.pitcher_details.away[0].name, '후라도');
});
