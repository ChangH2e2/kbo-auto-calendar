ALTER TABLE ticket_policies
ADD COLUMN requires_login INTEGER NOT NULL DEFAULT 0 CHECK (requires_login IN (0, 1));

UPDATE ticket_policies
SET requires_login = 1,
    presale_description = '경기별 판매 상태 확인과 예매에 NC 다이노스 회원 로그인이 필요합니다. 경기별 구단 공지를 우선합니다.',
    verified_at = '2026-09-04'
WHERE team_id = 'NC';
