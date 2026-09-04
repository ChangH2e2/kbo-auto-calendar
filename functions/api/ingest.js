const VALID_STATUSES = new Set(["scheduled", "ticket_soon", "ticket_open", "live", "final", "cancelled", "postponed"]);

function json(value) {
  return value == null || typeof value === "string" ? value : JSON.stringify(value);
}

function toRow(game) {
  const date = String(game.date || "");
  const time = String(game.time || "18:30").slice(0, 5);
  const status = game.is_cancel ? "cancelled" : (game.status || (game.home_score != null && game.away_score != null ? "final" : "scheduled"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !game.game_id || !game.home || !game.away || !VALID_STATUSES.has(status)) return null;
  return {
    id: String(game.game_id), season: Number(date.slice(0, 4)), starts_at: `${date}T${time}:00+09:00`, date, time,
    away_team: String(game.away), home_team: String(game.home), venue: game.stadium || null, status,
    away_score: game.away_score == null ? null : Number(game.away_score), home_score: game.home_score == null ? null : Number(game.home_score),
    status_note: game.status_note || null, away_line: game.away_line || null, home_line: game.home_line || null,
    away_rheb: game.away_rheb || null, home_rheb: game.home_rheb || null, hitter_details: json(game.hitter_details),
    pitcher_details: json(game.pitcher_details), holiday_name: game.holiday_name || null, source_updated_at: new Date().toISOString()
  };
}

export async function onRequestPost(context) {
  const expected = context.env.INGEST_TOKEN;
  const actual = (context.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || actual !== expected) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body;
  try { body = await context.request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const incoming = Array.isArray(body?.games) ? body.games : [];
  if (incoming.length > 2000) return Response.json({ error: "Too many games" }, { status: 413 });
  const rows = incoming.map(toRow).filter(Boolean);
  if (!rows.length) return Response.json({ accepted: 0, rejected: incoming.length });
  const statements = rows.map((row) => context.env.KBO_DB.prepare(`INSERT INTO games
    (id,season,starts_at,date,time,away_team,home_team,venue,status,away_score,home_score,status_note,away_line,home_line,away_rheb,home_rheb,hitter_details,pitcher_details,holiday_name,source_updated_at)
    VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)
    ON CONFLICT(id) DO UPDATE SET season=excluded.season,starts_at=excluded.starts_at,date=excluded.date,time=excluded.time,away_team=excluded.away_team,home_team=excluded.home_team,venue=excluded.venue,status=excluded.status,away_score=excluded.away_score,home_score=excluded.home_score,status_note=excluded.status_note,away_line=COALESCE(excluded.away_line,games.away_line),home_line=COALESCE(excluded.home_line,games.home_line),away_rheb=COALESCE(excluded.away_rheb,games.away_rheb),home_rheb=COALESCE(excluded.home_rheb,games.home_rheb),hitter_details=COALESCE(excluded.hitter_details,games.hitter_details),pitcher_details=COALESCE(excluded.pitcher_details,games.pitcher_details),holiday_name=COALESCE(excluded.holiday_name,games.holiday_name),source_updated_at=excluded.source_updated_at`).bind(row.id,row.season,row.starts_at,row.date,row.time,row.away_team,row.home_team,row.venue,row.status,row.away_score,row.home_score,row.status_note,row.away_line,row.home_line,row.away_rheb,row.home_rheb,row.hitter_details,row.pitcher_details,row.holiday_name,row.source_updated_at));
  await context.env.KBO_DB.batch(statements);
  return Response.json({ accepted: rows.length, rejected: incoming.length - rows.length });
}
