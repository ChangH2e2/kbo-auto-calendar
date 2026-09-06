import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TEAM_FULL_NAME, shellHtml } from '../functions/shell.js';

// app.js는 모듈이 아니라 parseRoute만 떼어 같은 규칙으로 검증한다.
const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('function parseRoute('), source.indexOf('const route = parseRoute();'));
const TEAMS = ["KIA", "KT", "LG", "NC", "SSG", "두산", "롯데", "삼성", "키움", "한화"];
const parseRoute = new Function('TEAMS', 'location', `${body}; return parseRoute;`)(TEAMS, { pathname: '/' });

test('팀 주소는 아는 구단만 받는다', () => {
  assert.deepEqual(parseRoute('/team/한화'), { view: 'team', team: '한화' });
  assert.deepEqual(parseRoute('/team/' + encodeURIComponent('롯데')), { view: 'team', team: '롯데' });
  assert.deepEqual(parseRoute('/team/삼미'), {});
  assert.deepEqual(parseRoute('/team/'), {});
});

test('경기 주소는 KBO 경기 id 형식만 받는다', () => {
  assert.deepEqual(parseRoute('/game/20260906HHLT0'), { view: 'schedule', gameId: '20260906HHLT0' });
  assert.deepEqual(parseRoute('/game/20260906HHLT0/'), { view: 'schedule', gameId: '20260906HHLT0' });
  assert.deepEqual(parseRoute('/game/nonsense'), {});
  assert.deepEqual(parseRoute('/game/20260906-한화-롯데-noid'), {}, '폴백 id는 주소로 쓰지 않는다');
});

test('날짜 주소는 ISO 형식만 받는다', () => {
  assert.deepEqual(parseRoute('/date/2026-09-06'), { view: 'schedule', date: '2026-09-06' });
  assert.deepEqual(parseRoute('/date/2026-9-6'), {});
  assert.deepEqual(parseRoute('/'), {});
  assert.deepEqual(parseRoute('/team/한화/extra'), {});
});

test('구단 전체 이름이 열 개 다 있다', () => {
  assert.equal(Object.keys(TEAM_FULL_NAME).length, 10);
  for (const team of TEAMS) assert.ok(TEAM_FULL_NAME[team], team);
});

test('셸 메타는 canonical과 og를 같은 주소로 맞춘다', () => {
  const html = shellHtml({ title: '제목', description: '설명', canonical: '/team/%ED%95%9C%ED%99%94' });
  const url = 'https://kbo-gameday.pages.dev/team/%ED%95%9C%ED%99%94';
  assert.ok(html.includes(`<link rel="canonical" href="${url}">`));
  assert.ok(html.includes(`<meta property="og:url" content="${url}">`));
  assert.ok(html.includes('<meta property="og:title" content="제목">'));
});
