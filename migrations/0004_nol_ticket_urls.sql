UPDATE ticket_policies
SET vendor_name = 'NOL 인터파크',
    official_url = 'https://nol.yanolja.com/ticket/genre/sports/bears',
    presale_description = 'NOL 통합 공식 경로입니다. 일반 일정 참고값이며 경기별 구단 공지를 우선합니다.',
    verified_at = '2026-09-04'
WHERE team_id = '두산';

UPDATE ticket_policies
SET vendor_name = 'NOL 인터파크',
    official_url = 'https://nol.yanolja.com/ticket/genre/sports/heroes',
    presale_description = '일반예매는 경기일 7일 전 14:00이며 경기별 구단 공지를 우선합니다.',
    general_days_before = 7,
    general_open_time = '14:00',
    verified_at = '2026-09-04'
WHERE team_id = '키움';
