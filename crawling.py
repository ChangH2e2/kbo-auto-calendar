import requests
from bs4 import BeautifulSoup
import re
import os
import datetime
import time
import json

HOLIDAY_API_KEY = os.environ.get("HOLIDAY_API_KEY", "").strip()
VALID_TEAMS = ['KIA', 'KT', 'LG', 'NC', 'SSG', '두산', '롯데', '삼성', '키움', '한화']
KBO_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://www.koreabaseball.com/Schedule/Schedule.aspx",
    "X-Requested-With": "XMLHttpRequest",
    "Accept": "application/json, text/javascript, */*; q=0.01",
}
COLLECT_DETAILS = os.environ.get("KBO_COLLECT_DETAILS", "0") == "1"
DETAIL_WINDOW_DAYS = int(os.environ.get("KBO_DETAIL_WINDOW_DAYS", "14"))
NAVER_LIVE = os.environ.get("KBO_NAVER_LIVE", "0") == "1"
KST = datetime.timezone(datetime.timedelta(hours=9))

def korea_today():
    return datetime.datetime.now(KST).date()

def fixed_holidays(year):
    """API 키가 없어도 표시할 수 있는 양력 법정 공휴일의 최소 목록."""
    return {
        f"{year}-01-01": "신정",
        f"{year}-03-01": "삼일절",
        f"{year}-05-05": "어린이날",
        f"{year}-06-06": "현충일",
        f"{year}-08-15": "광복절",
        f"{year}-10-03": "개천절",
        f"{year}-10-09": "한글날",
        f"{year}-12-25": "성탄절",
    }

def get_holidays(year):
    """대체 공휴일을 포함한 공휴일 정보 수집"""
    holidays = fixed_holidays(year)
    if not HOLIDAY_API_KEY:
        print("ℹ️ HOLIDAY_API_KEY가 없어 양력 공휴일 기본 목록만 사용합니다.")
        return holidays

    # 공휴일(getRestDeInfo) API는 대체 공휴일을 포함하여 반환합니다.
    for month in range(3, 12):
        try:
            url = "http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo"
            params = {'solYear': year, 'solMonth': str(month).zfill(2), 'ServiceKey': HOLIDAY_API_KEY, '_type': 'json'}
            res = requests.get(url, params=params, timeout=5)
            res.raise_for_status()
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
            print(f"⚠️ {month}월 공휴일 데이터 호출 실패: {e}")
    return holidays


def should_collect_details(game_date, today=None):
    """종료된 최근 경기만 상세 API 수집 대상으로 제한합니다."""
    today = today or korea_today()
    age_days = (today - datetime.date.fromisoformat(game_date)).days
    return 0 <= age_days <= DETAIL_WINDOW_DAYS

def fallback_game_id(game_date, away_team, home_team):
    """KBO가 ID를 주지 않는 취소 행도 일정에서 식별할 수 있게 한다."""
    return f"{game_date.replace('-', '')}-{away_team}-{home_team}-noid"

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
        res = requests.post(url, data=payload, headers={**KBO_HEADERS, **headers}, timeout=5)
        
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
    
