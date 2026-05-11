import requests
from bs4 import BeautifulSoup
import re
from supabase import create_client
import os
import sys
import datetime
import time

URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "").strip()
VALID_TEAMS = ['KIA', 'KT', 'LG', 'NC', 'SSG', '두산', '롯데', '삼성', '키움', '한화']

def get_line_score(game_id):
    """경기 상세 이닝 점수 및 RHEB 수집"""
    try:
        url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleLineScore"
        payload = {"gameId": game_id}
        headers = {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "User-Agent": "Mozilla/5.0"}
        res = requests.post(url, data=payload, headers=headers)
        data = res.json()
        
        # 이닝 점수 (최대 12이닝)
        h_line = "|".join([str(data.get(f'h{i}', '-')) for i in range(1, 13) if data.get(f'h{i}') is not None])
        a_line = "|".join([str(data.get(f'a{i}', '-')) for i in range(1, 13) if data.get(f'a{i}') is not None])
        # R-H-E-B (득점, 안타, 실책, 사사구)
        h_rheb = f"{data.get('hR',0)}|{data.get('hH',0)}|{data.get('hE',0)}|{data.get('hB',0)}"
        a_rheb = f"{data.get('aR',0)}|{data.get('aH',0)}|{data.get('aE',0)}|{data.get('aB',0)}"
        
        return h_line, a_line, h_rheb, a_rheb
    except:
        return None, None, None, None

def get_kbo_data():
    now = datetime.datetime.now()
    current_year = str(now.year)
    target_months = [str(m).zfill(2) for m in range(3, 12)]
    all_results = []
    
    for current_month in target_months:
        print(f"📡 {current_month}월 상세 데이터 포함 수집 중...")
        api_url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList"
        payload = {"leId": "1", "srIdList": "0,1,2,3,4,5,6,7,8,9", "seasonId": current_year, "gameMonth": current_month, "teamId": ""}
        res = requests.post(api_url, data=payload, headers={"User-Agent": "Mozilla/5.0"})
        rows = res.json().get('rows', [])
        
        curr_date = ""
        for item in rows:
            cells = item.get('row', [])
            game_id = item.get('G_ID', '') # 상세 조회를 위한 ID
            
            day_cell = next((c for c in cells if c.get('Class') == 'day'), None)
            if day_cell:
                txt = day_cell.get('Text', '')
                match = re.search(r'(\d{2})\.(\d{2})', txt)
                if match: curr_date = f"{match.group(1)}-{match.group(2)}"
            
            if current_month == "03" and curr_date and int(curr_date.split('-')[1]) < 28: continue
            
            # 클래스명으로 정확하게 시간/장소 추출
            time_cell = next((c for c in cells if c.get('Class') == 'time'), None)
            time_text = BeautifulSoup(time_cell.get('Text', '18:30'), 'html.parser').get_text(strip=True) if time_cell else "18:30"
            
            stadium_cell = next((c for c in cells if c.get('Class') == 'stadium'), None)
            stadium_name = BeautifulSoup(stadium_cell.get('Text', '미정'), 'html.parser').get_text(strip=True) if stadium_cell else "미정"
            
            remark_text = cells[-1].get('Text', '')
            
            play_cell = next((c for c in cells if c.get('Class') == 'play'), None)
            if play_cell and curr_date:
                soup = BeautifulSoup(play_cell.get('Text', ''), 'html.parser')
                spans = soup.find_all('span')
                if len(spans) >= 2:
                    away_team, home_team = spans[0].get_text(strip=True), spans[-1].get_text(strip=True)
                    if away_team not in VALID_TEAMS or home_team not in VALID_TEAMS: continue
                    
                    h_score, a_score = None, None
                    h_line, a_line, h_rheb, a_rheb = None, None, None, None
                    
                    if "취소" in remark_text or "우천" in remark_text:
                        stadium_name = f"{stadium_name}(우천취소)"
                    else:
                        em = soup.find('em')
                        if em:
                            s = em.find_all('span')
                            if len(s) >= 3:
                                a_score, h_score = int(s[0].text), int(s[-1].text)
                                # 종료된 경기 상세 기록 수집
                                h_line, a_line, h_rheb, a_rheb = get_line_score(game_id)
                                time.sleep(0.05)

                    all_results.append({
                        "date": f"{current_year}-{curr_date}", "home": home_team, "away": away_team,
                        "home_score": h_score, "away_score": a_score, "stadium": stadium_name, "time": time_text,
                        "game_id": game_id, "home_line": h_line, "away_line": a_line, "home_rheb": h_rheb, "away_rheb": a_rheb
                    })
    return all_results

if __name__ == "__main__":
    data = get_kbo_data()
    if data and URL and KEY:
        supabase = create_client(URL, KEY)
        supabase.table("kbo_matches").delete().gte("date", "2000-01-01").execute()
        supabase.table("kbo_matches").insert(data).execute()
        print(f"🎉 상세 기록 포함 업데이트 완료!")