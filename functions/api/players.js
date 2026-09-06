// 야구 Who Are Ya의 공개 선수 마스터를 중계한다.
// 네이버 프리뷰에는 라인업 등번호밖에 없고 불펜·대기 타자에는 그마저 없다.
// 년생·키·세부 포지션·출신교는 저쪽이 매주 수집해 두므로 다시 모으지 않는다.
const SOURCE_URL = "https://games.salarycrew.com/kbo/players.json";
const TEAMS = new Set(["KIA", "KT", "LG", "NC", "SSG", "두산", "롯데", "삼성", "키움", "한화"]);

export function normalizePlayer(raw) {
  if (!raw || typeof raw.n !== "string" || !TEAMS.has(raw.t)) return null;
  const backNumber = raw.no === null || raw.no === undefined ? null : String(raw.no);
  return {
    name: raw.n, team: raw.t, back_number: backNumber,
    position: typeof raw.p === "string" ? raw.p : null,
    position_group: typeof raw.g === "string" ? raw.g : null,
    birth_year: Number.isInteger(raw.y) ? raw.y : null,
    height: Number.isFinite(Number(raw.h)) && Number(raw.h) > 0 ? Number(raw.h) : null,
    school: typeof raw.s === "string" && raw.s ? raw.s : null,
    registered: raw.r === 1 || raw.r === true
  };
}

export function indexPlayers(rows) {
  const index = {};
  for (const row of rows) {
    const player = normalizePlayer(row);
    if (!player) continue;
    const key = `${player.team}|${player.name}`;
    (index[key] = index[key] || []).push(player);
  }
  return index;
}

export async function onRequestGet(context) {
  try {
    // 서버에서 부르므로 CORS와 무관하다. 브라우저에 다른 오리진을 노출하지 않는다.
    const response = await fetch(SOURCE_URL, { headers: { Accept: "application/json" },
      cf: { cacheTtl: 3600, cacheEverything: true } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload && payload.players) ? payload.players : [];
    if (!rows.length) throw new Error("empty");
    return Response.json({ as_of: payload.asOf || null, players: indexPlayers(rows) }, {
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=21600" }
    });
  } catch (error) {
    console.error("players_proxy_failed", String(error));
    // 프로필이 없어도 라인업은 이름만으로 완성된 정보다. 조용히 빈 응답을 준다.
    return Response.json({ as_of: null, players: {} }, {
      headers: { "Cache-Control": "public, max-age=60" }, status: 200
    });
  }
}
