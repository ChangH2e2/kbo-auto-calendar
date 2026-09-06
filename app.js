const API_URL = "/api/games";
const TICKET_POLICY_API_URL = "/api/ticket-policies";
const DATA_STALE_AFTER_MS = 8 * 60 * 60 * 1000;
const LIVE_FRESH_AFTER_MS = 5 * 60 * 1000;
// GitHub Actions의 schedule은 실제로 2시간대에 한 번 온다. 30분 임계는 상시 경고가 된다.
const SCHEDULE_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

const TEAMS = ["KIA", "KT", "LG", "NC", "SSG", "두산", "롯데", "삼성", "키움", "한화"];
const TEAM_COLORS = {
  KIA: "#e4002b", KT: "#34383c", LG: "#c9153e", NC: "#315991", SSG: "#ce0e2d",
  두산: "#16133b", 롯데: "#0b2f58", 삼성: "#0b5cab", 키움: "#760019", 한화: "#f36f21"
};
const STADIUMS = {
  KIA: "광주-KIA 챔피언스 필드", KT: "수원KT위즈파크", LG: "잠실야구장", NC: "창원NC파크", SSG: "인천SSG랜더스필드",
  두산: "잠실야구장", 롯데: "사직야구장", 삼성: "대구삼성라이온즈파크", 키움: "고척스카이돔", 한화: "대전한화생명볼파크"
};
const DEFAULT_TICKET_RULES = {
  LG: { vendor: "티켓링크", url: "https://ticketlink.co.kr/", daysBefore: 7, openTime: "11:00" },
  두산: { vendor: "NOL 인터파크", url: "https://nol.yanolja.com/ticket/genre/sports/bears", daysBefore: 7, openTime: "11:00" },
  키움: { vendor: "NOL 인터파크", url: "https://nol.yanolja.com/ticket/genre/sports/heroes", daysBefore: 7, openTime: "14:00" },
  KT: { vendor: "티켓링크", url: "https://m.ticketlink.co.kr/sports/137/62", daysBefore: 7, openTime: "14:00" },
  KIA: { vendor: "티켓링크", url: "https://m.ticketlink.co.kr/sports/137/58", daysBefore: 7, openTime: "11:00" },
  삼성: { vendor: "티켓링크", url: "https://m.ticketlink.co.kr/sports/137/57", daysBefore: 7, openTime: "11:00" },
  한화: { vendor: "티켓링크", url: "https://m.ticketlink.co.kr/sports/137/63", daysBefore: 7, openTime: "11:00" },
  NC: { vendor: "NC 다이노스", url: "https://ticket.ncdinos.com/", daysBefore: 7, openTime: "11:00", requiresLogin: true },
  롯데: { vendor: "롯데 자이언츠", url: "https://ticket.giantsclub.com/", daysBefore: 14, openTime: "14:00", requiresLogin: true },
  SSG: { vendor: "SSG.COM", url: "https://ticket.ssg.com/ticket", daysBefore: 7, openTime: "11:00" }
};

// 주소로 화면을 연다. 단일 URL이면 "한화 경기 일정" 같은 검색어로 들어올 입구가 없다.
function parseRoute(pathname) {
  const path = decodeURIComponent(pathname || location.pathname);
  const team = path.match(/^\/team\/([^/]+)\/?$/);
  if (team && TEAMS.includes(team[1])) return { view: "team", team: team[1] };
  const game = path.match(/^\/game\/(\d{8}[A-Za-z]{4}\d)\/?$/);
  if (game) return { view: "schedule", gameId: game[1] };
  const date = path.match(/^\/date\/(\d{4}-\d{2}-\d{2})\/?$/);
  if (date) return { view: "schedule", date: date[1] };
  return {};
}

const route = parseRoute();
const demoMode = new URLSearchParams(location.search).get("demo") === "1";
const initialView = new URLSearchParams(location.search).get("view");
const today = startOfDay(new Date());
const storedFavoriteTeam = localStorage.getItem("kbo-favorite-team");
const state = {
  games: [],
  favoriteTeam: storedFavoriteTeam || null,
  hasStoredTeam: Boolean(storedFavoriteTeam),
  activeView: route.view || (["today", "schedule", "team", "settings"].includes(initialView) ? initialView : (window.innerWidth >= 960 ? "schedule" : "today")),
  cursorDate: route.date ? new Date(`${route.date}T00:00:00`) : new Date(today),
  selectedDate: route.date || toISODate(today),
  selectedGameId: null,
  // 주소로 들어온 경기는 데이터가 도착한 뒤에 연다.
  pendingGameId: route.gameId || null,
  // /team/{팀}은 응원팀이 아니어도 그 팀을 보여준다.
  viewTeam: route.team || storedFavoriteTeam || null,
  teamScope: window.innerWidth >= 960 || !storedFavoriteTeam ? "all" : "favorite",
  venue: "all",
  loadedAt: null,
  dataTimestamp: null,
  sourceState: demoMode ? "sample" : "loading",
  ingestionStatus: null,
  ingestionRuns: {},
  roster: null,
  players: null,
  playersState: "idle",
  rosterState: "idle",
  ticketRules: { ...DEFAULT_TICKET_RULES },
  detailTab: "score",
  detailLineupTeam: null
};

let countdownTimer = null;
let liveRefreshTimer = null;
let liveRefreshInFlight = false;
let deferredInstallPrompt = null;

const dom = {
  notice: document.getElementById("dataNotice"),
  nextGame: document.getElementById("nextGameMount"),
  team: document.getElementById("teamMount"),
  playerDialog: document.getElementById("playerDialog"),
  playerSheet: document.getElementById("playerSheetBody"),
  todayGames: document.getElementById("todayGamesMount"),
  todayDate: document.getElementById("todayDateLabel"),
  todayFreshness: document.getElementById("todayFreshness"),
  scheduleTitle: document.getElementById("scheduleTitle"),
  month: document.getElementById("monthCalendar"),
  week: document.getElementById("weekSchedule"),
  dayPanel: document.getElementById("selectedDayPanel"),
  scheduleFreshness: document.getElementById("scheduleFreshness"),
  settingsFreshness: document.getElementById("settingsFreshness"),
  ingestionStatus: document.getElementById("ingestionStatus"),
  teamPicker: document.getElementById("teamPicker"),
  firstVisitNotice: document.getElementById("firstVisitNotice"),
  dialog: document.getElementById("gameDialog"),
  dialogBody: document.getElementById("dialogBody"),
  refreshNow: document.getElementById("refreshNow"),
  refreshStatus: document.getElementById("refreshStatus"),
  connectionStatus: document.getElementById("connectionStatus"),
  installApp: document.getElementById("installApp")
};

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseGameDate(game) {
  const [year, month, day] = String(game.date).split("-").map(Number);
  const [hour = 0, minute = 0] = String(game.time || "00:00").split(":").map(Number);
  return new Date(year, month - 1, day, hour, minute);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function teamStyle(team) {
  return `--team-color:${TEAM_COLORS[team] || "#697386"}`;
}

function formatKoreanDate(date, options = {}) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: options.month || "long",
    day: "numeric",
    weekday: options.weekday || "short",
    ...options
  }).format(date);
}

function normalizeGame(game, index) {
  const parseJson = (value) => {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return value; }
  };
  return {
    ...game,
    game_id: game.game_id || `${game.date}-${game.away}-${game.home}-${index}`,
    away: game.away || game.away_team,
    home: game.home || game.home_team,
    stadium: game.stadium || game.venue || "구장 미정",
    hitter_details: parseJson(game.hitter_details),
    pitcher_details: parseJson(game.pitcher_details),
    time: game.time || "시간 미정",
    home_score: game.home_score === "" ? null : game.home_score,
    away_score: game.away_score === "" ? null : game.away_score
  };
}

function getGameState(game) {
  if (game.status === "postponed") return "postponed";
  if (game.status === "cancelled" || game.is_cancel === true) return "cancelled";
  if (game.status === "live") return "live";
  if (game.status === "final") return "final";
  const hasScore = game.home_score !== null && game.home_score !== undefined && game.away_score !== null && game.away_score !== undefined;
  const startedAt = parseGameDate(game);
  const elapsed = Date.now() - startedAt.getTime();
  if (toISODate(startedAt) === toISODate(today) && elapsed >= 0 && elapsed < 5 * 60 * 60 * 1000) return "live";
  if (!hasScore) return "scheduled";
  return "final";
}

function shouldShowTicket(game, status = getGameState(game)) {
  if (status !== "scheduled" || parseGameDate(game).getTime() <= Date.now()) return false;
  const ticket = getTicket(game);
  // 추정 오픈 시각이 지난 뒤에는 낡은 예매 안내를 반복하지 않는다.
  // 공식 예매처가 확인한 상태가 있을 때만 안내를 유지한다.
  return ticket.isOfficial || Date.now() < ticket.openAt.getTime();
}

function getStatusText(game) {
  const status = getGameState(game);
  if (status === "cancelled") return game.status_note || "취소";
  if (status === "postponed") return game.status_note || "연기";
  if (status === "live") return `LIVE ${game.inning || game.status_note || "진행 중"}`;
  if (status === "final") return "종료";
  return game.time;
}

function scoreText(game) {
  if (game.away_score === null || game.away_score === undefined) return "";
  return `${game.away_score}:${game.home_score}`;
}

function getTicket(game) {
  const rule = state.ticketRules[game.home] || DEFAULT_TICKET_RULES.LG;
  const gameDate = parseGameDate(game);
  const estimatedOpenAt = addDays(startOfDay(gameDate), -rule.daysBefore);
  const [openHour = 11, openMinute = 0] = String(rule.openTime || `${rule.hour || 11}:00`).split(":").map(Number);
  estimatedOpenAt.setHours(openHour, openMinute, 0, 0);
  const checkedAt = game.ticket_checked_at ? new Date(game.ticket_checked_at) : null;
  const hasFreshOfficialState = ["scheduled", "open", "closed", "sold_out"].includes(game.ticket_state)
    && checkedAt && !Number.isNaN(checkedAt.getTime()) && Date.now() - checkedAt.getTime() <= 12 * 60 * 60 * 1000;
  const officialOpenAt = game.ticket_opens_at ? new Date(game.ticket_opens_at) : null;
  const openAt = hasFreshOfficialState && officialOpenAt && !Number.isNaN(officialOpenAt.getTime()) ? officialOpenAt : estimatedOpenAt;
  const isOpen = hasFreshOfficialState ? game.ticket_state === "open" : Date.now() >= openAt.getTime() && Date.now() < gameDate.getTime();
  return {
    ...rule, openAt, gameDate, isOpen,
    isOfficial: Boolean(hasFreshOfficialState),
    officialState: hasFreshOfficialState ? game.ticket_state : null,
    officialSourceUrl: hasFreshOfficialState ? game.ticket_source_url : null,
    checkedAt: hasFreshOfficialState ? checkedAt : null
  };
}

