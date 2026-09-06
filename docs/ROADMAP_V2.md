# KBO GameDay 로드맵 v2 — '누가'의 축을 연다

작성 2026-09-06 · 데이터 소스는 같은 날 실제 호출로 검증함(§1)
**시안 캔버스** https://claude.ai/code/artifact/a1e9f422-2a9b-4633-a6e4-ecc989f798c1 (아트보드 소스: `docs/canvas/*.dc.html`)
**작업 주체** 구현은 Codex에 맡긴다. 이 문서는 설계 확정본이자 Codex 프롬프트 원본이다.

## 0. 요약 판단

**라인업·등말소를 붙이자는 방향은 맞다. 다만 "화면에 슬롯을 하나 더 판다"로 접근하면 실패한다.**

지금 KBO GameDay가 답하는 질문은 **언제 / 어디서 / 어떻게 예매하나**다.
라인업과 등말소는 그 축이 아니라 **누가**라는 새 축이다. 이 축을 열면 세 가지가 따라온다.

1. **매일 다시 올 이유가 생긴다.** 일정은 한 번 보면 일주일치가 끝나지만, 선발 매치업과 라인업은 매일 바뀐다.
2. **`player`라는 엔티티가 처음 생긴다.** 지금 DB에 선수는 `hitter_details` JSON 문자열로만 존재한다. 라인업을 넣는 순간 선수는 조인 가능한 대상이 되고, 그 지점에서 **whoareya의 선수 마스터(약 1,100명 + 레전드 527명)와 붙는다.** 연계는 배너 교환이 아니라 데이터 공유가 본질이다.
3. **예매 → 관전 → 복기의 하루 흐름이 완성된다.** 현재는 예매(경기 전)와 결과(경기 후)만 있고 경기 당일 낮~저녁이 비어 있다.

### 다만 두 기능은 성격이 정반대다 — 같은 방식으로 붙이면 안 된다

| | 라인업 | 등록/말소 |
| --- | --- | --- |
| 변화 주기 | 경기당 1회, 시작 **1~2시간 전** | 하루 단위, 어떤 날은 0건 |
| 유효 수명 | 그 경기 3~4시간 | 다음 변동까지 계속 |
| 자연스러운 자리 | **경기**에 종속 (오늘 화면 / 경기 상세) | **팀**에 종속 (새 화면) |
| 잘못 붙이면 | 하루 22시간 빈 카드 | 캘린더 밀도만 올라가고 안 읽힘 |

→ 라인업은 **오늘 화면의 시간대별 상태 전환**으로, 등말소는 **'내 팀' 화면**으로 간다. §3에서 각각 설계한다.

### 기존 청사진(§10) 대비 순서를 바꾼다

`PRODUCT_BLUEPRINT.md`는 2단계=알림/iCal, 3단계=라인업이었다. **뒤집는다.**

- 라인업·프리뷰는 **엔드포인트 하나를 붙이면 5개 기능이 한꺼번에 열린다**(선발·라인업·불펜·상대전적·순위). 투자 대비 회수가 압도적이다.
- 알림은 푸시 키 관리, 구독 저장소, 발송 워커, 권한 UX, 실패 재시도까지 새 인프라가 통째로 필요한데 **알릴 콘텐츠가 아직 "예매 오픈" 하나뿐**이다. 라인업 공개 알림이 생긴 뒤에 만들면 같은 인프라로 두 배의 값을 한다.

---

## 1. 실측한 데이터 소스 (2026-09-06 직접 호출)

| 소스 | 나오는 것 | 검증 결과 |
| --- | --- | --- |
| `api-gw.sports.naver.com/schedule/games?fromDate&toDate&categoryId=kbo` | 경기 목록 + `gameId` | ✅ 이미 `crawling.py`가 사용 중 |
| `.../schedule/games/{gameId}/preview` | **선발투수(등번호·구질별 구속/비율·상대팀 상대 성적)**, **풀 라인업 10명(타순·포지션)**, **불펜 가용 15명**, **대기 타자 9명**, 양 팀 순위·최근 5경기·시즌 상대전적, 주목 타자 핫/콜드존 | ✅ 200. 경기 전에는 `fullLineUp`에 선발투수 1명만, 발표 후 10명. 9/5 종료 경기에서 10명 확인 |
| `.../schedule/games/{gameId}/lineup` | — | ⚠️ 항상 `lineUpData: null`. **쓰지 말 것** (이름에 속기 쉬움) |
| `.../schedule/games/{gameId}/record` | 결승타·홈런·실책 등 기타 기록 | ✅ 200, 종료 경기 |
| `.../schedule/games/{gameId}/relay` | 문자중계 전문 | ✅ 200 (지금은 범위 밖) |
| `koreabaseball.com/Player/RegisterAll.aspx` | 구단별 1군 등록 현황 | ✅ 200. 단 ASP.NET 포스트백 — **정적 GET은 첫 구단만**. Playwright 필요(whoareya `scrape-kbo-registered.mjs`가 이미 함) |
| `koreabaseball.com/Player/Register.aspx` | **당일 등록/말소 현황** + 구단별 등록 명단(등번호·포지션·투타·생년월일·등록일수) | ✅ 200, "말소된 선수가 없습니다" 문구까지 확인. 포스트백 동일 |
| `koreabaseball.com/Schedule/GameCenter/Main.aspx` | 공식 라인업 (폴백 후보) | 2026-09-06 JS 추적 확인: `LINEUP` 탭 → POST `/Schedule/GameCenter/Preview/LineUp.aspx` → POST `/ws/Schedule.asmx/GetLineUpAnalysis` (`leId`, `srId`, `seasonId`, `gameId`). `data[0][0].LINEUP_CK`가 당일 발표 여부이며 false면 최근 라인업이므로 폴백 시 구분 필수. 이번 P0에서는 구현하지 않음. |
| Supabase `waya_players` (salarycrew) | 선수 마스터: 팀·세부포지션·년생·키·등번호·출신교, KBO 약 1,100명 | 📌 whoareya가 주 1회 갱신. RLS 공개 읽기 열려 있음 |

### 실측에서 나온 데이터 함정 두 가지 (설계에 이미 반영함)

