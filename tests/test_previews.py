import copy
import datetime
import unittest
from unittest.mock import patch, Mock
import requests
import crawling

class PreviewTests(unittest.TestCase):
    def test_window_boundaries_and_doubleheader_matching(self):
        games = [{'game_id':f'20260906HHLT{n}','date':'2026-09-06','time':'17:00','away':'한화','home':'롯데'} for n in [1,2]]
        schedule = Mock()
        schedule.json.return_value = {'result':{'games':[{'gameId':g['game_id']+'2026','gameDate':g['date'],'awayTeamName':g['away'],'homeTeamName':g['home']} for g in games]}}
        preview = Mock()
        preview.json.return_value = {'result':{'previewData':{'awayStarter':{'playerInfo':{'name':'선발'}}}}}
        with patch.object(crawling,'COLLECT_PREVIEWS',True):
            for hour in [11,17]:
                with patch.object(crawling.requests,'get',side_effect=[schedule,preview,preview]) as get:
                    result = crawling.collect_previews(games,datetime.datetime(2026,9,6,hour,tzinfo=crawling.KST))
                    self.assertEqual([p['source_game_id'] for p in result],['20260906HHLT12026','20260906HHLT22026'])
                    self.assertEqual(get.call_count,3)

    def test_failure_leaves_games_unchanged(self):
        games = [{'game_id':'20260906HHLT0','date':'2026-09-06','time':'17:00','away':'한화','home':'롯데'}]
        before = copy.deepcopy(games)
        schedule = Mock()
        schedule.json.return_value = {'result':{'games':[{'gameId':'20260906HHLT02026','gameDate':'2026-09-06','awayTeamName':'한화','homeTeamName':'롯데'}]}}
        failure = Mock()
        failure.raise_for_status.side_effect = requests.HTTPError('500')
        with patch.object(crawling,'COLLECT_PREVIEWS',True), patch.object(crawling.requests,'get',side_effect=[schedule,failure]) as get:
            result = crawling.collect_previews(games,datetime.datetime(2026,9,6,12,tzinfo=crawling.KST))
            self.assertEqual(result,[])
            self.assertEqual(get.call_count,2)
            self.assertEqual(games,before)

    def test_disabled_and_outside_window_do_not_fetch(self):
        games = [{'game_id':'20260906HHLT0','date':'2026-09-06','time':'17:00','away':'한화','home':'롯데'}]
        with patch.object(crawling.requests,'get') as get:
            with patch.object(crawling,'COLLECT_PREVIEWS',False):
                self.assertEqual(crawling.collect_previews(games),[])
            with patch.object(crawling,'COLLECT_PREVIEWS',True):
                for hour in [10,18]:
                    self.assertEqual(crawling.collect_previews(games,datetime.datetime(2026,9,6,hour,tzinfo=crawling.KST)),[])
            get.assert_not_called()