function ticketSourceText(ticket) {
  try { return `${ticket.vendor} · ${new URL(ticket.officialSourceUrl || ticket.url).hostname.replace(/^www\./, "")}`; }
  catch { return ticket.vendor || "공식 예매처"; }
}

function getTicketState(ticket) {
  if (ticket.isOfficial) return ticket.officialState;
  if (ticket.isOpen) return "open";
  const hoursUntilOpen = (ticket.openAt.getTime() - Date.now()) / 3600000;
  return hoursUntilOpen > 0 && hoursUntilOpen <= 24 ? "soon" : "upcoming";
}

function ticketHeading(ticket, ticketState) {
  if (ticket.isOfficial) {
    if (ticketState === "open") return "예매 중";
    if (ticketState === "sold_out") return "매진 확인";
    if (ticketState === "closed") return "예매 종료";
    return "예매 오픈까지";
  }
  return ticketState === "open" ? "예매 가능 예상" : ticketState === "soon" ? "예매 오픈 임박" : "예매 오픈 예상까지";
}

function ticketTimeText(ticket, openText) {
  if (ticket.isOfficial && ticket.officialState === "open") return "공식 예매처에서 현재 판매 상태 확인됨";
  if (ticket.isOfficial && ["closed", "sold_out"].includes(ticket.officialState)) return "공식 예매처에서 현재 상태 확인됨";
  return `${ticket.isOfficial ? "" : "일반 기준 "}${openText} 오픈 ${ticket.isOfficial ? "예정" : "예상"}`;
}

function ticketSourceDetail(ticket) {
  const checked = ticket.checkedAt ? ` · ${formatKoreanDate(ticket.checkedAt, { month: "numeric", weekday: undefined })} ${formatTime(ticket.checkedAt)} 확인` : "";
  return `${ticketSourceText(ticket)}${checked}`;
}

function ticketDisclaimer(ticket) {
  if (ticket.isOfficial) return "공식 예매처 공개 경기 목록에서 확인한 정보입니다. 판매 상태는 예매처에서 최종 확인해 주세요.";
  return ticket.description || "일반 일정 참고값이며 경기별 구단·예매처 공지를 우선합니다.";
}

function ticketStatusNote(ticket) {
  if (ticket.isOfficial && ticket.officialState !== "scheduled") return "공식 상태 확인됨";
  if (ticket.requiresLogin) return "로그인 후 상태 확인";
  return ticket.isOpen ? "예매처 상태 확인 필요" : "계산 중";
}

function ticketActionText(ticket) {
  return ticket.requiresLogin ? "로그인 후 예매하러 가기" : "예매하러 가기";
}

function ticketPanelHtml(game, ticket, { compact = false } = {}) {
  const ticketState = getTicketState(ticket);
  const shouldCountdown = !ticket.isOpen && (!ticket.isOfficial || ticket.officialState === "scheduled");
  const openText = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(ticket.openAt);
  const isHomeFavorite = game.home === state.favoriteTeam;
  const context = isHomeFavorite ? "홈 경기 예매" : `원정 경기 · 홈팀 ${game.home} 예매처`;
  return `
    <div class="ticket-panel ticket-${ticketState}${compact ? " ticket-panel-compact" : ""}" aria-label="예매 안내">
      <div class="ticket-context">${escapeHtml(context)}</div>
      <div class="ticket-head"><strong>${escapeHtml(ticketHeading(ticket, ticketState))}</strong><span class="countdown"${shouldCountdown ? ` data-countdown="${ticket.openAt.toISOString()}"${ticket.requiresLogin ? ' data-countdown-login="true"' : ""}` : ""}>${escapeHtml(ticketStatusNote(ticket))}</span></div>
      <p class="ticket-absolute">${escapeHtml(ticketTimeText(ticket, openText))}</p>
      <p class="ticket-source">${escapeHtml(ticketSourceDetail(ticket))}</p>
      <p class="ticket-disclaimer">${escapeHtml(ticketDisclaimer(ticket))}</p>
      <a class="${ticket.isOpen ? "primary-button" : "secondary-button"}" href="${escapeHtml(ticket.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ticketActionText(ticket))}</a>
    </div>`;
}

function getFilteredGames() {
  return state.games.filter((game) => {
    if (state.teamScope === "favorite" && game.home !== state.favoriteTeam && game.away !== state.favoriteTeam) return false;
    if (state.venue === "home" && game.home !== state.favoriteTeam) return false;
    if (state.venue === "away" && game.away !== state.favoriteTeam) return false;
    return true;
  });
}

