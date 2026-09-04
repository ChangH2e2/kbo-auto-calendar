export async function onRequestGet(context) {
  try {
    const result = await context.env.KBO_DB.prepare(`SELECT id, job_type, started_at, finished_at,
      status, fetched_count, accepted_count, rejected_count, error_summary
      FROM ingestion_runs ORDER BY started_at DESC LIMIT 1`).first();
    return Response.json({ run: result || null }, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=60" }
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "ingestion_status_read_failed", message: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: "수집 상태 조회에 실패했습니다." }, { status: 500 });
  }
}
