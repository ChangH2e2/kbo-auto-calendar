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

import { parseRelayResults, parseRecords, formatRecords, mergeInningResults, shortenResult } from '../functions/api/boxscore.js';
import { inningOf } from '../functions/api/live-refresh.js';

const play = (inn, title, lines) => ({ inn, title, textOptions: lines.map((text) => ({ text })) });

test('중계에서 타석 결과를 뽑는다 — 주자 진루 줄에 속지 않는다', () => {
  const results = parseRelayResults({ textRelays: [
    play(1, '3번타자 오스틴', ['1구 스트라이크', '오스틴 : 좌익수 앞 1루타', '1루주자 박해민 : 2루까지 진루', '3루주자 신민재 : 홈인']),
    play(1, '5번타자 천성호', ['천성호 : 삼진 아웃']),
    play(9, '대타 김성윤', ['김성윤 : 유격수 땅볼 아웃 (유격수->1루수 송구아웃)'])
  ]});
  assert.deepEqual(results, [
    { inning: 1, batter: '오스틴', result: '좌익수 앞 1루타' },
    { inning: 1, batter: '천성호', result: '삼진' },
    { inning: 9, batter: '김성윤', result: '유격수 땅볼' }
  ]);
});

test('결과 문구는 괄호 설명과 끝의 아웃을 뗀다', () => {
  assert.equal(shortenResult('좌익수 플라이 아웃 (파울)'), '좌익수 플라이');
  assert.equal(shortenResult('삼진 아웃'), '삼진');
  assert.equal(shortenResult('좌익수 오른쪽 뒤 2루타'), '좌익수 오른쪽 뒤 2루타');
});

test('타석이 끝나지 않은 타자는 담지 않는다', () => {
  assert.deepEqual(parseRelayResults({ textRelays: [play(3, '1번타자 김지찬', ['1구 볼', '2구 스트라이크'])] }), []);
  assert.deepEqual(parseRelayResults(null), []);
});

test('기록 문자열은 왕복해도 그대로다', () => {
  assert.deepEqual(parseRecords('1회:안타 | 3회:삼진'), { 1: '안타', 3: '삼진' });
  assert.equal(formatRecords({ 3: '삼진', 1: '안타' }), '1회:안타 | 3회:삼진', '이닝 순으로 정렬');
  assert.deepEqual(parseRecords('-'), {});
  assert.equal(formatRecords({}), '-');
});

test('지난 이닝 기록을 잃지 않고 이번 이닝만 얹는다', () => {
  const details = { away: [{ name: '김지찬', records: '-' }], home: [] };
  const previous = { away: [{ name: '김지찬', records: '1회:좌익수 플라이 | 3회:삼진' }], home: [] };
  mergeInningResults(details, previous, [{ inning: 5, batter: '김지찬', result: '중전 안타' }]);
  assert.equal(details.away[0].records, '1회:좌익수 플라이 | 3회:삼진 | 5회:중전 안타');
});

test('박스스코어가 이미 채워졌으면 그것이 이긴다 — 경기 종료 후 네이버 값이 정본', () => {
  const details = { away: [{ name: '김지찬', records: '1회:좌비 | 3회:삼진 | 5회:중안' }], home: [] };
  const previous = { away: [{ name: '김지찬', records: '1회:좌익수 플라이' }], home: [] };
  mergeInningResults(details, previous, []);
  assert.equal(details.away[0].records, '1회:좌비 | 3회:삼진 | 5회:중안');
});

test('현재 이닝은 상태 문구에서 읽는다', () => {
  assert.equal(inningOf('8회말'), 8);
  assert.equal(inningOf('1회초'), 1);
  assert.equal(inningOf('경기전'), null);
  assert.equal(inningOf(null), null);
  assert.equal(inningOf('99회'), null);
});
