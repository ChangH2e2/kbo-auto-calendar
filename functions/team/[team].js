import { TEAM_FULL_NAME, renderShell } from "../shell.js";

export async function onRequestGet(context) {
  const team = decodeURIComponent(context.params.team || "");
  const fullName = TEAM_FULL_NAME[team];
  if (!fullName) return Response.redirect(new URL("/", context.request.url).toString(), 302);
  return renderShell(context, {
    title: `${fullName} 경기 일정 · 1군 등록 현황 | KBO GameDay`,
    description: `${fullName}의 다음 경기와 선발 매치업, 예매 시점, 1군 등록·말소 변동을 한 화면에서 확인하세요.`,
    canonical: `/team/${encodeURIComponent(team)}`
  });
}
