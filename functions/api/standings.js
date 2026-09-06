// 순위표와 매직넘버. game_previews가 경기마다 양 팀 순위를 담고 있어 추가 수집이 없다.
const SEASON_GAMES = 144;   // KBO 정규시즌 팀당 경기 수
const PLAYOFF_SPOTS = 5;    // 5위까지 포스트시즌

export function remainingGames(team) {
  return Math.max(0, SEASON_GAMES - (team.w + team.l + team.d));
}

export function winRate(team) {
  const decided = team.w + team.l;
  return decided ? team.w / decided : 0;
}

// 1위와의 게임차. 무승부는 KBO 순위 계산에서 빠지므로 승패만 쓴다.
export function gamesBehind(team, leader) {
  return ((leader.w - team.w) + (team.l - leader.l)) / 2;
}

// 특정 상대를 확실히 제치는 데 필요한 승수. 상대가 남은 경기를 전부 이겨도 앞서려면 몇 승인가.
// 승수 기준 통상 계산이며 무승부·상대전적 타이브레이크는 반영하지 않는다.
export function magicNumber(team, rival) {
  if (!rival) return null;
  return (rival.w + remainingGames(rival)) - team.w + 1;
}

export function buildStandings(rows) {
  const teams = rows
    .map((row) => ({ ...row, remaining: remainingGames(row), win_rate: Number(winRate(row).toFixed(3)) }))
    .sort((a, b) => b.win_rate - a.win_rate || b.w - a.w || a.l - b.l);
  const leader = teams[0];
  const cutoff = teams[PLAYOFF_SPOTS];        // 6위 — 진출 경쟁 상대
  const runnerUp = teams[1];
  return teams.map((team, index) => {
    const position = index + 1;
    const inRace = position <= PLAYOFF_SPOTS;
    const magic = inRace ? magicNumber(team, cutoff) : null;
    const titleMagic = position === 1 ? magicNumber(team, runnerUp) : null;
    return {
      ...team, position,
      games_behind: leader ? Number(gamesBehind(team, leader).toFixed(1)) : 0,
      // 매직넘버가 0 이하면 이미 확정이다.
      playoff_magic: magic === null ? null : Math.max(0, magic),
      title_magic: titleMagic === null ? null : Math.max(0, titleMagic),
      playoff_clinched: magic !== null && magic <= 0
    };
  });
}

export async function onRequestGet(context) {
  try {
    const result = await context.env.KBO_DB.prepare(`SELECT team, standing, checked_at FROM (
        SELECT g.away_team AS team, p.away_standing AS standing, p.checked_at AS checked_at,
               ROW_NUMBER() OVER (PARTITION BY g.away_team ORDER BY p.checked_at DESC) rn
        FROM game_previews p JOIN games g ON g.id = p.game_id WHERE p.away_standing IS NOT NULL
        UNION ALL
        SELECT g.home_team, p.home_standing, p.checked_at,
               ROW_NUMBER() OVER (PARTITION BY g.home_team ORDER BY p.checked_at DESC)
        FROM game_previews p JOIN games g ON g.id = p.game_id WHERE p.home_standing IS NOT NULL
      ) WHERE rn = 1`).all();
    const rows = [];
    let updatedAt = null;
    for (const row of result.results || []) {
      let standing;
      try { standing = JSON.parse(row.standing); } catch { continue; }
      if (!Number.isInteger(standing.w) || !Number.isInteger(standing.l)) continue;
      rows.push({ team: row.team, w: standing.w, l: standing.l, d: Number(standing.d) || 0,
        era: standing.era || null, hra: standing.hra || null });
      if (!updatedAt || row.checked_at > updatedAt) updatedAt = row.checked_at;
    }
    // 열 팀이 다 모이지 않으면 순위를 매길 수 없다. 반쪽 표를 보여주지 않는다.
    if (rows.length < 10) return Response.json({ standings: [], updated_at: updatedAt, partial: true },
      { headers: { "Cache-Control": "public, max-age=300" } });
    return Response.json({ standings: buildStandings(rows), updated_at: updatedAt, partial: false,
      season_games: SEASON_GAMES }, { headers: { "Cache-Control": "public, max-age=600, s-maxage=1800" } });
  } catch (error) {
    console.error("standings_read_failed", String(error));
    return Response.json({ error: "순위 조회에 실패했습니다." }, { status: 500 });
  }
}
