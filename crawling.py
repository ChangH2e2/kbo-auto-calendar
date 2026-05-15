import requests
from bs4 import BeautifulSoup
import re
from supabase import create_client
import os
import datetime
import time
import json

URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "").strip()
HOLIDAY_API_KEY = "4b4ad3442715e2758dd90b80e40e0a219d74b6ca6f870ad85cdeb8a37709e073"
VALID_TEAMS = ['KIA', 'KT', 'LG', 'NC', 'SSG', '두산', '롯데', '삼성', '키움', '한화']

def get_holidays(year):
    """대체 공휴일을 포함한 공휴일 정보 수집"""
    holidays = {}
    try:
        # 공휴일(getRestDeInfo) API는 대체 공휴일을 포함하여 반환합니다.
        for month in range(3, 12):
            url = "http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo"
            params = {'solYear': year, 'solMonth': str(month).zfill(2), 'ServiceKey': HOLIDAY_API_KEY, '_type': 'json'}
            res = requests.get(url, params=params, timeout=5)
            data = res.json()
            
            body = data.get('response', {}).get('body', {})
            if body and 'items' in body and body['items']:
                item_list = body['items'].get('item', [])
                if isinstance(item_list, dict): item_list = [item_list]
                for h in item_list:
                    # 'locdate'는 20260505 형태
                    locdate = str(h.get('locdate'))
                    f_date = f"{locdate[:4]}-{locdate[4:6]}-{locdate[6:8]}"
                    holidays[f_date] = h.get('dateName')
    except Exception as e:
        print(f"⚠️ 공휴일 데이터 호출 실패: {e}")
    return holidays

def get_line_score(game_id):
    """경기 상세 이닝 점수 및 RHEB 수집 (table2, table3 파싱)"""
    try:
        url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScoreBoardScroll"
        payload = {
            "leId": "1", 
            "srId": "0", 
            "seasonId": game_id[:4], 
            "gameId": game_id
        }
        headers = {"User-Agent": "Mozilla/5.0"}
        res = requests.post(url, data=payload, headers=headers, timeout=5)
        
        if res.status_code != 200:
            return None, None, None, None
            
        data = res.json()
        
        # 1. ⚾️ table2 에서 1~12회 이닝 점수 추출
        table2_str = data.get('table2', '{}')
        t2_dict = json.loads(table2_str) if table2_str else {}
        t2_rows = t2_dict.get('rows', [])
        
        if len(t2_rows) >= 2:
            a_line = "|".join([str(c.get('Text', '-')) for c in t2_rows[0].get('row', [])])
            h_line = "|".join([str(c.get('Text', '-')) for c in t2_rows[1].get('row', [])])
        else:
            a_line, h_line = None, None
            
        # 2. ⚾️ table3 에서 R(득점), H(안타), E(실책), B(볼넷) 추출
        table3_str = data.get('table3', '{}')
        t3_dict = json.loads(table3_str) if table3_str else {}
        t3_rows = t3_dict.get('rows', [])
        
        if len(t3_rows) >= 2:
            a_rheb = "|".join([str(c.get('Text', '-')) for c in t3_rows[0].get('row', [])])
            h_rheb = "|".join([str(c.get('Text', '-')) for c in t3_rows[1].get('row', [])])
        else:
            a_rheb, h_rheb = "-|-|-|-", "-|-|-|-"
            
        return h_line, a_line, h_rheb, a_rheb
        
    except Exception as e:
        print(f"상세 이닝 수집 에러 ({game_id}): {e}")
        return None, None, None, None
    
def get_pitcher_info(game_id):
    """박스스코어 API에서 투수진 정보 추출 (이중 JSON 껍질 제거)"""
    try:
        url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetBoxScoreScroll"
        payload = {"leId": "1", "srId": "0", "seasonId": game_id[:4], "gameId": game_id}
        res = requests.post(url, data=payload, headers={"User-Agent": "Mozilla/5.0"}, timeout=5)
        
        if res.status_code != 200: return None, None
        
        data = res.json()
        pitcher_list = data.get('arrPitcher', [])
        final_pitchers = []

        for p_data in pitcher_list[:2]: # 0: 원정, 1: 홈
            p_dict = json.loads(p_data) if isinstance(p_data, str) else p_data
            table_str = p_dict.get('table', '{}')
            table_data = json.loads(table_str) if isinstance(table_str, str) else table_str
            
            rows = table_data.get('rows', [])
            team_pitchers = []
            for row in rows:
                cells = row.get('row', [])
                if not cells: continue
                name = BeautifulSoup(str(cells[0].get('Text', '')), 'html.parser').get_text(strip=True)
                result = BeautifulSoup(str(cells[2].get('Text', '')), 'html.parser').get_text(strip=True).replace('&nbsp;', '')
                if name and name != "선수명":
                    team_pitchers.append(f"{name}({result})" if result else name)
            final_pitchers.append("|".join(team_pitchers))
            
        # 원정팀 투수진(index 0), 홈팀 투수진(index 1) 반환
        return final_pitchers[0] if len(final_pitchers) > 0 else None, \
               final_pitchers[1] if len(final_pitchers) > 1 else None
    except Exception as e:
        print(f"투수 정보 수집 에러 ({game_id}): {e}")
        return None, None


