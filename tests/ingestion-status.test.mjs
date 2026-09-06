import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet } from '../functions/api/ingestion-status.js';

// D1 대신 최소 스텁을 쓴다. 여기서 확인하려는 것은 응답 모양이다.
const context = (all) => ({ env: { KBO_DB: { prepare: () => ({ all }) } } });
const rows = (list) => context(async () => ({ results: list }));
const run = (job_type, started_at, extra = {}) => ({ id: `${job_type}-${started_at}`, job_type,
  started_at, finished_at: started_at, status: 'success', fetched_count: 1,
  accepted_count: 1, rejected_count: 0, error_summary: null, ...extra });

test('파이프라인별 최신 실행을 각각 돌려준다', async () => {
  const body = await (await onRequestGet(rows([
    run('live', '2026-09-06T06:31:00Z'),
    run('games', '2026-09-06T05:41:00Z', { status: 'failed' })
  ]))).json();
  assert.equal(body.run.job_type, 'live', 'run은 전체 최신 (기존 클라이언트 호환)');
  assert.deepEqual(Object.keys(body.runs).sort(), ['games', 'live']);
  assert.equal(body.runs.games.status, 'failed', '라이브가 돌아도 일정 수집 실패가 가려지지 않는다');
});

test('실행 기록이 없으면 run은 null이고 runs는 빈 객체다', async () => {
  const body = await (await onRequestGet(rows([]))).json();
  assert.equal(body.run, null);
  assert.deepEqual(body.runs, {});
});

test('D1 조회가 실패하면 500과 안내 문구를 준다', async () => {
  const response = await onRequestGet(context(async () => { throw new Error('boom'); }));
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, '수집 상태 조회에 실패했습니다.');
});
