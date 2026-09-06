// 오늘의 1군 등록 명단을 공개 JSON으로 내보낸다.
// 야구 Who Are Ya가 이걸 읽어 정답 풀 신선도를 주 1회에서 매일로 올린다.
// 두 시스템을 결합하지 않고 파일 하나로 느슨하게 잇는다.
export async function onRequestGet(context) {
  try {
    const [entryResult, checkResult] = await Promise.all([
      context.env.KBO_DB.prepare(`SELECT team_id, player_name, back_number, position, birth, as_of
        FROM roster_entries ORDER BY team_id, position, player_name`).all(),
      context.env.KBO_DB.prepare("SELECT MAX(checked_on) AS checked_on FROM roster_checks").first()
    ]);
    const rows = entryResult.results || [];
    const teams = {};
    for (const row of rows) {
      (teams[row.team_id] = teams[row.team_id] || []).push({
        name: row.player_name, no: row.back_number || null, position: row.position, birth: row.birth || null
      });
    }
    return Response.json({
      as_of: rows.length ? rows[0].as_of : null,
      checked_on: checkResult ? checkResult.checked_on : null,
      total: rows.length, teams
    }, { headers: { "Cache-Control": "public, max-age=1800, s-maxage=3600",
      "Access-Control-Allow-Origin": "*" } });
  } catch (error) {
    console.error("registered_read_failed", String(error));
    return Response.json({ error: "등록 명단 조회에 실패했습니다." }, { status: 500 });
  }
}