function gamesForDate(dateString, filtered = true) {
  const source = filtered ? getFilteredGames() : state.games;
  return source.filter((game) => game.date === dateString).sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

function makeDemoMatches() {
  const pairings = [
    [["삼성", "키움"], ["KIA", "NC"], ["한화", "롯데"], ["KT", "SSG"], ["두산", "LG"]],
    [["LG", "삼성"], ["키움", "두산"], ["NC", "KIA"], ["롯데", "한화"], ["SSG", "KT"]],
    [["NC", "LG"], ["두산", "삼성"], ["KIA", "키움"], ["KT", "롯데"], ["한화", "SSG"]]
  ];
  const times = ["14:00", "18:30", "18:30", "18:30", "18:30"];
  const games = [];
  for (let offset = -40; offset <= 70; offset += 1) {
    const date = addDays(today, offset);
    if (date.getDay() === 1) continue;
    const set = pairings[Math.abs(offset) % pairings.length];
    set.forEach(([away, home], index) => {
      const isPast = offset < 0;
      const game = {
        game_id: `demo-${toISODate(date)}-${index}`,
        date: toISODate(date), time: date.getDay() === 0 || date.getDay() === 6 ? "14:00" : times[index],
        away, home, stadium: STADIUMS[home], is_cancel: false,
        away_score: isPast ? (Math.abs(offset + index * 2) % 7) + 1 : null,
        home_score: isPast ? (Math.abs(offset * 2 + index) % 8) + 1 : null,
        status: isPast ? "final" : "scheduled",
        source_updated_at: new Date().toISOString()
      };
      games.push(game);
    });
  }

  const todayGames = games.filter((game) => game.date === toISODate(today));
  if (todayGames.length === 5) {
    Object.assign(todayGames[0], { status: "final", away_score: 5, home_score: 2, time: "14:00" });
    Object.assign(todayGames[1], { status: "live", away_score: 3, home_score: 1, inning: "6회초", time: "18:30" });
    Object.assign(todayGames[2], { status: "live", away_score: 4, home_score: 4, inning: "7회말", time: "18:30" });
    Object.assign(todayGames[3], { status: "cancelled", is_cancel: true, status_note: "취소 - 우천", away_score: null, home_score: null });
    Object.assign(todayGames[4], { status: "postponed", status_note: "연기 - 순연 예정", away_score: null, home_score: null });
  }

  const tomorrowString = toISODate(addDays(today, 1));
  const nextLgGame = games.find((game) => game.date === tomorrowString && (game.home === "LG" || game.away === "LG"));
  if (nextLgGame) {
    const opponent = nextLgGame.home === "LG" ? nextLgGame.away : nextLgGame.home;
    Object.assign(nextLgGame, { away: opponent, home: "LG", stadium: STADIUMS.LG });
  }

  const detailDate = toISODate(addDays(today, -2));
  let detail = games.find((game) => game.date === detailDate && game.home === "LG");
  if (!detail) detail = games.find((game) => game.date === detailDate);
  if (detail) {
    Object.assign(detail, {
      away: "두산", home: "LG", stadium: STADIUMS.LG, status: "final", time: "18:30", away_score: 5, home_score: 6,
      away_line: "0|1|0|0|2|0|1|0|0|0|0|1", home_line: "1|0|0|2|0|0|0|1|0|0|0|2",
      away_rheb: "5|9|1|3", home_rheb: "6|11|0|4",
      pitcher_details: {
        away: [{ name: "오세형", result: "패", ip: "0⅓", np: "11", so: "0", er: "1" }],
        home: [{ name: "한성호", result: "승", ip: "1", np: "14", so: "2", er: "0" }]
      },
      hitter_details: {
        away: [{ name: "김도환", pos: "중견수", ab: "5", hit: "2", rbi: "1", avg: ".286" }],
        home: [{ name: "문세진", pos: "좌익수", ab: "4", hit: "2", rbi: "2", avg: ".312" }]
      }
    });
  }
  return games;
}

function renderLoading() {
  dom.notice.hidden = false;
  dom.notice.className = "data-notice";
  dom.notice.textContent = "경기 데이터를 불러오고 있습니다.";
  dom.nextGame.innerHTML = `<div class="empty-hero"><h1>다음 경기를 확인하는 중입니다</h1><p>일정과 예매 정보를 불러오고 있습니다.</p></div>`;
  dom.todayGames.innerHTML = `<div class="day-empty">오늘 경기 정보를 불러오고 있습니다.</div>`;
}

async function fetchTicketPolicies() {
  try {
    const response = await fetch(TICKET_POLICY_API_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const policies = Array.isArray(payload?.policies) ? payload.policies : [];
    const remoteRules = Object.fromEntries(policies
      .filter((policy) => TEAMS.includes(policy.team) && policy.vendor && policy.url)
      .map((policy) => [policy.team, { ...DEFAULT_TICKET_RULES[policy.team], ...policy }]));
    state.ticketRules = { ...DEFAULT_TICKET_RULES, ...remoteRules };
  } catch (error) {
    console.warn("Ticket policy request failed; using bundled defaults", error);
    state.ticketRules = { ...DEFAULT_TICKET_RULES };
  }
}

async function fetchIngestionStatus() {
  try {
    const response = await fetch("/api/ingestion-status", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.ingestionStatus = payload.run || null;
    state.ingestionRuns = payload.runs || (payload.run ? { [payload.run.job_type]: payload.run } : {});
  } catch (error) {
    console.warn("Ingestion status request failed", error);
    state.ingestionStatus = null;
    state.ingestionRuns = {};
  }
}

async function fetchGames({ force = false } = {}) {
  renderLoading();
  if (demoMode) {
    state.games = makeDemoMatches().map(normalizeGame);
    state.loadedAt = new Date();
    state.dataTimestamp = state.loadedAt;
    state.sourceState = "sample";
    renderAll();
    return;
  }

  try {
    const [response] = await Promise.all([
      fetch(`${API_URL}?from=${encodeURIComponent(toISODate(addDays(today, -120)))}&to=${encodeURIComponent(toISODate(addDays(today, 180)))}`, force ? { cache: "no-store" } : undefined),
      fetchTicketPolicies(),
      fetchIngestionStatus()
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : (payload.games || []);
    state.games = rows.map(normalizeGame);
    state.loadedAt = new Date();
    const timestamps = rows.map((row) => row.source_updated_at || row.ingested_at).filter(Boolean).map((value) => new Date(value)).filter((value) => !Number.isNaN(value.getTime()));
    state.dataTimestamp = timestamps.length ? new Date(Math.max(...timestamps.map((value) => value.getTime()))) : null;
    if (!state.dataTimestamp && payload.data_updated_at) state.dataTimestamp = new Date(payload.data_updated_at);
    state.sourceState = "ready";
    dom.refreshStatus.textContent = `마지막 확인 ${formatTime(state.loadedAt)}`;
  } catch (error) {
    console.error("KBO data request failed", error);
    state.games = [];
    state.loadedAt = new Date();
    state.sourceState = "error";
    dom.refreshStatus.textContent = "갱신 실패 · 이전 데이터를 확인하세요";
  }
  renderAll();
  fetchPreviews();
}

// 프리뷰는 오늘 앞뒤 며칠만 가져온다. 전체 일정 요청에 붙이면 시즌치 라인업 JSON이 통째로 실린다.
async function fetchPreviews() {
  if (demoMode) return;
  try {
    const from = encodeURIComponent(toISODate(addDays(today, -1)));
    const to = encodeURIComponent(toISODate(addDays(today, 2)));
    const response = await fetch(`${API_URL}?from=${from}&to=${to}&include=preview`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : (payload.games || []);
    if (!rows.length) return;
    const previewById = new Map(rows.map((row) => [row.game_id, row.preview || null]));
    state.games = state.games.map((game) => previewById.has(game.game_id)
      ? { ...game, preview: previewById.get(game.game_id) } : game);
    renderAll();
    if (state.selectedGameId && dom.dialog.open) {
      const selected = state.games.find((game) => game.game_id === state.selectedGameId);
      if (selected) renderGameDetail(selected);
    }
  } catch (error) {
    // 프리뷰가 없어도 화면은 완전히 동작한다. 조용히 넘어간다.
    console.warn("Preview request failed", error);
  }
}

function hasLiveRefreshWindow() {
  const now = Date.now();
  // 선발 예고와 라인업은 경기 6시간 전부터 채워진다. 그때부터 따라간다.
  return state.games.some((game) => {
    const startsAt = parseGameDate(game).getTime();
    return startsAt - 6 * 60 * 60 * 1000 <= now && now <= startsAt + 5 * 60 * 60 * 1000;
  });
}

async function refreshLiveData() {
  if (demoMode || liveRefreshInFlight || !hasLiveRefreshWindow()) return;
  liveRefreshInFlight = true;
  try {
    const response = await fetch(`${API_URL}?from=${encodeURIComponent(toISODate(addDays(today, -2)))}&to=${encodeURIComponent(toISODate(addDays(today, 1)))}&include=preview`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const rows = Array.isArray(payload) ? payload : (payload.games || []);
    if (!rows.length) return;
    const refreshedGames = rows.map(normalizeGame);
    const refreshedById = new Map(refreshedGames.map((game) => [game.game_id, game]));
    state.games = state.games.map((game) => refreshedById.get(game.game_id) || game);
    state.loadedAt = new Date();
    const timestamps = rows.map((row) => row.source_updated_at || row.ingested_at).filter(Boolean).map((value) => new Date(value)).filter((value) => !Number.isNaN(value.getTime()));
    state.dataTimestamp = timestamps.length ? new Date(Math.max(...timestamps.map((value) => value.getTime()))) : state.dataTimestamp;
    state.sourceState = "ready";
    dom.refreshStatus.textContent = `마지막 확인 ${formatTime(state.loadedAt)}`;
    renderAll();
    if (state.selectedGameId && dom.dialog.open) {
      const selected = state.games.find((game) => game.game_id === state.selectedGameId);
      if (selected) renderGameDetail(selected);
    }
  } catch (error) {
    console.warn("Live KBO refresh failed; keeping the last successful data", error);
  } finally {
    liveRefreshInFlight = false;
  }
}

function renderNotice() {
  if (state.sourceState === "ready") {
    const isStale = state.dataTimestamp && Date.now() - state.dataTimestamp.getTime() > DATA_STALE_AFTER_MS;
    dom.notice.hidden = !isStale;
    if (isStale) {
      dom.notice.className = "data-notice error";
      dom.notice.textContent = `데이터 갱신이 8시간 이상 지연되고 있습니다. 마지막 갱신 ${formatTime(state.dataTimestamp)}`;
    }
    return;
  }
  dom.notice.hidden = false;
  if (state.sourceState === "sample") {
    dom.notice.className = "data-notice sample";
    dom.notice.innerHTML = `샘플 데이터 화면입니다. 점수와 선수명은 UI 검증용이며 실제 경기 정보가 아닙니다. <a href="./">운영 화면 보기</a>`;
  } else if (state.sourceState === "error") {
    dom.notice.className = "data-notice error";
    dom.notice.innerHTML = `경기 데이터 서버에 연결하지 못했습니다. 기존 데이터는 변경되지 않았습니다. <a href="?demo=1">샘플 화면 보기</a>`;
  }
}

function finishedAt(run) {
  if (!run || !run.finished_at) return null;
  const value = new Date(run.finished_at);
  return Number.isNaN(value.getTime()) ? null : value;
}

// 수집이 두 갈래다. 경기 중 점수는 Cloudflare 크론이 1분마다, 시즌 일정은 GitHub Actions가
// 훨씬 느리게 갱신한다. 하나의 임계값으로 묶으면 어느 쪽이 멈췄는지 알 수 없다.
function renderIngestionStatus() {
  if (!dom.ingestionStatus) return;
  const runs = state.ingestionRuns || {};
  const live = runs.live;
  const schedule = runs.games;
  if (!live && !schedule) {
    dom.ingestionStatus.className = "source-status is-warning";
    dom.ingestionStatus.textContent = "수집 실행 기록을 확인할 수 없습니다";
    return;
  }
  const liveFinished = finishedAt(live);
  const liveFresh = liveFinished && Date.now() - liveFinished.getTime() <= LIVE_FRESH_AFTER_MS;
  if (liveFresh && live.status === "success") {
    dom.ingestionStatus.className = "source-status is-healthy";
    dom.ingestionStatus.textContent = `실시간 갱신 중 · ${formatTime(liveFinished)}`;
    return;
  }
  const scheduleFinished = finishedAt(schedule);
  const time = scheduleFinished ? formatTime(scheduleFinished) : "시간 미상";
  const isDelayed = !scheduleFinished || Date.now() - scheduleFinished.getTime() > SCHEDULE_STALE_AFTER_MS;
  const failed = (schedule && schedule.status !== "success") || (live && !liveFresh && live.status !== "success");
  dom.ingestionStatus.className = `source-status ${!failed && !isDelayed ? "is-healthy" : "is-warning"}`;
  dom.ingestionStatus.textContent = failed
    ? `수집 실패 · ${time} · 이전 데이터 유지`
    : isDelayed
      ? `수집 지연 · 마지막 성공 ${time} · 이전 데이터 유지`
      : `수집 정상 · ${time} · ${schedule ? schedule.accepted_count : 0}건 반영`;
}

function freshnessText() {
  if (state.sourceState === "sample") return `샘플 생성 ${formatTime(state.loadedAt)}`;
  if (state.dataTimestamp) return `데이터 갱신 ${formatTime(state.dataTimestamp)}`;
  if (state.loadedAt && state.sourceState === "ready") return `데이터 조회 ${formatTime(state.loadedAt)}`;
  return "데이터 갱신 시각을 확인할 수 없습니다";
}

function formatTime(date) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function renderFavoriteTeam() {
  document.querySelectorAll("[data-favorite-team]").forEach((element) => { element.textContent = state.favoriteTeam || "응원팀 선택"; });
  document.querySelectorAll("[data-team-dot]").forEach((element) => {
    element.dataset.teamDot = state.favoriteTeam || "none";
    element.style.setProperty("--team-color", TEAM_COLORS[state.favoriteTeam] || "#a8a39a");
  });
  dom.teamPicker.innerHTML = TEAMS.map((team) => `
    <button class="team-option ${team === state.favoriteTeam ? "is-active" : ""}" type="button" data-team="${escapeHtml(team)}">
      <span class="team-dot" style="${teamStyle(team)}"></span>${escapeHtml(team)}
    </button>`).join("");
  dom.teamPicker.querySelectorAll("[data-team]").forEach((button) => button.addEventListener("click", () => setFavoriteTeam(button.dataset.team)));
  dom.firstVisitNotice.hidden = state.hasStoredTeam;
}

function setFavoriteTeam(team) {
  if (!TEAMS.includes(team)) return;
  const changed = state.favoriteTeam !== team;
  state.favoriteTeam = team;
  state.hasStoredTeam = true;
  localStorage.setItem("kbo-favorite-team", team);
  if (changed) { state.roster = null; state.rosterState = "idle"; state.viewTeam = team; }
  renderAll();
  if (changed && state.activeView === "team") { syncUrl(); fetchRoster(); }
}

/* ── 경기 프리뷰: 선발 매치업과 라인업 ─────────────────────────────────────
   데이터는 game_previews(네이버 preview)에서 오고 /api/games?include=preview로 실린다.
   프리뷰가 없으면 블록 자체를 렌더하지 않는다. "정보 없음" 자리를 남기지 않는다. */

const PITCH_LABELS = { FAST: "직구", TWOS: "투심", SINK: "싱커", CUTT: "커터", SLID: "슬라이더",
  SWEE: "스위퍼", CURV: "커브", CHUP: "체인지업", FORK: "포크", SPLI: "스플리터", KNUC: "너클볼" };
const POSITION_SHORT = { 선발투수: "선발", 투수: "투수", 포수: "포수", "1루수": "1루", "2루수": "2루",
  "3루수": "3루", 유격수: "유격", 좌익수: "좌익", 중견수: "중견", 우익수: "우익", 지명타자: "지명" };

function previewOf(game) {
  const preview = game && game.preview;
  return preview && preview.game_id ? preview : null;
}

function throwHand(hitType) {
  const value = String(hitType || "");
  const side = value.startsWith("좌") ? "좌완" : value.startsWith("우") ? "우완" : "";
  if (!side) return "";
  return value.includes("언더") ? `${side} 언더` : value.includes("사이드") ? `${side} 사이드` : side;
}

function mainPitch(starter) {
  const pitches = Array.isArray(starter && starter.pitches) ? starter.pitches : [];
  const best = pitches
    .filter((pitch) => Number.isFinite(Number(pitch && pitch.speed)))
    .sort((a, b) => Number(b.rate || 0) - Number(a.rate || 0))[0];
  if (!best) return "";
  return `${PITCH_LABELS[best.type] || best.type} ${Math.round(Number(best.speed))}km`;
}

function winLossText(record) {
  if (!record || (record.w == null && record.l == null)) return "";
  const parts = [`${record.w ?? 0}승`, `${record.l ?? 0}패`];
  if (record.d) parts.push(`${record.d}무`);
  return parts.join(" ");
}

function compareRowHtml(label, awayValue, homeValue, strong) {
  if (!awayValue && !homeValue) return "";
  const cell = (value, side) => `<span class="starter-value ${side}${strong ? " is-strong" : ""}">${escapeHtml(value || "-")}</span>`;
  return `${cell(awayValue, "away")}<span class="starter-label">${escapeHtml(label)}</span>${cell(homeValue, "home")}`;
}

function starterHeadHtml(starter, side) {
  if (!starter || !starter.name) return `<div class="starter-head ${side}"><span class="starter-name is-empty">선발 미정</span></div>`;
  const hand = throwHand(starter.hitType);
  return `<div class="starter-head ${side}">
      <span class="starter-line">${starter.backnum ? `<span class="starter-no">${escapeHtml(starter.backnum)}</span>` : ""}<strong class="starter-name">${escapeHtml(starter.name)}</strong></span>
      ${hand ? `<span class="starter-hand">${escapeHtml(hand)}</span>` : ""}
    </div>`;
}

function starterMatchupHtml(preview) {
  const away = preview.away_starter;
  const home = preview.home_starter;
  if (!away && !home) return "";
  const vsEra = (starter) => (starter && starter.vsOpponent ? starter.vsOpponent.era : "") || "";
  const rows = [
    compareRowHtml("시즌 ERA", away && away.era, home && home.era, true),
    compareRowHtml("승패", winLossText(away), winLossText(home)),
    compareRowHtml("상대 ERA", vsEra(away), vsEra(home), true),
    compareRowHtml("주무기", mainPitch(away), mainPitch(home))
  ].filter(Boolean).join("");
  return `<section class="starter-block">
      <span class="block-label">선발 매치업</span>
      <div class="starter-grid starter-heads">${starterHeadHtml(away, "away")}<span></span>${starterHeadHtml(home, "home")}</div>
      ${rows ? `<div class="starter-grid starter-compare">${rows}</div>` : ""}
    </section>`;
}

// 승률이 같으면 공동 순위가 내려온다(한화·롯데 둘 다 .440으로 8위). 오류가 아니라 정상이다.
function standingText(standing) {
  const rank = standing && Number.isInteger(standing.rank) ? `${standing.rank}위` : "";
  return [rank, winLossText(standing)].filter(Boolean).join(" · ");
}

function teamRecordHtml(game, preview) {
  const away = standingText(preview.away_standing);
  const home = standingText(preview.home_standing);
  if (!away && !home) return "";
  return `<div class="team-records"><span>${escapeHtml(away)}</span><span>${escapeHtml(home)}</span></div>`;
}

function seasonVsHtml(game, preview) {
  const record = preview.season_vs;
  const awayWin = Number(record && record.awayWin);
  const awayLoss = Number(record && record.awayLoss);
  if (!Number.isFinite(awayWin) || !Number.isFinite(awayLoss) || awayWin + awayLoss === 0) return "";
  const draw = Number(record.draw) || 0;
  const summary = `${game.away} ${awayWin}승 · ${game.home} ${awayLoss}승${draw ? ` · ${draw}무` : ""}`;
  return `<section class="season-vs">
      <div class="season-vs-head"><span class="block-label">시즌 상대전적</span><span class="season-vs-text">${escapeHtml(summary)}</span></div>
      <div class="season-vs-bar" role="img" aria-label="${escapeHtml(summary)}">
        <span style="flex:${awayWin};${teamStyle(game.away)}"></span>
        ${draw ? `<span class="is-draw" style="flex:${draw}"></span>` : ""}
        <span style="flex:${awayLoss};${teamStyle(game.home)}"></span>
      </div>
    </section>`;
}

function lineupNoticeHtml(game, preview) {
  const startsAt = parseGameDate(game);
  if (preview.lineup_state === "announced") {
    return `<button class="lineup-notice is-ready" type="button" data-open-lineup="${escapeHtml(game.game_id)}">라인업이 공개됐습니다<span aria-hidden="true">→</span></button>`;
  }
  if (toISODate(startsAt) !== toISODate(today) || startsAt.getTime() <= Date.now()) return "";
  const openAt = new Date(startsAt.getTime() - 2 * 60 * 60 * 1000);
  if (openAt.getTime() <= Date.now()) return `<p class="lineup-notice">라인업 발표를 기다리는 중입니다</p>`;
  return `<p class="lineup-notice">라인업은 <strong>${escapeHtml(formatTime(openAt))}</strong> 전후 공개됩니다</p>`;
}

function previewBlocksHtml(game) {
  const preview = previewOf(game);
  if (!preview) return "";
  return `${starterMatchupHtml(preview)}${seasonVsHtml(game, preview)}${lineupNoticeHtml(game, preview)}`;
}

function renderNextGame() {
  if (!state.favoriteTeam) {
    dom.nextGame.innerHTML = `<div class="empty-hero"><h1>응원팀을 선택해 보세요</h1><p>설정에서 팀을 고르면 다음 경기와 예매 정보를 맞춤으로 보여드립니다.</p><button class="primary-button" type="button" data-choose-team>응원팀 선택</button></div>`;
    dom.nextGame.querySelector("[data-choose-team]").addEventListener("click", () => setActiveView("settings"));
    return;
  }
  const upcoming = state.games
    .filter((game) => (game.home === state.favoriteTeam || game.away === state.favoriteTeam) && parseGameDate(game) > new Date() && !["cancelled", "postponed"].includes(getGameState(game)))
    .sort((a, b) => parseGameDate(a) - parseGameDate(b));
  const game = upcoming[0];
  if (!game) {
    dom.nextGame.innerHTML = `<div class="empty-hero"><h1>예정된 다음 경기가 없습니다</h1><p>새 일정이 등록되면 응원팀의 다음 경기를 이곳에 표시합니다.</p></div>`;
    return;
  }

  const ticket = getTicket(game);
  dom.nextGame.innerHTML = `
    <article class="next-game-card">
      <header class="next-game-head"><span>다음 경기</span><time datetime="${escapeHtml(game.date)}T${escapeHtml(game.time)}">${escapeHtml(formatKoreanDate(parseGameDate(game)))} ${escapeHtml(game.time)}</time></header>
      <div class="matchup">
        <div class="team-side away" style="${teamStyle(game.away)}">
          <span class="team-role">원정</span>
          <strong class="team-name"><span class="team-token"></span>${escapeHtml(game.away)}</strong>
          ${previewOf(game) ? "" : `<span class="starter">${game.away_starter ? `선발 ${escapeHtml(game.away_starter)}` : "선발 미정"}</span>`}
        </div>
        <span class="matchup-versus">VS</span>
        <div class="team-side home" style="${teamStyle(game.home)}">
          <span class="team-role">홈</span>
          <strong class="team-name">${escapeHtml(game.home)}<span class="team-token"></span></strong>
          ${previewOf(game) ? "" : `<span class="starter">${game.home_starter ? `선발 ${escapeHtml(game.home_starter)}` : "선발 미정"}</span>`}
        </div>
      </div>
      ${previewOf(game) ? teamRecordHtml(game, previewOf(game)) : ""}
      <div class="game-meta"><strong>${escapeHtml(game.stadium)}</strong>${game.broadcast ? ` / ${escapeHtml(game.broadcast)}` : ""}</div>
      ${previewBlocksHtml(game)}
      ${shouldShowTicket(game) ? ticketPanelHtml(game, ticket) : ""}
    </article>`;
  const openLineup = dom.nextGame.querySelector("[data-open-lineup]");
  if (openLineup) openLineup.addEventListener("click", () => openGameDetail(openLineup.dataset.openLineup, "lineup"));
  updateCountdowns();
}

// 경기가 없는 날이거나 오늘 경기가 전부 끝난 뒤에만 보여준다.
// 경기 전·중에 게임 링크가 예매와 라인업 앞을 가로막으면 앱의 목적이 흐려진다.
function shouldShowCrossLink(games) {
  if (!games.length) return true;
  return games.every((game) => ["final", "cancelled", "postponed"].includes(getGameState(game)));
}

function crossLinkHtml(games) {
  if (!shouldShowCrossLink(games)) return "";
  return `<a class="cross-link" href="https://games.salarycrew.com/kbo/" target="_blank" rel="noopener">
      <span class="cross-link-lead">${games.length ? "오늘 경기가 모두 끝났습니다" : "오늘은 경기가 없습니다"}</span>
      <span class="cross-link-body">
        <strong>야구 Who Are Ya</strong>
        <small>오늘 1군 등록 선수 중 한 명 맞히기</small>
      </span>
      <span class="cross-link-go">하러 가기 <span aria-hidden="true">→</span></span>
    </a>`;
}

function renderToday() {
  dom.todayDate.textContent = formatKoreanDate(today);
  const games = gamesForDate(toISODate(today), false);
  dom.todayGames.innerHTML = (games.length ? `<div class="game-list">${games.map(gameRowHtml).join("")}</div>` : `<div class="day-empty">오늘 예정된 경기가 없습니다.</div>`) + crossLinkHtml(games);
  bindGameButtons(dom.todayGames);
  dom.todayFreshness.textContent = freshnessText();
}

function gameRowHtml(game) {
  const status = getGameState(game);
  const isFavorite = game.home === state.favoriteTeam || game.away === state.favoriteTeam;
  const statusText = getStatusText(game);
  const score = scoreText(game);
  return `
    <button class="game-row ${status} ${isFavorite ? "is-favorite" : ""}" style="${isFavorite ? teamStyle(state.favoriteTeam) : ""}" type="button" data-game-id="${escapeHtml(game.game_id)}">
      <time>${escapeHtml(game.time)}</time>
      <span class="row-teams">
        <span class="row-team"><i class="team-dot" style="${teamStyle(game.away)}"></i><strong>${escapeHtml(game.away)}</strong>${score ? `<b class="row-score">${escapeHtml(game.away_score)}</b>` : ""}</span>
        <span class="row-team"><i class="team-dot" style="${teamStyle(game.home)}"></i><strong>${escapeHtml(game.home)}</strong><small class="home-label">홈</small>${score ? `<b class="row-score">${escapeHtml(game.home_score)}</b>` : ""}</span>
      </span>
      <span class="row-state ${status}">${escapeHtml(statusText)}</span>
    </button>`;
}

function startOfWeek(date) {
  const result = startOfDay(date);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function renderSchedule() {
  document.getElementById("currentPeriod").textContent = window.innerWidth >= 960 ? "이번 달" : "이번 주";
  renderFilterState();
  renderWeek();
  renderMonth();
  renderSelectedDay();
  dom.scheduleFreshness.textContent = freshnessText();
  dom.settingsFreshness.textContent = freshnessText();
}

function renderFilterState() {
  document.querySelectorAll("[data-scope]").forEach((button) => button.classList.toggle("is-active", button.dataset.scope === state.teamScope));
  document.querySelectorAll("[data-venue]").forEach((button) => button.classList.toggle("is-active", button.dataset.venue === state.venue));
}

function renderWeek() {
  const weekStart = startOfWeek(state.cursorDate);
  const weekEnd = addDays(weekStart, 6);
  dom.scheduleTitle.textContent = `${weekStart.getMonth() + 1}월 ${weekStart.getDate()}일 - ${weekEnd.getMonth() + 1}월 ${weekEnd.getDate()}일`;
  dom.week.innerHTML = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const dateString = toISODate(date);
    const games = gamesForDate(dateString);
    const dayClass = date.getDay() === 0 ? "is-sunday" : date.getDay() === 6 ? "is-saturday" : "";
    return `
      <section class="week-day ${dayClass} ${dateString === toISODate(today) ? "is-today" : ""}">
        <h2><time datetime="${dateString}">${date.getMonth() + 1}월 ${date.getDate()}일</time><span class="weekday">${new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(date)}</span></h2>
        ${games.length ? `<div class="game-list">${games.map(gameRowHtml).join("")}</div>` : `<div class="day-empty">경기가 없습니다.</div>`}
      </section>`;
  }).join("");
  bindGameButtons(dom.week);
}

function monthGridDates(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function renderMonth() {
  const year = state.cursorDate.getFullYear();
  const month = state.cursorDate.getMonth();
  dom.scheduleTitle.textContent = `${year}년 ${month + 1}월`;
  const weekdayHeaders = ["일", "월", "화", "수", "목", "금", "토"].map((day, index) => `<div class="calendar-weekday ${index === 0 ? "sunday" : index === 6 ? "saturday" : ""}">${day}</div>`).join("");
  const days = monthGridDates(state.cursorDate).map((date) => {
    const dateString = toISODate(date);
    const games = gamesForDate(dateString);
    // KBO 정규일은 최대 5경기이므로 월간 캘린더에서도 모든 팀 대진을 노출한다.
    // 더블헤더 등 5경기를 초과하는 경우에만 추가 경기 버튼을 표시한다.
    const visible = games.slice(0, 5);
    const day = date.getDay();
    return `
      <div class="calendar-day ${date.getMonth() !== month ? "is-outside" : ""} ${dateString === state.selectedDate ? "is-selected" : ""} ${dateString === toISODate(today) ? "is-today" : ""}" data-date="${dateString}">
        <button class="day-number ${day === 0 ? "sunday" : day === 6 ? "saturday" : ""}" type="button" data-select-date="${dateString}">${date.getDate()}</button>
        ${visible.map(monthChipHtml).join("")}
        ${games.length > 5 ? `<button class="more-games" type="button" data-select-date="${dateString}">+${games.length - 5}경기</button>` : ""}
      </div>`;
  }).join("");
  dom.month.innerHTML = weekdayHeaders + days;
  bindGameButtons(dom.month);
  dom.month.querySelectorAll("[data-select-date]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    state.selectedDate = button.dataset.selectDate;
    syncUrl(true);
    const games = gamesForDate(state.selectedDate);
    state.selectedGameId = games[0]?.game_id || null;
    renderMonth();
    renderSelectedDay();
  }));
}

function monthChipHtml(game) {
  const status = getGameState(game);
  const isFavorite = game.home === state.favoriteTeam || game.away === state.favoriteTeam;
  return `
    <button class="month-chip ${status} ${isFavorite ? "is-favorite" : ""}" style="${isFavorite ? teamStyle(state.favoriteTeam) : ""}" type="button" data-game-id="${escapeHtml(game.game_id)}">
      <strong>${escapeHtml(game.away)} : ${escapeHtml(game.home)}</strong>
      <span>${escapeHtml(status === "scheduled" ? game.time : status === "live" ? "LIVE" : status === "final" ? scoreText(game) : getStatusText(game))}</span>
    </button>`;
}

function renderSelectedDay() {
  const date = new Date(`${state.selectedDate}T00:00:00`);
  const games = gamesForDate(state.selectedDate);
  if (!state.selectedGameId || !games.some((game) => game.game_id === state.selectedGameId)) state.selectedGameId = games[0]?.game_id || null;
  const selected = games.find((game) => game.game_id === state.selectedGameId);
  dom.dayPanel.innerHTML = `
    <section class="panel-card">
      <div class="panel-card-head"><h2>${escapeHtml(formatKoreanDate(date))}</h2><span>${games.length}경기</span></div>
      ${games.length ? `<div class="panel-games">${games.map((game) => {
        const status = getGameState(game);
        return `<button class="panel-game ${status}" type="button" data-panel-game="${escapeHtml(game.game_id)}"><strong>${escapeHtml(game.away)} : ${escapeHtml(game.home)}</strong><span>${escapeHtml(status === "scheduled" ? game.time : status === "final" ? `${scoreText(game)} 종료` : getStatusText(game))}</span></button>`;
      }).join("")}</div>` : `<div class="day-empty">선택한 날짜에 경기가 없습니다.</div>`}
    </section>
    ${selected ? selectedGamePanelHtml(selected) : ""}`;
  dom.dayPanel.querySelectorAll("[data-panel-game]").forEach((button) => button.addEventListener("click", () => {
    state.selectedGameId = button.dataset.panelGame;
    renderSelectedDay();
  }));
  const detailButton = dom.dayPanel.querySelector("[data-open-selected]");
  if (detailButton) detailButton.addEventListener("click", () => openGameDetail(detailButton.dataset.openSelected));
}

function selectedGamePanelHtml(game) {
  const status = getGameState(game);
  const score = scoreText(game);
  return `
    <section class="panel-card selected-game">
      <div class="selected-game-top"><span>선택한 경기</span><strong>${escapeHtml(getStatusText(game))}</strong></div>
      <div class="selected-matchup">
        <div style="${teamStyle(game.away)}"><span>원정</span><strong>${escapeHtml(game.away)}</strong>${score ? `<b>${escapeHtml(game.away_score)}</b>` : ""}</div>
        <span class="detail-versus">${score ? ":" : "VS"}</span>
        <div class="home" style="${teamStyle(game.home)}"><span>홈</span><strong>${escapeHtml(game.home)}</strong>${score ? `<b>${escapeHtml(game.home_score)}</b>` : ""}</div>
      </div>
      <dl><dt>경기 시각</dt><dd>${escapeHtml(game.time)}</dd><dt>구장</dt><dd>${escapeHtml(game.stadium)}</dd>${game.broadcast ? `<dt>중계</dt><dd>${escapeHtml(game.broadcast)}</dd>` : ""}</dl>
      <button class="primary-button" type="button" data-open-selected="${escapeHtml(game.game_id)}">경기 상세 보기</button>
    </section>`;
}

function bindGameButtons(root) {
  root.querySelectorAll("[data-game-id]").forEach((button) => button.addEventListener("click", () => openGameDetail(button.dataset.gameId)));
}

function openGameDetail(gameId, tab) {
  const game = state.games.find((item) => item.game_id === gameId);
  if (!game) return;
  state.selectedGameId = gameId;
  // 팀 토글 기본값은 응원팀. 응원팀이 이 경기에 없으면 원정팀이다.
  state.detailLineupTeam = game.home === state.favoriteTeam ? "home" : "away";
  state.detailTab = tab === "lineup" && hasLineupTab(game) ? "lineup" : "score";
  renderGameDetail(game);
  if (typeof dom.dialog.showModal === "function") dom.dialog.showModal();
  else dom.dialog.setAttribute("open", "");
  syncUrl(true);
}

function renderGameDetail(game) {
  const status = getGameState(game);
  const score = scoreText(game);
  const dateText = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(parseGameDate(game));
  const resultText = status === "final" ? "최종" : getStatusText(game);
  dom.dialogBody.innerHTML = `
    <section class="detail-card detail-summary">
      <div class="detail-meta"><span class="status-label">${escapeHtml(resultText)}</span>${escapeHtml(dateText)} / ${escapeHtml(game.stadium)}</div>
      <div class="detail-score">
        <div class="detail-team away" style="${teamStyle(game.away)}"><span class="team-role">원정</span><strong class="team-name"><span class="team-token"></span>${escapeHtml(game.away)}</strong>${score ? `<span class="detail-score-value">${escapeHtml(game.away_score)}</span>` : ""}</div>
        <span class="detail-versus">${score ? ":" : "VS"}</span>
        <div class="detail-team home" style="${teamStyle(game.home)}"><span class="team-role">홈</span><strong class="team-name">${escapeHtml(game.home)}<span class="team-token"></span></strong>${score ? `<span class="detail-score-value">${escapeHtml(game.home_score)}</span>` : ""}</div>
      </div>
      <p class="detail-note">${escapeHtml(detailNote(game, status))}</p>
    </section>
    ${detailContentHtml(game, status)}
    <p class="detail-source">KBO 경기 일정 기반 / ${escapeHtml(freshnessText())}</p>`;
  bindDetailInteractions(game);
}

function detailNote(game, status) {
  if (status === "cancelled") return game.status_note || "경기가 취소되었습니다.";
  if (status === "postponed") return game.status_note || "경기가 연기되었습니다. 변경 일정을 확인해 주세요.";
  if (status === "live") return `${game.inning || game.status_note || "경기 진행 중"} / 점수는 수집 주기에 따라 늦게 반영될 수 있습니다.`;
  if (status === "final") return `${Math.max(splitLine(game.away_line).length, splitLine(game.home_line).length, 9)}회 경기 종료`;
  return game.broadcast ? `중계 ${game.broadcast}` : "경기 시작 전입니다.";
}

function detailContentHtml(game, status) {
  if (status === "scheduled") {
    const ticket = getTicket(game);
    const preview = previewOf(game);
    const previewCard = preview ? `<section class="detail-card"><div class="detail-preview">${starterMatchupHtml(preview)}${seasonVsHtml(game, preview)}</div></section>` : "";
    const lineupCard = hasLineupTab(game) ? `<section class="detail-card"><h2>라인업</h2><div class="detail-tab-panel" id="detailTabPanel">${lineupPanelHtml(game)}</div></section>` : "";
    return `<section class="detail-card"><h2>예매 안내</h2><div class="detail-tab-panel">${shouldShowTicket(game, status) ? ticketPanelHtml(game, ticket, { compact: true }) : `<p class="detail-empty">예매 오픈 시점이 지난 경기입니다. 공식 예매처에서 현재 판매 상태를 확인해 주세요.</p>`}</div></section>${previewCard}${lineupCard}`;
  }
  if (["cancelled", "postponed"].includes(status)) return `<section class="detail-card"><div class="detail-tab-panel"><p>${escapeHtml(detailNote(game, status))}</p><p class="detail-empty">새 일정이 확인되면 이 화면에 반영됩니다.</p></div></section>`;
  return `
    ${scoreboardHtml(game)}
    <section class="detail-card">
      <div class="detail-tabs${hasLineupTab(game) ? " has-lineup" : ""}" role="tablist">
        <button class="${state.detailTab === "score" ? "is-active" : ""}" type="button" data-detail-tab="score">요약</button>
        ${hasLineupTab(game) ? `<button class="${state.detailTab === "lineup" ? "is-active" : ""}" type="button" data-detail-tab="lineup">라인업</button>` : ""}
        <button class="${state.detailTab === "hitter" ? "is-active" : ""}" type="button" data-detail-tab="hitter">타자</button>
        <button class="${state.detailTab === "pitcher" ? "is-active" : ""}" type="button" data-detail-tab="pitcher">투수</button>
      </div>
      <div class="detail-tab-panel" id="detailTabPanel">${detailTabHtml(game)}</div>
    </section>`;
}

function splitLine(value) {
  if (!value) return [];
  return String(value).split("|").map((item) => item || "-");
}

function scoreboardHtml(game) {
  const away = splitLine(game.away_line);
  const home = splitLine(game.home_line);
  const inningCount = Math.max(away.length, home.length, 9);
  const awayTotals = splitLine(game.away_rheb);
  const homeTotals = splitLine(game.home_rheb);
  const innings = Array.from({ length: inningCount }, (_, index) => `<th>${index + 1}</th>`).join("");
  const row = (team, line, totals) => `<tr><td class="sticky-team">${escapeHtml(team)}</td>${Array.from({ length: inningCount }, (_, index) => `<td>${escapeHtml(line[index] ?? "-")}</td>`).join("")}<td class="total-r">${escapeHtml(totals[0] ?? "-")}</td><td class="total-h">${escapeHtml(totals[1] ?? "-")}</td><td class="total-e">${escapeHtml(totals[2] ?? "-")}</td></tr>`;
  return `
    <section class="detail-card"><h2>이닝별 득점 <span class="inning-count">${inningCount}회</span></h2><div class="score-scroll" role="region" aria-label="이닝별 득점 표"><table class="scoreboard"><thead><tr><th class="sticky-team">팀</th>${innings}<th class="total-r">R</th><th class="total-h">H</th><th class="total-e">E</th></tr></thead><tbody>${row(game.away, away, awayTotals)}${row(game.home, home, homeTotals)}</tbody></table></div><p class="score-hint">전체 이닝과 R·H·E를 표시합니다. 표는 좌우로 밀어 확인할 수 있습니다.</p></section>`;
}

// batorder가 없는 항목(선발투수)은 null로 온다. Number(null)이 0이라 정수 검사만으로는 걸러지지 않는다.
function battingOrder(player) {
  const order = Number(player && player.batorder);
  return Number.isInteger(order) && order >= 1 && order <= 9 ? order : null;
}

/* ── 선수 프로필: Who Are Ya 선수 마스터 ─────────────────────────────────
   매칭 실패는 조용히 넘긴다. 이름만으로도 라인업은 완성된 정보다. */

const PLAYERS_API_URL = "/api/players";

async function fetchPlayers() {
  if (demoMode || state.playersState === "loading" || state.playersState === "ready") return;
  state.playersState = "loading";
  try {
    const response = await fetch(PLAYERS_API_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.players = payload.players || {};
    state.playersState = "ready";
  } catch (error) {
    console.warn("Player master request failed", error);
    state.players = {};
    state.playersState = "error";
  }
}

function findPlayer(team, name, backNumber) {
  const candidates = state.players ? state.players[`${team}|${name}`] : null;
  if (!Array.isArray(candidates) || !candidates.length) return null;
  if (candidates.length === 1) return candidates[0];
  const number = backNumber ? String(backNumber) : null;
  return candidates.find((player) => player.back_number === number) || null;
}

function playerSheetHtml(team, name, backNumber, context) {
  const player = findPlayer(team, name, backNumber);
  const facts = [];
  if (player) {
    if (player.birth_year) facts.push(`${player.birth_year}년생`);
    if (player.height) facts.push(`${player.height}cm`);
  }
  const position = player && player.position ? player.position : "";
  return `<div class="player-sheet-head">
      <div class="player-sheet-title">
        ${backNumber ? `<span class="player-no">${escapeHtml(backNumber)}</span>` : ""}
        <strong id="playerSheetName">${escapeHtml(name)}</strong>
      </div>
      <button class="player-sheet-close" type="button" data-close-player aria-label="닫기">✕</button>
    </div>
    <div class="player-sheet-meta" style="${teamStyle(team)}">
      <span class="team-dot"></span>${escapeHtml(team)}${position ? ` · ${escapeHtml(position)}` : ""}
    </div>
    ${facts.length ? `<p class="player-sheet-facts">${escapeHtml(facts.join(" · "))}</p>` : ""}
    ${context ? `<div class="player-sheet-context">${context}</div>` : ""}
    ${player ? `<a class="player-sheet-link" href="https://games.salarycrew.com/kbo/" target="_blank" rel="noopener">
        <span><strong>야구 Who Are Ya 에서 만나기</strong><small>games.salarycrew.com</small></span>
        <span aria-hidden="true">→</span></a>`
      : `<p class="player-sheet-empty">이 선수의 상세 프로필은 아직 연결되지 않았습니다.</p>`}`;
}

function openPlayerSheet(team, name, backNumber, context) {
  if (!dom.playerDialog || !dom.playerSheet) return;
  dom.playerSheet.innerHTML = playerSheetHtml(team, name, backNumber, context);
  dom.playerSheet.querySelectorAll("[data-close-player]").forEach((button) =>
    button.addEventListener("click", () => dom.playerDialog.close()));
  if (typeof dom.playerDialog.showModal === "function") dom.playerDialog.showModal();
  else dom.playerDialog.setAttribute("open", "");
}

function lineupTeamSide(game) {
  if (state.detailLineupTeam === "home" || state.detailLineupTeam === "away") return state.detailLineupTeam;
  return game.home === state.favoriteTeam ? "home" : "away";
}

function lineupToggleHtml(game, side) {
  return `<div class="lineup-toggle" role="tablist" aria-label="라인업 팀 선택">
      ${["away", "home"].map((key) => {
        const team = key === "home" ? game.home : game.away;
        return `<button type="button" role="tab" aria-selected="${key === side}" class="${key === side ? "is-active" : ""}" data-lineup-team="${key}" style="${teamStyle(team)}"><span class="team-dot"></span>${escapeHtml(team)}</button>`;
      }).join("")}
    </div>`;
}

function lineupFoldHtml(title, players) {
  if (!Array.isArray(players) || !players.length) return "";
  // 불펜·대기 타자에는 소스에 등번호가 없다. 지어내지 않는다.
  const items = players.map((player) => `<li><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(player.hitType || player.position || "")}</span></li>`).join("");
  return `<details class="lineup-fold"><summary>${escapeHtml(title)}<b>${players.length}명</b></summary><ul class="lineup-fold-list">${items}</ul></details>`;
}

function lineupPanelHtml(game) {
  const preview = previewOf(game);
  if (!preview) return `<div class="detail-empty">라인업 정보가 아직 수집되지 않았습니다.</div>`;
  fetchPlayers();
  const side = lineupTeamSide(game);
  const lineup = Array.isArray(preview[`${side}_lineup`]) ? preview[`${side}_lineup`] : [];
  const starter = lineup.find((player) => battingOrder(player) === null) || preview[`${side}_starter`] || null;
  const batters = lineup
    .filter((player) => battingOrder(player) !== null)
    .sort((a, b) => battingOrder(a) - battingOrder(b));
  const starterRow = starter && starter.name
    ? `<div class="lineup-starter"><span class="lineup-starter-label">${batters.length ? "선발" : "선발 예고"}</span>${starter.backnum ? `<span class="lineup-no">${escapeHtml(starter.backnum)}</span>` : ""}<strong>${escapeHtml(starter.name)}</strong><span class="lineup-hand">${escapeHtml(throwHand(starter.hitType) || starter.batsThrows || "")}</span></div>`
    : "";
  const checked = preview.checked_at ? new Date(preview.checked_at) : null;
  const checkedText = checked && !Number.isNaN(checked.getTime()) ? `${formatTime(checked)} 확인` : "";

  if (batters.length < 9) {
    return `${lineupToggleHtml(game, side)}
      <div class="lineup-pending">
        <strong>아직 발표되지 않았습니다</strong>
        <span>보통 경기 시작 1~2시간 전에 공개됩니다</span>
      </div>
      ${starterRow}
      ${checkedText ? `<p class="lineup-source">${escapeHtml(checkedText)}</p>` : ""}`;
  }

  const rows = batters.map((player) => {
    const position = POSITION_SHORT[player.positionName] || player.positionName || "-";
    return `<div class="lineup-row"><span class="lineup-order">${escapeHtml(battingOrder(player))}</span><span class="lineup-pos">${escapeHtml(position)}</span><span class="lineup-no">${escapeHtml(player.backnum || "")}</span><button class="lineup-name" type="button" data-player-name="${escapeHtml(player.name)}" data-player-no="${escapeHtml(player.backnum || "")}" data-player-order="${escapeHtml(battingOrder(player))}" data-player-position="${escapeHtml(player.positionName || "")}">${escapeHtml(player.name)}</button><span class="lineup-hand">${escapeHtml(player.batsThrows || "")}</span></div>`;
  }).join("");

  const note = getGameState(game) === "scheduled" ? "" : `<p class="lineup-source">예고 라인업입니다. 실제 출장 기록은 타자·투수 탭에서 확인하세요.</p>`;
  return `${lineupToggleHtml(game, side)}
    ${starterRow}
    <div class="lineup-table">
      <div class="lineup-row is-head"><span>타순</span><span>포지션</span><span>번호</span><span>이름</span><span>투타</span></div>
      ${rows}
    </div>
    ${lineupFoldHtml("불펜 가용", preview[`${side}_bullpen`])}
    ${lineupFoldHtml("대기 타자", preview[`${side}_bench`])}
    ${note}
    ${checkedText ? `<p class="lineup-source">네이버 스포츠 · ${escapeHtml(checkedText)}</p>` : ""}`;
}

function hasLineupTab(game) {
  const preview = previewOf(game);
  if (!preview) return false;
  return Boolean(preview.away_starter || preview.home_starter
    || (preview.away_lineup && preview.away_lineup.length) || (preview.home_lineup && preview.home_lineup.length));
}

function detailTabHtml(game) {
  if (state.detailTab === "lineup") return lineupPanelHtml(game);
  if (state.detailTab === "score") return `<p>${getGameState(game) === "live" ? "현재 경기 상태를 표시하고 있습니다." : "종료된 경기의 공식 스코어를 표시합니다."}</p>`;
  const details = state.detailTab === "hitter" ? game.hitter_details : game.pitcher_details;
  if (!details || (!details.away?.length && !details.home?.length)) return `<div class="detail-empty">상세 기록이 아직 수집되지 않았습니다.</div>`;
  return [
    statsGroupHtml(game.away, details.away || [], state.detailTab),
    statsGroupHtml(game.home, details.home || [], state.detailTab)
  ].join("");
}

function statsGroupHtml(team, rows, type) {
  if (!rows.length) return "";
  if (type === "hitter") {
    const seenOrders = new Set();
    const cells = rows.map((row) => {
      const order = String(row.order || "");
      const isSubstitute = Boolean(order && seenOrders.has(order));
      if (order) seenOrders.add(order);
      return `<tr><td><strong>${escapeHtml(row.name)}</strong><small class="player-role">${escapeHtml(batterRoleText(row, isSubstitute))}</small>${row.records && row.records !== "-" ? `<small class="player-records">${escapeHtml(row.records)}</small>` : ""}</td><td>${escapeHtml(row.ab ?? "-")}</td><td>${escapeHtml(row.hit ?? "-")}</td><td>${escapeHtml(row.rbi ?? "-")}</td><td>${escapeHtml(row.avg ?? "-")}</td></tr>`;
    }).join("");
    return `<div class="stat-group"><h3>${escapeHtml(team)}</h3><table class="stat-table"><thead><tr><th>선수</th><th>타수</th><th>안타</th><th>타점</th><th>타율</th></tr></thead><tbody>${cells}</tbody></table></div>`;
  }
  return `<div class="stat-group"><h3>${escapeHtml(team)}</h3><table class="stat-table"><thead><tr><th>선수</th><th>결과</th><th>이닝</th><th>투구</th><th>삼진</th><th>실점</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.result || "-")}</td><td>${escapeHtml(row.ip)}</td><td>${escapeHtml(row.np)}</td><td>${escapeHtml(row.so)}</td><td>${escapeHtml(row.er)}</td></tr>`).join("")}</tbody></table></div>`;
}

function friendlyPosition(position) {
  const value = String(position || "").trim();
  const aliases = { P: "투수", C: "포수", "1B": "1루수", "2B": "2루수", "3B": "3루수", SS: "유격수", LF: "좌익수", CF: "중견수", RF: "우익수", DH: "지명타자", "一": "1루수", "二": "2루수", "三": "3루수", 유: "유격수", 좌: "좌익수", 중: "중견수", 우: "우익수", 포: "포수", 지: "지명타자" };
  if (value.startsWith("타")) return aliases[value.slice(1)] || "타자";
  return aliases[value.toUpperCase()] || aliases[value] || value || "포지션 미정";
}

function batterRoleText(row, isSubstitute = false) {
  const order = String(row.order || "").replace(/^\[|\]$/g, "");
  const role = order === "대타" || isSubstitute ? `대타${order && order !== "대타" ? ` (${order})` : ""}` : order || "타순 미정";
  return `${role} · ${friendlyPosition(row.pos)}`;
}

function bindDetailInteractions(game) {
  dom.dialogBody.querySelectorAll("[data-detail-tab]").forEach((button) => button.addEventListener("click", () => {
    state.detailTab = button.dataset.detailTab;
    renderGameDetail(game);
  }));
  dom.dialogBody.querySelectorAll("[data-lineup-team]").forEach((button) => button.addEventListener("click", () => {
    state.detailLineupTeam = button.dataset.lineupTeam;
    renderGameDetail(game);
  }));
  const side = lineupTeamSide(game);
  const team = side === "home" ? game.home : game.away;
  dom.dialogBody.querySelectorAll("[data-player-name]").forEach((button) => button.addEventListener("click", () => {
    const order = button.dataset.playerOrder;
    const position = button.dataset.playerPosition;
    const context = order && position
      ? `<span class="player-context-order">${escapeHtml(order)}</span><strong>${escapeHtml(position)}</strong><span class="player-context-game">${escapeHtml(game.away)} vs ${escapeHtml(game.home)} · ${escapeHtml(game.stadium)}</span>`
      : "";
    openPlayerSheet(team, button.dataset.playerName, button.dataset.playerNo, context);
  }));
}

function updateCountdowns() {
  if (countdownTimer) clearInterval(countdownTimer);
  const update = () => {
    document.querySelectorAll("[data-countdown]").forEach((element) => {
      const diff = new Date(element.dataset.countdown).getTime() - Date.now();
      if (diff <= 0) { element.textContent = element.dataset.countdownLogin === "true" ? "로그인 후 상태 확인" : "예매처 상태 확인 필요"; return; }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      element.textContent = days > 0 ? `${days}일 ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}` : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    });
  };
  update();
  countdownTimer = setInterval(update, 1000);
}

// 지금 화면에 해당하는 주소. 상세가 열려 있으면 그 경기가 주소다.
function currentPath() {
  if (state.selectedGameId && dom.dialog && dom.dialog.open) return `/game/${state.selectedGameId}`;
  if (state.activeView === "team" && (state.viewTeam || state.favoriteTeam)) {
    return `/team/${encodeURIComponent(state.viewTeam || state.favoriteTeam)}`;
  }
  if (state.activeView === "schedule" && state.selectedDate !== toISODate(today)) return `/date/${state.selectedDate}`;
  return state.activeView === "today" ? "/" : `/?view=${state.activeView}`;
}

function syncUrl(push) {
  if (demoMode) return;
  const path = currentPath();
  if (path === location.pathname + location.search) return;
  const entry = { view: state.activeView, gameId: state.selectedGameId, team: state.viewTeam, date: state.selectedDate };
  try {
    if (push) history.pushState(entry, "", path);
    else history.replaceState(entry, "", path);
  } catch (error) {
    console.warn("URL sync failed", error);
  }
}

function setActiveView(view) {
  if (!["today", "schedule", "team", "settings"].includes(view)) return;
  state.activeView = view;
  if (view === "team") fetchRoster();
  document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "auto" });
  syncUrl(true);
}

/* ── 내 팀: 1군 등록 현황과 등록/말소 ────────────────────────────────────── */

const ROSTER_API_URL = "/api/roster";
const TRANSACTION_LABEL = { register: "등록", remove: "말소" };

async function fetchRoster() {
  const team = state.viewTeam || state.favoriteTeam;
  if (!team || demoMode) return;
  if (state.rosterState === "loading") return;
  if (state.roster && state.roster.team === team) return;
  state.rosterState = "loading";
  renderTeam();
  try {
    const response = await fetch(`${ROSTER_API_URL}?team=${encodeURIComponent(team)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.team !== (state.viewTeam || state.favoriteTeam)) return;
    state.roster = payload;
    state.rosterState = "ready";
  } catch (error) {
    console.warn("Roster request failed", error);
    state.rosterState = "error";
  }
  renderTeam();
}

function shortDate(isoDate) {
  const [, month, day] = String(isoDate).split("-");
  return `${Number(month)}/${Number(day)}`;
}

function transactionRowHtml(transaction) {
  const kind = transaction.kind === "remove" ? "remove" : "register";
  return `<li class="tx-row is-${kind}">
      <span class="tx-kind">${escapeHtml(TRANSACTION_LABEL[kind])}</span>
      <span class="tx-no">${escapeHtml(transaction.back_number || "")}</span>
      <strong class="tx-name">${escapeHtml(transaction.player_name)}</strong>
      <span class="tx-pos">${escapeHtml(transaction.position || "")}</span>
    </li>`;
}

function todayChangesHtml(roster) {
  const changes = roster.changes || {};
  const label = formatKoreanDate(today);
  if (Array.isArray(changes.today) && changes.today.length) {
    return `<section class="card team-card">
        <div class="team-card-head"><h2>오늘의 변동</h2><span>${escapeHtml(label)}</span></div>
        <ul class="tx-list">${changes.today.map(transactionRowHtml).join("")}</ul>
      </section>`;
  }
  // 조회한 날인데 0건인 것과 아직 수집하지 않은 것은 다르다. 같게 보여주면 안 된다.
  const body = changes.checked_today
    ? `<p class="team-quiet"><strong>변동 없음</strong>${changes.last_change_on ? `<span>마지막 변동 ${escapeHtml(formatKoreanDate(new Date(changes.last_change_on)))} · ${escapeHtml(changes.last_change_count)}건</span>` : ""}</p>`
    : `<p class="team-quiet"><strong>오늘 기록을 아직 확인하지 못했습니다</strong><span>${roster.last_checked_on ? `마지막 확인 ${escapeHtml(formatKoreanDate(new Date(roster.last_checked_on)))}` : "수집 이력이 없습니다"}</span></p>`;
  return `<section class="card team-card">
      <div class="team-card-head"><h2>오늘의 변동</h2><span>${escapeHtml(label)}</span></div>
      ${body}
    </section>`;
}

function recentChangesHtml(roster) {
  const rest = (roster.transactions || []).filter((transaction) => transaction.occurred_on !== toISODate(today));
  if (!rest.length) return "";
  const byDate = new Map();
  for (const transaction of rest) {
    if (!byDate.has(transaction.occurred_on)) byDate.set(transaction.occurred_on, []);
    byDate.get(transaction.occurred_on).push(transaction);
  }
  const groups = [...byDate.entries()].slice(0, 8).map(([date, items]) => `<div class="tx-group">
      <span class="tx-date">${escapeHtml(shortDate(date))}</span>
      <ul class="tx-list">${items.map(transactionRowHtml).join("")}</ul>
    </div>`).join("");
  return `<section class="card team-card"><div class="team-card-head"><h2>최근 변동</h2><span>최근 30일</span></div>${groups}</section>`;
}

function rosterListHtml(roster) {
  const entries = roster.entries || [];
  if (!entries.length) return "";
  const groups = ["투수", "포수", "내야수", "외야수"].map((position) => {
    const players = entries.filter((entry) => entry.position === position);
    if (!players.length) return "";
    const items = players.map((player) => `<li><span class="tx-no">${escapeHtml(player.back_number || "")}</span><strong>${escapeHtml(player.player_name)}</strong><span class="tx-pos">${escapeHtml(player.bats_throws || "")}</span></li>`).join("");
    return `<details class="lineup-fold"><summary>${escapeHtml(position)}<b>${players.length}명</b></summary><ul class="roster-list">${items}</ul></details>`;
  }).join("");
  return `<section class="card team-card"><div class="team-card-head"><h2>등록 명단</h2></div>${groups}</section>`;
}

function renderTeam() {
  if (!dom.team) return;
  const viewTeam = state.viewTeam || state.favoriteTeam;
  if (!viewTeam) {
    dom.team.innerHTML = `<div class="empty-hero"><h1>응원팀을 선택해 보세요</h1><p>팀을 고르면 1군 등록 현황과 등록·말소 변동을 보여드립니다.</p><button class="primary-button" type="button" data-choose-team>응원팀 선택</button></div>`;
    const button = dom.team.querySelector("[data-choose-team]");
    if (button) button.addEventListener("click", () => setActiveView("settings"));
    return;
  }
  const roster = state.roster && state.roster.team === viewTeam ? state.roster : null;
  if (!roster) {
    dom.team.innerHTML = state.rosterState === "error"
      ? `<div class="empty-hero"><h1>등록 현황을 불러오지 못했습니다</h1><p>잠시 후 다시 시도해 주세요.</p></div>`
      : `<div class="empty-hero"><h1>${escapeHtml(viewTeam)} 등록 현황</h1><p>불러오는 중입니다.</p></div>`;
    return;
  }
  const counts = roster.counts || {};
  const tiles = ["투수", "포수", "내야수", "외야수"].map((position) => `<div class="count-tile"><strong>${escapeHtml(counts[position] ?? 0)}</strong><span>${escapeHtml(position)}</span></div>`).join("");
  dom.team.innerHTML = `
    <header class="team-heading" style="${teamStyle(viewTeam)}">
      <span class="team-dot"></span>
      <h1>${escapeHtml(viewTeam)}</h1>
      <button class="text-button" type="button" data-view="settings">팀 변경</button>
    </header>
    <section class="card team-card">
      <div class="team-card-head"><h2>1군 등록</h2><strong class="roster-total">${escapeHtml(counts.total ?? 0)}<span>명</span></strong></div>
      <div class="count-grid">${tiles}</div>
    </section>
    ${todayChangesHtml(roster)}
    ${recentChangesHtml(roster)}
    ${rosterListHtml(roster)}
    <p class="freshness">KBO 공식 등록 현황${roster.as_of ? ` · ${escapeHtml(roster.as_of)} 기준` : ""}</p>`;
  dom.team.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setActiveView(button.dataset.view)));
}

