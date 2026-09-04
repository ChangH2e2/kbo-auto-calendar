# Cloudflare 배포 메모

현재 구성은 Cloudflare Pages 정적 호스팅 + Pages Functions + D1이다.

- D1 database: `kbo-gameday`
- Database ID: `9a63a8b5-dc70-46e8-b5cb-fc1dd9b9f2a7`
- Pages binding: `KBO_DB`
- API route: `GET /api/games?from=YYYY-MM-DD&to=YYYY-MM-DD`

## Git 연결

Cloudflare Dashboard → Workers & Pages → Create application → Continue with GitHub에서
`ChangH2e2/kbo-auto-calendar`를 선택한다. 빌드 설정은 다음과 같다.

- Framework preset: None
- Build command: 비워두거나 `exit 0`
- Build output directory: `.`

저장소의 `functions/api/games.js`가 자동으로 `/api/games`에 배포되고,
`wrangler.jsonc`의 D1 binding이 `KBO_DB`를 연결한다. 첫 배포 후 Pages 프로젝트
Settings → Functions → D1 database bindings에서 같은 DB를 `KBO_DB` 이름으로
확인한다.

## 마이그레이션

`migrations/0001_initial.sql`은 로컬/CI에서 재현할 수 있는 스키마 원본이다.
현재 Cloudflare 콘솔에서 동일 SQL을 실행해 테이블을 만들었으며, 초기 `teams` 10개도
삽입했다. 운영 데이터는 GitHub Actions가 보호된 ingest API를 통해 D1에 upsert한다.
브라우저에서 `?demo=1`을 사용하면 원본 API와 관계없이 샘플 화면을 확인할 수 있다.

## 다음 운영 작업

`crawling.py`는 `KBO_INGEST_URL`과 `KBO_INGEST_TOKEN`이 모두 있을 때만 보호된 D1
ingest API로 전송한다. 설정이 없으면 성공한 것처럼 종료하지 않고 즉시 실패한다.
D1 자격증명은 브라우저 코드에 넣지 않는다.

일정 수집과 상세 기록 수집은 분리했다. `daily_update.yml`은 빠른 일정·점수 갱신을 담당하고,
`detail_update.yml`은 최근 14일 경기의 이닝·타자·투수 기록만 6시간마다 보강한다.
일정 수집이 상세 필드를 보내지 않아도 ingest upsert는 D1에 이미 저장된 상세 기록과
공휴일명을 유지한다.

Pages 프로젝트 생성 후 환경변수 `INGEST_TOKEN`을 등록하고, GitHub 저장소 Secrets에
`KBO_INGEST_URL` (Pages 주소)와 동일한 토큰인 `KBO_INGEST_TOKEN`을 등록하면 매일
06:00 KST 스케줄이 크롤러 결과를 D1에 upsert한다. 공휴일 표기가 필요하면 공공데이터포털의
새 서비스 키를 `HOLIDAY_API_KEY` Secret으로 추가한다. 이 값이 없어도 경기 수집은 정상 동작한다.
