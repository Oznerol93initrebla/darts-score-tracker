import { CHECKOUTS, MODE_SCORES, MAX_PLAYERS, evaluateTurn, normalizeDart } from './engine.js';

const NAME = 'darts-score-tracker-v1';
const VERSION = 1;
let dbPromise;
const requestResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Errore IndexedDB'));
});
const transactionDone = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onabort = () => reject(tx.error || new Error('Operazione annullata.'));
  tx.onerror = () => reject(tx.error || new Error('Errore salvataggio.'));
});
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
export function validName(name) {
  const v = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!v || v.length > 48) throw new Error('Ogni nome deve contenere da 1 a 48 caratteri.');
  return v;
}

export function openDb() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('players')) db.createObjectStore('players', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('matches')) db.createObjectStore('matches', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('turns')) {
        const store = db.createObjectStore('turns', { keyPath: 'id' });
        store.createIndex('matchId', 'matchId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { dbPromise = null; reject(request.error); };
    request.onblocked = () => { dbPromise = null; reject(new Error('Chiudi le altre schede dell’app e riprova.')); };
  });
  return dbPromise;
}

export async function getAllData() {
  const db = await openDb();
  const tx = db.transaction(['players', 'matches', 'turns'], 'readonly');
  const read = Promise.all(['players','matches','turns'].map(s => requestResult(tx.objectStore(s).getAll())));
  const [players, matches, turns] = await read;
  await transactionDone(tx);
  return { players, matches, turns };
}

export async function createMatch(config) {
  const score = Number(config.initialScore);
  if (!MODE_SCORES.includes(score) || !CHECKOUTS.includes(config.checkout)) throw new Error('Modalità non valida.');
  if (!Array.isArray(config.names) || config.names.length < 1 || config.names.length > MAX_PLAYERS) {
    throw new Error('Servono da 1 a 8 giocatori.');
  }
  const names = config.names.map(validName);
  const lower = names.map(n => n.toLocaleLowerCase('it'));
  if (new Set(lower).size !== names.length) throw new Error('I giocatori della stessa partita devono essere diversi.');
  const db = await openDb();
  const tx = db.transaction(['players','matches'], 'readwrite');
  const playersStore = tx.objectStore('players');
  const matchesStore = tx.objectStore('matches');
  const all = await requestResult(playersStore.getAll());
  const selected = [];
  for (const name of names) {
    let player = all.find(p => p.name.toLocaleLowerCase('it') === name.toLocaleLowerCase('it'));
    if (!player) {
      player = { id: uid(), name, createdAt: now() };
      playersStore.put(player);
      all.push(player);
    }
    selected.push(player.id);
  }
  const match = {
    id: uid(), initialScore: score, checkout: config.checkout,
    playerIds: selected, currentPlayerIndex: 0, turnCounter: 0,
    scores: Object.fromEntries(selected.map(id => [id, score])),
    status: 'in_progress', winnerId: null, createdAt: now(), endedAt: null,
    pendingDraft: [null,null,null],
  };
  matchesStore.put(match);
  await transactionDone(tx);
  return match;
}

export async function saveDraft(matchId, expectedTurnCounter, draft) {
  const safe = sanitizeDraft(draft);
  const db = await openDb();
  const tx = db.transaction('matches', 'readwrite');
  const store = tx.objectStore('matches');
  const match = await requestResult(store.get(matchId));
  if (match?.status === 'in_progress' && match.turnCounter === expectedTurnCounter) {
    match.pendingDraft = safe;
    store.put(match);
  }
  await transactionDone(tx);
}

function sanitizeDraft(draft) {
  if (!Array.isArray(draft) || draft.length !== 3) throw new Error('Bozza non valida.');
  return draft.map(d => d == null ? null : (() => {
    const n = normalizeDart(d);
    return { sector: n.sector, multiplier: n.multiplier };
  })());
}

