// 팀·날짜·경기 주소를 검색엔진에 알린다. 단일 URL이던 시절에는 색인할 것이 홈 하나뿐이었다.
import { TEAM_FULL_NAME } from "./shell.js";

const SITE = "https://kbo-gameday.pages.dev";
const RECENT_DAYS = 21;
const UPCOMING_DAYS = 14;

function url(path, priority, changefreq) {
  return `<url><loc>${SITE}${path}</loc><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

export async function onRequestGet(context) {
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const from = new Date(Date.now() + 9 * 60 * 60 * 1000 - RECENT_DAYS * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 9 * 60 * 60 * 1000 + UPCOMING_DAYS * 86400000).toISOString().slice(0, 10);
  const entries = [url("/", "1.0", "hourly")];
  for (const team of Object.keys(TEAM_FULL_NAME)) {
    entries.push(url(`/team/${encodeURIComponent(team)}`, "0.9", "daily"));
  }
  try {
    const result = await context.env.KBO_DB.prepare(
      "SELECT id, date FROM games WHERE date BETWEEN ?1 AND ?2 ORDER BY date").bind(from, to).all();
    const dates = new Set();
    for (const game of result.results || []) {
      dates.add(game.date);
      entries.push(url(`/game/${game.id}`, game.date === today ? "0.8" : "0.6", "daily"));
    }
    for (const date of dates) entries.push(url(`/date/${date}`, "0.7", "daily"));
  } catch (error) {
    console.error("sitemap_read_failed", String(error));
  }
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join("")}</urlset>`, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600, s-maxage=21600" }
  });
}
