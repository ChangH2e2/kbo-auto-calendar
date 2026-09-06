import test from 'node:test';
import assert from 'node:assert/strict';
import { remainingGames, winRate, gamesBehind, magicNumber, buildStandings } from '../functions/api/standings.js';

const team = (w, l, d = 0, name = 'T') => ({ team: name, w, l, d });

test('잔여 경기는 144에서 치른 경기를 뺀다', () => {
  assert.equal(remainingGames(team(71, 46, 3)), 24);
  assert.equal(remainingGames(team(100, 44, 0)), 0);
  assert.equal(remainingGames(team(100, 60, 0)), 0, '음수가 되지 않는다');
});

test('승률은 무승부를 제외한다 — KBO 순위 규칙', () => {
  assert.equal(winRate(team(51, 65, 3)).toFixed(3), '0.440');
  assert.equal(winRate(team(0, 0, 0)), 0);
});

test('게임차는 승차와 패차의 평균이다', () => {
  const leader = team(71, 46);
  // 71-46(.607)과 69-45(.605)는 승률이 거의 같다. 승 2 뒤·패 1 앞이라 게임차는 0.5다.
  assert.equal(gamesBehind(team(69, 45), leader), 0.5);
  assert.equal(gamesBehind(team(65, 52), leader), 6);
  assert.equal(gamesBehind(leader, leader), 0);
});

test('매직넘버는 상대가 전승해도 앞서는 데 필요한 승수다', () => {
  const me = team(71, 46, 3);        // 잔여 24
  const rival = team(55, 58, 2);     // 잔여 29 → 최대 84승
  assert.equal(magicNumber(me, rival), 84 - 71 + 1);
  assert.equal(magicNumber(me, null), null);
});

const LEAGUE = [
  team(71, 46, 3, '삼성'), team(69, 45, 3, 'KT'), team(68, 52, 1, 'LG'), team(65, 52, 2, 'KIA'),
  team(61, 57, 4, '두산'), team(55, 58, 2, 'NC'), team(52, 66, 5, 'SSG'), team(51, 65, 2, '롯데'),
  team(51, 65, 3, '한화'), team(43, 80, 3, '키움')
];

test('순위는 승률 순이고 5위까지만 진출 매직넘버가 붙는다', () => {
  const table = buildStandings(LEAGUE);
  assert.deepEqual(table.map((t) => t.team).slice(0, 5), ['삼성', 'KT', 'LG', 'KIA', '두산']);
  assert.equal(table[0].position, 1);
  assert.ok(Number.isInteger(table[0].playoff_magic), '1~5위는 매직넘버가 있다');
  assert.equal(table[5].playoff_magic, null, '6위 이하는 없다');
  assert.equal(table[0].games_behind, 0);
  assert.ok(table[1].games_behind > 0);
});

test('1위만 우승 매직넘버를 갖는다', () => {
  const table = buildStandings(LEAGUE);
  assert.ok(Number.isInteger(table[0].title_magic));
  assert.equal(table[1].title_magic, null);
});

test('이미 확정이면 매직넘버가 0이고 확정 표시가 붙는다', () => {
  const clinched = [team(100, 20, 0, 'A'), ...LEAGUE.slice(1)];
  const table = buildStandings(clinched);
  assert.equal(table[0].playoff_magic, 0);
  assert.equal(table[0].playoff_clinched, true);
  assert.equal(table[1].playoff_clinched, false);
});

test('승률이 같으면 승수, 그다음 패수로 가른다', () => {
  // LEAGUE에 이미 한화·롯데가 있어 상위 6팀만 붙인다.
  const table = buildStandings([team(51, 65, 3, '한화'), team(51, 65, 2, '롯데'), ...LEAGUE.slice(0, 6)]);
  const tied = table.filter((t) => ['한화', '롯데'].includes(t.team));
  assert.equal(tied.length, 2);
  assert.equal(Math.abs(tied[0].position - tied[1].position), 1, '동률이어도 순번은 이어진다');
});
