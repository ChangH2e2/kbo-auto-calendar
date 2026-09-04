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


if __name__ == "__main__":
    unittest.main()