1. **불펜·대기 타자에는 등번호가 없다.** `pitcherBullpen`/`batterCandidate` 항목은 `playerName`·`hitType`·`position`뿐이고 `backnum`이 없다(타순 표에는 있다). 그래서 라인업 화면에서 **등번호 칼럼은 타순 표에만** 두고, 불펜·대기 목록은 이름·투타로만 그린다. 이 구멍을 메우는 것이 P4에서 Who Are Ya 선수 마스터를 붙이는 실질적 이유 중 하나다.
2. **`standings`의 `rank`를 그대로 믿지 말 것.** 2026-09-06 한화·롯데 경기에서 `awayStandings.rank`와 `homeStandings.rank`가 **양쪽 다 8**로 내려왔다(승패는 팀별로 다르게, `name`도 정확하게 왔다). 그래서 시안에서는 순위 뱃지 대신 **승-패-무**를 쓴다. P0에서 여러 경기·여러 날짜로 교차 확인한 뒤에야 순위 표기를 넣는다.

### 소스 리스크 (먼저 정하고 시작할 것)

P0 교차 확인(2026-09-06): 한화-롯데 preview의 rank는 9/4=9·7, 9/5=9·7, 9/6=8·8이었다. 9/6 승패무는 한화 51승65패3무·롯데 51승65패2무이며 rank는 원본 저장만 하고 표시에는 사용하지 않는다.

P0 저장 계약: 양 팀 모두 고유 타순 1~9가 있어야 announced이며 한쪽만 발표되면 starter_only다. 불펜·벤치는 등번호를 생성하지 않고 `{name,hitType,position}`을 저장한다. 최근 경기 목록은 확정 P0 스키마에 컬럼이 없어 이번 저장 대상에서 제외한다.

- **네이버 스포츠 API는 비공개 API다.** 약관상 보장이 없고 언제든 막힐 수 있다. 그래서 ⑴ 수집기는 실패해도 기존 경기 데이터를 절대 훼손하지 않고, ⑵ 화면은 프리뷰가 없어도 완전히 동작하며(빈 상태가 정상 상태), ⑶ **KBO 공식 GameCenter 폴백 경로를 P0에서 함께 조사**해 둔다.
- 표시 문구에 출처를 남긴다. `PRODUCT_BLUEPRINT.md` §11의 "공식 KBO 데이터 이용 조건" 미결정 항목이 여기서 다시 걸린다.
- 스탯티즈는 whoareya에서 이미 배제 결정(로그인 전용·저작권 명시). **여기서도 쓰지 않는다.**

---

## 2. 후보 기능과 우선순위

| # | 기능 | 사용자 가치 | 데이터 비용 | 선행 |
| --- | --- | --- | --- | --- |
| P0 | 프리뷰 수집 파이프라인 | (기반) | 중 | — |
| P1 | 오늘 화면 **선발 매치업** | 높음 — 매일 바뀜 | 낮음 | P0 |
| P2 | 경기 상세 **라인업 탭** | 높음 — 경기 직전 재방문 | 낮음 | P0 |
| P3 | **내 팀** 화면 (등록 현황 + 등말소 타임라인) | 중상 — 코어 팬 전용, 애착 강함 | 중 (Playwright 크론) | — |
| P4 | **선수 프로필** + whoareya 연계 | 중 — 체류·회유 | 낮음 (기존 자산 재사용) | P2, P3 |
| P5 | 알림 / iCal 구독 | 높음 — 단 콘텐츠 축적 후 | 높음 (새 인프라) | P1, P2 |
| P6 | 순위·매직넘버, 구장 날씨 | 중 | 낮음 | P0 |

P0→P1→P2가 한 덩어리다(하나의 수집기, 세 개의 화면). P3는 독립적이라 **P1과 병렬 가능**.

---

## 3. 단계별 설계안

### P0 — 프리뷰 수집 파이프라인 (기반)

**왜 지금**: `preview` 엔드포인트 하나에 P1·P2·P6 재료가 전부 들어 있다. 여기서 정규화를 제대로 해두면 이후는 화면 작업만 남는다.

**수집 주기**: 경기일에만. 경기 시작 6시간 전부터 시작 시각까지 **10분 간격**(기존 `daily_update.yml` 주기에 얹는다). 라인업 발표 시점이 구단마다 달라서(대개 1~2시간 전) 폴링이 유일한 방법이다. 시작 이후에는 프리뷰를 더 부르지 않는다 — 기록은 기존 박스스코어 경로가 담당한다.

**스키마** (`migrations/0010_game_previews.sql`)

```sql
CREATE TABLE IF NOT EXISTS game_previews (
  game_id       TEXT PRIMARY KEY,
  source        TEXT NOT NULL DEFAULT 'naver',
  source_game_id TEXT,
  lineup_state  TEXT NOT NULL CHECK (lineup_state IN ('none','starter_only','announced')),
  away_starter  TEXT,   -- JSON {name,backnum,hitType,era,w,l,vsOpponent:{era,inn,kk,bb},pitches:[{type,speed,rate}]}
  home_starter  TEXT,
  away_lineup   TEXT,   -- JSON [{batorder,position,positionName,name,backnum,batsThrows}]
  home_lineup   TEXT,
  away_bullpen  TEXT,   -- JSON [{name,backnum,hitType}]
  home_bullpen  TEXT,
  away_bench    TEXT,   -- JSON  (batterCandidate)
  home_bench    TEXT,
  away_standing TEXT,   -- JSON {rank,w,l,d,wra,era,hra}
  home_standing TEXT,
  season_vs     TEXT,   -- JSON {awayWin,awayLoss,draw}
  checked_at    TEXT NOT NULL,
  FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_game_previews_checked_at ON game_previews(checked_at);
```

