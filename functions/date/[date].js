import { renderShell } from "../shell.js";

export async function onRequestGet(context) {
  const date = String(context.params.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.redirect(new URL("/", context.request.url).toString(), 302);
  const [year, month, day] = date.split("-").map(Number);
  return renderShell(context, {
    title: `${year}년 ${month}월 ${day}일 KBO 경기 일정 | KBO GameDay`,
    description: `${month}월 ${day}일 KBO 리그 경기 일정과 결과, 선발 투수와 예매 정보를 확인하세요.`,
    canonical: `/date/${date}`
  });
}