def get_boxscore_details(game_id):
    """박스스코어 API에서 타자/투수 상세 기록을 JSON 형태로 완벽 추출"""
    url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetBoxScoreScroll"
    payload = {"leId": "1", "srId": "0", "seasonId": game_id[:4], "gameId": game_id}
    headers = {"User-Agent": "Mozilla/5.0"}
    
    try:
        res = requests.post(url, data=payload, headers={**KBO_HEADERS, **headers}, timeout=5)
        data = res.json()
    except Exception as e:
        print(f"박스스코어 에러 ({game_id}): {e}")
        return None, None

    def parse_rows(t_str):
        t_dict = json.loads(t_str) if isinstance(t_str, str) else t_str
        return [[BeautifulSoup(str(c.get('Text', '')), 'html.parser').get_text(strip=True) for c in r.get('row', [])] for r in t_dict.get('rows', [])]

    hitter_details = {"away": [], "home": []}
    pitcher_details = {"away": [], "home": []}
    teams = ["away", "home"]

    # 🏃‍♂️ 1. 타자 기록 파싱
    for i, h_str in enumerate(data.get('arrHitter', [])[:2]):
        h_dict = json.loads(h_str) if isinstance(h_str, str) else h_str
        r1, r2, r3 = parse_rows(h_dict.get('table1', '{}')), parse_rows(h_dict.get('table2', '{}')), parse_rows(h_dict.get('table3', '{}'))

        max_rows = max(len(r1), len(r2), len(r3))
        for j in range(max_rows):
            h = (r1[j] if j < len(r1) else []) + (r2[j] if j < len(r2) else []) + (r3[j] if j < len(r3) else [])
            if not h or len(h) < 8 or "합계" in h: continue

            bat_order, pos, name = h[0], h[1], h[2]
            avg, rbi, hit, runs, ab = h[-1], h[-2], h[-3], h[-4], h[-5]
            
            order_str = f"[{bat_order}번]" if bat_order.isdigit() else "[대타]"
            inning_results = [f"{idx+1}회:{rec}" for idx, rec in enumerate(h[3:-5]) if rec and rec not in ['-', '', ' ']]

            hitter_details[teams[i]].append({
                "order": order_str, "pos": pos, "name": name,
                "ab": ab, "hit": hit, "rbi": rbi, "avg": avg,
                "records": " | ".join(inning_results) if inning_results else "-"
            })

    # 🧤 2. 투수 기록 파싱
    for i, p_str in enumerate(data.get('arrPitcher', [])[:2]):
        p_dict = json.loads(p_str) if isinstance(p_str, str) else p_str
        p_table = parse_rows(p_dict.get('table', p_dict.get('table1', '{}')))

        for p in p_table:
            if len(p) < 10 or p[0] in ["선수명", "TOTAL"]: continue
            pitcher_details[teams[i]].append({
                "name": p[0], "result": p[2], "ip": p[6],
                "np": p[8], "so": p[13] if len(p)>13 else '-',
                "er": p[14] if len(p)>14 else '-'
            })

    return hitter_details, pitcher_details

def normalize_naver_polling(game, polling):
    """네이버 game-polling 응답을 기존 ingest 행의 부분 업데이트로 변환한다."""
    if not isinstance(game, dict) or not isinstance(polling, dict):
        return {}
    if polling.get("cancel") or polling.get("suspended"):
        return {"is_cancel": True, "status": "cancelled", "status_note": polling.get("statusInfo") or "경기취소"}
    status_code = str(polling.get("statusCode") or "").upper()
    result = {}
    if status_code in {"BEFORE", "SCHEDULED", "PREVIEW"}:
        result.update({"status": "scheduled", "home_score": None, "away_score": None,
                       "home_line": None, "away_line": None, "home_rheb": None, "away_rheb": None})
        return result
    elif status_code in {"INGAME", "IN_PROGRESS", "PLAYING", "LIVE"}:
        result["status"] = "live"
    elif status_code in {"RESULT", "FINAL", "END"}:
        result["status"] = "final"
    if polling.get("homeTeamScore") is not None:
        result["home_score"] = polling.get("homeTeamScore")
    if polling.get("awayTeamScore") is not None:
        result["away_score"] = polling.get("awayTeamScore")
    for side in ("home", "away"):
        values = polling.get(f"{side}TeamScoreByInning")
        if isinstance(values, list) and values:
            result[f"{side}_line"] = "|".join(str(value) for value in values)
        rhe = polling.get(f"{side}TeamRheb")
        if isinstance(rhe, list) and rhe:
            result[f"{side}_rheb"] = "|".join(str(value) for value in rhe)
    if polling.get("statusInfo"):
        result["status_note"] = polling["statusInfo"]
    return result

