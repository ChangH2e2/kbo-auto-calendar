export async function onRequestGet(context) {
  try {
    // 수집 파이프라인이 둘로 나뉘었다(GitHub Actions의 일정·기록, Cloudflare 크론의 라이브).
    // 전체 최신 한 건만 보면 라이브가 도는 동안 일정 수집이 멈춘 것을 알 수 없다.
    const result = await context.env.KBO_DB.prepare(`SELECT id, job_type, started_at, finished_at,
      status, fetched_count, accepted_count, rejected_count, error_summary FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY job_type ORDER BY started_at DESC) AS rn
        FROM ingestion_runs
      ) WHERE rn = 1 ORDER BY started_at DESC`).all();
    const rows = result.results || [];
    const runs = Object.fromEntries(rows.map((row) => [row.job_type, row]));
    // run은 기존 클라이언트 호환용이다. 새 클라이언트는 runs를 본다.
    return Response.json({ run: rows[0] || null, runs }, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=60" }
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "ingestion_status_read_failed", message: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: "수집 상태 조회에 실패했습니다." }, { status: 500 });
  }
}
