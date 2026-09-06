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

/* ── 이닝별 타석 결과 ────────────────────────────────────────────────────
   네이버 박스스코어의 inn1..inn25는 경기가 끝나야 채워진다. 경기 중에는 문자중계에서 뽑는다.
   중계 한 덩어리가 타석 하나이고, 결과 줄은 "이름 : 결과" 형식이다. */

// "좌익수 플라이 아웃 (파울)" → "좌익수 플라이". 괄호 설명과 끝의 '아웃'을 떼어 짧게 만든다.
export function shortenResult(text) {
  return String(text || "").split(" (")[0].replace(/\s*아웃$/, "").trim();
}

export function parseRelayResults(relayData) {
  const plays = relayData && Array.isArray(relayData.textRelays) ? relayData.textRelays : [];
  const results = [];
  for (const play of plays) {
    const inning = Number(play && play.inn);
    if (!Number.isInteger(inning) || inning < 1) continue;
    // title은 "3번타자 오스틴" 또는 "대타 김성윤".
    const batter = String(play.title || "").replace(/^\d+번타자\s*/, "").replace(/^대타\s*/, "").replace(/^대주자\s*/, "").trim();
    if (!batter) continue;
    const options = Array.isArray(play.textOptions) ? play.textOptions : [];
    // 그 타자의 결과 줄만 고른다. 주자 진루("1루주자 … : 홈인")는 이름이 달라 걸리지 않는다.
    const line = options.map((option) => String(option && option.text || ""))
      .find((text) => text.startsWith(`${batter} : `));
    if (!line) continue;
    const result = shortenResult(line.slice(batter.length + 3));
    if (result) results.push({ inning, batter, result });
  }
  return results;
}

// "1회:안타 | 3회:삼진" ↔ { 1: "안타", 3: "삼진" }
export function parseRecords(text) {
  const map = {};
  if (!text || text === "-") return map;
  for (const part of String(text).split("|")) {
    const match = part.trim().match(/^(\d+)회:(.+)$/);
    if (match) map[Number(match[1])] = match[2].trim();
  }
  return map;
}

export function formatRecords(map) {
  const innings = Object.keys(map).map(Number).filter((n) => Number.isInteger(n)).sort((a, b) => a - b);
  return innings.length ? innings.map((inning) => `${inning}회:${map[inning]}`).join(" | ") : "-";
}

// 이번에 받은 중계 결과를 기존 기록 위에 얹는다. 지난 이닝 결과를 잃지 않기 위해서다.
export function mergeInningResults(details, previous, relayResults) {
  if (!details) return details;
  const bySide = { away: new Map(), home: new Map() };
  for (const side of ["away", "home"]) {
    for (const row of (previous && previous[side]) || []) bySide[side].set(row.name, parseRecords(row.records));
  }
  const byName = new Map();
  for (const result of relayResults) {
    if (!byName.has(result.batter)) byName.set(result.batter, {});
    byName.get(result.batter)[result.inning] = result.result;
  }
  for (const side of ["away", "home"]) {
    for (const row of details[side] || []) {
      const merged = { ...(bySide[side].get(row.name) || {}), ...parseRecords(row.records), ...(byName.get(row.name) || {}) };
      row.records = formatRecords(merged);
    }
  }
  return details;
}
