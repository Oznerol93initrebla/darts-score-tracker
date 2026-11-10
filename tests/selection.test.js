import test from 'node:test';
import assert from 'node:assert/strict';
import { selectMatchData, buildWorkbook } from '../js/export.js';
import { validateBackup } from '../js/db.js';

const ts='2026-10-23T16:00:00.000Z';
const players=['p1','p2','p3'].map(id=>({id,name:id,createdAt:ts}));
const mk=(id, p)=>({id,initialScore:301,checkout:'straight',playerIds:[p],currentPlayerIndex:0,turnCounter:1,scores:{[p]:241},status:'in_progress',winnerId:null,createdAt:ts,endedAt:null,pendingDraft:[null,null,null]});
const dart=()=>({sector:'20',multiplier:1,points:20,label:'S20'});
const turn=(id,p)=>({id:`${id}:1`,matchId:id,playerId:p,sequence:1,createdAt:ts,startScore:301,endScore:241,rawPoints:60,creditedPoints:60,bust:false,win:false,darts:[dart(),dart(),dart()]});
const data={players,matches:[mk('m1','p1'),mk('m2','p2'),mk('m3','p1')],turns:[turn('m1','p1'),turn('m2','p2'),turn('m3','p1')]};
test('selezione di più partite esporta solo i relativi giocatori e turni',()=>{
 const out=selectMatchData(data,['m1','m3']);
 assert.deepEqual(out.matches.map(x=>x.id),['m1','m3']);
 assert.deepEqual(out.turns.map(x=>x.matchId),['m1','m3']);
 assert.deepEqual(out.players.map(x=>x.id),['p1']);
 assert.deepEqual(validateBackup({app:'Darts Score Tracker',schemaVersion:1,...out}).matches.map(x=>x.id),['m1','m3']);
 const bytes=buildWorkbook(out);
 assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b);
});
test('selezione vuota e ID sconosciuti rifiutati',()=>{
 assert.throws(()=>selectMatchData(data,[]),/Seleziona/);
 assert.throws(()=>selectMatchData(data,['m1','unknown']),/non esistono/);
});
test('selezione non modifica i dati originari',()=>{
 selectMatchData(data,['m2']);
 assert.equal(data.matches.length,3);
 assert.equal(data.players.length,3);
});
