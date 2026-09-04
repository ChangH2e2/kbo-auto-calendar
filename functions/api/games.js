const ALLOWED_STATUSES = new Set(["scheduled", "ticket_soon", "ticket_open", "live", "final", "cancelled", "postponed"]);

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : "0000-01-01";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") || "") ? url.searchParams.get("to") : "9999-12-31";
  const status = url.searchParams.get("status");
  const params = [from, to];
  let where = "date BETWEEN ?1 AND ?2";
  if (status && ALLOWED_STATUSES.has(status)) { params.push(status); where += " AND status = ?3"; }
  const query = `SELECT id AS game_id, starts_at, date, time, away_team AS away, home_team AS home,
    venue AS stadium, status, away_score, home_score, status_note, away_line, home_line,
    away_rheb, home_rheb, hitter_details, pitcher_details, holiday_name, source_updated_at, ingested_at,
    ticket.state AS ticket_state, ticket.opens_at AS ticket_opens_at,
    ticket.source_url AS ticket_source_url, ticket.checked_at AS ticket_checked_at
    FROM games LEFT JOIN game_ticket_info AS ticket ON ticket.game_id = games.id
    WHERE ${where} ORDER BY starts_at ASC`;
  try {
    const result = await context.env.KBO_DB.prepare(query).bind(...params).all();
    return Response.json({ games: result.results || [], data_updated_at: new Date().toISOString() }, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=60" }
    });
  } catch (error) {
    return Response.json({ error: "KBO 데이터 조회에 실패했습니다." }, { status: 500 });
  }
}