**설계 규칙**
- `lineup_state`는 계산해서 저장한다: `fullLineUp`이 없으면 `none`, 선발투수만 있으면 `starter_only`, `batorder`를 가진 행이 9개면 `announced`. **프런트가 배열 길이를 세게 하지 않는다.**
- 한 번 `announced`가 된 뒤 소스가 비어서 오면 **덮어쓰지 않는다**(네이버가 경기 후 프리뷰를 정리하는 경우 대비). `ARCHITECTURE.md` §4-7의 `source_missing` 원칙과 같은 태도.
- 경기 매칭은 `(date, awayTeamName, homeTeamName)` — 이미 `enrich_with_naver_live`가 쓰는 키다. 더블헤더가 생기면 이 키가 깨지므로 `gameId` 접미(`...02026`)까지 보관해 둔다.
- ingest는 기존 `/api/ingest`와 **같은 `INGEST_TOKEN`**을 쓰되 경로를 나눈다(`/api/preview-ingest`). 프리뷰 수집 실패가 일정 수집을 막으면 안 된다.

**완료 기준**: 오늘 경기 5건에 대해 `starter_only` 행이 생기고, 경기 1시간 전 재실행 시 `announced`로 전이한다. 네이버가 500을 줘도 `games` 테이블은 무변화.

---

### P1 — 오늘 화면: 선발 매치업

**시안 — 모바일 390px, 다음 경기 히어로 카드 확장**

```
┌────────────────────────────────────────┐
│ 다음 경기                        D-DAY │
│                                        │
│    한화              vs         롯데   │
│    ● 4위                       ● 8위   │
│              17:00                     │
│              사직                      │
├────────────────────────────────────────┤
│ 선발 매치업                            │
│                                        │
│  24 화이트          │   31 로드리게스  │
│  우완 · 190cm       │   우완 · 193cm   │
│  ─────────────────  │  ─────────────── │
│  롯데 상대  7.71    │   한화 상대 6.35 │
│  4.2이닝 1패        │   11.1이닝 2패   │
│                                        │
│  직구 148km 42%     │   직구 151km 43% │
├────────────────────────────────────────┤
│ 시즌 상대전적   한화 9승 · 롯데 3승    │
├────────────────────────────────────────┤
│ 라인업은 15:00 전후 공개됩니다         │
│                                        │
│ [        예매하기  →        ]          │
└────────────────────────────────────────┘
```

**상태 전환 — 이 카드의 핵심**

| 시점 | 카드가 보여주는 것 |
| --- | --- |
| D-2 이상 | 지금과 동일 (팀·시각·구장·예매) |
| D-1 ~ 당일 오전 | + 양 팀 순위, 시즌 상대전적, 최근 5경기 폼 |
| 선발 예고 후 | + **선발 매치업 블록** |
| 시작 1~2시간 전 | + "라인업 공개" 배지, 탭하면 상세 라인업 탭으로 |
| 시작 후 | 기존 LIVE 표시로 교체, 선발 블록은 접힘 |
| 종료 | 기존 결과 카드 |

**디자인 규칙** (`DESIGN_BRIEF.md` 준수)
- 선발 이름 20px semibold, 성적 숫자는 tabular. 구질/구속은 13px 보조 텍스트.
- 두 선발 사이 세로 1px 구분선. 좌=원정, 우=홈 — 앱 전역 규칙 유지.
- 팀 컬러는 순위 앞 점만. 카드 배경은 아이보리 유지.
- **성적 우위를 강조하는 색은 쓰지 않는다.** 붉은/푸른 우열 표시는 중계 화면 문법이고 이 앱의 톤이 아니다.
- 프리뷰가 없으면 블록 전체를 렌더하지 않는다. "정보 없음" 자리를 남기지 않는다.

**접근성**: 좌우 2열은 `<dl>` 또는 role=group + 팀명 라벨. 스크린리더에서 "화이트 롯데 상대 7.71" 순으로 읽혀야 한다.

---

### P2 — 경기 상세: 라인업 탭

현재 상세 탭은 `개요 / 타자 / 투수`. **`개요 / 라인업 / 타자 / 투수`로 확장**한다. 라인업 탭은 경기 전에는 예고 라인업, 경기 후에는 실제 출장 기록으로 자연스럽게 의미가 바뀐다 — 탭을 새로 만들지 않고 내용만 전환한다.

**시안 — 라인업 탭 (경기 전)**

```
 개요  │ 라인업 │  타자  │  투수
━━━━━━━━┷━━━━━━━━┷━━━━━━━━┷━━━━━━━
        [ 한화 ]   롯데              ← 팀 토글
        15:12 발표 · 네이버 스포츠

  선발  29  황준서        좌완
 ─────────────────────────────────
  1   유격수   7  심우준    우타
  2   중견수  41  최인호    좌타
  3   좌익수  51  문현빈    좌타
  4   1루수   25  채은성    우타
  ...
  9   포수    32  장규현    좌타

  ▾ 불펜 가용 15명
  ▾ 대기 타자 9명
```

**시안 — 라인업 미발표 상태**

```
        아직 발표되지 않았습니다
     보통 경기 시작 1~2시간 전에 공개됩니다

  선발  29  황준서        좌완   ← 예고된 것만 먼저
```

**설계 규칙**
- 팀 토글의 기본값은 **응원팀**. 응원팀이 이 경기에 없으면 원정팀.
- 불펜/대기 타자는 기본 접힘. 펼치면 등번호 오름차순. 여기가 등말소와 만나는 지점 — P3 이후 "어제 등록" 선수에 작은 뱃지를 붙인다.
- 종료 경기에서는 라인업 탭이 **예고 라인업 대신 박스스코어의 실제 출장 순서**를 쓴다(이미 `hitter_details`에 있다). 예고와 실제가 다르면 그게 오히려 팬이 보고 싶은 정보이므로, 예고 라인업을 지우지 말고 "예고 → 실제" 차이를 접힌 영역에 남긴다.
- 360px에서 가로 스크롤 0. 타순·포지션·등번호·이름·투타 5칸을 grid로 정렬하되 포지션은 2글자(유격/중견/좌익)로 축약.

---

### P3 — '내 팀' 화면: 등록 현황과 등말소

**왜 별도 화면인가**: 등말소는 경기가 아니라 팀에 붙는 정보다. 오늘 화면에 넣으면 경기 없는 날 갈 곳이 없고, 캘린더에 넣으면 밀도가 무너진다. 하단 내비를 `오늘 / 일정 / 내 팀 / 설정` 4탭으로 늘린다.

**시안 — 내 팀 (모바일)**

