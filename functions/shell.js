// 딥링크 주소(/team/…, /game/…, /date/…)에 각각의 제목과 설명을 붙여 정적 셸을 돌려준다.
// 단일 URL SPA라 "한화 경기 일정" 같은 검색어로 들어올 입구가 하나도 없었다.
export const TEAM_FULL_NAME = {
  KIA: "KIA 타이거즈", KT: "KT 위즈", LG: "LG 트윈스", NC: "NC 다이노스", SSG: "SSG 랜더스",
  두산: "두산 베어스", 롯데: "롯데 자이언츠", 삼성: "삼성 라이온즈", 키움: "키움 히어로즈", 한화: "한화 이글스"
};

const SITE = "https://kbo-gameday.pages.dev";

class Meta {
  constructor(name, value) { this.name = name; this.value = value; }
  element(element) { element.setAttribute("content", this.value); }
}
class Title {
  constructor(value) { this.value = value; }
  element(element) { element.setInnerContent(this.value); }
}
class Head {
  constructor(html) { this.html = html; }
  element(element) { element.append(this.html, { html: true }); }
}

export function shellHtml({ title, description, canonical }) {
  const url = `${SITE}${canonical}`;
  return `<link rel="canonical" href="${url}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${url}">
<meta property="og:type" content="website">`;
}

export async function renderShell(context, meta) {
  const asset = await context.env.ASSETS.fetch(new URL("/index.html", context.request.url));
  if (!asset.ok) return asset;
  return new HTMLRewriter()
    .on("title", new Title(meta.title))
    .on('meta[name="description"]', new Meta("description", meta.description))
    .on("head", new Head(shellHtml(meta)))
    .transform(new Response(asset.body, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=300" }
    }));
}
