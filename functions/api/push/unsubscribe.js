import { isPushEndpoint } from "./subscribe.js";

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!isPushEndpoint(body && body.endpoint)) return Response.json({ error: "지원하지 않는 구독 주소입니다." }, { status: 400 });
  try {
    await context.env.KBO_DB.batch([
      context.env.KBO_DB.prepare("DELETE FROM push_alerts WHERE endpoint = ?1").bind(body.endpoint),
      context.env.KBO_DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?1").bind(body.endpoint)
    ]);
  } catch (error) {
    console.error("push_unsubscribe_failed", String(error));
    return Response.json({ error: "구독 해지에 실패했습니다." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