```
┌────────────────────────────────────────┐
│ 한화 이글스                    ▾ 팀 변경│
│ 리그 4위 · 68승 55패 2무               │
├────────────────────────────────────────┤
│ 1군 등록                         63명  │
│ 투수 30 · 포수 3 · 내야 15 · 외야 15   │
├────────────────────────────────────────┤
│ 오늘의 변동                      9월 6일│
│                                        │
│  ▲ 등록   55  김서현      투수         │
│  ▼ 말소   61  이민우      투수         │
│                                        │
├────────────────────────────────────────┤
│ 최근 변동                              │
│  9/5  ▲ 문동주 투수                    │
│       ▼ 한승혁 투수                    │
│  9/3  ▲ 이진영 외야수                  │
│  8/31 ▼ 김범수 투수                    │
│                          [ 더 보기 ]   │
├────────────────────────────────────────┤
│ 등록 명단                              │
│  투수 ▾   포수 ▾   내야수 ▾   외야수 ▾ │
└────────────────────────────────────────┘
```

**변동 없는 날의 상태** — 이게 대부분이다. 빈 카드 대신:
```
│ 오늘의 변동                      9월 6일│
│  변동 없음                             │
│  마지막 변동 9월 5일 · 2건             │
```

**스키마** (`migrations/0011_roster.sql`)

```sql
CREATE TABLE IF NOT EXISTS roster_entries (
  team_id      TEXT NOT NULL,
  player_name  TEXT NOT NULL,
  back_number  TEXT,
  position     TEXT NOT NULL,          -- 투수/포수/내야수/외야수
  bats_throws  TEXT,
  birth        TEXT,
  registered_days INTEGER,             -- KBO '등록일수'
  as_of        TEXT NOT NULL,
  PRIMARY KEY (team_id, player_name, back_number)
);
CREATE TABLE IF NOT EXISTS roster_transactions (
  id           TEXT PRIMARY KEY,       -- {occurred_on}-{team}-{name}-{kind}
  occurred_on  TEXT NOT NULL,
  team_id      TEXT NOT NULL,
  player_name  TEXT NOT NULL,
  back_number  TEXT,
  position     TEXT,
  kind         TEXT NOT NULL CHECK (kind IN ('register','remove')),
  detected_by  TEXT NOT NULL CHECK (detected_by IN ('official','diff')),
  detected_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roster_tx ON roster_transactions(team_id, occurred_on DESC);
```

**수집 설계 — 여기가 이 단계의 진짜 난이도다**

1. `Player/Register.aspx`의 **당일 등록/말소는 그날만 보여준다.** 하루를 놓치면 그 이력은 영영 복구되지 않는다. → **매일 아침 KST 06:00 크론 + 실패 시 반드시 알림.**
2. 그래서 이중 안전장치를 둔다: `RegisterAll.aspx` 스냅샷(`roster_entries`)을 매일 저장하고, **전일 스냅샷과의 diff로도 등말소를 유추**한다(`detected_by='diff'`). 공식 발표가 잡히면 `official`이 diff 행을 대체한다.
3. ASP.NET 포스트백이라 구단 드롭다운을 순회해야 한다. **whoareya의 `scrape-kbo-registered.mjs`가 이미 이 문제를 푼 코드다 — 새로 짜지 말고 옮겨 온다.** 그 파일의 주석에 남은 함정(빈 검색은 0건, 팀 드롭다운 순회 필수, `setDefaultTimeout` 120초)이 그대로 적용된다.
4. GitHub Actions ubuntu에서 KBO는 해외 IP 차단이 없다(whoareya가 검증함).

**완료 기준**: 10개 구단 전부 `roster_entries`가 채워지고 합계가 실제 등록 인원과 일치. 이틀 연속 수집 후 diff가 공식 등말소와 일치.

---

### P4 — 선수 프로필과 whoareya 연계

여기서 두 사이트가 실제로 붙는다. **배너 교환이 아니라 데이터 교환이 본질**이라는 점을 다시 강조한다.

#### 4-1. 무엇을 주고받나

| 방향 | 주는 것 | 받는 쪽의 이득 |
| --- | --- | --- |
| whoareya → GameDay | `waya_players` 선수 마스터 (년생·키·출신교·세부 포지션·프로필) | 라인업의 이름이 **프로필 카드**가 된다. 재수집 비용 0 |
| GameDay → whoareya | **매일 갱신되는 1군 등록 명단**(P3 산출물) | 정답 풀 신선도가 **주 1회 → 매일**로 올라간다. whoareya 메모의 "퇴단 외국인 유령" 문제도 등말소로 더 빨리 걸린다 |
| GameDay → whoareya | 오늘의 선발·라인업 | "오늘 선발 등판" 뱃지, 데일리 문제 소재 |

**이게 P4의 가장 큰 값이다.** whoareya의 알려진 약점(주 1회 수집이라 반영 지연)을 GameDay의 일일 크론이 그대로 메운다.

#### 4-2. 연결 방식

- GameDay(Cloudflare Pages) → Supabase 공개 읽기(`waya_players`, RLS 읽기 이미 개방). 브라우저에서 직접 부르지 말고 **Pages Function이 프록시 + 캐시**한다(anon 키를 번들에 넣지 않기 위해, 그리고 PostgREST 1000행 캡 페이징을 서버에서 처리하기 위해).
- 선수 매칭 키는 **(팀, 이름, 등번호)**. 동명이인은 등번호로 갈린다. 매칭 실패는 조용히 프로필 없이 렌더한다 — 이름만으로도 라인업은 완성된 정보다.
- 반대 방향(GameDay → whoareya)은 GameDay가 **공개 JSON을 하나 내보내는 것**으로 끝낸다: `/api/roster/registered.json`. whoareya의 `build-players.py`가 그걸 읽어 정답 풀을 만든다. 두 시스템을 결합하지 않고 파일 하나로 느슨하게 잇는다.

#### 4-3. 시안 — 선수 프로필 시트 (라인업에서 이름 탭)

```
┌────────────────────────────────────────┐
│                                   ✕    │
│  51  문현빈                            │
│  한화 이글스 · 외야수 · 좌투좌타        │
│  2004년생 · 174cm                      │
│  북일고 → 한화 (2023)                  │
├────────────────────────────────────────┤
│  오늘  3번 좌익수 선발                 │
│  최근 5경기  타율 .316 · 2홈런 · 6타점 │
├────────────────────────────────────────┤
│  🕹  야구 Who Are Ya 에서 만나기  →     │
└────────────────────────────────────────┘
```

