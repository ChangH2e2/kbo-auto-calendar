const API_URL = "/api/games";
const TICKET_POLICY_API_URL = "/api/ticket-policies";
const DATA_STALE_AFTER_MS = 8 * 60 * 60 * 1000;

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

const demoMode = new URLSearchParams(location.search).get("demo") === "1";
const today = startOfDay(new Date());
const storedFavoriteTeam = localStorage.getItem("kbo-favorite-team");
const state = {
  games: [],
  favoriteTeam: storedFavoriteTeam || null,
  hasStoredTeam: Boolean(storedFavoriteTeam),
  activeView: window.innerWidth >= 960 ? "schedule" : "today",
  cursorDate: new Date(today),
  selectedDate: toISODate(today),
  selectedGameId: null,
  teamScope: window.innerWidth >= 960 || !storedFavoriteTeam ? "all" : "favorite",
  venue: "all",
  loadedAt: null,
  dataTimestamp: null,
  sourceState: demoMode ? "sample" : "loading",
  ingestionStatus: null,
  ticketRules: { ...DEFAULT_TICKET_RULES },
  detailTab: "score"
};

let countdownTimer = null;
let liveRefreshTimer = null;
let liveRefreshInFlight = false;
let deferredInstallPrompt = null;

const dom = {
  notice: document.getElementById("dataNotice"),
  nextGame: document.getElementById("nextGameMount"),
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
  if (!hasScore) return "scheduled";
  const startedAt = parseGameDate(game);
  const elapsed = Date.now() - startedAt.getTime();
  if (toISODate(startedAt) === toISODate(today) && elapsed >= 0 && elapsed < 5 * 60 * 60 * 1000) return "live";
  return "final";
}

function getStatusText(game) {
  const status = getGameState(game);
  if (status === "cancelled") return game.status_note || "취소";
  if (status === "postponed") return game.status_note || "연기";
  if (status === "live") return `LIVE ${game.inning || "진행 중"}`;
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
  return ticket.isOpen ? "공식 예매처 확인 필요" : "계산 중";
}

function ticketActionText(ticket) {
  return ticket.requiresLogin ? "로그인 후 예매처 확인" : "공식 예매처에서 확인";
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
    state.ingestionStatus = (await response.json()).run || null;
  } catch (error) {
    console.warn("Ingestion status request failed", error);
    state.ingestionStatus = null;
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
    const refreshedGames = rows.map(normalizeGame);
    const refreshedById = new Map(refreshedGames.map((game) => [game.game_id, game]));
    state.games = state.games.map((game) => refreshedById.get(game.game_id) || game);
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
}

function hasLiveRefreshWindow() {
  const now = Date.now();
  return state.games.some((game) => {
    const startsAt = parseGameDate(game).getTime();
    return startsAt - 30 * 60 * 1000 <= now && now <= startsAt + 5 * 60 * 60 * 1000;
  });
}