def enrich_with_naver_live(all_results):
    """오늘 경기만 네이버 game-polling으로 보강한다. 실패 시 원본을 보존한다."""
    if not NAVER_LIVE:
        return all_results
    today = korea_today().isoformat()
    targets = [game for game in all_results if game.get("date") == today and not game.get("is_cancel")]
    if not targets:
        return all_results
    try:
        response = requests.get(
            "https://api-gw.sports.naver.com/schedule/games",
            params={"fromDate": today, "toDate": today, "categoryId": "kbo"},
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"}, timeout=8)
        response.raise_for_status()
        naver_games = response.json().get("result", {}).get("games", [])
    except Exception as exc:
        print(f"네이버 일정 보강 실패: {exc}")
        return all_results
    by_teams = {(g.get("away"), g.get("home")): g for g in targets}
    for naver_game in naver_games:
        key = (naver_game.get("awayTeamName"), naver_game.get("homeTeamName"))
        target = by_teams.get(key)
        naver_id = naver_game.get("gameId")
        if not target or not naver_id:
            continue
        try:
            poll = requests.get(
                f"https://api-gw.sports.naver.com/schedule/games/{naver_id}/game-polling",
                headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"}, timeout=5)
            poll.raise_for_status()
            update = normalize_naver_polling(target, poll.json().get("result", {}).get("game", {}))
            if update.get("status") == "scheduled":
                target.update(update)
            else:
                target.update({key: value for key, value in update.items() if value is not None})
            target["naver_game_id"] = naver_id
        except Exception as exc:
            print(f"네이버 경기 보강 실패 ({naver_id}): {exc}")
    return all_results

def get_kbo_data():
    now = datetime.datetime.now(KST)
    current_year = str(now.year)
    all_results = []
    holidays = get_holidays(current_year)

    for current_month in [str(m).zfill(2) for m in range(3, 12)]:
        api_url = "https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList"
        payload = {"leId": "1", "srIdList": "0", "seasonId": current_year, "gameMonth": current_month, "teamId": ""}
        
        try:
            res = requests.post(api_url, data=payload, headers=KBO_HEADERS, timeout=10)
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
                    is_cancel = "취소" in remark_text or "우천" in remark_text
                    if not game_id and not is_cancel:
                        continue
                    resolved_game_id = game_id or fallback_game_id(full_date, away_team, home_team)
                    
                    # 💡 [중요] 변수 초기화 위치: 매 경기마다 새로 초기화해야 데이터가 안 꼬입니다.
                    h_score, a_score = None, None
                    h_line, a_line, h_rheb, a_rheb = None, None, None, None
                    hitters, pitchers = None, None
                    if not is_cancel:
                        em = soup.find('em')
                        if em and len(em.find_all('span')) >= 3:
                            try:
                                a_score_val = em.find_all('span')[0].text.strip()
                                h_score_val = em.find_all('span')[-1].text.strip()
                                
                                if a_score_val.isdigit() and h_score_val.isdigit():
                                    a_score = int(a_score_val)
                                    h_score = int(h_score_val)
                                    if game_id:
                                        if COLLECT_DETAILS and should_collect_details(full_date):
                                            h_line, a_line, h_rheb, a_rheb = get_line_score(game_id)
                                            hitters, pitchers = get_boxscore_details(game_id)
                                            time.sleep(0.2)
                            except ValueError:
                                pass

                    all_results.append({
                        "date": full_date, 
                        "home": home_team, 
                        "away": away_team,
                        "home_score": h_score, 
                        "away_score": a_score, 
                        "stadium": stadium_name,
                        "time": game_time,
                        "game_id": resolved_game_id,
                        "home_line": h_line, 
                        "away_line": a_line, 
                        "home_rheb": h_rheb, 
                        "away_rheb": a_rheb,
                        "hitter_details": hitters,   # 🌟 새로 추가 (JSONB 매핑)
                        "pitcher_details": pitchers, # 🌟 새로 추가 (JSONB 매핑)
                        "is_cancel": is_cancel,
                        "status_note": remark_text.strip() if is_cancel and remark_text.strip() else None,
                        "holiday_name": holidays.get(full_date)
                    })
    return enrich_with_naver_live(all_results)

if __name__ == "__main__":
    data = get_kbo_data()
    if not data:
        raise SystemExit("KBO 원본 응답에서 경기 데이터를 찾지 못했습니다. 수집 endpoint 응답을 확인하세요.")
    ingest_url = os.environ.get("KBO_INGEST_URL", "").strip().rstrip("/")
    ingest_token = os.environ.get("KBO_INGEST_TOKEN", "").strip()
    if not ingest_url or not ingest_token:
        raise SystemExit("KBO_INGEST_URL과 KBO_INGEST_TOKEN이 모두 필요합니다.")
    response = requests.post(
        f"{ingest_url}/api/ingest",
        json={"games": data},
        headers={"Authorization": f"Bearer {ingest_token}"},
        timeout=30,
    )
    response.raise_for_status()
    print(f"🎉 Cloudflare D1 업데이트 완료! (총 {len(data)}건)")