#### 4-4. 시안 — 교차 유입 카드 (경기 종료 후 오늘 화면 하단)

```
┌────────────────────────────────────────┐
│ 오늘 경기가 모두 끝났습니다            │
│                                        │
│ 🕹 야구 Who Are Ya                      │
│    오늘 1군 등록 선수 중 한 명 맞히기   │
│                       [ 하러 가기 → ]  │
└────────────────────────────────────────┘
```

**놓을 자리 원칙**: 경기가 없는 날, 또는 오늘 경기가 전부 끝난 뒤에만 노출한다. 경기 전·중에 게임 링크를 띄우면 앱의 목적을 흐린다.

**역방향**: whoareya `/kbo/` 정답 공개 화면에 "이 선수 오늘 경기 →" 링크. 정답 선수가 오늘 라인업에 있을 때만.

#### 4-5. 운영상 정리해 둘 것

- 두 사이트 모두 로그인이 없다. **공통 식별자를 만들지 말 것** — whoareya의 `waya_cid`를 GameDay가 읽으면 개인정보 처리 범위가 커진다. 지금의 "기기 로컬 저장만" 원칙(`PRODUCT_BLUEPRINT.md` §3-6)을 깨지 않는다.
- CORS: salarycrew 워커에 GameDay 오리진 추가가 필요하다(whoareya 때 games 오리진을 열어 준 것과 같은 작업).
- GA4는 salarycrew 속성(G-PB5T1RP0XG) 공유가 가능하다. 사이트별 분해 카드에 자동으로 잡힌다.

---

### P5 — 알림 / 구독 (콘텐츠가 쌓인 뒤)

P1·P2가 끝나면 알릴 거리가 세 개가 된다: **예매 오픈 / 선발 예고 / 라인업 공개**. 그때 웹 푸시 + iCal을 한 번에 만든다. 지금 만들면 콘텐츠 하나에 인프라 전부를 태우는 셈이다.

- iCal(`/api/calendar/{team}.ics`)은 푸시보다 훨씬 싸고 유지비가 0에 가깝다. **P5 안에서 iCal을 먼저** 낸다.

### P6 — 순위표·매직넘버, 구장 날씨

`preview`의 `standings`가 이미 순위·승패·팀 ERA·팀 타율을 준다(P0에서 이미 저장한다). 별도 수집 없이 '내 팀' 화면 상단과 일정 화면 사이드에 붙일 수 있는 **가장 싼 기능**이다. 9월 이후에는 매직넘버가 그 자체로 재방문 이유가 된다.

---

## 4. 결정이 필요한 항목

1. **하단 내비를 4탭으로 늘릴 것인가** (오늘/일정/내 팀/설정). 대안은 '내 팀'을 설정 안이나 오늘 화면 하위 섹션으로 넣는 것 — 하지만 그러면 P3의 값이 반감된다. **4탭 권장.**
2. **네이버 API 의존을 어디까지 허용할 것인가.** 지금도 `KBO_NAVER_LIVE` 플래그로 쓰고 있지만, 프리뷰까지 가면 핵심 기능이 비공개 API에 묶인다. 최소한 폴백 경로 조사(P0)는 하고 시작한다.
3. **whoareya 데이터를 런타임에 읽을 것인가, 빌드 타임에 동봉할 것인가.** 런타임(Supabase 프록시)이 신선하지만 의존이 하나 늘고, 동봉은 단순하지만 주 1회 수동. **런타임 + 동봉 폴백** 권장 — whoareya가 이미 쓰는 패턴이라 검증돼 있다.
4. 서비스 이름 `KBO GameDay` 확정 (`PRODUCT_BLUEPRINT.md` §11에서 계속 미결).

## 5. 작업 순서 요약

```
P0 프리뷰 수집 ──┬── P1 선발 매치업 ── P2 라인업 탭 ──┐
                 └── P6 순위·매직넘버                 ├── P4 whoareya 연계 ── P5 알림/iCal
P3 로스터·등말소 ─────────────────────────────────────┘
```

P0+P1을 한 세션, P2를 한 세션, P3를 한 세션(병렬 가능), P4를 한 세션으로 끊는다.
스키마·UI 규칙·완료 기준이 §7 프롬프트에 이미 고정돼 있어 탐색 비용이 낮으므로 **중간 수준 추론이면 충분하다.** 두 저장소를 오가는 P4만 한 단계 올린다.
각 단계가 끝나면 배포하고 실제 경기 데이터로 확인한 뒤 다음으로 넘어간다 — 프리뷰·등말소는 **실경기 시간대가 아니면 검증이 안 되는 종류**라 한 번에 몰아서 만들면 전부 미검증 상태로 쌓인다.

---

## 6. 더 먼 관점 — P6 이후에 무엇이 남나

P0~P5는 "누가"라는 축을 여는 작업이다. 그 뒤에 무엇이 남는지를 지금 적어 두는 이유는, **몇 가지 결정이 P0 단계의 스키마와 URL 구조에 이미 영향을 주기 때문**이다.

### 6-1. URL 구조 — 지금 결정해야 할 유일한 장기 항목

지금 GameDay는 **단일 URL SPA**다(`?view=today` 정도). 즉 "한화 경기 일정", "9월 15일 KBO 경기" 같은 검색어로 들어올 입구가 **하나도 없다.**

Who Are Ya에서 이미 같은 문제를 겪고 풀었다 — `/money/`에 게임 다섯 개를 몰아 두었더니 개별 게임 검색으로 들어올 길이 없었고, `/money/hilo·rank·net`으로 쪼개면서 열렸다. 리그별 주소 분리도 같은 이유였다. **GameDay도 같은 처방이 그대로 듣는다.**

- `/team/한화` — 팀 일정 + 다음 경기 + 등록 현황 (P3 화면이 그대로 이 URL의 내용이다)
- `/game/20260906HHLT0` — 경기 상세 (지금은 다이얼로그라 주소가 없다)
- `/date/2026-09-06` — 그날의 전체 경기