async function refreshLiveData() {
  if (demoMode || liveRefreshInFlight || !hasLiveRefreshWindow()) return;
  liveRefreshInFlight = true;
  try {
    const response = await fetch(`${API_URL}?from=${encodeURIComponent(toISODate(addDays(today, -2)))}&to=${encodeURIComponent(toISODate(addDays(today, 1)))}`, { cache: "no-store" });
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

function renderIngestionStatus() {
  if (!dom.ingestionStatus) return;
  const run = state.ingestionStatus;
  if (!run) {
    dom.ingestionStatus.textContent = "수집 실행 기록을 확인할 수 없습니다";
    return;
  }
  const finished = run.finished_at ? new Date(run.finished_at) : null;
  const time = finished && !Number.isNaN(finished.getTime()) ? formatTime(finished) : "시간 미상";
  const isDelayed = finished && Date.now() - finished.getTime() > 30 * 60 * 1000;
  dom.ingestionStatus.className = `source-status ${run.status === "success" && !isDelayed ? "is-healthy" : "is-warning"}`;
  dom.ingestionStatus.textContent = run.status === "success" && !isDelayed
    ? `수집 정상 · ${time} · ${run.accepted_count}건 반영`
    : run.status === "success"
      ? `수집 지연 · 마지막 성공 ${time} · 이전 데이터 유지`
      : `수집 실패 · ${time} · 이전 데이터 유지`;
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
  state.favoriteTeam = team;
  state.hasStoredTeam = true;
  localStorage.setItem("kbo-favorite-team", team);
  renderAll();
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
          <span class="starter">${game.away_starter ? `선발 ${escapeHtml(game.away_starter)}` : "선발 미정"}</span>
        </div>
        <span class="matchup-versus">VS</span>
        <div class="team-side home" style="${teamStyle(game.home)}">
          <span class="team-role">홈</span>
          <strong class="team-name">${escapeHtml(game.home)}<span class="team-token"></span></strong>
          <span class="starter">${game.home_starter ? `선발 ${escapeHtml(game.home_starter)}` : "선발 미정"}</span>
        </div>
      </div>
      <div class="game-meta"><strong>${escapeHtml(game.stadium)}</strong>${game.broadcast ? ` / ${escapeHtml(game.broadcast)}` : ""}</div>
      ${ticketPanelHtml(game, ticket)}
    </article>`;
  updateCountdowns();
}

function renderToday() {
  dom.todayDate.textContent = formatKoreanDate(today);
  const games = gamesForDate(toISODate(today), false);
  dom.todayGames.innerHTML = games.length ? `<div class="game-list">${games.map(gameRowHtml).join("")}</div>` : `<div class="day-empty">오늘 예정된 경기가 없습니다.</div>`;
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
    const visible = games.slice(0, 3);
    const day = date.getDay();
    return `
      <div class="calendar-day ${date.getMonth() !== month ? "is-outside" : ""} ${dateString === state.selectedDate ? "is-selected" : ""} ${dateString === toISODate(today) ? "is-today" : ""}" data-date="${dateString}">
        <button class="day-number ${day === 0 ? "sunday" : day === 6 ? "saturday" : ""}" type="button" data-select-date="${dateString}">${date.getDate()}</button>
        ${visible.map(monthChipHtml).join("")}
        ${games.length > 3 ? `<button class="more-games" type="button" data-select-date="${dateString}">+${games.length - 3}경기</button>` : ""}
      </div>`;
  }).join("");
  dom.month.innerHTML = weekdayHeaders + days;
  bindGameButtons(dom.month);
  dom.month.querySelectorAll("[data-select-date]").forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    state.selectedDate = button.dataset.selectDate;
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

function openGameDetail(gameId) {
  const game = state.games.find((item) => item.game_id === gameId);
  if (!game) return;
  state.selectedGameId = gameId;
  state.detailTab = "score";
  renderGameDetail(game);
  if (typeof dom.dialog.showModal === "function") dom.dialog.showModal();
  else dom.dialog.setAttribute("open", "");
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
  if (status === "live") return `${game.inning || "경기 진행 중"} / 점수는 수집 주기에 따라 늦게 반영될 수 있습니다.`;
  if (status === "final") return `${Math.max(splitLine(game.away_line).length, splitLine(game.home_line).length, 9)}회 경기 종료`;
  return game.broadcast ? `중계 ${game.broadcast}` : "경기 시작 전입니다.";
}

function detailContentHtml(game, status) {
  if (status === "scheduled") {
    const ticket = getTicket(game);
    return `<section class="detail-card"><h2>예매 안내</h2><div class="detail-tab-panel">${ticketPanelHtml(game, ticket, { compact: true })}</div></section>`;
  }
  if (["cancelled", "postponed"].includes(status)) return `<section class="detail-card"><div class="detail-tab-panel"><p>${escapeHtml(detailNote(game, status))}</p><p class="detail-empty">새 일정이 확인되면 이 화면에 반영됩니다.</p></div></section>`;
  return `
    ${scoreboardHtml(game)}
    <section class="detail-card">
      <div class="detail-tabs" role="tablist">
        <button class="${state.detailTab === "score" ? "is-active" : ""}" type="button" data-detail-tab="score">요약</button>
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
    <section class="detail-card"><h2>이닝별 득점</h2><div class="score-scroll"><table class="scoreboard"><thead><tr><th class="sticky-team">팀</th>${innings}<th class="total-r">R</th><th class="total-h">H</th><th class="total-e">E</th></tr></thead><tbody>${row(game.away, away, awayTotals)}${row(game.home, home, homeTotals)}</tbody></table></div><p class="score-hint">이닝 영역만 좌우로 스크롤할 수 있습니다.</p></section>`;
}

function detailTabHtml(game) {
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
    return `<div class="stat-group"><h3>${escapeHtml(team)}</h3><table class="stat-table"><thead><tr><th>선수</th><th>타수</th><th>안타</th><th>타점</th><th>타율</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escapeHtml(row.name)}</strong> ${escapeHtml(row.pos || "")}</td><td>${escapeHtml(row.ab)}</td><td>${escapeHtml(row.hit)}</td><td>${escapeHtml(row.rbi)}</td><td>${escapeHtml(row.avg)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  return `<div class="stat-group"><h3>${escapeHtml(team)}</h3><table class="stat-table"><thead><tr><th>선수</th><th>결과</th><th>이닝</th><th>투구</th><th>삼진</th><th>실점</th></tr></thead><tbody>${rows.map((row) => `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.result || "-")}</td><td>${escapeHtml(row.ip)}</td><td>${escapeHtml(row.np)}</td><td>${escapeHtml(row.so)}</td><td>${escapeHtml(row.er)}</td></tr>`).join("")}</tbody></table></div>`;
}

function bindDetailInteractions(game) {
  dom.dialogBody.querySelectorAll("[data-detail-tab]").forEach((button) => button.addEventListener("click", () => {
    state.detailTab = button.dataset.detailTab;
    renderGameDetail(game);
  }));
}

function updateCountdowns() {
  if (countdownTimer) clearInterval(countdownTimer);
  const update = () => {
    document.querySelectorAll("[data-countdown]").forEach((element) => {
      const diff = new Date(element.dataset.countdown).getTime() - Date.now();
      if (diff <= 0) { element.textContent = element.dataset.countdownLogin === "true" ? "로그인 후 상태 확인" : "공식 예매처 확인 필요"; return; }
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

function setActiveView(view) {
  if (!["today", "schedule", "settings"].includes(view)) return;
  state.activeView = view;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === view));
  window.scrollTo({ top: 0, behavior: "auto" });
}

function renderAll() {
  renderNotice();
  renderFavoriteTeam();
  renderNextGame();
  renderToday();
  renderSchedule();
  renderIngestionStatus();
  setActiveView(state.activeView);
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
