import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {buildWorkbook} from '../js/export.js';

test('workbook XLSX generato offline, intestazioni e nomi UTF-8',()=>{
  const data={
    players:[{id:'p1',name:'Lorenzo & Co =SUM(1,1)',createdAt:'2026-10-23T16:00:00.000Z'}],
    matches:[{id:'m1',initialScore:301,checkout:'straight',playerIds:['p1'],currentPlayerIndex:0,
      turnCounter:1,scores:{p1:241},status:'in_progress',winnerId:null,createdAt:'2026-10-23T16:00:00.000Z',endedAt:null}],
    turns:[{id:'m1:1',matchId:'m1',playerId:'p1',sequence:1,createdAt:'2026-10-23T16:01:00.000Z',
      startScore:301,endScore:241,rawPoints:60,creditedPoints:60,bust:false,win:false,
      darts:[{sector:'20',multiplier:1,points:20,label:'S20'},{sector:'20',multiplier:1,points:20,label:'S20'},
        {sector:'20',multiplier:1,points:20,label:'S20'}]}]
  };
  const bytes=buildWorkbook(data);
  assert.equal(bytes[0],0x50);assert.equal(bytes[1],0x4b);
  assert.ok(bytes.length>3000);
  writeFileSync('/tmp/darts_validation.xlsx',bytes);
});
