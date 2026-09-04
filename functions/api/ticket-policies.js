const VALID_TEAMS = new Set(["KIA", "KT", "LG", "NC", "SSG", "두산", "롯데", "삼성", "키움", "한화"]);

export function normalizeTicketPolicy(row) {
  if (!row || !VALID_TEAMS.has(row.team_id)) return null;
  let url;
  try { url = new URL(row.official_url); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const daysBefore = Number(row.general_days_before);
  const openTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(row.general_open_time || "") ? row.general_open_time : null;
  const requiresLogin = Number(row.requires_login ?? 0);
  if (!Number.isInteger(daysBefore) || daysBefore < 0 || daysBefore > 30 || !openTime || ![0, 1].includes(requiresLogin)) return null;
  return {
    team: row.team_id,
    vendor: row.vendor_name,
    url: url.toString(),
    daysBefore,
    openTime,
    requiresLogin: requiresLogin === 1,
    description: row.presale_description || null,
    verifiedAt: row.verified_at
  };
}

export async function onRequestGet(context) {
  try {
    const result = await context.env.KBO_DB.prepare(`SELECT team_id, vendor_name, official_url,
      general_days_before, general_open_time, requires_login, presale_description, verified_at
      FROM ticket_policies ORDER BY team_id`).all();
    const policies = (result.results || []).map(normalizeTicketPolicy).filter(Boolean);
    return Response.json({ policies }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=300" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "ticket_policies_read_failed", message: error instanceof Error ? error.message : String(error) }));
    return Response.json({ error: "예매 정책 조회에 실패했습니다." }, { status: 500 });
  }
}
