"""KBO 1군 등록 현황과 등록/말소 이력을 수집한다.

Player/Register.aspx는 ASP.NET 포스트백이지만 hfSearchTeam/hfSearchDate를 직접 실어
POST하면 브라우저 없이 임의 팀·임의 날짜를 조회할 수 있다(2026-09-06 확인).
날짜를 지정할 수 있으므로 하루를 놓쳐도 나중에 되메울 수 있다.
"""
import datetime
import os
import re
import sys

import requests
from bs4 import BeautifulSoup

URL = "https://www.koreabaseball.com/Player/Register.aspx"
HEADERS = {"User-Agent": "Mozilla/5.0", "Referer": URL}
PREFIX = "ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$"
KST = datetime.timezone(datetime.timedelta(hours=9))

# KBO 팀 코드 → 이 서비스의 팀 id
TEAMS = {"SS": "삼성", "KT": "KT", "LG": "LG", "HT": "KIA", "OB": "두산",
         "NC": "NC", "SK": "SSG", "HH": "한화", "LT": "롯데", "WO": "키움"}
PLAYER_POSITIONS = {"투수", "포수", "내야수", "외야수"}
MIN_ROSTER = 20  # 이보다 적으면 응답이 깨진 것으로 보고 명단을 반영하지 않는다


def korea_today():
    return datetime.datetime.now(KST).date()


def hidden_fields(soup):
    fields = {}
    for name in ("__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"):
        element = soup.find("input", {"name": name})
        fields[name] = element.get("value", "") if element else ""
    return fields


def cell_text(row):
    return [cell.get_text(strip=True) for cell in row.find_all("td")]


def parse_page(html):
    """등록 명단과 그날의 등록/말소를 뽑는다."""
    soup = BeautifulSoup(html, "html.parser")
    entries, registered, removed = [], [], []
    transaction_tables = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if len(rows) < 2:
            continue
        header = [cell.get_text(strip=True) for cell in rows[0].find_all(["th", "td"])]
        if not header:
            continue
        # 등록 명단 표는 두 번째 칸이 포지션명이다: 등번호 | 투수 | 투타유형 | 생년월일 | 체격
        if len(header) == 5 and header[0] == "등번호" and header[1] in PLAYER_POSITIONS:
            for row in rows[1:]:
                cells = cell_text(row)
                if len(cells) < 5 or not cells[1]:
                    continue
                entries.append({"name": cells[1], "back_number": cells[0], "position": header[1],
                                "bats_throws": cells[2] or None, "birth": cells[3] or None,
                                "physique": cells[4] or None})
        # 등/말소 표는 등록 표와 말소 표가 이 순서로 두 번 나온다
        elif header[:2] == ["등번호", "선수명"]:
            transaction_tables.append(rows[1:])

    for kind, rows in zip(("register", "remove"), transaction_tables):
        target = registered if kind == "register" else removed
        for row in rows:
            cells = cell_text(row)
            if len(cells) < 6 or not cells[1]:
                continue  # "당일 1군 등록된 선수가 없습니다." 같은 안내 행
            target.append({"name": cells[1], "back_number": cells[0], "position": cells[2], "kind": kind})
    return entries, registered + removed


def collect(days=1, session=None):
    session = session or requests.Session()
    response = session.get(URL, headers=HEADERS, timeout=15)
    response.raise_for_status()
    form = hidden_fields(BeautifulSoup(response.text, "html.parser"))
    today = korea_today()
    dates = [(today - datetime.timedelta(days=offset)).strftime("%Y%m%d") for offset in range(days)]

    entries, transactions, checks = [], [], []
    for index, date in enumerate(dates):
        for code, team in TEAMS.items():
            payload = dict(form)
            payload.update({"__EVENTTARGET": PREFIX + "btnCalendarSelect", "__EVENTARGUMENT": "",
                            PREFIX + "hfSearchTeam": code, PREFIX + "hfSearchDate": date})
            try:
                page = session.post(URL, data=payload, headers=HEADERS, timeout=20)
                page.raise_for_status()
            except Exception as error:
                print(f"수집 실패 {team} {date}: {error}")
                continue
            soup = BeautifulSoup(page.text, "html.parser")
            selected = soup.find("input", {"id": "cphContents_cphContents_cphContents_hfSearchTeam"})
            if not selected or selected.get("value") != code:
                print(f"팀 전환 실패 {team} {date} — 건너뜁니다")
                continue
            form = hidden_fields(soup)
            team_entries, team_transactions = parse_page(page.text)
            iso_date = f"{date[:4]}-{date[4:6]}-{date[6:]}"
            # 명단 스냅샷은 가장 최근 날짜의 것만 쓴다. 과거 날짜는 이력 수집이 목적이다.
            if index == 0:
                if len(team_entries) >= MIN_ROSTER:
                    entries.extend({**entry, "team": team} for entry in team_entries)
                else:
                    print(f"명단이 {len(team_entries)}명뿐이라 반영하지 않습니다: {team}")
            for transaction in team_transactions:
                transactions.append({**transaction, "team": team, "date": iso_date})
            checks.append({"team": team, "date": iso_date})
    return {"as_of": today.isoformat(), "entries": entries, "transactions": transactions, "checks": checks}


if __name__ == "__main__":
    days = int(os.environ.get("KBO_ROSTER_DAYS", "1"))
    result = collect(days=days)
    if not result["checks"]:
        raise SystemExit("KBO 등록 현황 페이지에서 아무 팀도 읽지 못했습니다.")
    ingest_url = os.environ.get("KBO_INGEST_URL", "").strip().rstrip("/")
    ingest_token = os.environ.get("KBO_INGEST_TOKEN", "").strip()
    if not ingest_url or not ingest_token:
        raise SystemExit("KBO_INGEST_URL과 KBO_INGEST_TOKEN이 모두 필요합니다.")
    response = requests.post(f"{ingest_url}/api/roster-ingest", json=result,
                             headers={"Authorization": f"Bearer {ingest_token}"}, timeout=60)
    response.raise_for_status()
    print(f"로스터 반영 완료: 명단 {len(result['entries'])}명 · 변동 {len(result['transactions'])}건 "
          f"· 조회 {len(result['checks'])}건 → {response.json()}")
