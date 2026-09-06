// 네이버 record 응답의 박스스코어를 기존 hitter_details/pitcher_details 모양으로 옮긴다.
// 이 모양은 crawling.py가 KBO 박스스코어에서 만들던 것과 같아야 한다 — 화면이 그대로 쓴다.

const number = (value) => (value === null || value === undefined || value === "" ? "-" : String(value));

// 대타·대주자는 같은 타순으로 여러 줄이 온다. 화면이 순서로 구분하므로 순서를 지킨다.
export function normalizeBatters(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => row && row.name).map((row) => {
    const order = Number.isInteger(row.batOrder) && row.batOrder >= 1 ? `[${row.batOrder}번]` : "[대타]";
    // 이닝별 결과(inn1..inn25)는 네이버가 비워 보내는 경우가 많다. 있으면 살린다.
    const innings = [];
    for (let inning = 1; inning <= 25; inning += 1) {
      const value = row[`inn${inning}`];
      if (value) innings.push(`${inning}회:${value}`);
    }
    return { order, pos: row.pos || "", name: row.name,
      ab: number(row.ab), hit: number(row.hit), rbi: number(row.rbi), avg: number(row.hra),
      records: innings.length ? innings.join(" | ") : "-" };
  });
}

export function normalizePitchers(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((row) => row && row.name).map((row) => ({
    name: row.name,
    // wls는 경기가 끝나야 채워진다. 진행 중에는 빈 값이 정상이다.
    result: row.wls || "-",
    ip: number(row.inn),
    np: number(row.bf),   // bf가 투구수다(5.2이닝 102구로 확인)
    so: number(row.kk),
    er: number(row.er)
  }));
}

export function normalizeBoxscore(recordData) {
  if (!recordData || typeof recordData !== "object") return null;
  const batters = recordData.battersBoxscore;
  const pitchers = recordData.pitchersBoxscore;
  const hitter = { away: normalizeBatters(batters && batters.away), home: normalizeBatters(batters && batters.home) };
  const pitcher = { away: normalizePitchers(pitchers && pitchers.away), home: normalizePitchers(pitchers && pitchers.home) };
  // 양쪽 다 비면 저장할 것이 없다. 기존 기록을 빈 값으로 덮지 않는다.
  if (!hitter.away.length && !hitter.home.length && !pitcher.away.length && !pitcher.home.length) return null;
  return { hitter_details: hitter, pitcher_details: pitcher };
}
