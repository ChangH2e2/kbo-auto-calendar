import { renderShell } from "../shell.js";

// 제목에 실제 대진을 넣으려고 D1을 한 번 읽는다. 실패해도 일반 제목으로 셸을 돌려준다.
export async function onRequestGet(context) {
  const gameId = String(context.params.gameId || "");
  if (!/^\d{8}[A-Za-z]{4}\d$/.test(gameId)) return Response.redirect(new URL("/", context.request.url).toString(), 302);
  let game = null;
  try {
    game = await context.env.KBO_DB.prepare(
      "SELECT date, time, away_team, home_team, venue, status FROM games WHERE id = ?1").bind(gameId).first();
  } catch (error) {
    console.error("game_shell_read_failed", String(error));
  }
  if (!game) {
    return renderShell(context, { title: "경기 상세 | KBO GameDay",
      description: "KBO 경기의 선발 매치업, 라인업, 이닝별 득점과 예매 정보를 확인하세요.",
      canonical: `/game/${gameId}` });
  }
  const [, month, day] = game.date.split("-").map(Number);
  const matchup = `${game.away_team} vs ${game.home_team}`;
  const place = game.venue ? ` · ${game.venue}` : "";
  return renderShell(context, {
    title: `${month}월 ${day}일 ${matchup}${place} | KBO GameDay`,
    description: `${month}월 ${day}일 ${game.time} ${matchup} 경기의 선발 매치업과 라인업, 이닝별 득점과 예매 정보를 확인하세요.`,
    canonical: `/game/${gameId}`
  });
}
