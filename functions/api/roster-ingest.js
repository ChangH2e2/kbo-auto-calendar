// 1군 등록 명단과 등록/말소 이력을 저장한다. roster.py가 호출한다.
export const TEAMS = new Set(["KIA", "KT", "LG", "NC", "SSG", "두산", "롯데", "삼성", "키움", "한화"]);
export const POSITIONS = new Set(["투수", "포수", "내야수", "외야수"]);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BATCH_SIZE = 50;
// 한 팀 명단이 이보다 적으면 응답이 깨진 것으로 보고 그 팀 명단은 반영하지 않는다.
const MIN_ROSTER = 20;

const text = (value, max) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed.slice(0, max) : null;
};

export function normalizeEntry(raw) {
  if (!raw || !TEAMS.has(raw.team) || !POSITIONS.has(raw.position)) return null;
  const name = text(raw.name, 40);
  if (!name) return null;
  return { team_id: raw.team, player_name: name, back_number: text(raw.back_number, 5) || "",
    position: raw.position, bats_throws: text(raw.bats_throws, 20), birth: text(raw.birth, 10),
    physique: text(raw.physique, 30) };
}

export function normalizeTransaction(raw) {
  if (!raw || !TEAMS.has(raw.team) || !DATE.test(raw.date || "")) return null;
  if (raw.kind !== "register" && raw.kind !== "remove") return null;
  const name = text(raw.name, 40);
  if (!name) return null;
  const backNumber = text(raw.back_number, 5) || "";
  return { id: `${raw.date}-${raw.team}-${raw.kind}-${name}-${backNumber}`, occurred_on: raw.date,
    team_id: raw.team, player_name: name, back_number: backNumber || null, kind: raw.kind,
    position: POSITIONS.has(raw.position) ? raw.position : text(raw.position, 10) };
}

export function normalizeCheck(raw) {
  if (!raw || !TEAMS.has(raw.team) || !DATE.test(raw.date || "")) return null;
  return { team_id: raw.team, checked_on: raw.date };
}

// 명단이 부족하게 온 팀은 통째로 뺀다. 일부만 지워 명단이 반쪽이 되는 것을 막는다.
export function teamsWithFullRoster(entries) {
  const counts = new Map();
  for (const entry of entries) counts.set(entry.team_id, (counts.get(entry.team_id) || 0) + 1);
  return new Set([...counts].filter(([, count]) => count >= MIN_ROSTER).map(([team]) => team));
}

export async function onRequestPost(context) {
  const expected = context.env.INGEST_TOKEN;
  const actual = (context.request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!expected || actual !== expected) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body;
  try {
    const raw = await context.request.text();
    if (raw.length > 2000000) return Response.json({ error: "Payload too large" }, { status: 413 });
    body = JSON.parse(raw);
  } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }

  const asOf = DATE.test(body && body.as_of) ? body.as_of : null;
  if (!asOf) return Response.json({ error: "as_of is required" }, { status: 400 });
  const entries = (Array.isArray(body.entries) ? body.entries : []).map(normalizeEntry).filter(Boolean);
  const transactions = (Array.isArray(body.transactions) ? body.transactions : []).map(normalizeTransaction).filter(Boolean);
  const checks = (Array.isArray(body.checks) ? body.checks : []).map(normalizeCheck).filter(Boolean);
  if (!checks.length) return Response.json({ error: "No usable rows" }, { status: 400 });

  const db = context.env.KBO_DB;
  const now = new Date().toISOString();
  const runId = crypto.randomUUID();
  const startedAt = now;
  const complete = teamsWithFullRoster(entries);
  const usableEntries = entries.filter((entry) => complete.has(entry.team_id));

  const statements = [];
  for (const entry of usableEntries) {
    statements.push(db.prepare(`INSERT INTO roster_entries
      (team_id,player_name,back_number,position,bats_throws,birth,physique,as_of)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
      ON CONFLICT(team_id,player_name,back_number) DO UPDATE SET position=excluded.position,
        bats_throws=excluded.bats_throws,birth=excluded.birth,physique=excluded.physique,as_of=excluded.as_of`)
      .bind(entry.team_id, entry.player_name, entry.back_number, entry.position,
        entry.bats_throws, entry.birth, entry.physique, asOf));
  }
  // 이번 스냅샷에 없는 선수는 말소된 것이다. 전체 삭제 후 삽입 대신 오래된 행만 지운다.
  for (const team of complete) {
    statements.push(db.prepare("DELETE FROM roster_entries WHERE team_id = ?1 AND as_of < ?2").bind(team, asOf));
  }
  for (const transaction of transactions) {
    statements.push(db.prepare(`INSERT INTO roster_transactions
      (id,occurred_on,team_id,player_name,back_number,position,kind,detected_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(id) DO NOTHING`)
      .bind(transaction.id, transaction.occurred_on, transaction.team_id, transaction.player_name,
        transaction.back_number, transaction.position, transaction.kind, now));
  }
  for (const check of checks) {
    statements.push(db.prepare(`INSERT INTO roster_checks (team_id,checked_on,checked_at)
      VALUES (?1,?2,?3) ON CONFLICT(team_id,checked_on) DO UPDATE SET checked_at=excluded.checked_at`)
      .bind(check.team_id, check.checked_on, now));
  }

  const log = (status, accepted, error = null) => db.prepare(`INSERT INTO ingestion_runs
    (id,job_type,started_at,finished_at,status,fetched_count,accepted_count,rejected_count,error_summary)
    VALUES (?1,'roster',?2,?3,?4,?5,?6,?7,?8)`)
    .bind(runId, startedAt, new Date().toISOString(), status,
      entries.length + transactions.length, accepted, entries.length - usableEntries.length, error);

  try {
    for (let index = 0; index < statements.length; index += BATCH_SIZE) {
      await db.batch(statements.slice(index, index + BATCH_SIZE));
    }
    await log("success", usableEntries.length + transactions.length).run();
  } catch (error) {
    console.error("roster_ingest_failed", String(error));
    await log("failed", 0, "Roster storage failed").run().catch(() => {});
    return Response.json({ error: "로스터 저장에 실패했습니다." }, { status: 500 });
  }
  return Response.json({ entries: usableEntries.length, transactions: transactions.length,
    checks: checks.length, skipped_teams: [...new Set(entries.map((e) => e.team_id))].filter((t) => !complete.has(t)) });
}
