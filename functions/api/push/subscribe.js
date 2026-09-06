import { TEAMS } from "../roster-ingest.js";

export const TOPICS = new Set(["lineup", "final"]);

// 우리가 POST를 보내는 주소라 아무 URL이나 받으면 SSRF 통로가 된다.
// 실제 푸시 서비스 호스트만 허용한다.
const PUSH_HOSTS = [
  /\.googleapis\.com$/, /\.mozilla\.com$/, /\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/, /\.windows\.com$/, /\.push\.apple\.com$/
];

export function isPushEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length > 800) return false;
  let url;
  try { url = new URL(endpoint); } catch { return false; }
  if (url.protocol !== "https:") return false;
  return PUSH_HOSTS.some((pattern) => pattern.test(url.hostname));
}

export function normalizeTopics(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || "").split(",");
  const chosen = list.map((topic) => String(topic).trim()).filter((topic) => TOPICS.has(topic));
  return (chosen.length ? [...new Set(chosen)] : [...TOPICS]).sort().join(",");
}

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!isPushEndpoint(body && body.endpoint)) return Response.json({ error: "지원하지 않는 구독 주소입니다." }, { status: 400 });
  if (!TEAMS.has(body.team)) return Response.json({ error: "알 수 없는 구단입니다." }, { status: 400 });
  try {
    await context.env.KBO_DB.prepare(`INSERT INTO push_subscriptions (endpoint, team_id, topics, created_at)
      VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(endpoint) DO UPDATE SET team_id=excluded.team_id, topics=excluded.topics, failures=0`)
      .bind(body.endpoint, body.team, normalizeTopics(body.topics), new Date().toISOString()).run();
  } catch (error) {
    console.error("push_subscribe_failed", String(error));
    return Response.json({ error: "구독 저장에 실패했습니다." }, { status: 500 });
  }
  return Response.json({ ok: true, team: body.team, topics: normalizeTopics(body.topics) });
}
