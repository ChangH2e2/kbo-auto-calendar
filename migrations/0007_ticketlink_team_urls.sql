-- Point Ticketlink teams at their official, team-specific mobile schedule pages.
-- These pages remain public and are more useful to users than the generic home page.
UPDATE ticket_policies SET official_url = 'https://m.ticketlink.co.kr/sports/137/62' WHERE team_id = 'KT';
UPDATE ticket_policies SET official_url = 'https://m.ticketlink.co.kr/sports/137/58' WHERE team_id = 'KIA';
UPDATE ticket_policies SET official_url = 'https://m.ticketlink.co.kr/sports/137/57' WHERE team_id = '삼성';
UPDATE ticket_policies SET official_url = 'https://m.ticketlink.co.kr/sports/137/63' WHERE team_id = '한화';
