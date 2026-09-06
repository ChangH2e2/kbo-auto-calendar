import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { isPushEndpoint, normalizeTopics } from '../functions/api/push/subscribe.js';
import { alertFor, matchSubscriptions, alertRows, eventId } from '../functions/api/push/dispatch.js';
// Node 18+ 는 globalThis.crypto와 btoa를 이미 갖고 있다(워커 런타임과 같은 Web Crypto).
import { base64url, audienceOf, vapidClaims, signVapid } from '../functions/api/push/vapid.js';

test('푸시 주소는 실제 푸시 서비스 호스트만 받는다 — 아무 URL이나 받으면 SSRF 통로가 된다', () => {
  assert.ok(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc123'));
  assert.ok(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/xyz'));
  assert.ok(isPushEndpoint('https://web.push.apple.com/QABC'));
  assert.equal(isPushEndpoint('https://evil.example.com/hook'), false);
  assert.equal(isPushEndpoint('http://fcm.googleapis.com/x'), false, 'https만');
  assert.equal(isPushEndpoint('https://fcm.googleapis.com/' + 'a'.repeat(900)), false);
  assert.equal(isPushEndpoint(null), false);
});

test('주제는 아는 것만 남기고, 비면 전체를 켠다', () => {
  assert.equal(normalizeTopics(['lineup']), 'lineup');
  assert.equal(normalizeTopics(['final', 'lineup']), 'final,lineup');
  assert.equal(normalizeTopics(['nonsense']), 'final,lineup');
  assert.equal(normalizeTopics(undefined), 'final,lineup');
  assert.equal(normalizeTopics('lineup,lineup'), 'lineup', '중복 제거');
});

test('알림 문구는 주제에 따라 달라진다', () => {
  assert.deepEqual(alertFor({ topic: 'lineup', away: '한화', home: '롯데' }),
    { title: '라인업 공개', body: '한화 vs 롯데 라인업이 나왔습니다' });
  assert.deepEqual(alertFor({ topic: 'final', away: '한화', home: '롯데', away_score: 11, home_score: 6 }),
    { title: '경기 종료', body: '한화 11 : 6 롯데' });
});

const SUBS = [
  { endpoint: 'https://fcm.googleapis.com/a', team_id: '한화', topics: 'final,lineup' },
  { endpoint: 'https://fcm.googleapis.com/b', team_id: '한화', topics: 'final' },
  { endpoint: 'https://fcm.googleapis.com/c', team_id: '롯데', topics: 'lineup' },
  { endpoint: 'https://fcm.googleapis.com/d', team_id: 'LG', topics: 'final,lineup' }
];

test('경기에 걸린 두 팀 구독자에게만, 켜 둔 주제로만 간다', () => {
  const event = { topic: 'lineup', game_id: '20260906HHLT0', away: '한화', home: '롯데' };
  const matched = matchSubscriptions(event, SUBS).map((s) => s.endpoint);
  assert.deepEqual(matched, ['https://fcm.googleapis.com/a', 'https://fcm.googleapis.com/c']);
  assert.equal(matchSubscriptions({ ...event, topic: 'final', away_score: 1, home_score: 2 }, SUBS).length, 2);
});

test('알림 id는 사건과 구독의 조합이라 재실행해도 중복되지 않는다', () => {
  const event = { topic: 'lineup', game_id: '20260906HHLT0', away: '한화', home: '롯데' };
  assert.equal(eventId(event), '20260906HHLT0-lineup');
  const rows = alertRows(event, SUBS, '2026-09-06T08:00:00Z');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, '20260906HHLT0-lineup-https://fcm.googleapis.com/a');
  assert.equal(rows[0].url, '/game/20260906HHLT0');
  assert.deepEqual(alertRows(event, SUBS, '2026-09-06T08:00:00Z').map((r) => r.id), rows.map((r) => r.id));
});

test('VAPID aud는 푸시 엔드포인트의 오리진이고 exp는 24시간을 넘지 않는다', () => {
  assert.equal(audienceOf('https://fcm.googleapis.com/fcm/send/abc'), 'https://fcm.googleapis.com');
  assert.equal(audienceOf('말이 안 되는 값'), null);
  const now = Date.parse('2026-09-06T08:00:00Z');
  const claims = vapidClaims('https://fcm.googleapis.com/fcm/send/abc', 'mailto:a@b.c', now);
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:a@b.c');
  assert.ok(claims.exp - Math.floor(now / 1000) <= 24 * 3600);
  assert.ok(claims.exp > Math.floor(now / 1000));
});

test('ES256 JWT는 세 조각이고 서명은 r‖s 64바이트다 — DER이면 푸시 서비스가 거절한다', async () => {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
  const claims = vapidClaims('https://fcm.googleapis.com/fcm/send/abc', 'mailto:a@b.c', Date.now());
  const token = await signVapid(claims, { kty: jwk.kty, crv: jwk.crv, d: jwk.d, x: jwk.x, y: jwk.y });
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  const signature = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  assert.equal(signature.length, 64);
  const header = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  assert.deepEqual(header, { typ: 'JWT', alg: 'ES256' });
  // 실제로 검증까지 통과해야 한다.
  const ok = await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey,
    signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  assert.equal(ok, true);
});

test('base64url은 패딩과 +/ 를 남기지 않는다', () => {
  const encoded = base64url(new Uint8Array([251, 255, 190, 0]));
  assert.equal(/[+/=]/.test(encoded), false);
});
