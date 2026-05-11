import requests
from bs4 import BeautifulSoup
import re
from supabase import create_client
import os
import sys
import datetime

URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "").strip()

# 🛡️ 1차 방어막: KBO 10개 구단 (WBC, 평가전 완벽 차단)
VALID_TEAMS = ['KIA', 'KT', 'LG', 'NC', 'SSG', '두산', '롯데', '삼성', '키움', '한화']

def get_kbo_data():
    now = datetime.datetime.now()
    current_year = str(now.year)
    target_months = [str(m).zfill(2) for m in range(3, 12)]
    
    all_results = []
    
    for current_month in target_months:
        print(f"📡 KBO {current_year}년 {current_month}월 데이터 수집 중...")
        api_url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList"
        headers = {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
        }
        
        # 🚨 KBO 서버 오류 방지: 가장 안정적인 "0~9 전체 호출"을 사용합니다.
        payload = {
            "leId": "1", 
            "srIdList": "0,1,2,3,4,5,6,7,8,9", 
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
                        
                        # 🛡️ 1차 방어 작동: 정식 구단이 아니면 무조건 버림! (WBC 제거)
                        if away_team not in VALID_TEAMS or home_team not in VALID_TEAMS:
                            continue
                            
                        # 🛡️ 2차 방어 작동: 시범경기 버림!
                        # (KBO 정규시즌은 무조건 3월 20일 이후에 개막하므로, 3월 초중순 경기는 모두 시범경기로 간주하고 버림)
                        if current_month == "03":
                            day_num = int(curr_date.split('-')[1])
                            if day_num <= 20: 
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
            print(f"⚠️ {current_month}월 처리 중 오류 발생: {e}")
            continue
            
    return all_results

if __name__ == "__main__":
    if not URL or not KEY:
        print("🚨 SUPABASE 설정 에러")
        sys.exit(1)

    try:
        data = get_kbo_data()
        if data:
            supabase = create_client(URL, KEY)
            # 기존의 잘못된 데이터(시범경기 등)를 싹 지우고 깨끗한 데이터만 붓기!
            supabase.table("kbo_matches").delete().neq("id", 0).execute()
            supabase.table("kbo_matches").insert(data).execute()
            print(f"🎉 찌꺼기 완벽 제거! 순수 KBO 데이터 총 {len(data)}건 동기화 완료!")
    except Exception as e:
        print(f"❌ 에러 발생: {e}")
        sys.exit(1)