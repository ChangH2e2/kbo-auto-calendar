const VALID_TEAMS = new Set(["KIA", "KT", "LG", "NC", "SSG", "두산", "롯데", "삼성", "키움", "한화"]);
const VALID_STATES = new Set(["scheduled", "open", "closed", "sold_out"]);
const MAX_TICKETS = 300;

function isIsoTimestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

export function normalizeTicketInfo(ticket) {
  if (!ticket || !/^\d{4}-\d{2}-\d{2}$/.test(ticket.date || "")) return null;
  if (!VALID_TEAMS.has(ticket.away) || !VALID_TEAMS.has(ticket.home) || !VALID_STATES.has(ticket.state)) return null;
  let sourceUrl;
  try { sourceUrl = new URL(ticket.sourceUrl); } catch { return null; }
  if (sourceUrl.protocol !== "https:" || !["ticketlink.co.kr", "www.ticketlink.co.kr"].includes(sourceUrl.hostname)) return null;
  const opensAt = ticket.opensAt == null ? null : ticket.opensAt;
  if (opensAt !== null && !isIsoTimestamp(opensAt)) return null;
  if (!isIsoTimestamp(ticket.checkedAt)) return null;
  return {
    date: ticket.date,
    away: ticket.away,
    home: ticket.home,
    state: ticket.state,
    opensAt,
    sourceUrl: sourceUrl.toString(),
    checkedAt: ticket.checkedAt
  };
}

export async function onRequestPost(context) {
  const expected = context.env.INGEST_TOKEN;
  const actual = (context.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || actual !== expected) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try { body = await context.request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  const incoming = Array.isArray(body?.tickets) ? body.tickets : [];
  if (incoming.length > MAX_TICKETS) return Response.json({ error: "Too many tickets" }, { status: 413 });
  const tickets = incoming.map(normalizeTicketInfo).filter(Boolean);
  if (!tickets.length) return Response.json({ accepted: 0, rejected: incoming.length, unmatched: 0 });

  const lookups = await context.env.KBO_DB.batch(tickets.map((ticket) => context.env.KBO_DB
    .prepare("SELECT id FROM games WHERE date = ?1 AND away_team = ?2 AND home_team = ?3 LIMIT 1")
    .bind(ticket.date, ticket.away, ticket.home)));
  const matched = tickets.flatMap((ticket, index) => {
    const gameId = lookups[index]?.results?.[0]?.id;
    return gameId ? [{ ...ticket, gameId }] : [];
  });

  if (matched.length) {
    await context.env.KBO_DB.batch(matched.map((ticket) => context.env.KBO_DB.prepare(`INSERT INTO game_ticket_info
      (game_id,state,opens_at,source_url,checked_at) VALUES (?1,?2,?3,?4,?5)
      ON CONFLICT(game_id) DO UPDATE SET state=excluded.state,opens_at=COALESCE(excluded.opens_at,game_ticket_info.opens_at),source_url=excluded.source_url,checked_at=excluded.checked_at`)
      .bind(ticket.gameId, ticket.state, ticket.opensAt, ticket.sourceUrl, ticket.checkedAt)));
  }

  return Response.json({ accepted: matched.length, rejected: incoming.length - tickets.length, unmatched: tickets.length - matched.length });
}
