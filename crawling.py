import requests
import json
from bs4 import BeautifulSoup
import re
from supabase import create_client
import os
import sys

# 환경 변수 설정
URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "").strip()

def get_kbo_data():
    print("📡 KBO 서버 데이터 정밀 분석 중... (2026년 5월)")
    api_url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList"
    headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
    }
    payload = {
        "leId": "1", "srIdList": "0,1,2,3,4,5,6,7,8,9", 
        "seasonId": "2026", "gameMonth": "05", "teamId": ""
    }
    
    response = requests.post(api_url, data=payload, headers=headers)
    rows = response.json().get('rows', [])
    
    results = []
    curr_date = ""
    for item in rows:
        cells = item.get('row', [])
        if not cells: continue
        
        # 날짜 추출
        day_cell = next((c for c in cells if c.get('Class') == 'day'), None)
        if day_cell:
            txt = day_cell.get('Text', '')
            match = re.search(r'(\d{2})\.(\d{2})', txt)
            if match: curr_date = f"{match.group(1)}-{match.group(2)}"
        
        # 경기장(stadium) 추출 - 클래스 이름으로 검색
        stadium_cell = next((c for c in cells if c.get('Class') == 'stadium'), None)
        stadium_name = stadium_cell.get('Text', '미정') if stadium_cell else "미정"
        
        # 시간(time) 추출
        time_cell = next((c for c in cells if c.get('Class') == 'time'), None)
        game_time = time_cell.get('Text', '18:30') if time_cell else "18:30"
        
        # 경기 내용(play) 추출
        play_cell = next((c for c in cells if c.get('Class') == 'play'), None)
        if play_cell and curr_date:
            play_text = play_cell.get('Text', '')
            soup = BeautifulSoup(play_text, 'html.parser')
            
            team_spans = soup.find_all('span')
            scores = soup.find_all('em')
            
            if len(team_spans) >= 2:
                away_team = team_spans[0].get_text(strip=True)
                home_team = team_spans[-1].get_text(strip=True)
                
                h_score = None
                a_score = None
                
                # 우천취소 처리 및 점수 파싱
                if "우천취소" in play_text:
                    stadium_name = "🚫 우천취소"
                elif len(scores) >= 2:
                    a_txt = scores[0].get_text(strip=True)
                    h_txt = scores[-1].get_text(strip=True)
                    if a_txt.isdigit() and h_txt.isdigit():
                        a_score = int(a_txt)
                        h_score = int(h_txt)

                results.append({
                    "date": f"2026-{curr_date}",
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
            # upsert를 통해 이미 있는 데이터는 업데이트(점수 반영), 없으면 삽입
            supabase.table("kbo_matches").upsert(data, on_conflict="date,home,away").execute()
            print(f"🎉 {len(data)}건의 데이터 동기화 완료!")
    except Exception as e:
        print(f"❌ 에러 발생: {e}")
        sys.exit(1)