**이건 P3·P2의 화면을 만들 때 같이 하면 거의 공짜고, 나중에 하면 라우팅을 다시 짜는 일이 된다.** 그래서 P2·P3 프롬프트에 "화면을 URL로 주소화할 수 있게 렌더 함수를 분리해 둘 것"을 넣었다. 실제 라우팅 구현은 별도 단계로 남기되, **구조를 막지 않는 것**이 지금의 과제다.

우선순위 판단: 트래픽 관점에서는 이것이 P3보다 임팩트가 클 수 있다. 다만 만들 화면이 없으면 주소도 의미가 없으므로 **P2·P3 다음이 자연스럽다.**

### 6-2. 시즌이라는 축

선수 축이 열린 다음에 남는 마지막 축은 **시즌**이다. 9~10월에만 값이 폭발하는 종류의 기능이다.

- 순위표와 매직넘버 (P6, 추가 수집 0)
- 잔여 경기 상대 분포 — "한화는 남은 12경기 중 8경기가 상위권 팀"
- 포스트시즌 진출 시나리오

이 축은 데이터가 이미 다 있고 화면만 남아 있다. **시즌 막바지에 재방문을 만드는 가장 싼 기능군**이라 매년 8월에 꺼내 쓸 수 있다.

### 6-3. 계정을 만들 것인가 — 만든다면 언제

현재 원칙은 "로그인 없이 기기 로컬 저장만"이다(`PRODUCT_BLUEPRINT.md` §3-6). 이 원칙으로 갈 수 있는 최대치는 **iCal 구독과 웹 푸시**까지다(둘 다 계정 없이 동작한다).

그 너머 — 여러 기기 동기화, 즐겨찾는 선수, 알림 이력 — 는 계정이 필요하다. 그리고 그 시점이 오면 **GameDay 혼자 계정 체계를 만들 이유가 없다.** salarycrew·Who Are Ya와 같은 인프라를 쓰는 게 맞다. 지금은 결정하지 않되, **P4에서 두 사이트를 이을 때 공통 식별자를 만들지 않는 것**이 이 선택지를 열어 둔다(반대로, 급하게 만든 기기 ID를 공유해 버리면 나중에 정리 비용이 커진다).

### 6-4. 네이버 의존을 줄이는 작업

P0~P2가 네이버 preview에 크게 기댄다. 장기적으로는 **KBO 공식 GameCenter 경로로 무게중심을 옮기는 것**이 맞다. 지금 당장은 비용 대비 값이 낮아 미루지만, ⑴ P0에서 공식 폴백 경로를 조사해 문서에 남기고, ⑵ `game_previews.source` 칼럼을 두어 소스를 바꿔 끼울 수 있게 한다. 이 두 가지가 장기 이전을 싸게 만드는 준비다.

---

## 7. 실행 프롬프트

각 블록은 **이 저장소 루트에서 Codex를 새로 띄우고 그대로 붙여 넣는 것**을 전제로 쓰였다.
반드시 순서대로 진행하고, 앞 단계가 배포·검증된 뒤 다음으로 넘어간다.
Codex는 이 대화를 모르므로 프롬프트가 자족적이어야 한다 — 검증된 엔드포인트, 스키마 위치, 시안 위치, 완료 기준을 각 블록이 스스로 담고 있다.

---

### 프롬프트 P0 — 프리뷰 수집 파이프라인

```text
docs/ROADMAP_V2.md의 P0을 구현해줘.

목표: 네이버 스포츠 preview 엔드포인트에서 선발투수·라인업·불펜·순위·상대전적을 수집해
D1에 저장하는 파이프라인을 만든다. 화면 작업은 이 단계에 포함하지 않는다.

검증된 소스 (2026-09-06 실측):
  GET https://api-gw.sports.naver.com/schedule/games/{gameId}/preview
  → result.previewData 안에 awayStarter, homeStarter, awayTeamLineUp{fullLineUp,
    pitcherBullpen, batterCandidate}, homeTeamLineUp, awayStandings, homeStandings,
    seasonVsResult, awayTeamPreviousGames, homeTeamPreviousGames
  gameId는 기존 crawling.py의 enrich_with_naver_live가 쓰는 schedule/games 목록에서 얻는다.
  ※ /games/{id}/lineup 은 항상 null이다. 쓰지 말 것.

할 일:
1. migrations/0010_game_previews.sql — docs/ROADMAP_V2.md P0의 스키마 그대로.
2. crawling.py에 collect_previews() 추가.
   - KBO_COLLECT_PREVIEWS=1 환경변수로만 동작 (기존 플래그 패턴과 동일)
   - 대상: 오늘 경기 중 시작 6시간 전 ~ 시작 시각 사이인 것
   - lineup_state 계산: fullLineUp 없음=none, 선발투수만=starter_only,
     batorder 보유 행 9개=announced
   - 이미 announced인 행은 빈 응답으로 덮어쓰지 않는다
   - 실패는 로그만 남기고 기존 경기 수집 결과에 영향을 주지 않는다
3. functions/api/preview-ingest.js — INGEST_TOKEN 인증, upsert, ingestion_runs 기록.
   job_type='preview'.
4. functions/api/games.js — ?include=preview 일 때만 game_previews를 LEFT JOIN해서
   preview 객체를 함께 반환. 기본 응답 모양은 바꾸지 않는다(기존 클라이언트 무영향).
5. .github/workflows/daily_update.yml에 KBO_COLLECT_PREVIEWS=1 추가.
6. tests/previews.test.mjs — 세 가지 lineup_state 전이, announced 보존 규칙,
   네이버 500 응답 시 games 무변화.

추가 조사 (한 가지만, 15분 넘기지 말 것):
  KBO 공식 폴백 경로를 찾아 둔다. koreabaseball.com/Schedule/GameCenter/Main.aspx 의
  '라인업' 탭이 호출하는 ajax 경로 — 정적 HTML에는 없고 /ws/*.asmx 목록에도 안 보인다.
  headless 브라우저(playwright 등)로 네트워크 요청을 찍거나, 페이지 JS 번들을 grep해서
  찾아 docs/ROADMAP_V2.md §1 표의 '확인 필요' 줄을 채워줘. 구현은 하지 않는다.
  못 찾으면 못 찾았다고 그 줄에 적고 넘어간다.

데이터 함정 (실측에서 확인됨, 반드시 반영):
- 불펜(pitcherBullpen)·대기타자(batterCandidate) 항목에는 backnum이 없다.
  playerName / hitType / position 뿐이다. 스키마와 파서가 이를 전제해야 한다.
- awayStandings.rank 와 homeStandings.rank 가 양쪽 다 8로 내려온 사례를 관측했다.
  rank는 저장은 하되 화면에 쓰지 않는다. 승-패-무만 신뢰한다.
  여러 날짜로 교차 확인한 결과를 docs/ROADMAP_V2.md에 한 줄로 남겨줘.

완료 기준: 오늘 경기 전부에 starter_only 행이 생기고, 경기 1시간 전 재실행 시
announced로 전이한다. 테스트 전부 통과.
```

