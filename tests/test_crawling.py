import datetime
import json
import unittest
from unittest.mock import patch

import crawling


class FakeResponse:
    status_code = 200

    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload

    def raise_for_status(self):
        return None


class CrawlingTests(unittest.TestCase):
    def test_recovers_missing_live_game_and_started_status(self):
        stored = {'game_id':'20260906NCWO0','date':'2026-09-06','time':'14:00','away':'NC','home':'키움','status':'scheduled'}
        responses = [FakeResponse({'games':[stored]}),
            FakeResponse({'result':{'games':[{'gameId':'20260906NCWO02026','awayTeamName':'NC','homeTeamName':'키움'}]}}),
            FakeResponse({'result':{'game':{'statusCode':'STARTED','currentInning':'3회초','awayTeamScore':0,'homeTeamScore':0}}})]
        with patch.object(crawling,'NAVER_LIVE',True), patch.object(crawling,'korea_today',return_value=datetime.date(2026,9,6)), patch.dict(crawling.os.environ,{'KBO_INGEST_URL':'https://example.com'}), patch.object(crawling.requests,'get',side_effect=responses):
            games=crawling.enrich_with_naver_live([])
        self.assertEqual(len(games),1)
        self.assertEqual(games[0]['status'],'live')
        self.assertEqual(games[0]['away_score'],0)
        self.assertEqual(games[0]['status_note'],'3회초')
        self.assertNotIn('status_note',stored)

    def test_holidays_keep_fixed_dates_without_api_key(self):
        with patch.object(crawling, "HOLIDAY_API_KEY", ""), patch.object(crawling.requests, "get") as get:
            holidays = crawling.get_holidays("2026")
            self.assertEqual(holidays["2026-05-05"], "어린이날")
            self.assertEqual(holidays["2026-10-09"], "한글날")
            get.assert_not_called()

    def test_detail_collection_only_includes_recent_past_games(self):
        today = datetime.date(2026, 9, 4)
        with patch.object(crawling, "DETAIL_WINDOW_DAYS", 14):
            self.assertTrue(crawling.should_collect_details("2026-09-04", today))
            self.assertTrue(crawling.should_collect_details("2026-08-21", today))
            self.assertFalse(crawling.should_collect_details("2026-08-20", today))
            self.assertFalse(crawling.should_collect_details("2026-09-05", today))

    def test_korea_today_is_timezone_aware(self):
        expected_now = datetime.datetime(2026, 9, 5, 0, 30, tzinfo=crawling.KST)
        class FakeDateTime:
            @staticmethod
            def now(tz=None):
                return expected_now
        with patch.object(crawling.datetime, "datetime", FakeDateTime):
            self.assertEqual(crawling.korea_today(), datetime.date(2026, 9, 5))

    def test_fallback_id_keeps_cancelled_rows_without_source_id(self):
        self.assertEqual(crawling.fallback_game_id("2026-08-30", "LG", "롯데"), "20260830-LG-롯데-noid")

    def test_line_score_maps_away_and_home_rows(self):
        payload = {
            "table2": json.dumps({"rows": [
                {"row": [{"Text": "1"}, {"Text": "0"}]},
                {"row": [{"Text": "0"}, {"Text": "2"}]},
            ]}),
            "table3": json.dumps({"rows": [
                {"row": [{"Text": "1"}, {"Text": "4"}, {"Text": "0"}, {"Text": "2"}]},
                {"row": [{"Text": "2"}, {"Text": "5"}, {"Text": "1"}, {"Text": "3"}]},
            ]}),
        }
        with patch.object(crawling.requests, "post", return_value=FakeResponse(payload)):
            home_line, away_line, home_rheb, away_rheb = crawling.get_line_score("20260904ABCD0")

        self.assertEqual(away_line, "1|0")
        self.assertEqual(home_line, "0|2")
        self.assertEqual(away_rheb, "1|4|0|2")
        self.assertEqual(home_rheb, "2|5|1|3")

    def test_normalize_naver_polling_live_score_and_innings(self):
        update = crawling.normalize_naver_polling({}, {
            "statusCode": "INGAME", "statusInfo": "6회초",
            "awayTeamScore": 3, "homeTeamScore": 2,
            "awayTeamScoreByInning": ["0", "1", "2"],
            "homeTeamScoreByInning": ["1", "0", "1"],
            "awayTeamRheb": [3, 7, 0, 1], "homeTeamRheb": [2, 5, 1, 0],
        })
        self.assertEqual(update["status"], "live")
        self.assertEqual(update["away_score"], 3)
        self.assertEqual(update["away_line"], "0|1|2")
        self.assertEqual(update["home_rheb"], "2|5|1|0")

    def test_normalize_naver_before_clears_false_zero_score(self):
        update = crawling.normalize_naver_polling({}, {"statusCode": "BEFORE", "statusInfo": "경기전"})
        self.assertEqual(update["status"], "scheduled")
        self.assertIsNone(update["away_score"])
        self.assertIsNone(update["home_line"])


if __name__ == "__main__":
    unittest.main()
