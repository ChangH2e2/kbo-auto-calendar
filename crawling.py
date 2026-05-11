import requests
import json
from bs4 import BeautifulSoup
import re
from supabase import create_client
import os
import sys

# 환경 변수 가져오기 및 공백 제거
URL = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "").strip()

def get_kbo_data():
    print("📡 KBO 서버 접속 시도 중... (2026년 5월 일정)")
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
        day_cell = next((c for c in cells if c.get('Class') == 'day'), None)
        if day_cell:
            txt = day_cell.get('Text', '')
            match = re.search(r'(\d{2})\.(\d{2})', txt)
            if match: curr_date = f"{match.group(1)}-{match.group(2)}"
        
        play_cell = next((c for c in cells if c.get('Class') == 'play'), None)
        if play_cell and curr_date:
            soup = BeautifulSoup(play_cell.get('Text', ''), 'html.parser')
            teams = soup.find_all('span')
            if len(teams) >= 2:
                results.append({
                    "date": f"2026-{curr_date}",
                    "home": teams[-1].get_text(strip=True),
                    "away": teams[0].get_text(strip=True),
                    "stadium": cells[7].get('Text', '미정') if len(cells) > 7 else "미정",
                    "time": "18:30"
                })
    return results

if __name__ == "__main__":
    print("🚀 [시스템] 크롤러 엔진 가동 시작!")
    
    if not URL or not KEY:
        print("🚨 [에러] SUPABASE_URL 또는 KEY가 설정되지 않았습니다.")
        sys.exit(1)

    try:
        data = get_kbo_data()
        if data:
            print(f"✅ [성공] 총 {len(data)}건의 일정을 확보했습니다.")
            # 주소 정제 후 접속
            supabase = create_client(URL, KEY)
            supabase.table("kbo_matches").delete().neq("id", 0).execute()
            supabase.table("kbo_matches").insert(data).execute()
            print("🎉 [완료] Supabase DB 저장 성공!")
        else:
            print("🚨 [경고] 데이터를 가져오지 못했습니다.")
            sys.exit(1)
    except Exception as e:
        print(f"❌ [치명적 에러] 실행 중 오류 발생: {e}")
        sys.exit(1) # 에러 발생 시 깃허브 액션도 '실패'로 표시되게 함