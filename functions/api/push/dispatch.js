// 라이브 갱신에서 감지한 사건을 구독자별 알림으로 바꾸고 빈 푸시를 보낸다.
import { sendPush } from "./vapid.js";

const MAX_PUSHES = 200;

export function eventId(event) {
  return `${event.game_id}-${event.topic}`;
}

export function alertFor(event) {
  if (event.topic === "lineup") {
    return { title: "라인업 공개", body: `${event.away} vs ${event.home} 라인업이 나왔습니다` };
  }
  const score = `${event.away} ${event.away_score} : ${event.home_score} ${event.home}`;
  return { title: "경기 종료", body: score };
}

// 사건이 걸린 두 팀을 구독한 사람에게만, 그 주제를 켜 둔 경우에만 보낸다.
export function matchSubscriptions(event, subscriptions) {
  return subscriptions.filter((subscription) =>
    (subscription.team_id === event.away || subscription.team_id === event.home)
    && String(subscription.topics || "").split(",").includes(event.topic));
}

export function alertRows(event, subscriptions, now) {
  const { title, body } = alertFor(event);
  return matchSubscriptions(event, subscriptions).map((subscription) => ({
    id: `${eventId(event)}-${subscription.endpoint}`.slice(0, 400),
    endpoint: subscription.endpoint, topic: event.topic, title, body,
    url: `/game/${event.game_id}`, created_at: now
  }));
}

export async function dispatchEvents(db, env, events, now) {
  if (!events.length) return { sent: 0, removed: 0 };
  // 같은 사건으로 두 번 알리지 않는다. 먼저 표식을 남기고, 새로 남은 것만 보낸다.
  const fresh = [];
  for (const event of events) {
    const id = eventId(event);
    const result = await db.prepare("INSERT INTO push_events (id, created_at) VALUES (?1, ?2) ON CONFLICT(id) DO NOTHING")
      .bind(id, now).run();
    if (result.meta && result.meta.changes) fresh.push(event);
  }
  if (!fresh.length) return { sent: 0, removed: 0 };

  const teams = [...new Set(fresh.flatMap((event) => [event.away, event.home]))];
  const placeholders = teams.map((_, index) => `?${index + 1}`).join(",");
  const subscriptionResult = await db.prepare(
    `SELECT endpoint, team_id, topics FROM push_subscriptions WHERE team_id IN (${placeholders}) AND failures < 5`)
    .bind(...teams).all();
  const subscriptions = subscriptionResult.results || [];
  if (!subscriptions.length) return { sent: 0, removed: 0 };

  const rows = fresh.flatMap((event) => alertRows(event, subscriptions, now)).slice(0, MAX_PUSHES);
  if (!rows.length) return { sent: 0, removed: 0 };
  await db.batch(rows.map((row) => db.prepare(
    `INSERT INTO push_alerts (id, endpoint, topic, title, body, url, created_at)
     VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO NOTHING`)
    .bind(row.id, row.endpoint, row.topic, row.title, row.body, row.url, row.created_at)));

  let sent = 0;
  const gone = [];
  for (const endpoint of [...new Set(rows.map((row) => row.endpoint))]) {
    try {
      const result = await sendPush(endpoint, env, Date.parse(now) || Date.now());
      if (result.ok) sent += 1;
      else if (result.gone) gone.push(endpoint);
    } catch (error) {
      console.error("push_send_failed", String(error));
    }
  }
  if (gone.length) {
    await db.batch(gone.map((endpoint) =>
      db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?1").bind(endpoint)));
  }
  return { sent, removed: gone.length };
}