---

### 프롬프트 P1 — 오늘 화면 선발 매치업

```text
docs/ROADMAP_V2.md의 P1을 구현해줘. P0이 배포되어 game_previews에 데이터가 있는 상태를 전제한다.

목표: 오늘 화면의 '다음 경기' 히어로 카드에 선발 매치업·순위·상대전적을 얹고,
경기까지 남은 시간에 따라 카드 내용이 단계적으로 늘어나게 만든다.

시안:
  docs/canvas/Main.dc.html          — 오늘 화면 전체 (모바일 390px)
  docs/canvas/StateTimeline.dc.html — 블록별 등장 시점 (이 설계의 핵심)
  docs/canvas/Desktop.dc.html       — 데스크톱 사이드 패널 버전
  .dc.html은 인라인 스타일로 된 정적 마크업이다. 색·간격·폰트크기를 여기서 그대로 읽어라.
  상태 전환표는 docs/ROADMAP_V2.md P1에 있다.

구현 규칙:
- app.js renderNextGame()을 확장한다. 새 파일을 만들지 말고 기존 렌더 함수 구조를 유지.
- fetchGames를 ?include=preview 로 바꾼다.
- 프리뷰가 없으면 선발 블록 자체를 렌더하지 않는다. "정보 없음" 자리를 남기지 않는다.
- 성적 우열을 색으로 강조하지 않는다 (docs/DESIGN_BRIEF.md의 calm sports utility 톤).
  팀 컬러는 순위 앞 점에만 쓴다.
- 점수·성적 숫자는 tabular-nums.
- 좌=원정 우=홈 전역 규칙 유지.
- 접근성: 좌우 2열을 스크린리더가 팀별로 읽도록 그룹 라벨을 붙인다.
- 360px에서 가로 스크롤 0.

완료 기준: 오늘 경기가 있는 날 실제 데이터로 카드가 렌더되고, 프리뷰를 지운
상태에서도 기존 카드가 그대로 동작한다. 360/390/1440px 확인.
```

---

### 프롬프트 P2 — 경기 상세 라인업 탭

```text
docs/ROADMAP_V2.md의 P2를 구현해줘. P0·P1이 끝난 상태를 전제한다.

목표: 경기 상세 다이얼로그 탭을 개요/타자/투수 → 개요/라인업/타자/투수로 늘리고,
경기 전에는 예고 라인업, 경기 후에는 실제 출장 라인업을 보여준다.

시안:
  docs/canvas/Lineup.dc.html        — 발표 상태
  docs/canvas/LineupPending.dc.html — 미발표 상태
  두 파일의 인라인 스타일이 확정 스펙이다.

구현 규칙:
- 팀 토글 기본값은 응원팀. 응원팀이 그 경기에 없으면 원정팀.
- lineup_state가 'announced'가 아니면 미발표 시안을 렌더한다. 예고된 선발투수는
  있으면 먼저 보여준다.
- 불펜·대기 타자는 기본 접힘, 펼치면 등번호 오름차순.
- 종료 경기: games.hitter_details의 실제 출장 순서를 우선 표시하고,
  예고 라인업과 다르면 "예고와 다름" 접힌 영역에 예고 라인업을 남긴다.
- 포지션은 2글자 축약(유격/중견/좌익/우익/1루/2루/3루/포수/지명).
- 5칸 grid, 360px 가로 스크롤 0.
- 출처와 발표 시각(checked_at)을 탭 하단에 표시한다.
- 불펜·대기 타자에는 등번호가 없다(소스에 없음). 이름·투타·포지션만 그린다.
- 장기 과제 대비: 경기 상세를 나중에 /game/{id} 주소로 뺄 수 있도록 렌더 함수를
  다이얼로그 열기 로직과 분리해 둘 것. 라우팅 구현은 이번 범위가 아니다.

완료 기준: 오늘 경기(발표 전/후)와 어제 종료 경기 양쪽에서 올바른 상태로 렌더.
```

---

### 프롬프트 P3 — 내 팀 화면 (등록 현황·등말소)

