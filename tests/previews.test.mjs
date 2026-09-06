import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { normalizePreview, PREVIEW_UPSERT, previewValues, onRequestPost } from '../functions/api/preview-ingest.js';
import { onRequestGet } from '../functions/api/games.js';

const input = previewData => ({game_id:'20260906HHLT0',source_game_id:'20260906HHLT02026',checked_at:'2026-09-06T04:00:00Z',previewData});
const starter = {playerInfo:{name:'선발',backnum:'24',hitType:'우투우타'}};
const nine = Array.from({length:9},(_,i)=>({batorder:i+1,playerName:`타자${i+1}`}));
const announced = {awayStarter:starter,homeStarter:starter,awayTeamLineUp:{fullLineUp:nine},homeTeamLineUp:{fullLineUp:nine}};
test('none → starter_only → announced; both teams require nine unique batting orders', () => {
  assert.equal(normalizePreview(input({})).lineup_state,'none');
  assert.equal(normalizePreview(input({awayStarter:starter})).lineup_state,'starter_only');
  assert.equal(normalizePreview(input(announced)).lineup_state,'announced');
  assert.equal(normalizePreview(input({...announced,homeTeamLineUp:{fullLineUp:nine.map(p=>({...p,batorder:1}))}})).lineup_state,'starter_only');
});
test('bullpen/bench do not invent backnum; standings rank retained as data', () => {
  const row=normalizePreview(input({awayTeamLineUp:{pitcherBullpen:[{playerName:'불펜',hitType:'좌투좌타',position:'투수'}]},awayStandings:{rank:8,w:51,l:65,d:3}}));
  assert.deepEqual(row.away_bullpen,[{name:'불펜',hitType:'좌투좌타',position:'투수'}]);
  assert.equal(row.away_standing.rank,8);
});
test('actual SQLite upsert preserves announced rows on empty/partial/stale responses and never changes games', () => {
  const rows=[{}, {awayStarter:starter}, announced, {}, {awayStarter:starter}].map((data,i)=>normalizePreview({...input(data),checked_at:`2026-09-06T04:0${i}:00Z`}));
  const code=`import sqlite3,json,sys\nx=json.load(sys.stdin)\ndb=sqlite3.connect(':memory:')\ndb.executescript(x['initial'])\ndb.execute("INSERT INTO games(id,season,starts_at,date,time,away_team,home_team,status) VALUES ('20260906HHLT0',2026,'2026-09-06T17:00:00+09:00','2026-09-06','17:00','한화','롯데','scheduled')")\ndb.executescript(x['migration'])\nbefore=list(db.execute('SELECT * FROM games'))\nstates=[]\nfor row in x['rows']:\n db.execute(x['sql'],row)\n states.append(db.execute('SELECT lineup_state FROM game_previews').fetchone()[0])\nassert before==list(db.execute('SELECT * FROM games'))\nprint(json.dumps(states))`;
  const result=spawnSync('python',['-c',code],{encoding:'utf8',input:JSON.stringify({initial:readFileSync('migrations/0001_initial.sql','utf8'),migration:readFileSync('migrations/0010_game_previews.sql','utf8'),sql:PREVIEW_UPSERT,rows:rows.map(previewValues)})});
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),['none','starter_only','announced','announced','announced']);
});
test('unauthorized preview ingestion cannot access D1',async()=>{
  const response=await onRequestPost({request:new Request('https://example.com/api/preview-ingest',{method:'POST'}),env:{INGEST_TOKEN:'secret'}});
  assert.equal(response.status,401);
});
test('default games response does not join previews; include=preview returns parsed object or null',async()=>{
  for(const include of [false,true]) {
    let query;
    const row={game_id:'20260906HHLT0',status:'scheduled'};
    if(include) Object.assign(row,{preview_game_id:row.game_id,preview_away_starter:'{"name":"선발"}'});
    const response=await onRequestGet({request:new Request('https://example.com/api/games'+(include?'?include=preview':'')),env:{KBO_DB:{prepare(sql){query=sql;return {bind(){return {async all(){return {results:[row]};}};}};}}}});
    const body=await response.json();
    assert.equal(query.includes('LEFT JOIN game_previews'),include);
    assert.equal(Object.hasOwn(body.games[0],'preview'),include);
    if(include) assert.equal(body.games[0].preview.away_starter.name,'선발');
  }
});
test('Naver 500 failure and collection window preserve source games (Python collector tests)',()=>{
  const result=spawnSync('python',['-m','unittest','discover','-s','tests','-p','test_previews.py'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);
});
