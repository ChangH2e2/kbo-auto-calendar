// 특정 구단의 1군 등록 현황과 최근 등록/말소를 읽는다.
import { TEAMS } from "./roster-ingest.js";

const DEFAULT_DAYS = 30;
const MAX_DAYS = 120;

export function positionCounts(entries) {
  const counts = { 투수: 0, 포수: 0, 내야수: 0, 외야수: 0 };
  for (const entry of entries) {
    if (counts[entry.position] !== undefined) counts[entry.position] += 1;
  }
  return { ...counts, total: entries.length };
}

// 조회한 날인데 변동이 0건인 것과 아예 수집하지 않은 날은 다르다.
export function summarizeChanges(transactions, checks, today) {
  const checkedToday = checks.some((check) => check.checked_on === today);
  const todays = transactions.filter((transaction) => transaction.occurred_on === today);
  const previous = transactions.find((transaction) => transaction.occurred_on !== today);
  return { checked_today: checkedToday, today: todays,
    last_change_on: previous ? previous.occurred_on : null,
    last_change_count: previous ? transactions.filter((t) => t.occurred_on === previous.occurred_on).length : 0 };
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const team = url.searchParams.get("team") || "";
  if (!TEAMS.has(team)) return Response.json({ error: "알 수 없는 구단입니다." }, { status: 400 });
  const requestedDays = Number(url.searchParams.get("days"));
  const days = Number.isFinite(requestedDays) ? Math.min(Math.max(requestedDays, 1), MAX_DAYS) : DEFAULT_DAYS;
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const since = new Date(Date.now() + 9 * 60 * 60 * 1000 - days * 86400000).toISOString().slice(0, 10);

  try {
    const [entryResult, transactionResult, checkResult] = await Promise.all([
      context.env.KBO_DB.prepare(`SELECT player_name, back_number, position, bats_throws, birth, physique, as_of
        FROM roster_entries WHERE team_id = ?1
        ORDER BY CASE position WHEN '투수' THEN 1 WHEN '포수' THEN 2 WHEN '내야수' THEN 3 ELSE 4 END,
          CAST(back_number AS INTEGER), player_name`).bind(team).all(),
      context.env.KBO_DB.prepare(`SELECT occurred_on, player_name, back_number, position, kind
        FROM roster_transactions WHERE team_id = ?1 AND occurred_on >= ?2
        ORDER BY occurred_on DESC, kind ASC, player_name ASC`).bind(team, since).all(),
      context.env.KBO_DB.prepare(`SELECT checked_on, checked_at FROM roster_checks
        WHERE team_id = ?1 ORDER BY checked_on DESC LIMIT 40`).bind(team).all()
    ]);
    const entries = entryResult.results || [];
    const transactions = transactionResult.results || [];
    const checks = checkResult.results || [];
    return Response.json({
      team, as_of: entries.length ? entries[0].as_of : null,
      counts: positionCounts(entries), entries, transactions,
      changes: summarizeChanges(transactions, checks, today),
      last_checked_on: checks.length ? checks[0].checked_on : null
    }, { headers: { "Cache-Control": "public, max-age=300, s-maxage=600" } });
  } catch (error) {
    console.error("roster_read_failed", String(error));
    return Response.json({ error: "등록 현황 조회에 실패했습니다." }, { status: 500 });
  }
}
