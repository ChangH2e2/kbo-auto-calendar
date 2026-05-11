import requests
from bs4 import BeautifulSoup
import re
from supabase import create_client
import os
import sys
import datetime

URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "").strip()

# KBO 정식 10개 구단 (여기에 포함 안 된 단어가 팀명에 있으면 무조건 버림)
VALID_TEAMS = ['KIA', 'KT', 'LG', 'NC', 'SSG', '두산', '롯데', '삼성', '키움', '한화']

def is_valid_team(team_name):
    # 팀명에 정규 구단 이름이 포함되어 있는지 엄격하게 검사
    for valid in VALID_TEAMS:
        if valid in team_name:
            return True
    return False

def get_kbo_data():
    now = datetime.datetime.now()
    current_year = str(now.year)
    target_months = [str(m).zfill(2) for m in range(3, 12)]
    
    # KBO API의 꼼수를 막기 위해 명확히 분리 호출
    # "1": 정규시즌 / "4,5,7": 준플, 플옵, 한국시리즈
    # "0"(시범경기), "3"(올스타전) 등은 아예 물어보지도 않음!
    sr_ids_to_fetch = ["1", "4,5,7"] 
    
    all_results = []
    
    for current_month in target_months:
        print(f"📡 KBO {current_year}년 {current_month}월 데이터 수집 중...")
        api_url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList"
        headers = {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
        }
        
        # 정규시즌 한번, 가을야구 한번 따로따로 요청
        for sr_id in sr_ids_to_fetch:
            payload = {
                "leId": "1", 
                "srIdList": sr_id, 
                "seasonId": current_year,
                "gameMonth": current_month,
                "teamId": ""
            }
            
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
                    
                    stadium_raw = cells[-2].get('Text', '미정') if len(cells) >= 2 else "미정"
                    stadium_name = BeautifulSoup(stadium_raw, 'html.parser').get_text(strip=True)
                    
                    time_cell = next((c for c in cells if c.get('Class') == 'time'), None)
                    time_raw = time_cell.get('Text', '18:30') if time_cell else "18:30"
                    game_time = BeautifulSoup(time_raw, 'html.parser').get_text(strip=True)
                    
                    play_cell = next((c for c in cells if c.get('Class') == 'play'), None)
                    if play_cell and curr_date:
                        play_text = play_cell.get('Text', '')
                        soup = BeautifulSoup(play_text, 'html.parser')
                        
                        spans = soup.find_all('span')
                        if len(spans) >= 2:
                            away_team = spans[0].get_text(strip=True)
                            home_team = spans[-1].get_text(strip=True)
                            
                            # 🚨 철벽 방어막: WBC, MLB 평가전, 아마추어 등 싹 다 걸러냄
                            if not is_valid_team(away_team) or not is_valid_team(home_team):
                                print(f"🚫 KBO 정규팀 아님 (제외됨): {away_team} vs {home_team}")
                                continue
                            
                            a_score, h_score = None, None
                            
                            if "취소" in play_text or "우천" in play_text:
                                stadium_name = "🚫 우천취소"
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

                            all_results.append({
                                "date": f"{current_year}-{curr_date}",
                                "home": home_team,
                                "away": away_team,
                                "home_score": h_score,
                                "away_score": a_score,
                                "stadium": stadium_name,
                                "time": game_time
                            })
            except Exception as e:
                print(f"⚠️ 에러 발생: {e}")
                continue
                
    # 🚨 중복 제거 로직 (API 두 번 호출하면서 혹시라도 겹치는 데이터가 생길까 봐 한 번 더 청소)
    unique_results = []
    seen = set()
    for match in all_results:
        identifier = f"{match['date']}_{match['home']}_{match['away']}"
        if identifier not in seen:
            seen.add(identifier)
            unique_results.append(match)

    return unique_results

if __name__ == "__main__":
    if not URL or not KEY:
        print("🚨 SUPABASE 설정 에러")
        sys.exit(1)

    try:
        data = get_kbo_data()
        if data:
            supabase = create_client(URL, KEY)
            # 수파베이스 창고를 완전히 텅텅 비운 뒤에 깨끗한 정규시즌 데이터만 넣음
            supabase.table("kbo_matches").delete().neq("id", 0).execute()
            supabase.table("kbo_matches").insert(data).execute()
            print(f"🎉 찌꺼기 완벽 제거! 순수 KBO 데이터 총 {len(data)}건 동기화 완료!")
    except Exception as e:
        print(f"❌ 에러 발생: {e}")
        sys.exit(1)