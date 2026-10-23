import { computeStats } from './engine.js';

/** Scrittore XLSX minimale e autonomo: OOXML + ZIP (store) senza CDN né librerie esterne. */
const enc = new TextEncoder();
const xmlEscape = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'');
const colRef = i => {
  let r = '';
  for (let x = i + 1; x; x = Math.floor((x - 1) / 26)) r = String.fromCharCode(65 + (x-1) % 26) + r;
  return r;
};
const sheetXml = (headers, rows) => {
  const lines = [headers, ...rows];
  let body = '';
  lines.forEach((row, i) => {
    const r = i + 1;
    body += `<row r="${r}">`;
    row.forEach((value,j) => {
      if (value == null || value === '') return;
      const ref = `${colRef(j)}${r}`;
      if (typeof value === 'number' && Number.isFinite(value)) {
        body += `<c r="${ref}"${i===0?' s="1"':''} t="n"><v>${value}</v></c>`;
      } else {
        // inlineStr evita che Excel interpreti nomi giocatore come formule.
        body += `<c r="${ref}"${i===0?' s="1"':''} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
      }
    });
    body += '</row>';
  });
  const end = `${colRef(headers.length-1)}${lines.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`+
    `<dimension ref="A1:${end}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>`+
    `<sheetFormatPr defaultRowHeight="17"/><sheetData>${body}</sheetData>`+
    `</worksheet>`;
};

const STYLE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+
`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`+
`<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>`+
`<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF174B58"/><bgColor indexed="64"/></patternFill></fill></fills>`+
`<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`+
`<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`+
`<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>`+
`<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// ZIP senza compressione (metodo 0), interoperabile con Excel, LibreOffice e openpyxl.
const crcTable = new Uint32Array(256);
for (let n=0;n<256;n++) {
  let c=n;
  for (let k=0;k<8;k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : c >>> 1;
  crcTable[n]=c>>>0;
}
const crc32 = bytes => {
  let c=0xFFFFFFFF;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c>>>8);
  return (c ^ 0xFFFFFFFF) >>> 0;
};
const uint16 = (v,at,x) => v.setUint16(at,x,true);
const uint32 = (v,at,x) => v.setUint32(at,x>>>0,true);
function createZip(files) {
  const chunks=[];
  const central=[];
  let offset=0;
  for (const [name,content] of files) {
    const filename=enc.encode(name), data=enc.encode(content), crc=crc32(data);
    if (data.length > 0xFFFFFFFF || offset + data.length > 0xFFFFFFFF) throw new Error('Esportazione troppo grande per XLSX.');
    const local=new Uint8Array(30+filename.length);
    const lv=new DataView(local.buffer);
    uint32(lv,0,0x04034b50); uint16(lv,4,20); uint16(lv,6,0x0800);
    uint16(lv,8,0); uint32(lv,14,crc); uint32(lv,18,data.length);
    uint32(lv,22,data.length); uint16(lv,26,filename.length);
    local.set(filename,30);
    chunks.push(local,data);
    const c=new Uint8Array(46+filename.length), cv=new DataView(c.buffer);
    uint32(cv,0,0x02014b50); uint16(cv,4,20); uint16(cv,6,20); uint16(cv,8,0x0800);
    uint16(cv,10,0); uint32(cv,16,crc); uint32(cv,20,data.length);
    uint32(cv,24,data.length); uint16(cv,28,filename.length); uint32(cv,42,offset);
    c.set(filename,46); central.push(c);
    offset += local.length+data.length;
  }
  const centralSize=central.reduce((n,b)=>n+b.length,0);
  const end=new Uint8Array(22), ev=new DataView(end.buffer);
  uint32(ev,0,0x06054b50); uint16(ev,8,files.length); uint16(ev,10,files.length);
  uint32(ev,12,centralSize); uint32(ev,16,offset);
  const result=new Uint8Array(offset+centralSize+end.length);
  let p=0;
  for (const b of [...chunks,...central,end]) { result.set(b,p); p+=b.length; }
  return result;
}
function xlsxBytes(sheets) {
  const ct=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`+
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`+
    `<Default Extension="xml" ContentType="application/xml"/>`+
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`+
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`+
    sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')+`</Types>`;
  const wb=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`+
    sheets.map((s,i)=>`<sheet name="${xmlEscape(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')+`</sheets></workbook>`;
  const rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
    sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')+
    `<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const files=[
    ['[Content_Types].xml',ct],
    ['_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml',wb], ['xl/_rels/workbook.xml.rels',rels],['xl/styles.xml',STYLE],
    ...sheets.map((s,i)=>[`xl/worksheets/sheet${i+1}.xml`,sheetXml(s.headers,s.rows)]),
  ];
  return createZip(files);
}

export function buildWorkbook(data, matchId = null) {
  const matches = data.matches.filter(m=>!matchId || m.id===matchId)
    .sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  if (matchId && !matches.length) throw new Error('Partita non trovata.');
  const mids=new Set(matches.map(m=>m.id));
  const allTurns=data.turns.filter(t=>mids.has(t.matchId)).sort((a,b)=>
    a.matchId.localeCompare(b.matchId) || a.sequence-b.sequence);
  const participants=new Set(matches.flatMap(m=>m.playerIds));
  const players=data.players.filter(p=>!matchId || participants.has(p.id));
  const playerMap=new Map(data.players.map(p=>[p.id,p.name]));
  const gameMap=new Map(matches.map(m=>[m.id,m]));
  const stats=computeStats({players,matches,turns:allTurns},matchId);
  const sheets = [
    {name:'Giocatori',headers:['ID giocatore','Nome','Data creazione'],
      rows:players.map(p=>[p.id,p.name,p.createdAt])},
    {name:'Partite',headers:['ID partita','Data inizio','Data fine','Modalità','Uscita','Stato','Partecipanti','Vincitore','Numero turni'],
      rows:matches.map(m=>[m.id,m.createdAt,m.endedAt||'',m.initialScore,m.checkout==='double'?'Double-out':'Straight-out',
        m.status==='completed'?'Conclusa':'In corso',m.playerIds.map(id=>playerMap.get(id)||id).join(', '),
        playerMap.get(m.winnerId)||'',m.turnCounter])},
    {name:'Turni',headers:['ID partita','N. turno globale','Giocatore','ID giocatore','Residuo iniziale','Punti lanciati','Punti accreditati','Residuo finale','Bust','Chiusura','Freccette'],
      rows:allTurns.map(t=>[t.matchId,t.sequence,playerMap.get(t.playerId)||'',t.playerId,t.startScore,t.rawPoints,
        t.creditedPoints,t.endScore,t.bust?'Sì':'No',t.win?'Sì':'No',t.darts.length])},
    {name:'Tiri',headers:['ID partita','N. turno globale','Giocatore','N. freccetta','Settore','Moltiplicatore','Punti','Sigla'],
      rows:allTurns.flatMap(t=>t.darts.map((d,i)=>[t.matchId,t.sequence,playerMap.get(t.playerId)||'',i+1,
        d.sector,d.multiplier,d.points,d.label]))},
    {name:'Statistiche',headers:['ID giocatore','Nome','Partite concluse','Vittorie','Vittorie %','Turni','Freccette','Punti accreditati','Media / turno','Media / 3 freccette','Miglior turno','Bust','100+','140+','180'],
      rows:stats.map(s=>[s.id,s.name,s.played,s.wins,round(s.winRate),s.turns,s.darts,s.totalCredited,
        round(s.averageVisit),round(s.average3),s.bestTurn,s.busts,s.visits100,s.visits140,s.visits180])},
  ];
  return xlsxBytes(sheets);
}
const round = n => Math.round(n*100)/100;
export function downloadBytes(bytes, filename, type) {
  const blob=new Blob([bytes],{type});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url; anchor.download=filename;
  document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function exportXlsx(data, matchId = null) {
  const bytes=buildWorkbook(data,matchId);
  const day=new Date().toISOString().slice(0,10);
  downloadBytes(bytes,`darts_${matchId?'partita':'storico'}_${day}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
export function exportBackup(data) {
  const payload={app:'Darts Score Tracker',schemaVersion:1,exportedAt:new Date().toISOString(),...data};
  const bytes=enc.encode(JSON.stringify(payload,null,2));
  downloadBytes(bytes,`darts_backup_${new Date().toISOString().slice(0,10)}.json`,'application/json');
}
