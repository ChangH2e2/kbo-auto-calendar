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
    """경기 상세 이닝 점수 수집"""
    try:
        url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleLineScore"
        payload = {"gameId": game_id}
        headers = {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "User-Agent": "Mozilla/5.0"}
        res = requests.post(url, data=payload, headers=headers, timeout=5)
        data = res.json()
        h_line = "|".join([str(data.get(f'h{i}', '-')) for i in range(1, 13) if data.get(f'h{i}') is not None])
        a_line = "|".join([str(data.get(f'a{i}', '-')) for i in range(1, 13) if data.get(f'a{i}') is not None])
        h_rheb = f"{data.get('hR',0)}|{data.get('hH',0)}|{data.get('hE',0)}|{data.get('hB',0)}"
        a_rheb = f"{data.get('aR',0)}|{data.get('aH',0)}|{data.get('aE',0)}|{data.get('aB',0)}"
        return h_line, a_line, h_rheb, a_rheb
    except Exception as e:
        print(f"상세 이닝 정보 수집 실패 ({game_id}: {e})")
        return None, None, None, None

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
            continue # 실패하면 다음 달로 넘어감

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
            
            time_cell = next((c for c in cells if c.get('Class') == 'time'), None)
            time_raw = time_cell.get('Text', '18:30') if time_cell else "18:30"
            game_time = BeautifulSoup(time_raw, 'html.parser').get_text(strip=True)

            remark_text = cells[-1].get('Text', '')
            play_cell = next((c for c in cells if c.get('Class') == 'play'), None)
            
            if play_cell:
                play_text = play_cell.get('Text', '')
                
                # 💡 [핵심 추가] 숨겨진 13자리 Game ID 정규식으로 확실하게 추출
                extracted_id = re.search(r'([0-9]{8}[A-Za-z]{4}[0-9])', play_text)
                if extracted_id:
                    game_id = extracted_id.group(1)
 
                soup = BeautifulSoup(play_text, 'html.parser')
                spans = soup.find_all('span')
                if len(spans) >= 2:
                    away_team, home_team = spans[0].get_text(strip=True), spans[-1].get_text(strip=True)
                    if away_team not in VALID_TEAMS or home_team not in VALID_TEAMS: continue
                    
                    h_score, a_score = None, None # 초기값을 None으로 유지
                    h_line, a_line, h_rheb, a_rheb = None, None, None, None
                    is_cancel = "취소" in remark_text or "우천" in remark_text
                    
                    if not is_cancel:
                        em = soup.find('em')
                        # em 태그가 있고 그 안에 숫자가 명확히 있을 때만 점수 기록
                        if em and len(em.find_all('span')) >= 3:
                            try:
                                a_score_val = em.find_all('span')[0].text.strip()
                                h_score_val = em.find_all('span')[-1].text.strip()
                                
                                if a_score_val.isdigit() and h_score_val.isdigit():
                                    a_score = int(a_score_val)
                                    h_score = int(h_score_val)
                                    h_line, a_line, h_rheb, a_rheb = get_line_score(game_id)
                                    time.sleep(0.2)
                            except ValueError:
                                pass # 숫자가 아니면 None 유지

                    all_results.append({
                        "date": full_date, "home": home_team, "away": away_team,
                        "home_score": h_score, "away_score": a_score, "stadium": stadium_name.replace("(우천취소)", ""), 
                        "time": game_time, "game_id": game_id, "home_line": h_line, "away_line": a_line, 
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