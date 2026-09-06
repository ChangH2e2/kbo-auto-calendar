// 크론 트리거만 있는 워커다. 공개 엔드포인트를 열지 않기 위해 fetch 핸들러를 두지 않고
// wrangler.jsonc에서 workers_dev를 끈다. 토큰은 LIVE_REFRESH_TOKEN 시크릿으로 주입한다.
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refresh(env));
  }
};

async function refresh(env) {
  if (!env.LIVE_REFRESH_TOKEN || !env.TARGET_URL) {
    console.error('live_cron_misconfigured');
    return;
  }
  try {
    const response = await fetch(env.TARGET_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.LIVE_REFRESH_TOKEN}` }
    });
    const body = await response.text();
    if (!response.ok) console.error('live_cron_failed', response.status, body.slice(0, 200));
    else console.log('live_cron_ok', body.slice(0, 200));
  } catch (error) {
    // 한 번 실패해도 1분 뒤 다시 시도한다. 재시도 로직을 따로 두지 않는다.
    console.error('live_cron_error', String(error));
  }
}
