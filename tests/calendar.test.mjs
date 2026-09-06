import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeText, foldLine, icalDate, gameSummary, buildCalendar } from '../functions/api/calendar/[team].js';

test('RFC 5545 TEXT 이스케이프 — 세미콜론이 빠지면 파서가 값을 잘라 먹는다', () => {
  assert.equal(escapeText('a;b'), 'a\\;b');
  assert.equal(escapeText('a,b'), 'a\\,b');
  assert.equal(escapeText('a\\b'), 'a\\\\b');
  assert.equal(escapeText('a\nb'), 'a\\nb');
  assert.equal(escapeText(null), '');
});

test('줄 접기는 글자 수가 아니라 UTF-8 바이트로 센다', () => {
  const encoder = new TextEncoder();
  const long = 'SUMMARY:' + '한'.repeat(60);   // 한글 한 글자 3바이트
  const folded = foldLine(long);
  assert.ok(folded.includes('\r\n '), '길면 접혀야 한다');
  for (const line of folded.split('\r\n')) {
    assert.ok(encoder.encode(line).length <= 75, `75옥텟 초과: ${encoder.encode(line).length}`);
  }
  assert.equal(folded.split('\r\n ').join(''), long, '되붙이면 원문과 같아야 한다');
});

test('짧은 줄은 건드리지 않는다', () => {
  assert.equal(foldLine('VERSION:2.0'), 'VERSION:2.0');
});

test('KST 시각을 UTC로 바꾼다', () => {
  assert.equal(icalDate('2026-09-06T17:00:00+09:00'), '20260906T080000Z');
  assert.equal(icalDate('말이 안 되는 값'), null);
});

test('요약은 상대팀과 홈/원정을 담고, 끝난 경기는 점수까지 담는다', () => {
  const base = { home_team: '롯데', away_team: '한화', away_score: null, home_score: null, status: 'scheduled' };
  assert.equal(gameSummary(base, '한화'), '한화 vs 롯데 (원정)');
  assert.equal(gameSummary(base, '롯데'), '롯데 vs 한화 (홈)');
  assert.equal(gameSummary({ ...base, away_score: 11, home_score: 6, status: 'final' }, '한화'), '한화 vs 롯데 (원정) 11:6');
  assert.equal(gameSummary({ ...base, status: 'cancelled' }, '한화'), '한화 vs 롯데 (원정) (취소)');
});

test('캘린더는 CRLF로 끝나고 이벤트가 짝을 이룬다', () => {
  const games = [{ id: '20260906HHLT0', starts_at: '2026-09-06T17:00:00+09:00', away_team: '한화',
    home_team: '롯데', venue: '사직', status: 'scheduled', away_score: null, home_score: null }];
  const ics = buildCalendar('한화', games, '2026-09-06T07:00:00Z');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
  assert.equal((ics.match(/END:VEVENT/g) || []).length, 1);
  assert.ok(ics.includes('DTSTART:20260906T080000Z'));
  assert.ok(ics.includes('DTEND:20260906T113000Z'), '3시간 30분 뒤');
  assert.ok(ics.includes('UID:20260906HHLT0@kbo-gameday'));
  assert.ok(ics.includes('URL:https://kbo-gameday.pages.dev/game/20260906HHLT0'));
});

test('시작 시각이 깨진 경기는 건너뛰고 나머지는 살린다', () => {
  const ics = buildCalendar('한화', [
    { id: 'bad', starts_at: '???', away_team: '한화', home_team: '롯데', status: 'scheduled', away_score: null, home_score: null },
    { id: '20260906HHLT0', starts_at: '2026-09-06T17:00:00+09:00', away_team: '한화', home_team: '롯데', venue: '사직', status: 'scheduled', away_score: null, home_score: null }
  ], '2026-09-06T07:00:00Z');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});
