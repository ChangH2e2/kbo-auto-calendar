import requests
from bs4 import BeautifulSoup
import re
from supabase import create_client
import os
import sys
import datetime

URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "").strip()

VALID_TEAMS = ['KIA', 'KT', 'LG', 'NC', 'SSG', '두산', '롯데', '삼성', '키움', '한화']

def get_kbo_data():
    now = datetime.datetime.now()
    current_year = str(now.year)
    target_months = [str(m).zfill(2) for m in range(3, 12)]
    all_results = []
    
    for current_month in target_months:
        print(f"📡 {current_month}월 데이터 정밀 스캔...")
        api_url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList"
        headers = {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "User-Agent": "Mozilla/5.0"}
        payload = {"leId": "1", "srIdList": "0,1,2,3,4,5,6,7,8,9", "seasonId": current_year, "gameMonth": current_month, "teamId": ""}
        
        try:
            response = requests.post(api_url, data=payload, headers=headers)
            rows = response.json().get('rows', [])
            curr_date = ""
            for item in rows:
                cells = item.get('row', [])
                if not cells: continue
                
                day_cell = next((c for c in cells if c.get('Class') == 'day'), None)
                if day_cell:
                    txt = day_cell.get('Text', '')
                    match = re.search(r'(\d{2})\.(\d{2})', txt)
                    if match: curr_date = f"{match.group(1)}-{match.group(2)}"
                
                if current_month == "03" and curr_date and int(curr_date.split('-')[1]) < 28: continue
                
                # 🚨 시간과 장소를 클래스 이름으로 정확히 추출 (인덱스 버그 방지)
                time_cell = next((c for c in cells if c.get('Class') == 'time'), None)
                time_text = BeautifulSoup(time_cell.get('Text', '18:30'), 'html.parser').get_text(strip=True) if time_cell else "18:30"
                
                stadium_cell = next((c for c in cells if c.get('Class') == 'stadium'), None)
                stadium_name = BeautifulSoup(stadium_cell.get('Text', '미정'), 'html.parser').get_text(strip=True) if stadium_cell else "미정"
                
                remark_raw = cells[-1].get('Text', '')
                is_cancelled = "취소" in remark_raw or "우천" in remark_raw
                
                play_cell = next((c for c in cells if c.get('Class') == 'play'), None)
                if play_cell and curr_date:
                    play_text = play_cell.get('Text', '')
                    soup = BeautifulSoup(play_text, 'html.parser')
                    spans = soup.find_all('span')
                    if len(spans) >= 2:
                        away_team, home_team = spans[0].get_text(strip=True), spans[-1].get_text(strip=True)
                        if away_team not in VALID_TEAMS or home_team not in VALID_TEAMS: continue
                        
                        a_score, h_score = None, None
                        if is_cancelled:
                            # 🚨 '우천취소' 풀네임 적용
                            stadium_name = f"{stadium_name}(우천취소)"
                        else:
                            em_tag = soup.find('em')
                            if em_tag:
                                s_spans = em_tag.find_all('span')
                                if len(s_spans) >= 3:
                                    a_score = int(s_spans[0].get_text(strip=True)) if s_spans[0].get_text(strip=True).isdigit() else None
                                    h_score = int(s_spans[-1].get_text(strip=True)) if s_spans[-1].get_text(strip=True).isdigit() else None

                        all_results.append({
                            "date": f"{current_year}-{curr_date}", "home": home_team, "away": away_team,
                            "home_score": h_score, "away_score": a_score, "stadium": stadium_name, "time": time_text
                        })
        except: continue
    return all_results

if __name__ == "__main__":
    data = get_kbo_data()
    if data and URL and KEY:
        supabase = create_client(URL, KEY)
        supabase.table("kbo_matches").delete().gte("date", "2000-01-01").execute()
        supabase.table("kbo_matches").insert(data).execute()
        print(f"🎉 동기화 완료 ({len(data)}건)")