import requests
import json
from bs4 import BeautifulSoup
import re
from supabase import create_client
import os
import sys
import datetime # 날짜 계산을 위해 추가!

# 환경 변수 설정
URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "").strip()

def get_kbo_data():
    # 1. 스스로 현재 연도와 월 파악하기
    now = datetime.datetime.now()
    current_year = str(now.year)
    current_month = str(now.month).zfill(2) # 5 -> '05' 로 변환
    
    print(f"📡 KBO 서버 데이터 정밀 분석 중... ({current_year}년 {current_month}월)")
    
    api_url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList"
    headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
    }
    payload = {
        "leId": "1", "srIdList": "0,1,2,3,4,5,6,7,8,9", 
        "seasonId": current_year,     # 동적 연도
        "gameMonth": current_month,   # 동적 월
        "teamId": ""
    }
    
    response = requests.post(api_url, data=payload, headers=headers)
    rows = response.json().get('rows', [])
    
    results = []
    curr_date = ""
    for item in rows:
        cells = item.get('row', [])
        if not cells: continue
        
        day_cell = next((c for c in cells if c.get('Class') == 'day'), None)
        if day_cell:
            txt = day_cell.get('Text', '')
            match = re.search(r'(\d{2})\.(\d{2})', txt)
            if match: curr_date = f"{match.group(1)}-{match.group(2)}"
        
        stadium_cell = next((c for c in cells if c.get('Class') == 'stadium'), None)
        stadium_raw = stadium_cell.get('Text', '미정') if stadium_cell else "미정"
        stadium_name = BeautifulSoup(stadium_raw, 'html.parser').get_text(strip=True)
        
        time_cell = next((c for c in cells if c.get('Class') == 'time'), None)
        time_raw = time_cell.get('Text', '18:30') if time_cell else "18:30"
        game_time = BeautifulSoup(time_raw, 'html.parser').get_text(strip=True)
        
        play_cell = next((c for c in cells if c.get('Class') == 'play'), None)
        if play_cell and curr_date:
            play_text = play_cell.get('Text', '')
            soup = BeautifulSoup(play_text, 'html.parser')
            
            team_spans = soup.find_all('span')
            score_ems = soup.find_all('em')
            
            if len(team_spans) >= 2:
                away_team = team_spans[0].get_text(strip=True)
                home_team = team_spans[-1].get_text(strip=True)
                
                h_score, a_score = None, None
                
                if "취소" in play_text or "우천" in play_text:
                    stadium_name = "🚫 경기취소"
                elif len(score_ems) >= 2:
                    a_txt = score_ems[0].get_text(strip=True)
                    h_txt = score_ems[-1].get_text(strip=True)
                    if a_txt.isdigit() and h_txt.isdigit():
                        a_score = int(a_txt)
                        h_score = int(h_txt)
                        print(f"📊 점수: {away_team} {a_score}:{h_score} {home_team}")

                results.append({
                    "date": f"{current_year}-{curr_date}", # 동적 연도 적용
                    "home": home_team,
                    "away": away_team,
                    "home_score": h_score,
                    "away_score": a_score,
                    "stadium": stadium_name,
                    "time": game_time
                })
    return results

if __name__ == "__main__":
    if not URL or not KEY:
        print("🚨 SUPABASE 설정 에러")
        sys.exit(1)

    try:
        data = get_kbo_data()
        if data:
            supabase = create_client(URL, KEY)
            supabase.table("kbo_matches").upsert(data, on_conflict="date,home,away").execute()
            print(f"🎉 {len(data)}건의 데이터 동기화 완료!")
    except Exception as e:
        print(f"❌ 에러 발생: {e}")
        sys.exit(1)