import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateTurn, normalizeDart, computeStats} from '../js/engine.js';
const D = (sector, multiplier=1) => ({sector:String(sector),multiplier});

test('301/501, tripla massima (180)', () => {
  const r=evaluateTurn(501,[D(20,3),D(20,3),D(20,3)],'double');
  assert.equal(r.creditedPoints,180);assert.equal(r.remainingScore,321);assert.equal(r.complete,true);
});
test('double-out chiude al primo lancio e ignora successivi', () => {
  const r=evaluateTurn(40,[D(20,2),D(1),D(3)],'double');
  assert.equal(r.win,true);assert.equal(r.dartCount,1);assert.equal(r.remainingScore,0);
});
test('bust per superamento, 0 accreditati', () => {
  const r=evaluateTurn(32,[D(20),D(13),null],'double');
  assert.equal(r.bust,true);assert.equal(r.rawPoints,33);assert.equal(r.creditedPoints,0);
  assert.equal(r.remainingScore,32);assert.equal(r.dartCount,2);
});
test('double-out: un punto residuo = bust',()=>{
  const r=evaluateTurn(2,[D(1)],'double');
  assert.equal(r.bust,true);assert.equal(r.remainingScore,2);
});
test('double-out: single a zero = bust',()=>{
  const r=evaluateTurn(20,[D(20)],'double');
  assert.equal(r.bust,true);assert.equal(r.remainingScore,20);
});
test('straight-out: single a zero chiude',()=>{
  const r=evaluateTurn(20,[D(20)],'straight');
  assert.equal(r.win,true);assert.equal(r.remainingScore,0);
});
test('double-out: B50 chiude, B25 no',()=>{
  assert.equal(evaluateTurn(50,[D('B50')],'double').win,true);
  assert.equal(evaluateTurn(25,[D('B25')],'double').bust,true);
});
test('MISS conta come freccetta senza fare punti',()=>{
  const r=evaluateTurn(301,[D('MISS'),D('MISS'),D('MISS')],'straight');
  assert.equal(r.complete,true);assert.equal(r.creditedPoints,0);assert.equal(r.dartCount,3);
});
test('non si conferma un turno parziale',()=>{
  const r=evaluateTurn(301,[D(20),null,null],'straight');
  assert.equal(r.complete,false);assert.equal(r.missingDarts,2);
});
test('niente buchi nelle caselle',()=>assert.throws(()=>evaluateTurn(301,[null,D(20)],'straight')));
test('valori non validi',()=>{
  for(const d of [D(21),D(0),D(20,4),D('B50',3),D('5',0)]) assert.throws(()=>normalizeDart(d));
});
test('statistiche: media su punti accreditati, non raw bust',()=>{
  const match={id:'m',status:'completed',winnerId:'p',playerIds:['p']};
  const turns=[{matchId:'m',playerId:'p',creditedPoints:0,rawPoints:33,bust:true,darts:[D(20),D(13)]},
    {matchId:'m',playerId:'p',creditedPoints:180,rawPoints:180,bust:false,darts:[D(20,3),D(20,3),D(20,3)]}];
  const s=computeStats({players:[{id:'p',name:'L'}],matches:[match],turns})[0];
  assert.equal(s.wins,1);assert.equal(s.average3,108);assert.equal(s.bestTurn,180);assert.equal(s.visits180,1);
});
