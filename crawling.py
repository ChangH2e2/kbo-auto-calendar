import requests
import json
from bs4 import BeautifulSoup
import re
from supabase import create_client
import os
import sys

URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "").strip()

def get_kbo_data():
    print("📡 KBO 서버 데이터 분석 중...")
    # ... (생략: 기존 API 호출 및 rows 가져오는 부분) ...
    
    results = []
    curr_date = ""
    for item in rows:
        cells = item.get('row', [])
        if not cells: continue
        
        # 1. 날짜 추출
        day_cell = next((c for c in cells if c.get('Class') == 'day'), None)
        if day_cell:
            txt = day_cell.get('Text', '')
            match = re.search(r'(\d{2})\.(\d{2})', txt)
            if match: curr_date = f"{match.group(1)}-{match.group(2)}"
        
        # 2. 장소(stadium) 추출 - 번호가 아니라 'stadium' 클래스를 직접 찾음
        stadium_cell = next((c for c in cells if c.get('Class') == 'stadium'), None)
        stadium_name = stadium_cell.get('Text', '미정') if stadium_cell else "미정"
        
        # 3. 경기 정보 추출
        play_cell = next((c for c in cells if c.get('Class') == 'play'), None)
        if play_cell and curr_date:
            play_text = play_cell.get('Text', '')
            soup = BeautifulSoup(play_text, 'html.parser')
            
            # 팀명 및 점수 추출
            teams = soup.find_all('script') # 가끔 스크립트 안에 데이터가 숨어있을 수 있음
            # 실제 팀 이름이 적힌 span 태그 확인
            team_spans = soup.find_all('span')
            scores = soup.find_all('em')

            if len(team_spans) >= 2:
                away_team = team_spans[0].get_text(strip=True)
                home_team = team_spans[-1].get_text(strip=True)
                
                h_score = None
                a_score = None
                
                # 우천 취소 여부 확인
                if "우천취소" in play_text:
                    stadium_name = "🚫 우천취소"
                elif len(scores) >= 2:
                    a_txt = scores[0].get_text(strip=True)
                    h_txt = scores[-1].get_text(strip=True)
                    if a_txt.isdigit() and h_txt.isdigit():
                        a_score = int(a_txt)
                        h_score = int(h_txt)

                # 시간 정보 추출
                time_cell = next((c for c in cells if c.get('Class') == 'time'), None)
                game_time = time_cell.get('Text', '18:30') if time_cell else "18:30"

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
        print("🚨 설정 에러")
        sys.exit(1)

    try:
        data = get_kbo_data()
        if data:
            supabase = create_client(URL, KEY)
            # on_conflict를 사용해 날짜/홈/원정이 겹치면 업데이트하도록 설정
            supabase.table("kbo_matches").upsert(data, on_conflict="date,home,away").execute()
            print(f"🎉 {len(data)}건의 데이터 업데이트 완료!")
        else:
            print("🚨 데이터 없음")
    except Exception as e:
        print(f"❌ 에러: {e}")
        sys.exit(1)