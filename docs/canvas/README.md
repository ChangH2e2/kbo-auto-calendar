# 시안 아트보드

`docs/ROADMAP_V2.md`의 시안 원본. 각 `.dc.html`은 하나의 화면이고, 인라인 스타일이 **확정 스펙**이다 —
색·간격·폰트 크기·굵기를 여기서 그대로 읽어 구현하면 된다. 값은 전부 `styles.css`의 `:root` 토큰에서 온다.

| 파일 | 단계 | 화면 |
| --- | --- | --- |
| `Main.dc.html` | P1 | 오늘 화면 — 선발 매치업 히어로 (390px) |
| `Lineup.dc.html` | P2 | 경기 상세 라인업 탭 — 발표 상태 |
| `LineupPending.dc.html` | P2 | 라인업 탭 — 미발표 상태 |
| `MyTeam.dc.html` | P3 | 내 팀 — 1군 등록과 등말소 |
| `MyTeamQuiet.dc.html` | P3 | 내 팀 — 변동 없는 날 (대부분의 날) |
| `PlayerSheet.dc.html` | P4 | 선수 프로필 시트 |
| `CrossLink.dc.html` | P4 | Who Are Ya 교차 유입 카드 |
| `Desktop.dc.html` | P1·P2 | 데스크톱 일정 + 프리뷰 사이드 패널 (1440px) |
| `StateTimeline.dc.html` | 설계 | 카드 블록이 언제 등장하는가 |
| `DataFlow.dc.html` | 설계 | Who Are Ya와 무엇을 주고받는가 |
| `Roadmap.dc.html` | 설계 | P0~P6 진행 순서 |

캔버스: https://claude.ai/code/artifact/a1e9f422-2a9b-4633-a6e4-ecc989f798c1

`canvas.json`은 캔버스 배치(좌표·페이지·메모)다. 화면 구현에는 필요 없다.

## 시안에 들어간 데이터

2026-09-06 네이버 스포츠 preview를 실제 호출해 받은 값이다(한화-롯데, 사직 17:00).
라인업은 같은 카드의 9/5 경기 실제 예고 라인업이다. 지어낸 숫자는 없다 —
단, `standings.rank`는 양 팀 모두 8로 내려와 신뢰할 수 없어 시안에서 뺐다(`ROADMAP_V2.md` §1 참고).
