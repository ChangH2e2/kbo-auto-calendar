import requests
from bs4 import BeautifulSoup
import re
from supabase import create_client
import os
import datetime
import time

URL = os.environ.get("SUPABASE_URL", "https://rqdwdortnbpkpipussah.supabase.co").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_72QYev7CliIOdaHVa9caFg_mm19QiZE").strip()
VALID_TEAMS = ['KIA', 'KT', 'LG', 'NC', 'SSG', '두산', '롯데', '삼성', '키움', '한화']

def get_kbo_data():
    now = datetime.datetime.now()
    current_year = str(now.year)
    opening_day = datetime.date(int(current_year), 3, 28)
    all_results = []
    
    for current_month in [str(m).zfill(2) for m in range(3, 12)]:
        api_url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList"
        payload = {"leId": "1", "srIdList": "0", "seasonId": current_year, "gameMonth": current_month, "teamId": ""}
        res = requests.post(api_url, data=payload, headers={"User-Agent": "Mozilla/5.0"})
        rows = res.json().get('rows', [])
        
        curr_date_str = "" # 날짜 유지를 위해 루프 밖에서 선언
        for item in rows:
            cells = item.get('row', [])
            game_id = item.get('G_ID', '')
            
            # 1. 날짜가 있을 때만 업데이트, 없으면 이전 날짜 유지
            day_cell = next((c for c in cells if c.get('Class') == 'day'), None)
            if day_cell:
                txt = day_cell.get('Text', '')
                match = re.search(r'(\d{2})\.(\d{2})', txt)
                if match:
                    m, d = int(match.group(1)), int(match.group(2))
                    if datetime.date(int(current_year), m, d) < opening_day:
                        curr_date_str = ""
                        continue
                    curr_date_str = f"{current_year}-{str(m).zfill(2)}-{str(d).zfill(2)}"
            
            if not curr_date_str: continue # 날짜 정보가 확정되지 않았으면 스킵

            # 2. 장소 추출 (뒤에서 두 번째 셀 방식 적용)
            stadium_cell = next((c for c in cells if c.get('Class') == 'stadium'), None)
            stadium_name = BeautifulSoup(stadium_cell.get('Text', '미정'), 'html.parser').get_text(strip=True) if stadium_cell else BeautifulSoup(cells[-2].get('Text', '미정'), 'html.parser').get_text(strip=True)

            # 3. 팀 정보 추출
            play_cell = next((c for c in cells if c.get('Class') == 'play'), None)
            if play_cell:
                soup = BeautifulSoup(play_cell.get('Text', ''), 'html.parser')
                spans = soup.find_all('span')
                if len(spans) >= 2:
                    away_team, home_team = spans[0].get_text(strip=True), spans[-1].get_text(strip=True)
                    if away_team not in VALID_TEAMS or home_team not in VALID_TEAMS: continue
                    
                    # (이하 점수 및 라인 스코어 추출 로직은 동일)
                    all_results.append({
                        "date": curr_date_str, "home": home_team, "away": away_team,
                        "stadium": stadium_name, "game_id": game_id, # ... 나머지 필드들
                    })
    return all_results