import requests
from bs4 import BeautifulSoup
import re
from supabase import create_client
import os
import datetime
import time

# 환경 변수 설정
URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "").strip()
VALID_TEAMS = ['KIA', 'KT', 'LG', 'NC', 'SSG', '두산', '롯데', '삼성', '키움', '한화']

def get_line_score(game_id):
    """경기 상세 이닝 점수 수집"""
    try:
        url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleLineScore"
        payload = {"gameId": game_id}
        headers = {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "User-Agent": "Mozilla/5.0"}
        res = requests.post(url, data=payload, headers=headers)
        data = res.json()
        h_line = "|".join([str(data.get(f'h{i}', '-')) for i in range(1, 13) if data.get(f'h{i}') is not None])
        a_line = "|".join([str(data.get(f'a{i}', '-')) for i in range(1, 13) if data.get(f'a{i}') is not None])
        h_rheb = f"{data.get('hR',0)}|{data.get('hH',0)}|{data.get('hE',0)}|{data.get('hB',0)}"
        a_rheb = f"{data.get('aR',0)}|{data.get('aH',0)}|{data.get('aE',0)}|{data.get('aB',0)}"
        return h_line, a_line, h_rheb, a_rheb
    except:
        return None, None, None, None

def get_kbo_data():
    # [개선] 현재 실행 시점의 연도를 자동으로 가져옴
    now = datetime.datetime.now()
    current_year = str(now.year)
    target_months = [str(m).zfill(2) for m in range(3, 12)]
    all_results = []
    
    for current_month in target_months:
        print(f"📡 {current_year}년 {current_month}월 정규시즌 데이터 수집 중...")
        api_url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList"
        
        # [개선] srIdList를 "0"으로 설정하여 시범경기를 코드 수준에서 제외
        payload = {
            "leId": "1", 
            "srIdList": "0", # 0: 정규시즌, 1: 시범경기
            "seasonId": current_year, 
            "gameMonth": current_month, 
            "teamId": ""
        }
        
        res = requests.post(api_url, data=payload, headers={"User-Agent": "Mozilla/5.0"})
        rows = res.json().get('rows', [])
        
        for item in rows:
            cells = item.get('row', [])
            game_id = item.get('G_ID', '')
            
            day_cell = next((c for c in cells if c.get('Class') == 'day'), None)
            if not day_cell: continue
            
            txt = day_cell.get('Text', '')
            match = re.search(r'(\d{2})\.(\d{2})', txt)
            if not match: continue
            curr_date_str = f"{current_year}-{match.group(1)}-{match.group(2)}"
            
            # [수정] 장소 추출: 'stadium' 클래스가 없으면 뒤에서 두 번째 셀(cells[-2]) 사용
            stadium_cell = next((c for c in cells if c.get('Class') == 'stadium'), None)
            if stadium_cell:
                stadium_name = BeautifulSoup(stadium_cell.get('Text', '미정'), 'html.parser').get_text(strip=True)
            elif len(cells) >= 2:
                stadium_name = BeautifulSoup(cells[-2].get('Text', '미정'), 'html.parser').get_text(strip=True)
            else:
                stadium_name = "장소 미정"

            time_cell = next((c for c in cells if c.get('Class') == 'time'), None)
            time_text = BeautifulSoup(time_cell.get('Text', '18:30'), 'html.parser').get_text(strip=True) if time_cell else "18:30"
            
            play_cell = next((c for c in cells if c.get('Class') == 'play'), None)
            if play_cell:
                soup = BeautifulSoup(play_cell.get('Text', ''), 'html.parser')
                spans = soup.find_all('span')
                if len(spans) >= 2:
                    away_team, home_team = spans[0].get_text(strip=True), spans[-1].get_text(strip=True)
                    if away_team not in VALID_TEAMS or home_team not in VALID_TEAMS: continue
                    
                    h_score, a_score = None, None
                    h_line, a_line, h_rheb, a_rheb = None, None, None, None
                    
                    em = soup.find('em')
                    if em: # 결과가 있는 경기
                        s = em.find_all('span')
                        if len(s) >= 3:
                            a_score, h_score = int(s[0].text), int(s[-1].text)
                            h_line, a_line, h_rheb, a_rheb = get_line_score(game_id)
                            time.sleep(0.05)

                    all_results.append({
                        "date": curr_date_str, "home": home_team, "away": away_team,
                        "home_score": h_score, "away_score": a_score, "stadium": stadium_name, "time": time_text,
                        "game_id": game_id, "home_line": h_line, "away_line": a_line, "home_rheb": h_rheb, "away_rheb": a_rheb
                    })
    return all_results

if __name__ == "__main__":
    data = get_kbo_data()
    if data and URL and KEY:
        supabase = create_client(URL, KEY)
        # 기존 데이터를 유지하거나 특정 연도만 지우고 싶다면 조건을 수정하세요.
        supabase.table("kbo_matches").delete().gte("date", "2000-01-01").execute()
        supabase.table("kbo_matches").insert(data).execute()
        print(f"🎉 정규시즌 데이터 업데이트 완료!")