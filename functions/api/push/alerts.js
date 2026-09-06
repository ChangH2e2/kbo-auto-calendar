// 서비스 워커가 빈 푸시를 받은 뒤 내용을 가져가는 곳.
// 구독 endpoint를 아는 쪽만 조회할 수 있고, 담긴 내용은 공개 경기 정보다.
import { isPushEndpoint } from "./subscribe.js";

export async function onRequestGet(context) {
  const endpoint = new URL(context.request.url).searchParams.get("endpoint") || "";
  if (!isPushEndpoint(endpoint)) return Response.json({ alerts: [] }, { status: 400 });
  try {
    const result = await context.env.KBO_DB.prepare(`SELECT id, topic, title, body, url FROM push_alerts
      WHERE endpoint = ?1 AND delivered_at IS NULL ORDER BY created_at LIMIT 5`).bind(endpoint).all();
    const alerts = result.results || [];
    if (alerts.length) {
      await context.env.KBO_DB.prepare(
        `UPDATE push_alerts SET delivered_at = ?1 WHERE endpoint = ?2 AND delivered_at IS NULL`)
        .bind(new Date().toISOString(), endpoint).run();
    }
    return Response.json({ alerts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("push_alerts_failed", String(error));
    return Response.json({ alerts: [] }, { status: 500 });
  }
}