export async function commitTurn(matchId, expectedTurnCounter, draft) {
  const safe = sanitizeDraft(draft);
  const db = await openDb();
  const tx = db.transaction(['matches','turns'], 'readwrite');
  const ms = tx.objectStore('matches');
  const match = await requestResult(ms.get(matchId));
  if (!match || match.status !== 'in_progress' || match.turnCounter !== expectedTurnCounter) {
    tx.abort();
    throw new Error('Turno non più attivo. Aggiorna la partita.');
  }
  const playerId = match.playerIds[match.currentPlayerIndex];
  const startScore = match.scores[playerId];
  let result;
  try {
    result = evaluateTurn(startScore, safe, match.checkout);
    if (!result.complete) throw new Error('Inserisci tutti e tre i tiri, salvo bust o vittoria.');
  } catch (error) { tx.abort(); throw error; }
  const turn = {
    id: `${match.id}:${match.turnCounter+1}`, matchId: match.id,
    playerId, sequence: match.turnCounter+1, createdAt: now(),
    startScore, endScore: result.remainingScore,
    rawPoints: result.rawPoints, creditedPoints: result.creditedPoints,
    darts: result.darts, bust: result.bust, win: result.win,
  };
  match.scores[playerId] = result.remainingScore;
  match.turnCounter += 1;
  match.pendingDraft = [null,null,null];
  if (result.win) {
    match.status = 'completed'; match.winnerId = playerId; match.endedAt = now();
  } else {
    match.currentPlayerIndex = (match.currentPlayerIndex + 1) % match.playerIds.length;
  }
  tx.objectStore('turns').add(turn);
  ms.put(match);
  await transactionDone(tx);
  return turn;
}

export async function undoLastTurn(matchId) {
  const db = await openDb();
  const tx = db.transaction(['matches','turns'], 'readwrite');
  const store = tx.objectStore('matches');
  const match = await requestResult(store.get(matchId));
  if (!match || match.turnCounter <= 0) {
    tx.abort(); throw new Error('Non ci sono turni da annullare.');
  }
  const ts = tx.objectStore('turns');
  const id = `${matchId}:${match.turnCounter}`;
  const turn = await requestResult(ts.get(id));
  if (!turn) { tx.abort(); throw new Error('Dati del turno non trovati.'); }
  match.scores[turn.playerId] = turn.startScore;
  match.currentPlayerIndex = match.playerIds.indexOf(turn.playerId);
  match.turnCounter -= 1;
  match.status = 'in_progress'; match.winnerId = null; match.endedAt = null;
  match.pendingDraft = [null,null,null];
  ts.delete(id); store.put(match);
  await transactionDone(tx);
  return turn;
}

export async function renamePlayer(id, name) {
  name = validName(name);
  const db = await openDb();
  const tx = db.transaction('players', 'readwrite');
  const store = tx.objectStore('players');
  const all = await requestResult(store.getAll());
  const current = all.find(p => p.id === id);
  if (!current) { tx.abort(); throw new Error('Giocatore non trovato.'); }
  if (all.some(p => p.id !== id && p.name.toLocaleLowerCase('it') === name.toLocaleLowerCase('it'))) {
    tx.abort(); throw new Error('Esiste già un giocatore con questo nome.');
  }
  store.put({...current,name});
  await transactionDone(tx);
}

