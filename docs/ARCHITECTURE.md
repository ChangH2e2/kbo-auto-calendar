# KBO GameDay 아키텍처

## 1. 권장 구조

```text
KBO / 공공데이터 API
        │
        ▼
수집 워커 (Python / GitHub Actions)
  - 일정/상태/스코어 수집
  - 응답 검증 및 정규화
  - 실행 로그 기록
        │ service role, server only
        │ HTTPS + Bearer secret
        ▼
Cloudflare Pages Functions
  /api/ingest (write, secret protected)
  /api/games  (read-only)
        │ D1 binding KBO_DB
        ▼
Cloudflare D1 (SQLite)
  games / game_innings / teams / ticket_policies / ingestion_runs
        │
        ▼
Cloudflare Pages 정적 웹 앱
  - 모바일·데스크톱 반응형 UI
  - 기기별 localStorage 개인화
  - 오류 및 갱신 상태 표시
```

## 2. 기술 선택

### 프런트엔드

- 정적 HTML + vanilla JavaScript
- CSS design system과 접근 가능한 semantic controls
- 모바일 우선 반응형 레이아웃
- 응원팀 설정은 MVP에서 `localStorage`
- 서버 컴포넌트에서 초기 데이터를 읽고 필요한 부분만 클라이언트 상호작용 사용

### 데이터베이스/API

- Cloudflare D1 (SQLite)
- 브라우저는 Pages Function의 읽기 API만 호출
- D1 binding은 Pages 런타임에서만 접근
- ingest API는 `INGEST_TOKEN`으로 보호
- D1 자격증명과 토큰은 브라우저 번들에 포함하지 않음

### 수집 실행

- Python 수집 로직은 프런트엔드와 분리
- 장시간 외부 API 호출 때문에 Edge Function보다 독립 실행 워커를 우선
- 일정·점수 갱신: `.github/workflows/daily_update.yml`
- 최근 상세 기록 보강: `.github/workflows/detail_update.yml` (최근 14일)
- 두 workflow 모두 `/api/ingest`에 upsert하며 실패 시 로그에 원인을 남김

## 3. 데이터 모델

### `public.teams`

- `id text primary key`
- `name_ko text not null`
- `short_name text not null`
- `color_primary text`
- `ticket_vendor_id uuid`

### `public.venues`

- `id uuid primary key`
- `name text not null`
- `city text`
- `timezone text not null default 'Asia/Seoul'`

### `public.games`

- `id text primary key` — KBO game id
- `season integer not null`
- `starts_at timestamptz not null`
- `home_team_id text not null`
- `away_team_id text not null`
- `venue_id uuid`
- `status text not null`
- `home_score smallint`
- `away_score smallint`
- `status_note text`
- `source_updated_at timestamptz`
- `ingested_at timestamptz not null`
- 제약: 홈팀과 원정팀은 달라야 하고 점수는 0 이상

권장 인덱스:

- `(starts_at)`
- `(home_team_id, starts_at)`
- `(away_team_id, starts_at)`
- `(status, starts_at)`

### `public.game_innings`

- `game_id text references games(id)`
- `team_id text references teams(id)`
- `inning smallint`
- `runs smallint`
- 기본키 `(game_id, team_id, inning)`

### `public.player_game_stats`

- `game_id text references games(id)`
- `team_id text`
- `player_name text`
- `role text` — hitter/pitcher
- `batting_order smallint`
- `position text`
- `stats jsonb not null`
- 복합 인덱스 `(game_id, team_id, role)`

MVP에서는 외부 선수 고유 ID의 신뢰도가 확보될 때까지 이름 기반 표시만 하고, 장기 통계 집계에는 사용하지 않는다.

### `public.ticket_policies`

- `team_id text primary key`
- `vendor_name text not null`
- `official_url text not null`
- `general_days_before smallint`
- `general_open_time time`
- `presale_description text`
- `effective_from date not null`
- `effective_to date`
- `verified_at timestamptz not null`

예매 정책을 프런트엔드 코드에서 분리해 시즌 중 변경을 배포 없이 반영한다.

### `private.ingestion_runs`

- `id uuid primary key`
- `job_type text not null`
- `started_at`, `finished_at`
- `status text not null`
- `fetched_count`, `accepted_count`, `rejected_count`
- `error_summary text`
- `source_fingerprint text`

### `private.raw_kbo_responses`

- `id bigint generated always as identity`
- `fetched_at timestamptz not null`
- `endpoint text not null`
- `request_key text`
- `payload jsonb not null`
- 보존 기간을 정하고 주기적으로 삭제

## 4. 안전한 수집 절차