// 주소로 들어온 경기는 데이터가 도착한 뒤에야 열 수 있다.
function openPendingGame() {
  if (!state.pendingGameId) return;
  const game = state.games.find((item) => item.game_id === state.pendingGameId);
  if (!game) return;
  state.pendingGameId = null;
  openGameDetail(game.game_id);
}

function renderAll() {
  renderNotice();
  renderFavoriteTeam();
  renderNextGame();
  renderToday();
  renderSchedule();
  renderTeam();
  renderIngestionStatus();
  setActiveView(state.activeView);
  openPendingGame();
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setActiveView(button.dataset.view)));
document.getElementById("sidebarTeamButton").addEventListener("click", () => setActiveView("settings"));
document.getElementById("mobileTeamButton").addEventListener("click", () => setActiveView("settings"));
document.getElementById("resetPreferences").addEventListener("click", () => {
  localStorage.removeItem("kbo-favorite-team");
  state.favoriteTeam = null;
  state.hasStoredTeam = false;
  state.teamScope = "all";
  renderAll();
});
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  dom.installApp.hidden = false;
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  dom.installApp.hidden = true;
  dom.refreshStatus.textContent = "앱 설치 완료";
});
dom.installApp.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const choice = await deferredInstallPrompt.userChoice;
  if (choice.outcome === "accepted") dom.refreshStatus.textContent = "앱 설치를 시작했습니다";
  deferredInstallPrompt = null;
  dom.installApp.hidden = true;
});
function renderConnectionStatus() {
  const isOnline = navigator.onLine;
  dom.connectionStatus.textContent = isOnline ? "온라인" : "오프라인 · 저장된 데이터";
  dom.connectionStatus.classList.toggle("is-offline", !isOnline);
}
window.addEventListener("online", renderConnectionStatus);
window.addEventListener("offline", renderConnectionStatus);
renderConnectionStatus();
document.getElementById("teamScopeFilter").addEventListener("click", (event) => {
  const button = event.target.closest("[data-scope]");
  if (!button) return;
  state.teamScope = button.dataset.scope;
  renderSchedule();
});
document.getElementById("venueFilter").addEventListener("click", (event) => {
  const button = event.target.closest("[data-venue]");
  if (!button) return;
  state.venue = button.dataset.venue;
  renderSchedule();
});
document.getElementById("previousPeriod").addEventListener("click", () => {
  state.cursorDate = window.innerWidth >= 960 ? new Date(state.cursorDate.getFullYear(), state.cursorDate.getMonth() - 1, 1) : addDays(state.cursorDate, -7);
  state.selectedDate = toISODate(state.cursorDate);
  renderSchedule();
});
document.getElementById("nextPeriod").addEventListener("click", () => {
  state.cursorDate = window.innerWidth >= 960 ? new Date(state.cursorDate.getFullYear(), state.cursorDate.getMonth() + 1, 1) : addDays(state.cursorDate, 7);
  state.selectedDate = toISODate(state.cursorDate);
  renderSchedule();
});
document.getElementById("currentPeriod").addEventListener("click", () => {
  state.cursorDate = new Date(today);
  state.selectedDate = toISODate(today);
  renderSchedule();
});
document.getElementById("closeDialog").addEventListener("click", () => dom.dialog.close());
dom.dialog.addEventListener("click", (event) => { if (event.target === dom.dialog) dom.dialog.close(); });
// Esc로 닫히는 경우까지 한 곳에서 처리한다.
dom.dialog.addEventListener("close", () => {
  state.selectedGameId = null;
  syncUrl(false);
});

