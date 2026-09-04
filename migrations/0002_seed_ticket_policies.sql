INSERT INTO ticket_policies
  (team_id, vendor_name, official_url, general_days_before, general_open_time, presale_description, verified_at)
VALUES
  ('LG', '티켓링크', 'https://ticketlink.co.kr/', 7, '11:00', '일반 일정 참고값이며 경기별 구단 공지를 우선합니다.', '2026-09-04'),
  ('두산', '인터파크', 'https://ticket.interpark.com/Contents/Sports/GoodsInfo?SportsCode=07001&TeamCode=PB004', 7, '11:00', '일반 일정 참고값이며 경기별 구단 공지를 우선합니다.', '2026-09-04'),
  ('키움', '인터파크', 'https://ticket.interpark.com/Contents/Sports/GoodsInfo?SportsCode=07001&TeamCode=PB003', 7, '14:00', '일반 일정 참고값이며 경기별 구단 공지를 우선합니다.', '2026-09-04'),
  ('KT', '티켓링크', 'https://ticketlink.co.kr/', 7, '14:00', '일반 일정 참고값이며 경기별 구단 공지를 우선합니다.', '2026-09-04'),
  ('KIA', '티켓링크', 'https://ticketlink.co.kr/', 7, '11:00', '일반 일정 참고값이며 경기별 구단 공지를 우선합니다.', '2026-09-04'),
  ('삼성', '티켓링크', 'https://ticketlink.co.kr/', 7, '11:00', '일반 일정 참고값이며 경기별 구단 공지를 우선합니다.', '2026-09-04'),
  ('한화', '티켓링크', 'https://ticketlink.co.kr/', 7, '11:00', '일반 일정 참고값이며 경기별 구단 공지를 우선합니다.', '2026-09-04'),
  ('NC', 'NC 다이노스', 'https://ticket.ncdinos.com/', 7, '11:00', '일반 일정 참고값이며 경기별 구단 공지를 우선합니다.', '2026-09-04'),
  ('롯데', '롯데 자이언츠', 'https://ticket.giantsclub.com/', 7, '14:00', '일반 일정 참고값이며 경기별 구단 공지를 우선합니다.', '2026-09-04'),
  ('SSG', 'SSG.COM', 'https://ticket.ssg.com/ticket', 7, '11:00', '일반 일정 참고값이며 경기별 구단 공지를 우선합니다.', '2026-09-04')
ON CONFLICT(team_id) DO UPDATE SET
  vendor_name = excluded.vendor_name,
  official_url = excluded.official_url,
  general_days_before = excluded.general_days_before,
  general_open_time = excluded.general_open_time,
  presale_description = excluded.presale_description,
  verified_at = excluded.verified_at;