1. 실행 ID를 만들고 `running` 상태를 기록한다.
2. 외부 응답을 원본 테이블에 저장한다.
3. 스키마, 팀명, 경기 ID, 날짜, 점수 범위를 검증한다.
4. 전체 시즌 응답이 비정상적으로 적으면 게시 단계로 넘어가지 않는다.
5. 검증된 행을 staging에 적재한다.
6. 하나의 트랜잭션에서 게임과 상세 기록을 upsert한다.
7. 원본에서 사라진 경기를 즉시 삭제하지 않고 `source_missing`으로 표시한다.
8. 성공 후 실행 로그와 `last_success_at`을 갱신한다.
9. 실패 시 기존 공개 데이터는 그대로 유지한다.

현재 구현의 `DELETE 전체 → INSERT 전체` 방식은 사용하지 않는다.

## 5. 갱신 전략

| 데이터 | 실행 빈도 | 범위 |
| --- | --- | --- |
| 시즌 일정 | 매일 05:30 KST | 현재 시즌 전체 |
| 오늘/내일 경기 상태 | 경기일 5~10분 | 최근 1일~향후 2일 |
| 종료 경기 상세 | 종료 추정 후 10분 간격, 최대 6회 | 해당 경기 |
| 예매 정책 | 운영자 변경 또는 주 1회 검증 | 구단별 |
| 공휴일 | 시즌 시작 전 및 월 1회 | 현재/다음 해 |

중복 실행을 막기 위해 DB advisory lock 또는 작업 ID 기반 잠금을 사용한다. 모든 쓰기는 동일 입력에 같은 결과가 나오는 멱등성을 가져야 한다.

## 6. 읽기 API와 캐시

- 초기 홈 화면: 서버에서 오늘 기준 ±7일 경기 조회
- 일정 화면: 요청한 월의 시작 1주 전부터 다음 달 1주 후까지 조회
- 경기 상세: 게임 ID 단건 + 관련 기록 조회
- 공개 데이터는 짧은 캐시와 재검증을 사용하되 `live` 상태는 캐시 시간을 최소화
- 응답에 `data_updated_at`을 포함해 UI에서 신뢰 상태 표시

## 7. 오류 상태

- 데이터가 있지만 오래됨: 마지막 데이터와 함께 `갱신 지연` 배너 표시
- 데이터가 없음: 빈 달력 대신 복구 안내 표시
- 일부 상세 수집 실패: 기본 경기 정보는 유지하고 상세 탭만 준비 중 표시
- 예매 정책 검증일이 오래됨: 링크는 제공하되 `정보 확인 필요` 표시

## 8. 보안

- 노출 스키마의 모든 테이블에 RLS 활성화
- 공개 역할은 필요한 테이블에 `SELECT`만 명시적으로 부여
- 수집용 키는 서버 환경 변수에만 저장
- 외부 API 키 및 service role 키는 Git 이력에 넣지 않음
- 관리자 기능을 추가할 때 사용자 편집 가능한 metadata를 권한 판단에 사용하지 않음
- `SECURITY DEFINER` 함수는 기본 해법으로 사용하지 않고, 필요 시 private 스키마와 명시적 권한 검증 적용

Supabase의 2026년 변경으로 새 테이블은 Data API에 자동 노출되지 않을 수 있으므로, 마이그레이션에 GRANT와 RLS 정책을 함께 포함한다.

## 9. 관측성과 운영

- 수집 실행 성공률, 처리 행 수, 소요 시간 기록
- 직전 실행 대비 경기 수 급감 감지
- 30분 이상 갱신 지연 시 알림
- 프런트엔드 오류와 API 실패율 수집
- 운영 화면 또는 보호된 상태 API에서 최근 실행 내역 조회

## 10. 저장소 구조 제안

```text
index.html                 Cloudflare Pages 정적 진입점
app.js / styles.css        UI와 도메인 표시 규칙
functions/api/games.js     읽기 API
functions/api/ingest.js    보호된 upsert API
migrations/                D1 스키마
crawling.py                KBO 수집기
docs/                      제품·설계·운영 문서
tests/fixtures/            KBO 응답 고정 샘플 (추가 예정)
```

## 11. 테스트 전략

- 파서 단위 테스트: 예정/종료/취소/연장/더블헤더 응답
- 도메인 테스트: 예매 오픈 시각과 경기 상태 전환
- DB 통합 테스트: 중복 실행, 부분 실패, upsert, RLS
- UI 컴포넌트 테스트: 모든 경기 상태 카드
- 브라우저 E2E: 팀 선택 → 일정 필터 → 상세 → 예매 링크
- 모바일 360px, 390px 및 데스크톱 1440px 시각 회귀

## 12. 구현 순서

1. 고정 fixture와 파서 테스트 구축
2. D1 마이그레이션과 Pages binding 작성
3. 멱등 수집 파이프라인 구현
4. 오늘/일정/상세 읽기 모델 구현
5. 새 UI 구현
6. GitHub Actions 일정/상세 workflow와 실패 알림 연결
7. 실제 데이터로 E2E 및 모바일 QA
