import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareArchiveMerge,validateBackup} from '../js/db.js';
import {evaluateTurn,computeStats} from '../js/engine.js';

const started='2026-10-23T16:00:00.000Z';
const stamp=i=>new Date(Date.parse(started)+(i+1)*60000).toISOString();
const D=(sector,multiplier=1)=>({sector,multiplier});
const a=[D('20',3),D('20',3),D('20',3)];
const b=[D('20',3),D('20',3),D('1')];
const other=[D('20'),D('20'),D('20')];
const empty={players:[],matches:[],turns:[]};

function fixture(id, pid, name, visits=[a,b]) {
  let score=301;
  const turns=[];
  for(let i=0;i<visits.length;i++){
    const result=evaluateTurn(score,visits[i],'straight');
    assert.ok(result.complete);
    turns.push({id:`${id}:${i+1}`,matchId:id,playerId:pid,sequence:i+1,createdAt:stamp(i),
      startScore:score,endScore:result.remainingScore,rawPoints:result.rawPoints,
      creditedPoints:result.creditedPoints,darts:result.darts,bust:result.bust,win:result.win});
    score=result.remainingScore;
  }
  const completed=score===0;
  return {app:'Darts Score Tracker',schemaVersion:1,
    players:[{id:pid,name,createdAt:started}],
    matches:[{id,initialScore:301,checkout:'straight',playerIds:[pid],
      currentPlayerIndex:0,turnCounter:visits.length,scores:{[pid]:score},
      status:completed?'completed':'in_progress',winnerId:completed?pid:null,
      createdAt:started,endedAt:completed?stamp(visits.length):null,pendingDraft:[null,null,null]}],
    turns};
}

test('unisce molti backup e riconcilia un giocatore omonimo con ID differente',()=>{
  const one=fixture('match1','p1','Ada');
  const two=fixture('match2','p2','ada');
  const result=prepareArchiveMerge(empty,[one,two]);
  assert.equal(result.summary.newMatches,2);
  assert.equal(result.summary.newPlayers,1);
  assert.equal(result.data.players[0].name,'Ada');
  assert.deepEqual(result.data.matches.map(m=>m.playerIds),[['p1'],['p1']]);
  const s=computeStats(result.data)[0];
  assert.equal(s.played,2);assert.equal(s.wins,2);assert.equal(s.average3,150.5);
  validateBackup({app:'Darts Score Tracker',schemaVersion:1,...result.data});
});

test('reimportare lo stesso backup non aumenta le statistiche né modifica l’archivio',()=>{
  const backup=fixture('match1','p1','Ada');
  const current=prepareArchiveMerge(empty,[backup]).data;
  const before=JSON.stringify(current);
  const {data,summary}=prepareArchiveMerge(current,[backup,backup]);
  assert.equal(summary.newMatches,0);assert.equal(summary.skippedMatches,2);
  assert.equal(data.matches.length,1);assert.equal(data.turns.length,2);
  assert.equal(JSON.stringify(current),before);
});

test('backup con sequenza più recente completa una partita già importata',()=>{
  const older=fixture('match1','p1','Ada',[a]);
  const newer=fixture('match1','p1','Ada',[a,b]);
  const original=prepareArchiveMerge(empty,[older]).data;
  const {data,summary}=prepareArchiveMerge(original,[newer]);
  assert.equal(summary.updatedMatches,1);
  assert.equal(summary.newTurns,1);
  assert.equal(data.matches[0].status,'completed');
  assert.equal(computeStats(data)[0].wins,1);
  const again=prepareArchiveMerge(data,[older]);
  assert.equal(again.summary.skippedMatches,1);
  assert.equal(again.data.matches[0].status,'completed');
});

test('ID partita uguale con turni diversi: conflitto invece di sovrascrivere',()=>{
  const current=prepareArchiveMerge(empty,[fixture('m1','p1','Ada',[a])]).data;
  const conflict=fixture('m1','p1','Ada',[other]);
  assert.throws(()=>prepareArchiveMerge(current,[conflict]),/Conflitto sui tiri/);
  assert.equal(current.turns[0].rawPoints,180);
});

test('un JSON non valido blocca tutta l’importazione prima di cambiare lo storico',()=>{
  const good=fixture('m1','p1','Ada');
  const bad=fixture('m2','p2','Bob');
  bad.turns[0].creditedPoints=999;
  assert.throws(()=>prepareArchiveMerge(empty,[good,bad]),/File 2:.*incoerenti/);
  assert.equal(empty.matches.length,0);
});

test('una rinomina su ID già noto preserva il nome locale',()=>{
  const current=prepareArchiveMerge(empty,[fixture('m1','p1','Ada')]).data;
  const renamed=fixture('m2','p1','Ada Nuova');
  const {data}=prepareArchiveMerge(current,[renamed]);
  assert.equal(data.players.length,1);
  assert.equal(data.players[0].name,'Ada');
});

test('unione rifiuta due giocatori distinti che diventerebbero lo stesso partecipante',()=>{
  const current=prepareArchiveMerge(empty,[fixture('m1','p1','Ada')]).data;
  // Il backup è coerente di per sé: p1 si chiama Maria ed è seguito da p3 Ada.
  // Nell'archivio locale p1 è Ada, quindi entrambi si mapperebbero su p1.
  const raw=fixture('m2','p1','Maria',[a]);
  raw.players.push({id:'p3',name:'Ada',createdAt:started});
  raw.matches[0].playerIds.push('p3');
  raw.matches[0].scores.p3=301;
  raw.matches[0].currentPlayerIndex=1;
  validateBackup(raw);
  assert.throws(()=>prepareArchiveMerge(current,[raw]),/stesso profilo/);
});

test('un ID importato da due backup resta lo stesso giocatore anche se nel secondo cambia nome',()=>{
  const base=prepareArchiveMerge(empty,[fixture('m0','canonical','Ada')]).data;
  const first=fixture('m1','alias','Ada');
  const second=fixture('m2','alias','Ada Rinomina');
  const result=prepareArchiveMerge(base,[first,second]);
  assert.equal(result.data.players.length,1);
  assert.deepEqual(result.data.matches.map(m=>m.playerIds[0]),['canonical','canonical','canonical']);
  assert.equal(result.summary.newPlayers,0);
});
