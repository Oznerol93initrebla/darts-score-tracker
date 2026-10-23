import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBackup} from '../js/db.js';
const stamp='2026-10-23T16:00:00.000Z';
const D=(sector,multiplier=1)=>({sector,multiplier,points:Number(sector)*multiplier,label:`${['','S','D','T'][multiplier]}${sector}`});
function fixture(){return {app:'Darts Score Tracker',schemaVersion:1,players:[{id:'p',name:'Ada',createdAt:stamp}],
  matches:[{id:'m',initialScore:301,checkout:'straight',playerIds:['p'],currentPlayerIndex:0,
    turnCounter:1,scores:{p:241},status:'in_progress',winnerId:null,createdAt:stamp,endedAt:null,pendingDraft:[null,null,null]}],
  turns:[{id:'m:1',matchId:'m',playerId:'p',sequence:1,createdAt:stamp,startScore:301,endScore:241,
    rawPoints:60,creditedPoints:60,bust:false,win:false,darts:[D('20'),D('20'),D('20')]}]};}
test('backup valido normalizzato',()=>{
  const safe=validateBackup(fixture());
  assert.equal(safe.matches[0].scores.p,241);
  assert.equal(safe.turns[0].darts[0].label,'S20');
});
test('backup rifiuta punteggio alterato',()=>{
  const data=fixture();data.matches[0].scores.p=210;
  assert.throws(()=>validateBackup(data),/incoerente/);
});
test('backup rifiuta una sequenza turni alterata',()=>{
  const data=fixture();data.turns[0].sequence=2;
  assert.throws(()=>validateBackup(data),/alterato/);
});
test('backup rifiuta nomi duplicati',()=>{
  const data=fixture();data.players.push({id:'another',name:'ada',createdAt:stamp});
  assert.throws(()=>validateBackup(data),/duplicati/);
});
