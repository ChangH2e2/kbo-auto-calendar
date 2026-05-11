import requests
from bs4 import BeautifulSoup
import re
from supabase import create_client
import os
import sys
import datetime

# 깃허브 액션용 환경변수 세팅
URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "").strip()

def get_kbo_data():
    now = datetime.datetime.now()
    current_year = str(now.year)
    current_month = str(now.month).zfill(2)
    
    print(f"📡 KBO 서버 데이터 정밀 분석 중... ({current_year}년 {current_month}월)")
    
    api_url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList"
    headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
    }
    payload = {
        "leId": "1", "srIdList": "0,1,2,3,4,5,6,7,8,9", 
        "seasonId": current_year,
        "gameMonth": current_month,
        "teamId": ""
    }
    
    response = requests.post(api_url, data=payload, headers=headers)
    rows = response.json().get('rows', [])
    
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
        
        # 2. 장소 추출 (뒤에서 두 번째 칸)
        stadium_raw = cells[-2].get('Text', '미정') if len(cells) >= 2 else "미정"
        stadium_name = BeautifulSoup(stadium_raw, 'html.parser').get_text(strip=True)
        
        # 3. 시간 추출
        time_cell = next((c for c in cells if c.get('Class') == 'time'), None)
        time_raw = time_cell.get('Text', '18:30') if time_cell else "18:30"
        game_time = BeautifulSoup(time_raw, 'html.parser').get_text(strip=True)
        
        # 4. 경기 정보 및 점수 추출
        play_cell = next((c for c in cells if c.get('Class') == 'play'), None)
        if play_cell and curr_date:
            play_text = play_cell.get('Text', '')
            soup = BeautifulSoup(play_text, 'html.parser')
            
            spans = soup.find_all('span')
            if len(spans) >= 2:
                away_team = spans[0].get_text(strip=True)
                home_team = spans[-1].get_text(strip=True)
                
                a_score, h_score = None, None
                
                if "취소" in play_text or "우천" in play_text:
                    stadium_name = "🚫 경기취소"
                else:
                    em_tag = soup.find('em')
                    if em_tag:
                        score_spans = em_tag.find_all('span')
                        if len(score_spans) >= 3:
                            a_txt = score_spans[0].get_text(strip=True)
                            h_txt = score_spans[-1].get_text(strip=True)
                            if a_txt.isdigit() and h_txt.isdigit():
                                a_score = int(a_txt)
                                h_score = int(h_txt)
                                print(f"📊 스코어 획득: {away_team} {a_score} : {h_score} {home_team} ({stadium_name})")

                results.append({
                    "date": f"{current_year}-{curr_date}",
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
        print("🚨 SUPABASE 설정 에러 (GitHub Secrets 확인 필요)")
        sys.exit(1)

    try:
        data = get_kbo_data()
        if data:
            supabase = create_client(URL, KEY)
            # 기존 데이터 싹 날리고 완벽한 새 데이터로 덮어쓰기!
            supabase.table("kbo_matches").delete().neq("id", 0).execute()
            supabase.table("kbo_matches").insert(data).execute()
            print(f"🎉 총 {len(data)}건의 데이터 동기화 완료!")
    except Exception as e:
        print(f"❌ 에러 발생: {e}")
        sys.exit(1)