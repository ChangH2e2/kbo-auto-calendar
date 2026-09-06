import { PREVIEW_COLUMNS, PREVIEW_JSON_FIELDS } from './preview-ingest.js';
const ALLOWED_STATUSES = new Set(["scheduled", "ticket_soon", "ticket_open", "live", "final", "cancelled", "postponed"]);

export function latestGameDataTimestamp(games = []) {
  const timestamps = games
    .map((game) => game.source_updated_at || game.ingested_at)
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value));
  return timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
}

export function inferLiveStatus(game, now = Date.now()) {
  if (!game || game.status !== "scheduled") return game?.status || null;
  const startsAt = new Date(game.starts_at).getTime();
  if (!Number.isFinite(startsAt)) return game.status;
  return startsAt <= now && now <= startsAt + 5 * 60 * 60 * 1000 ? "live" : game.status;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? url.searchParams.get("from") : "0000-01-01";
  const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") || "") ? url.searchParams.get("to") : "9999-12-31";
  const status = url.searchParams.get("status");
  const includePreview = url.searchParams.get('include') === 'preview';
  const previewSelect = includePreview ? PREVIEW_COLUMNS.map(key => `preview.${key} AS preview_${key}`).join(',') : '';
  const params = [from, to];
  let where = "date BETWEEN ?1 AND ?2";
  if (status && ALLOWED_STATUSES.has(status)) { params.push(status); where += " AND status = ?3"; }
  const query = `SELECT id AS game_id, starts_at, date, time, away_team AS away, home_team AS home,
    venue AS stadium, status, away_score, home_score, status_note, away_line, home_line,
    away_rheb, home_rheb, hitter_details, pitcher_details, holiday_name, source_updated_at, ingested_at,
    ticket.state AS ticket_state, ticket.opens_at AS ticket_opens_at,
    ticket.source_url AS ticket_source_url, ticket.checked_at AS ticket_checked_at
    ${includePreview ? ',' + previewSelect : ''}
    FROM games LEFT JOIN game_ticket_info AS ticket ON ticket.game_id = games.id
    ${includePreview ? 'LEFT JOIN game_previews AS preview ON preview.game_id = games.id' : ''}
    WHERE ${where} ORDER BY starts_at ASC`;
  try {
    const result = await context.env.KBO_DB.prepare(query).bind(...params).all();
    const games = result.results || [];
    const responseGames = games.map((game) => {
      const result = { ...game, status: inferLiveStatus(game) };
      if (includePreview) {
        const preview = {};
        for (const key of PREVIEW_COLUMNS) {
          const value = result[`preview_${key}`];
          preview[key] = PREVIEW_JSON_FIELDS.includes(key) && value != null ? JSON.parse(value) : value ?? null;
          delete result[`preview_${key}`];
        }
        result.preview = preview.game_id ? preview : null;
      }
      return result;
    });
    return Response.json({ games: responseGames, data_updated_at: latestGameDataTimestamp(games) }, {
      headers: { "Cache-Control": "public, max-age=30, s-maxage=60" }
    });
  } catch (error) {
    return Response.json({ error: "KBO 데이터 조회에 실패했습니다." }, { status: 500 });
  }
}
