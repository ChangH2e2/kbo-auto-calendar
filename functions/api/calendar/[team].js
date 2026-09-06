// 구단별 경기 일정을 iCal로 내보낸다. 캘린더 앱에서 구독하면 일정이 알아서 따라온다.
// 푸시 알림보다 훨씬 싸고 유지비가 거의 없다.
import { TEAMS } from "../roster-ingest.js";
import { TEAM_FULL_NAME } from "../../shell.js";

const PAST_DAYS = 30;
const FUTURE_DAYS = 180;
const GAME_MINUTES = 210; // 경기 평균 3시간 30분

// RFC 5545: TEXT 값에서 역슬래시·세미콜론·쉼표·줄바꿈은 이스케이프한다.
export function escapeText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// 한 줄은 75옥텟 이하여야 한다. 한글은 글자당 3바이트라 글자 수로 자르면 규격을 넘는다.
// UTF-8 시퀀스 중간에서 자르면 깨지므로 바이트를 세되 문자 경계를 지킨다.
export function foldLine(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = character;
      bytes = size;
      limit = 74; // 이어지는 줄은 앞에 공백 한 칸이 붙는다
    } else {
      current += character;
      bytes += size;
    }
  }
  if (current) parts.push(current);
  return parts.join("\r\n ");
}

export function icalDate(value) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function gameSummary(game, team) {
  const opponent = game.home_team === team ? game.away_team : game.home_team;
  const place = game.home_team === team ? "홈" : "원정";
  const scored = game.away_score !== null && game.home_score !== null;
  const score = scored ? ` ${game.away_score}:${game.home_score}` : "";
  const state = game.status === "cancelled" ? " (취소)" : game.status === "postponed" ? " (연기)" : "";
  return `${team} vs ${opponent} (${place})${score}${state}`;
}

export function buildCalendar(team, games, now) {
  const stamp = icalDate(now);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//KBO GameDay//KR", "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH", `X-WR-CALNAME:${escapeText(`${TEAM_FULL_NAME[team] || team} 경기 일정`)}`,
    "X-WR-TIMEZONE:Asia/Seoul", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"];
  for (const game of games) {
    const start = icalDate(game.starts_at);
    if (!start) continue;
    const end = icalDate(new Date(Date.parse(game.starts_at) + GAME_MINUTES * 60000).toISOString());
    lines.push("BEGIN:VEVENT", `UID:${game.id}@kbo-gameday`, `DTSTAMP:${stamp}`,
      `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${escapeText(gameSummary(game, team))}`,
      `LOCATION:${escapeText(game.venue || "구장 미정")}`,
      `URL:https://kbo-gameday.pages.dev/game/${game.id}`,
      `STATUS:${game.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export async function onRequestGet(context) {
  const team = decodeURIComponent(String(context.params.team || "")).replace(/\.ics$/i, "");
  if (!TEAMS.has(team)) return new Response("알 수 없는 구단입니다.", { status: 404 });
  const kstNow = Date.now() + 9 * 60 * 60 * 1000;
  const from = new Date(kstNow - PAST_DAYS * 86400000).toISOString().slice(0, 10);
  const to = new Date(kstNow + FUTURE_DAYS * 86400000).toISOString().slice(0, 10);
  try {
    const result = await context.env.KBO_DB.prepare(`SELECT id, starts_at, away_team, home_team, venue,
      status, away_score, home_score FROM games
      WHERE date BETWEEN ?1 AND ?2 AND (home_team = ?3 OR away_team = ?3) ORDER BY starts_at`)
      .bind(from, to, team).all();
    return new Response(buildCalendar(team, result.results || [], new Date().toISOString()), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `inline; filename="kbo-${encodeURIComponent(team)}.ics"`,
        "Cache-Control": "public, max-age=1800, s-maxage=3600",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (error) {
    console.error("calendar_read_failed", String(error));
    return new Response("일정을 불러오지 못했습니다.", { status: 500 });
  }
}

// 일부 캘린더 클라이언트는 구독 전에 HEAD로 확인한다. Pages는 HEAD를 GET으로 넘겨주지 않는다.
export const onRequestHead = onRequestGet;