/** Valida e normalizza backup; viene RICALCOLATA ogni partita, mai fiducia nei punteggi importati. */
export function validateBackup(raw) {
  if (!raw || raw.app !== 'Darts Score Tracker' || raw.schemaVersion !== 1 ||
      !Array.isArray(raw.players) || !Array.isArray(raw.matches) || !Array.isArray(raw.turns)) {
    throw new Error('Backup JSON non riconosciuto o versione incompatibile.');
  }
  if (raw.players.length > 10000 || raw.matches.length > 100000 || raw.turns.length > 2000000) {
    throw new Error('Backup troppo grande.');
  }
  const id = value => typeof value === 'string' && value.length > 0 && value.length <= 150;
  const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const players = raw.players.map(p => {
    if (!p || !id(p.id) || !iso(p.createdAt)) throw new Error('Anagrafica giocatore non valida.');
    return {id:p.id,name:validName(p.name),createdAt:p.createdAt};
  });
  if (new Set(players.map(p=>p.id)).size !== players.length ||
      new Set(players.map(p=>p.name.toLocaleLowerCase('it'))).size !== players.length) {
    throw new Error('ID o nomi giocatori duplicati nel backup.');
  }
  const pids = new Set(players.map(p=>p.id));
  const matches = raw.matches.map(m => {
    if (!m || !id(m.id) || !MODE_SCORES.includes(m.initialScore) || !CHECKOUTS.includes(m.checkout) ||
        !['in_progress','completed'].includes(m.status) || !iso(m.createdAt) ||
        (m.endedAt != null && !iso(m.endedAt)) ||
        !Array.isArray(m.playerIds) || m.playerIds.length < 1 || m.playerIds.length > MAX_PLAYERS ||
        new Set(m.playerIds).size !== m.playerIds.length || m.playerIds.some(pid => !pids.has(pid)) ||
        !Number.isInteger(m.turnCounter) || m.turnCounter < 0 ||
        !Number.isInteger(m.currentPlayerIndex) || m.currentPlayerIndex < 0 || m.currentPlayerIndex >= m.playerIds.length) {
      throw new Error('Partita non valida nel backup.');
    }
    if (m.status === 'completed' && (!m.playerIds.includes(m.winnerId) || !m.endedAt)) throw new Error('Vincitore non valido.');
    if (m.status === 'in_progress' && (m.winnerId != null || m.endedAt != null)) throw new Error('Stato partita non coerente.');
    if (!m.scores || typeof m.scores !== 'object') throw new Error('Punteggi mancanti.');
    const scores = Object.fromEntries(m.playerIds.map(pid=>[pid,m.scores[pid]]));
    if (Object.values(scores).some(s => !Number.isInteger(s) || s < 0 || s > m.initialScore)) throw new Error('Punteggi non validi.');
    const pendingDraft = sanitizeDraft(Array.isArray(m.pendingDraft) ? m.pendingDraft : [null,null,null]);
    return {id:m.id, initialScore:m.initialScore, checkout:m.checkout, playerIds:[...m.playerIds],
      currentPlayerIndex:m.currentPlayerIndex,turnCounter:m.turnCounter,scores,
      status:m.status,winnerId:m.winnerId,createdAt:m.createdAt,endedAt:m.endedAt,pendingDraft};
  });
  if (new Set(matches.map(m=>m.id)).size !== matches.length) throw new Error('ID partite duplicati.');
  const matchMap = new Map(matches.map(m=>[m.id,m]));
  const turns = raw.turns.map(t => {
    if (!t || !id(t.id) || !id(t.matchId) || !pids.has(t.playerId) ||
        !matchMap.has(t.matchId) || !Number.isInteger(t.sequence) || t.sequence < 1 ||
        !iso(t.createdAt) || !Array.isArray(t.darts) || t.darts.length < 1 || t.darts.length > 3) {
      throw new Error('Turno non valido.');
    }
    return {id:t.id,matchId:t.matchId,playerId:t.playerId,sequence:t.sequence,createdAt:t.createdAt,
      startScore:t.startScore,endScore:t.endScore,rawPoints:t.rawPoints,creditedPoints:t.creditedPoints,
      darts:t.darts.map(d => normalizeDart(d)),bust:t.bust,win:t.win};
  });
  if (new Set(turns.map(t=>t.id)).size !== turns.length) throw new Error('Turni duplicati.');
  for (const m of matches) {
    const gameTurns = turns.filter(t=>t.matchId === m.id).sort((a,b)=>a.sequence-b.sequence);
    if (gameTurns.length !== m.turnCounter) throw new Error('Numero turni non coerente.');
    const scores = Object.fromEntries(m.playerIds.map(pid=>[pid,m.initialScore]));
    let index = 0, winner = null;
    for (const [i,t] of gameTurns.entries()) {
      if (t.sequence !== i+1 || t.id !== `${m.id}:${i+1}` || t.playerId !== m.playerIds[index] || winner) {
        throw new Error('Ordine dei turni alterato.');
      }
      const result = evaluateTurn(scores[t.playerId],t.darts,m.checkout);
      if (!result.complete || t.startScore !== scores[t.playerId] || t.endScore !== result.remainingScore ||
          t.rawPoints !== result.rawPoints || t.creditedPoints !== result.creditedPoints ||
          t.bust !== result.bust || t.win !== result.win || t.darts.length !== result.darts.length) {
        throw new Error('Punteggi o tiri del backup incoerenti.');
      }
      scores[t.playerId] = result.remainingScore;
      if (result.win) winner = t.playerId;
      else index = (index+1)%m.playerIds.length;
    }
    if (m.currentPlayerIndex !== index || m.winnerId !== winner ||
        (m.status === 'completed') !== Boolean(winner) ||
        m.playerIds.some(pid=>m.scores[pid] !== scores[pid])) {
      throw new Error('Stato finale partita incoerente.');
    }
    if (winner && m.pendingDraft.some(Boolean)) throw new Error('Bozza su partita conclusa.');
    if (!winner) evaluateTurn(scores[m.playerIds[index]], m.pendingDraft, m.checkout);
  }
  return {players,matches,turns};
}

export async function replaceWithBackup(raw) {
  const safe = validateBackup(raw);
  const db = await openDb();
  const tx = db.transaction(['players','matches','turns'], 'readwrite');
  for (const kind of ['players','matches','turns']) {
    const store = tx.objectStore(kind);
    store.clear();
    for (const item of safe[kind]) store.put(item);
  }
  await transactionDone(tx);
  return safe;
}
