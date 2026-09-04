# Claude Design 산출물

- 생성 일시: 2026-09-04 KST
- 도구: Claude Design Beta · UI mockups / Hi-fi design
- 프로젝트: [KBO GameDay 목업 세트](https://claude.ai/design/p/0a12651a-0bf9-45c6-9ba6-57a7eee8dc3e?file=KBO+GameDay+%EB%AA%A9%EC%97%85+%EC%84%B8%ED%8A%B8.dc.html)
- 입력: 제품 청사진, 아키텍처, 디자인 브리프, Claude 리뷰 요약, 1차 목업 3종

## 생성 화면

1. [모바일 오늘](mockups/claude-design-mobile-today.png)
   - 다음 경기와 예매 오픈 시각
   - 하루 5경기의 종료·LIVE·취소·연기 상태
2. [모바일 주간 일정](mockups/claude-design-mobile-week.png)
   - 7일 일정, 응원팀/전체 구단과 홈/원정 필터
   - 우천 취소, 순연, 예매 오픈 상태
3. [데스크톱 월간 전체 경기](mockups/claude-design-desktop-month.png)
   - 월간 고밀도 캘린더와 `+2경기` 축약
   - 날짜별 경기 목록과 선택 경기 상세 패널
4. [모바일 12회 연장 경기 상세](mockups/claude-design-mobile-game-detail.png)
   - 원정 왼쪽·홈 오른쪽 규칙
   - 고정 팀명/R·H·E와 가로 스크롤 이닝 영역
   - 결정 투수와 홈런처럼 근거가 있는 공식 기록만 표시

## 적용한 리뷰 원칙

- 원정은 왼쪽, 홈은 오른쪽으로 통일했다.
- 예정은 중립, LIVE는 레드, 종료는 네이비/회색으로 구분했다.
- 취소는 사선, 연기·순연은 점선과 문구를 함께 사용했다.
- 코발트는 선택, 링크, 활성 CTA에 집중했다.
- 라이선스가 필요한 구단 로고 대신 단색 원형 토큰과 팀명을 썼다.
- 현재 수집 데이터로 증명할 수 없는 파생 지표를 제거했다.

## 구현 시 확인할 점

- 목업의 시각·점수·경기 상태는 상태 표현 검증용 가상 데이터다.
- 예매 정보와 선발·중계·기록은 실제 데이터 소스가 확보된 항목만 노출한다.
- 모바일 아트보드는 화면 콘텐츠 390×844에 Claude Design의 아트보드 라벨 영역이 더해진 형태로 추출됐다.
- 이 산출물은 구현 기준 이미지이며, 실제 반응형 UI와 접근성 검증은 별도로 진행한다.