def get_kbo_data():
    now = datetime.datetime.now()
    current_year = str(now.year)
    all_results = []
    holidays = get_holidays(current_year)

    for current_month in [str(m).zfill(2) for m in range(3, 12)]:
        api_url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList"
        payload = {"leId": "1", "srIdList": "0", "seasonId": current_year, "gameMonth": current_month, "teamId": ""}
        
        try:
            res = requests.post(api_url, data=payload, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
            rows = res.json().get('rows', [])
        except Exception as e:
            print(f"{current_month}월 데이터 호출 실패: {e}")
            continue

        curr_date_only = ""
        for item in rows:
            cells = item.get('row', [])
            
            # 💡 [핵심 해결!] 좁은 칸(play_text)이 아니라 item 전체 문자열에서 Game ID를 싹쓸이로 찾아냅니다!
            extracted_id = re.search(r'([0-9]{8}[A-Za-z]{4}[0-9])', str(item))
            game_id = extracted_id.group(1) if extracted_id else ""
            
            day_cell = next((c for c in cells if c.get('Class') == 'day'), None)
            if day_cell:
                txt = day_cell.get('Text', '')
                match = re.search(r'(\d{2})\.(\d{2})', txt)
                if match: curr_date_only = f"{match.group(1)}-{match.group(2)}"
            
            if not curr_date_only: continue
            if current_month == "03" and int(curr_date_only.split('-')[1]) < 28: continue

            full_date = f"{current_year}-{curr_date_only}"
            stadium_cell = next((c for c in cells if c.get('Class') == 'stadium'), None)
            stadium_name = BeautifulSoup(stadium_cell.get('Text', '미정'), 'html.parser').get_text(strip=True) if stadium_cell else BeautifulSoup(cells[-2].get('Text', '미정'), 'html.parser').get_text(strip=True)
            
            time_cell = next((c for c in cells if c.get('Class') == 'time'), None)
            time_raw = time_cell.get('Text', '18:30') if time_cell else "18:30"
            game_time = BeautifulSoup(time_raw, 'html.parser').get_text(strip=True)

            remark_text = cells[-1].get('Text', '')
            play_cell = next((c for c in cells if c.get('Class') == 'play'), None)
            
            if play_cell:
                play_text = play_cell.get('Text', '')
                soup = BeautifulSoup(play_text, 'html.parser')
                spans = soup.find_all('span')
                
                if len(spans) >= 2:
                    away_team, home_team = spans[0].get_text(strip=True), spans[-1].get_text(strip=True)
                    if away_team not in VALID_TEAMS or home_team not in VALID_TEAMS: continue
                    
                    # 💡 [중요] 변수 초기화 위치: 매 경기마다 새로 초기화해야 데이터가 안 꼬입니다.
                    h_score, a_score = None, None
                    h_line, a_line, h_rheb, a_rheb = None, None, None, None
                    a_pitchers, h_pitchers = None, None # 투수 정보 초기화 추가
                    is_cancel = "취소" in remark_text or "우천" in remark_text
                    
                    if not is_cancel:
                        em = soup.find('em')
                        if em and len(em.find_all('span')) >= 3:
                            try:
                                a_score_val = em.find_all('span')[0].text.strip()
                                h_score_val = em.find_all('span')[-1].text.strip()
                                
                                if a_score_val.isdigit() and h_score_val.isdigit():
                                    a_score = int(a_score_val)
                                    h_score = int(h_score_val)
                                    
                                    # 💡 game_id가 있을 때만 상세 기록 호출
                                    if game_id:
                                        h_line, a_line, h_rheb, a_rheb = get_line_score(game_id)
                                        a_pitchers, h_pitchers = get_pitcher_info(game_id)
                                        time.sleep(0.2)
                            except ValueError:
                                pass

                    # 💡 [해결] 누락되었던 stadium과 time을 다시 추가했습니다!
                    all_results.append({
                        "date": full_date, 
                        "home": home_team, 
                        "away": away_team,
                        "home_score": h_score, 
                        "away_score": a_score, 
                        "stadium": stadium_name, # ✅ 다시 추가
                        "time": game_time,       # ✅ 다시 추가
                        "game_id": game_id,
                        "home_line": h_line, 
                        "away_line": a_line, 
                        "home_rheb": h_rheb, 
                        "away_rheb": a_rheb,
                        "away_pitchers": a_pitchers,
                        "home_pitchers": h_pitchers,
                        "is_cancel": is_cancel,
                        "holiday_name": holidays.get(full_date)
                    })
    return all_results

if __name__ == "__main__":
    data = get_kbo_data()
    if data and URL and KEY:
        supabase = create_client(URL, KEY)
        supabase.table("kbo_matches").delete().gte("date", "2000-01-01").execute()
        supabase.table("kbo_matches").insert(data).execute()
        print(f"🎉 업데이트 완료! (총 {len(data)}건)")