window.addEventListener("popstate", () => {
  const next = parseRoute();
  if (next.gameId) {
    state.pendingGameId = next.gameId;
    openPendingGame();
    return;
  }
  if (dom.dialog.open) dom.dialog.close();
  if (next.team) state.viewTeam = next.team;
  if (next.date) {
    state.selectedDate = next.date;
    state.cursorDate = new Date(`${next.date}T00:00:00`);
  }
  const view = next.view || new URLSearchParams(location.search).get("view") || "today";
  state.activeView = ["today", "schedule", "team", "settings"].includes(view) ? view : "today";
  renderAll();
});
document.getElementById("shareGame").addEventListener("click", async () => {
  const game = state.games.find((item) => item.game_id === state.selectedGameId);
  if (!game) return;
  const text = `${game.date} ${game.away} : ${game.home}`;
  try {
    if (navigator.share) await navigator.share({ title: "KBO GameDay", text, url: location.href });
    else await navigator.clipboard.writeText(`${text} ${location.href}`);
  } catch (error) {
    if (error.name !== "AbortError") console.error("Share failed", error);
  }
});

fetchGames();
liveRefreshTimer = setInterval(refreshLiveData, 60 * 1000);
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("PWA registration failed", error));
dom.refreshNow.addEventListener("click", async () => {
  dom.refreshNow.disabled = true;
  dom.refreshNow.textContent = "갱신 중…";
  dom.refreshStatus.textContent = "최신 경기 데이터를 확인하는 중";
  await fetchGames({ force: true });
  dom.refreshNow.disabled = false;
  dom.refreshNow.textContent = "지금 새로고침";
});