```text
docs/ROADMAP_V2.md의 P3를 구현해줘. P0~P2와 독립적이라 병렬 진행 가능하다.

목표: 1군 등록 현황과 등록/말소 이력을 수집하고 '내 팀' 화면을 새로 만든다.
하단 내비를 오늘/일정/내 팀/설정 4탭으로 늘린다.

검증된 소스 (2026-09-06 실측):
  koreabaseball.com/Player/Register.aspx     — 당일 등록/말소 + 구단별 등록 명단
  koreabaseball.com/Player/RegisterAll.aspx  — 구단별 1군 등록 현황
  둘 다 ASP.NET 포스트백이라 정적 GET으로는 첫 구단만 나온다. Playwright로 구단
  드롭다운을 순회해야 한다.

중요 — 새로 짜지 말고 옮겨 올 것:
  ~/moneymap/whoareya/scripts/scrape-kbo-registered.mjs 가 이 문제를 이미 푼 코드다.
  그 파일의 주석에 있는 함정(빈 검색은 0건, 팀 드롭다운 순회 필수,
  setDefaultTimeout 120s / 네비 180s)이 그대로 적용된다.

할 일:
1. migrations/0011_roster.sql — docs/ROADMAP_V2.md P3의 스키마 그대로.
2. scripts/scrape-roster.mjs — 10개 구단 등록 명단 + 당일 등말소 수집.
3. 이중 안전장치: 당일 등말소 공식 발표를 detected_by='official'로,
   전일 roster_entries 스냅샷 diff를 detected_by='diff'로 넣는다.
   official이 잡히면 같은 (날짜,팀,선수)의 diff 행을 대체한다.
   ※ 당일 등말소는 그날만 조회 가능하다. 하루 놓치면 복구 불가이므로
     크론 실패 시 워크플로가 반드시 실패로 끝나게 할 것.
4. functions/api/roster.js — ?team= 로 등록 현황 + 최근 변동 조회.
5. .github/workflows/roster_update.yml — 매일 KST 06:00, ubuntu-latest.
6. app.js·index.html·styles.css — '내 팀' 화면과 4탭 내비.
   시안:
     docs/canvas/MyTeam.dc.html      — 변동이 있는 날
     docs/canvas/MyTeamQuiet.dc.html — 변동 없는 날 (대부분의 날, 문구까지 그대로)
   빈 카드나 스켈레톤 대신 '마지막 변동이 언제였는지'를 보여준다 —
   수집이 멈춘 것과 변동이 없는 것을 사용자가 구분할 수 있어야 한다.
7. 장기 과제 대비: '내 팀' 화면을 나중에 /team/{팀} 주소로 뺄 수 있도록
   팀을 인자로 받는 렌더 함수로 만든다(현재 응원팀은 기본값일 뿐).
   라우팅 구현은 이번 범위가 아니다.

완료 기준: 10개 구단 roster_entries가 채워지고 인원 합계가 KBO 사이트와 일치.
이틀 연속 수집 후 diff 결과가 공식 등말소와 일치.
```

---

### 프롬프트 P4 — whoareya 연계

```text
docs/ROADMAP_V2.md의 P4를 구현해줘. P2와 P3가 끝난 상태를 전제한다.
두 저장소를 오간다 — 이 저장소와 ~/moneymap/whoareya.

목표: 라인업의 선수 이름을 whoareya 선수 마스터와 연결해 프로필 시트를 띄우고,
반대로 GameDay의 일일 등록 명단을 whoareya에 공급한다.
배너 교환이 아니라 데이터 교환이 본질이다.

먼저 읽을 것: ~/.claude/projects/-Users-changee/memory/project-whoareya.md
(Supabase waya_players 구조, RLS, PostgREST 1000행 캡, CORS 이력이 전부 거기 있다)

GameDay 쪽:
1. functions/api/players.js — Supabase waya_players 프록시 + 캐시.
   anon 키는 Pages 환경변수. 브라우저 번들에 넣지 않는다.
   PostgREST 1000행 캡은 서버에서 Range 페이징으로 처리.
2. 매칭 키는 (팀, 이름, 등번호). 매칭 실패는 조용히 프로필 없이 렌더한다.
3. 라인업 탭에서 이름 탭 시 프로필 시트. 시안: docs/canvas/PlayerSheet.dc.html
4. 교차 유입 카드. 시안: docs/canvas/CrossLink.dc.html
   경기가 없는 날 또는 오늘 경기가 전부 끝난 뒤에만 노출한다.
   경기 전·중에는 절대 띄우지 않는다.
   전체 구조는 docs/canvas/DataFlow.dc.html 참고.
5. functions/api/roster/registered.json — 오늘의 1군 등록 명단 공개 JSON.
   whoareya가 읽어 갈 출구다.

whoareya 쪽:
6. build-players.py가 위 JSON을 읽어 정답 풀 신선도를 주 1회 → 매일로 올린다.
   등말소가 잡히면 '퇴단 외국인 유령' 문제도 더 빨리 걸린다.
7. /kbo/ 정답 공개 화면에 "이 선수 오늘 경기 →" 링크. 정답 선수가 오늘 라인업에
   있을 때만 노출.

지켜야 할 선:
- 두 사이트 모두 로그인이 없다. 공통 식별자(waya_cid 등)를 GameDay가 읽지 않는다.
  기기 로컬 저장만 쓰는 현재 원칙을 깨지 않는다.
- salarycrew 워커 CORS에 GameDay 오리진 추가가 필요하다.

완료 기준: 오늘 라인업 18명 중 매칭률 90% 이상, 실패한 이름도 라인업은 정상 렌더.
whoareya 정답 풀이 당일 등록 명단으로 갱신됨을 실제 확인.
```

---

### 프롬프트 P5 · P6 (착수 전 재검토)

P5(알림·iCal)와 P6(순위·매직넘버·날씨)는 P1~P4의 실사용 반응을 본 뒤 프롬프트를 새로 쓴다.
지금 확정된 것은 두 가지뿐이다:

- P5는 **iCal 구독(`/api/calendar/{team}.ics`)을 먼저** 낸다. 푸시보다 싸고 유지비가 0에 가깝다.
- P6의 순위·팀 성적은 **P0에서 이미 저장되므로 추가 수집이 없다.** 화면 작업만 남는다.


### P0 운영 검증 (2026-09-06 13:55 KST)

- migration 0010 및 Pages Functions 운영 배포 완료. GitHub Actions 실행 `34012673328` 성공, `ingestion_runs`에 `job_type=preview`, accepted_count=5 확인.
- 오늘 5건 저장: NC-키움은 이미 announced(양 팀 타순 9명), 삼성-LG / 한화-롯데 / 두산-SSG / KT-KIA는 starter_only. 이미 발표된 경기를 starter_only로 낮춰 저장하지 않는다.
- 기본 `/api/games` 필드 유지 및 `?include=preview`에서만 JSON 객체 반환 확인. Node 14개·Python 10개 테스트 통과.
- 17시 경기의 경기 1시간 전 announced 전이는 아직 실측 대기. 10분 크론으로 재수집하며 발표 전후의 실제 데이터만으로 검증해야 한다.
- KBO 폴백 ajax 경로는 Main.aspx 및 LineUp.aspx의 JS에서 확인했다. GetLineUpAnalysis 직접 POST는 이 실행 환경에서 HTTP 200 HTML을 반환하여 JSON 응답까지는 검증하지 못했다.
