UPDATE ticket_policies
SET requires_login = 1,
    general_days_before = 14,
    general_open_time = '14:00',
    presale_description = '일반예매는 시리즈 2주 전 수·금 14:00부터이며 비회원 예매는 불가합니다. 경기별 구단 공지를 우선합니다.',
    verified_at = '2026-09-04'
WHERE team_id = '롯데';
