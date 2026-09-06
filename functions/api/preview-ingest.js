export const PREVIEW_JSON_FIELDS = ['away_starter', 'home_starter', 'away_lineup', 'home_lineup',
  'away_bullpen', 'home_bullpen', 'away_bench', 'home_bench', 'away_standing', 'home_standing', 'season_vs'];
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value?.[key] ?? null]));

function starter(raw) {
  const data = object(raw);
  if (!data.playerInfo?.name) return null;
  return { ...pick(data.playerInfo, ['name', 'backnum', 'hitType']),
    ...pick(data.currentSeasonStats, ['era', 'w', 'l']),
    vsOpponent: pick(data.currentSeasonStatsOnOpponents, ['era', 'inn', 'kk', 'bb']),
    pitches: list(data.currentPitKindStats).map(p => ({ type: p.type, speed: p.speed, rate: p.pit_rt })) };
}

export function normalizePreview(input) {
  if (!input || typeof input.game_id !== 'string' || !/^\d{8}[A-Za-z]{4}\d$/.test(input.game_id)
      || typeof input.source_game_id !== 'string' || !/^\d{8}[A-Za-z]{4}\d\d{4}$/.test(input.source_game_id)
      || input.source_game_id !== input.game_id + input.game_id.slice(0, 4)
      || !Number.isFinite(Date.parse(input.checked_at)) || !input.previewData
      || typeof input.previewData !== 'object' || Array.isArray(input.previewData)) return null;
  const data = input.previewData;
  const row = { game_id: input.game_id, source: 'naver', source_game_id: input.source_game_id,
    checked_at: new Date(input.checked_at).toISOString() };
  const states = [];
  for (const side of ['away', 'home']) {
    const lineup = object(data[`${side}TeamLineUp`]);
    row[`${side}_starter`] = starter(data[`${side}Starter`]);
    row[`${side}_lineup`] = list(lineup.fullLineUp).map(p => ({
      ...pick(p, ['batorder', 'position', 'positionName', 'backnum', 'batsThrows']), name: p.playerName ?? null
    }));
    // Bench/bullpen have no backnum in the source. Never invent one.
    for (const [target, source] of [['bullpen', 'pitcherBullpen'], ['bench', 'batterCandidate']]) {
      row[`${side}_${target}`] = list(lineup[source]).map(p => ({
        name: p.playerName ?? null, hitType: p.hitType ?? null, position: p.position ?? null
      }));
    }
    row[`${side}_standing`] = data[`${side}Standings`]
      ? pick(data[`${side}Standings`], ['rank', 'w', 'l', 'd', 'wra', 'era', 'hra']) : null;
    const orders = row[`${side}_lineup`].map(p => Number(p.batorder)).filter(n => Number.isInteger(n) && n >= 1 && n <= 9);
    states.push(new Set(orders).size === 9 ? 'announced' : row[`${side}_starter`] || row[`${side}_lineup`].length ? 'starter_only' : 'none');
  }
  row.lineup_state = states.every(s => s === 'announced') ? 'announced' : states.some(s => s !== 'none') ? 'starter_only' : 'none';
  row.season_vs = data.seasonVsResult ? { awayWin: data.seasonVsResult.aw ?? null,
    awayLoss: data.seasonVsResult.al ?? null, draw: data.seasonVsResult.ad ?? null } : null;
  return row;
}

export const PREVIEW_COLUMNS = ['game_id', 'source', 'source_game_id', 'lineup_state', ...PREVIEW_JSON_FIELDS, 'checked_at'];
// Atomic protection also covers concurrent requests and stale retries.
export const PREVIEW_UPSERT = `INSERT INTO game_previews (${PREVIEW_COLUMNS.join(',')})
  VALUES (${PREVIEW_COLUMNS.map(() => '?').join(',')})
  ON CONFLICT(game_id) DO UPDATE SET ${PREVIEW_COLUMNS.slice(1).map(key => `${key}=excluded.${key}`).join(',')}
  WHERE excluded.checked_at >= game_previews.checked_at
    AND NOT (game_previews.lineup_state='announced' AND excluded.lineup_state!='announced')
    AND NOT (game_previews.lineup_state='starter_only' AND excluded.lineup_state='none')`;
export const previewValues = row => PREVIEW_COLUMNS.map(key => PREVIEW_JSON_FIELDS.includes(key)
  ? row[key] == null ? null : JSON.stringify(row[key]) : row[key]);

export async function onRequestPost(context) {
  const expected = context.env.INGEST_TOKEN;
  const actual = (context.request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || actual !== expected) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body;
  try {
    const text = await context.request.text();
    if (text.length > 1000000) return Response.json({ error: 'Payload too large' }, { status: 413 });
    body = JSON.parse(text);
  } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  if (!Array.isArray(body.previews) || body.previews.length > 20) return Response.json({ error: 'Invalid previews' }, { status: 400 });
  const rows = body.previews.map(normalizePreview).filter(Boolean);
  const db = context.env.KBO_DB;
  const id = crypto.randomUUID(), started = new Date().toISOString();
  const log = (status, accepted, error = null) => db.prepare(`INSERT INTO ingestion_runs
    (id,job_type,started_at,finished_at,status,fetched_count,accepted_count,rejected_count,error_summary)
    VALUES (?,'preview',?,?,?,?,?,?,?)`).bind(id, started, new Date().toISOString(), status,
      body.previews.length, accepted, body.previews.length - rows.length, error);
  try {
    const results = rows.length ? await db.batch(rows.map(row => db.prepare(PREVIEW_UPSERT).bind(...previewValues(row)))) : [];
    const accepted = results.reduce((sum, result) => sum + (result.meta?.changes || 0), 0);
    await log('success', accepted).run();
    return Response.json({ accepted, preserved: rows.length - accepted, rejected: body.previews.length - rows.length });
  } catch (error) {
    console.error('preview_ingest_failed', String(error));
    try { await log('failed', 0, 'Preview storage failed').run(); } catch (logError) { console.error('preview_log_failed', String(logError)); }
    return Response.json({ error: 'Preview storage failed' }, { status: 500 });
  }
}
