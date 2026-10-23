import { evaluateTurn, computeStats } from './engine.js';
import { getAllData, createMatch, saveDraft, commitTurn, undoLastTurn,
  renamePlayer, replaceWithBackup } from './db.js';
import { exportXlsx, exportBackup } from './export.js';

const state = {data:{players:[],matches:[],turns:[]},activeId:null,detailId:null,busy:false,view:'setup'};
const $ = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const date = iso => iso ? new Intl.DateTimeFormat('it-IT',{dateStyle:'short',timeStyle:'short'}).format(new Date(iso)) : '—';
const fmt = value => new Intl.NumberFormat('it-IT',{maximumFractionDigits:2}).format(value);
const playerName = id => state.data.players.find(p=>p.id===id)?.name ?? 'Giocatore sconosciuto';
const activeMatch = () => state.data.matches.find(m=>m.id===state.activeId);
function notify(message,error=false){
  const el=$('notification'); el.textContent=message; el.classList.toggle('error',error);el.hidden=false;
}
function clearNotice(){ $('notification').hidden=true; }
function view(name){
  state.view=name; clearNotice();
  document.querySelectorAll('.view').forEach(el=>{el.hidden=el.id!==`view-${name}`;});
  document.querySelectorAll('.tab').forEach(el=>{
    const on=el.dataset.view===name;
    el.classList.toggle('active',on);
    if(on)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
  });
  window.scrollTo({top:0,behavior:'instant'});
}
async function refresh(){
  state.data=await getAllData();
  renderSetupKnownNames();renderGame();renderHistory();renderStats();
}
function setupPlayerFields(){
  const count=Number($('player-count').value);
  const previous=[...document.querySelectorAll('[data-player-name]')].map(el=>el.value);
  $('player-inputs').innerHTML=Array.from({length:count},(_,i)=>`
    <div class="player-name"><span class="number-chip">${i+1}</span>
      <label class="field">Giocatore ${i+1}
        <input name="player-${i}" data-player-name type="text" maxlength="48" list="known-players"
          autocomplete="off" placeholder="Nome giocatore" value="${safe(previous[i]||'')}" required />
      </label></div>`).join('');
}
function renderSetupKnownNames(){
  $('known-players').innerHTML=state.data.players.map(p=>`<option value="${safe(p.name)}"></option>`).join('');
}
function recentTurns(matchId){
  return state.data.turns.filter(t=>t.matchId===matchId).sort((a,b)=>b.sequence-a.sequence);
}
function dartFields(draft){
  const opts=['<option value="">— Seleziona —</option>',
    ...Array.from({length:20},(_,i)=>`<option value="${i+1}">${i+1}</option>`),
    '<option value="B25">Bull esterno · 25</option>',
    '<option value="B50">Bull interno · 50</option>',
    '<option value="MISS">Fuori bersaglio · 0</option>'].join('');
  return Array.from({length:3},(_,i)=>{
    const d=draft[i];
    const sector=d?.sector ?? '';
    const mult=Number(d?.multiplier||1);
    const extra=['B25','B50','MISS'].includes(sector);
    const sectorOpts=opts.replace(`value="${sector}"`,`value="${sector}" selected`);
    return `<div class="dart-row" data-dart-row="${i}">
      <div class="dart-label">TIRO<br>${i+1}</div>
      <label class="field">Settore<select data-dart-sector="${i}" aria-label="Settore tiro ${i+1}">${sectorOpts}</select></label>
      <label class="field">Tipo<select data-dart-mult="${i}" aria-label="Moltiplicatore tiro ${i+1}" ${extra?'disabled':''}>
        <option value="1" ${mult===1?'selected':''}>S</option><option value="2" ${mult===2?'selected':''}>D</option><option value="3" ${mult===3?'selected':''}>T</option>
      </select></label>
      <div class="dart-points" data-dart-points="${i}" aria-label="Punti tiro ${i+1}">—</div>
    </div>`;
  }).join('');
}
function renderGame(){
  const match=activeMatch(), host=$('game-content');
  if (!match) {
    $('game-mode').textContent='301 / 501';
    host.innerHTML=`<div class="panel empty"><h3>Nessuna partita selezionata</h3>
      <p>Inizia una nuova partita oppure riprendi un incontro dallo storico.</p>
      <button class="btn btn-primary" data-view="setup">Crea una partita</button></div>`;
    return;
  }
  $('game-mode').textContent=`${match.initialScore} · ${match.checkout==='double'?'Double-out':'Straight-out'}`;
  $('game-kicker').textContent=match.status==='completed'?'PARTITA CONCLUSA':`TURNO ${match.turnCounter+1}`;
  const playingId=match.playerIds[match.currentPlayerIndex];
  const tiles=match.playerIds.map(id=>`<div class="score-card ${id===playingId?'active':''}">
    <span class="caption">${id===playingId&&match.status==='in_progress'?'● AL TIRO':'GIOCATORE'}</span>
    <strong>${safe(playerName(id))}</strong><span class="score">${match.scores[id]}</span>
    <span class="caption">punti rimanenti</span></div>`).join('');
  const recent=recentTurns(match.id);
  const undo=`<button type="button" id="undo-turn" class="btn btn-ghost" ${!match.turnCounter?'disabled':''}>↶ Annulla ultimo turno</button>`;
  const finished=match.status==='completed'
    ? `<div class="panel completed"><p class="eyebrow">GAME SHOT!</p><h3>Vince ${safe(playerName(match.winnerId))} 🎯</h3>
      <p class="subtle">Chiusura valida. La partita è salvata nello storico.</p></div>`
    : '';
  const active=match.status==='in_progress' ? `<div class="panel turn-panel">
    <div class="turn-title"><div><p class="turn-label">Tocca a</p><h3>${safe(playerName(playingId))}</h3></div>
      <div class="turn-label">RESIDUO ${match.scores[playingId]} PT</div></div>
    <div class="darts" id="dart-inputs">${dartFields(match.pendingDraft ?? [null,null,null])}</div>
    <div class="preview"><div><p class="subtle">Anteprima del turno</p><strong id="preview-result">—</strong></div>
      <div id="preview-remaining" class="subtle" aria-live="polite"></div></div>
    <div class="actions"><button type="button" class="btn btn-primary" id="confirm-turn">Conferma turno →</button>
      <button type="button" class="btn btn-secondary" id="reset-darts">Azzera tiri</button></div>
  </div>` : '';
  const recentHtml=recent.length?`<div class="last-turns"><h3>Ultimi turni</h3><div class="recent-list">`+
    recent.slice(0,6).map(t=>`<div class="recent-item"><span>#${t.sequence} · ${safe(playerName(t.playerId))} · ${t.darts.map(d=>safe(d.label)).join(' / ')}</span>
    <strong>${t.bust?'BUST':t.win?'VITTORIA':`−${t.creditedPoints}`}</strong></div>`).join('')+`</div></div>`:'';
  host.innerHTML=`<div class="score-grid">${tiles}</div>${finished}${active}
    <div class="game-foot">${undo}<button type="button" class="btn btn-ghost" data-view="history">Storico partite ↗</button></div>${recentHtml}`;
  if(match.status==='in_progress') updateDraftPreview(false);
}
function readDraftInputs(){
  return Array.from({length:3},(_,i)=>{
    const sector=document.querySelector(`[data-dart-sector="${i}"]`).value;
    if(!sector)return null;
    const multiplier=['B25','B50','MISS'].includes(sector) ? 1 : Number(document.querySelector(`[data-dart-mult="${i}"]`).value);
    return {sector,multiplier};
  });
}
function updateDraftPreview(shouldPersist=true){
  const match=activeMatch();
  if(!match||match.status!=='in_progress')return;
  // Bull e MISS hanno moltiplicatore 1. Se un tiro termina il turno, quelli dopo sono cancellati.
  for(let i=0;i<3;i++){
    const s=document.querySelector(`[data-dart-sector="${i}"]`);
    const mult=document.querySelector(`[data-dart-mult="${i}"]`);
    if(['B25','B50','MISS'].includes(s.value)){mult.value='1';mult.disabled=true;}
    else mult.disabled=false;
  }
  const inputs=readDraftInputs();
  let result;
  try { result=evaluateTurn(match.scores[match.playerIds[match.currentPlayerIndex]],inputs,match.checkout); }
  catch(error){ notify(error.message,true); $('confirm-turn').disabled=true; return; }
  if(result.complete && result.dartCount<3){
    for(let i=result.dartCount;i<3;i++){
      document.querySelector(`[data-dart-sector="${i}"]`).value='';
      document.querySelector(`[data-dart-mult="${i}"]`).value='1';
    }
  }
  for(let i=0;i<3;i++){
    const sector=document.querySelector(`[data-dart-sector="${i}"]`);
    const mult=document.querySelector(`[data-dart-mult="${i}"]`);
    const row=sector.closest('[data-dart-row]');
    const disabled=result.complete && i>=result.dartCount;
    sector.disabled=disabled;
    mult.disabled=disabled||['B25','B50','MISS'].includes(sector.value);
    row.classList.toggle('inactive',disabled);
    const dart=result.darts[i];
    document.querySelector(`[data-dart-points="${i}"]`).textContent=dart?String(dart.points):'—';
  }
  const score=$('preview-result'),remaining=$('preview-remaining');
  score.className='';
  if(result.bust){score.textContent='BUST · 0 punti';score.className='bust';}
  else if(result.win){score.textContent='GAME SHOT!';score.className='win';}
  else score.textContent=`${result.creditedPoints} punti`;
  remaining.textContent=`Residuo: ${result.remainingScore} · ${result.complete?'Turno pronto per la conferma':`Mancano ${result.missingDarts} tiro/i`}`;
  $('confirm-turn').disabled=!result.complete||state.busy;
  if(shouldPersist){
    const fresh=readDraftInputs();
    saveDraft(match.id,match.turnCounter,fresh).catch(e=>notify(`Bozza non salvata: ${e.message}`,true));
  }
}
function renderHistory(){
  const host=$('history-content');
  $('export-all').disabled=state.data.matches.length===0;
  const matches=[...state.data.matches].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if(!matches.length){host.innerHTML='<div class="panel empty"><h3>Nessuna partita archiviata</h3><p>Le tue partite appariranno qui non appena ne inizierai una.</p></div>';return;}
  host.innerHTML=matches.map(m=>{
    const detail=state.detailId===m.id;
    const turns=recentTurns(m.id).reverse();
    const names=m.playerIds.map(pid=>safe(playerName(pid))).join(' · ');
    const detailHTML=detail?`<div class="table-scroll"><table class="detail-table">
      <thead><tr><th>Turno</th><th>Giocatore</th><th>Tiri</th><th>Lanciati</th><th>Accreditati</th><th>Residuo</th><th>Esito</th></tr></thead><tbody>`+
      turns.map(t=>`<tr><td>${t.sequence}</td><td>${safe(playerName(t.playerId))}</td><td>${t.darts.map(d=>safe(d.label)).join(' / ')}</td>
      <td>${t.rawPoints}</td><td>${t.creditedPoints}</td><td>${t.endScore}</td><td>${t.bust?'Bust':t.win?'Vittoria':'OK'}</td></tr>`).join('')+
      `</tbody></table></div>`:'';
    return `<article class="history-card">
      <div class="history-top"><div><p class="eyebrow">${safe(date(m.createdAt))}</p>
        <h3>${m.initialScore} · ${m.checkout==='double'?'Double-out':'Straight-out'}</h3>
        <p class="meta">${names}</p><p class="meta">${m.status==='completed'?`Vincitore: ${safe(playerName(m.winnerId))}`:'Partita sospesa / in corso'} · ${m.turnCounter} turni</p></div>
        <span class="badge ${m.status==='in_progress'?'live':''}">${m.status==='completed'?'Conclusa':'In corso'}</span></div>
      <div class="history-actions">
        ${m.status==='in_progress'?`<button class="btn btn-primary small-btn" data-action="resume" data-id="${safe(m.id)}">Riprendi</button>`:''}
        <button class="btn btn-secondary small-btn" data-action="details" data-id="${safe(m.id)}" aria-expanded="${detail}">${detail?'Chiudi dettagli':'Mostra turni'}</button>
        <button class="btn btn-ghost small-btn" data-action="export-match" data-id="${safe(m.id)}">Excel partita</button>
      </div>${detailHTML}</article>`;
  }).join('');
}
function renderStats(){
  const stats=computeStats(state.data), host=$('stats-content');
  if(!stats.length){host.innerHTML='<div class="panel empty"><h3>Ancora nessun giocatore</h3><p>Le statistiche appariranno qui.</p></div>';return;}
  host.innerHTML=stats.map(s=>`<article class="player-stat">
    <div class="stat-header"><h3>${safe(s.name)}</h3><span class="pill">${s.played} PARTITE</span></div>
    <div class="stat-grid">
      ${statTile('Vittorie',s.wins)}${statTile('Percentuale vittorie',fmt(s.winRate)+'%')}
      ${statTile('Media / 3 freccette',fmt(s.average3))}
      ${statTile('Media / turno',fmt(s.averageVisit))}${statTile('Miglior turno',s.bestTurn)}${statTile('Bust',s.busts)}
    </div><p class="stat-extras">Turni: ${s.turns} · Freccette: ${s.darts} · Punti accreditati: ${s.totalCredited}<br>
      Visite 100+: ${s.visits100} · 140+: ${s.visits140} · 180: ${s.visits180}</p>
    <form data-rename-form="${safe(s.id)}" class="rename-form">
      <label class="field" for="rename-${safe(s.id)}" style="flex:1 1 180px">Rinomina giocatore
        <input id="rename-${safe(s.id)}" type="text" name="name" value="${safe(s.name)}" maxlength="48" required /></label>
      <button class="btn btn-ghost" type="submit" style="align-self:end">Salva nome</button></form>
  </article>`).join('');
}
function statTile(name,value){return `<div class="stat-tile"><span class="stat-value">${safe(value)}</span><span class="stat-name">${safe(name)}</span></div>`;}
async function handleClick(event){
  const tab=event.target.closest('[data-view]');
  if(tab){view(tab.dataset.view);return;}
  const action=event.target.closest('[data-action]');
  if(action){
    const id=action.dataset.id;
    if(action.dataset.action==='resume'){state.activeId=id;renderGame();view('game');}
    if(action.dataset.action==='details'){state.detailId=state.detailId===id?null:id;renderHistory();}
    if(action.dataset.action==='export-match')exportXlsx(state.data,id);
    return;
  }
  if(event.target.closest('#export-all')){exportXlsx(state.data);return;}
  if(event.target.closest('#backup')){exportBackup(state.data);return;}
  if(event.target.closest('#persistent-storage')){
    if(!navigator.storage?.persist){notify('Il browser non supporta la richiesta di storage persistente. Usa backup JSON.',true);return;}
    const accepted=await navigator.storage.persist();
    await storageStatus();
    notify(accepted?'Storage persistente autorizzato. Esegui comunque backup periodici.':'Il browser non ha concesso lo storage persistente. Esegui backup JSON periodici.',!accepted);
    return;
  }
  if(event.target.closest('#restore-trigger')){$('backup-file').click();return;}
  if(event.target.closest('#undo-turn')){
    const m=activeMatch();if(!m||!m.turnCounter||state.busy)return;
    if(!confirm('Annullare l’ultimo turno confermato?'))return;
    state.busy=true;
    try {await undoLastTurn(m.id);await refresh();notify('Ultimo turno annullato.');}
    catch(e){notify(e.message,true);}finally{state.busy=false;}
    return;
  }
  if(event.target.closest('#reset-darts')){
    document.querySelectorAll('[data-dart-sector]').forEach(el=>{el.value='';el.disabled=false;});
    document.querySelectorAll('[data-dart-mult]').forEach(el=>{el.value='1';el.disabled=false;});
    updateDraftPreview();return;
  }
  if(event.target.closest('#confirm-turn')){
    const m=activeMatch();if(!m||m.status!=='in_progress'||state.busy)return;
    state.busy=true;$('confirm-turn').disabled=true;
    try {await commitTurn(m.id,m.turnCounter,readDraftInputs());await refresh();clearNotice();}
    catch(e){notify(e.message,true);$('confirm-turn')?.removeAttribute('disabled');}
    finally{state.busy=false;}
  }
}
async function handleSubmit(event){
  if(event.target.id==='new-match-form'){
    event.preventDefault();
    if(state.busy)return;
    const names=[...document.querySelectorAll('[data-player-name]')].map(el=>el.value);
    if(state.data.matches.some(m=>m.status==='in_progress') && !confirm('Ci sono partite in corso. La nuova partita non le cancellerà: potrai riprenderle dallo storico. Proseguire?'))return;
    state.busy=true;
    try {
      const m=await createMatch({initialScore:Number($('initial-score').value),checkout:$('checkout').value,names});
      state.activeId=m.id;await refresh();view('game');
    }catch(e){notify(e.message,true);}finally{state.busy=false;}
    return;
  }
  const form=event.target.closest('[data-rename-form]');
  if(form){
    event.preventDefault();
    try {await renamePlayer(form.dataset.renameForm,form.elements.name.value);await refresh();notify('Nome aggiornato nello storico.');}
    catch(e){notify(e.message,true);}
  }
}
async function restoreFile(event){
  const file=event.target.files?.[0];event.target.value='';
  if(!file)return;
  if(file.size>25*1024*1024){notify('Il file JSON supera il limite di 25 MB.',true);return;}
  if(!confirm('Il ripristino SOSTITUIRÀ giocatori, partite e tiri locali. Hai già scaricato un backup dello storico attuale?'))return;
  state.busy=true;
  try {
    const contents=JSON.parse(await file.text());
    await replaceWithBackup(contents);
    state.activeId=null;state.detailId=null;await refresh();
    const latest=[...state.data.matches].sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0];
    state.activeId=latest?.id||null;
    renderGame();view('history');notify('Backup verificato e ripristinato.');
  }catch(e){notify(`Impossibile ripristinare: ${e.message}`,true);}finally{state.busy=false;}
}
async function storageStatus(){
  const el=$('storage-status');
  if(navigator.storage?.persisted){
    try {el.textContent=await navigator.storage.persisted()?'Storage persistente attivo':'Backup periodico consigliato';}
    catch{el.textContent='Backup periodico consigliato';}
  }
}
function connection(){
  $('connection-status').textContent=navigator.onLine?'Pronta per offline':'Offline · dati locali';
}
async function init(){
  document.addEventListener('click',e=>{handleClick(e).catch(err=>notify(err.message,true));});
  document.addEventListener('submit',e=>{handleSubmit(e).catch(err=>notify(err.message,true));});
  document.addEventListener('change',event=>{
    if(event.target.id==='player-count')setupPlayerFields();
    if(event.target.matches('[data-dart-sector], [data-dart-mult]')){
      if(event.target.matches('[data-dart-sector]') && !event.target.value){
        const i=Number(event.target.dataset.dartSector);
        for(let n=i+1;n<3;n++)document.querySelector(`[data-dart-sector="${n}"]`).value='';
      }
      updateDraftPreview();
    }
  });
  $('backup-file').addEventListener('change',restoreFile);
  window.addEventListener('online',connection);window.addEventListener('offline',connection);
  setupPlayerFields();connection();
  try {
    await refresh();
    const sorted=[...state.data.matches].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const match=sorted.find(m=>m.status==='in_progress') || sorted[0];
    state.activeId=match?.id??null;renderGame();
    view(match?.status==='in_progress'?'game':'setup');
    await storageStatus();
  } catch(error){notify('Database locale non disponibile: '+error.message,true);}
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js').catch(e=>notify('Modalità offline PWA non attiva: '+e.message,true));
  }
}
init();
