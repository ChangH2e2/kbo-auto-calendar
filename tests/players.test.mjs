import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlayer, indexPlayers } from '../functions/api/players.js';

const raw = (extra = {}) => ({ i: '53006', n: '문현빈', t: '한화', p: '외야수', g: '외야수',
  b: '2004-04-20', y: 2004, no: 51, h: 174, s: '북일고', r: 1, ...extra });

test('알 수 없는 구단이나 이름 없는 행은 버린다', () => {
  assert.ok(normalizePlayer(raw()));
  assert.equal(normalizePlayer(raw({ t: '삼미' })), null);
  assert.equal(normalizePlayer(raw({ n: 42 })), null);
  assert.equal(normalizePlayer(null), null);
});

test('등번호 없는 선수도 남긴다 — 소스에 null이 실제로 온다', () => {
  const player = normalizePlayer(raw({ no: null }));
  assert.equal(player.back_number, null);
  assert.equal(player.name, '문현빈');
});

test('등번호는 문자열로 맞춘다 — 라인업 쪽이 문자열이라 숫자면 매칭이 깨진다', () => {
  assert.equal(normalizePlayer(raw()).back_number, '51');
  assert.strictEqual(typeof normalizePlayer(raw()).back_number, 'string');
});

test('키가 0이거나 없으면 지어내지 않는다', () => {
  assert.equal(normalizePlayer(raw({ h: 0 })).height, null);
  assert.equal(normalizePlayer(raw({ h: undefined })).height, null);
});

test('동명이인은 같은 키에 함께 담아 등번호로 가른다', () => {
  const index = indexPlayers([raw(), raw({ no: 7, p: '내야수' }), raw({ n: '노시환', no: 8 })]);
  assert.equal(index['한화|문현빈'].length, 2);
  assert.equal(index['한화|노시환'].length, 1);
  assert.deepEqual(index['한화|문현빈'].map((p) => p.back_number), ['51', '7']);
});

test('1군 등록 여부는 1과 true만 참으로 본다', () => {
  assert.equal(normalizePlayer(raw({ r: 1 })).registered, true);
  assert.equal(normalizePlayer(raw({ r: 0 })).registered, false);
  assert.equal(normalizePlayer(raw({ r: undefined })).registered, false);
});
