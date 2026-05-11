import requests
from bs4 import BeautifulSoup
import re
from supabase import create_client
import os
import datetime
import time

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
            res = requests.get(url, params=params)
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
    now = datetime.datetime.now()
    current_year = str(now.year)
    all_results = []
    holidays = get_holidays(current_year)

    for current_month in [str(m).zfill(2) for m in range(3, 12)]:
        api_url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList"
        payload = {"leId": "1", "srIdList": "0", "seasonId": current_year, "gameMonth": current_month, "teamId": ""}
        res = requests.post(api_url, data=payload, headers={"User-Agent": "Mozilla/5.0"})
        rows = res.json().get('rows', [])
        
        curr_date_only = ""
        for item in rows:
            cells = item.get('row', [])
            game_id = item.get('G_ID', '')
            
            day_cell = next((c for c in cells if c.get('Class') == 'day'), None)
            if day_cell:
                txt = day_cell.get('Text', '')
                match = re.search(r'(\d{2})\.(\d{2})', txt)
                if match: curr_date_only = f"{match.group(1)}-{match.group(2)}"
            
            if not curr_date_only: continue
            # 개막일 필터 (3월 28일)
            if current_month == "03" and int(curr_date_only.split('-')[1]) < 28: continue

            full_date = f"{current_year}-{curr_date_only}"
            stadium_cell = next((c for c in cells if c.get('Class') == 'stadium'), None)
            stadium_name = BeautifulSoup(stadium_cell.get('Text', '미정'), 'html.parser').get_text(strip=True) if stadium_cell else BeautifulSoup(cells[-2].get('Text', '미정'), 'html.parser').get_text(strip=True)
            
            remark_text = cells[-1].get('Text', '')
            play_cell = next((c for c in cells if c.get('Class') == 'play'), None)
            
            if play_cell:
                soup = BeautifulSoup(play_cell.get('Text', ''), 'html.parser')
                spans = soup.find_all('span')
                if len(spans) >= 2:
                    away_team, home_team = spans[0].get_text(strip=True), spans[-1].get_text(strip=True)
                    if away_team not in VALID_TEAMS or home_team not in VALID_TEAMS: continue
                    
                    h_score, a_score = None, None
                    h_line, a_line, h_rheb, a_rheb = None, None, None, None
                    is_cancel = "취소" in remark_text or "우천" in remark_text
                    
                    if not is_cancel:
                        em = soup.find('em')
                        if em:
                            s = em.find_all('span')
                            if len(s) >= 3:
                                a_score, h_score = int(s[0].text), int(s[-1].text)
                                h_line, a_line, h_rheb, a_rheb = get_line_score(game_id)
                                time.sleep(0.05)

                    all_results.append({
                        "date": full_date, "home": home_team, "away": away_team,
                        "home_score": h_score, "away_score": a_score, "stadium": stadium_name.replace("(우천취소)", ""), 
                        "time": "18:30", "game_id": game_id, "home_line": h_line, "away_line": a_line, 
                        "home_rheb": h_rheb, "away_rheb": a_rheb, "is_cancel": is_cancel,
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