/** Motore puro 301/501: nessuna dipendenza dal DOM o dal database. */
export const APP_VERSION = '1.0.0';
export const MAX_PLAYERS = 8;
export const MODE_SCORES = [301, 501];
export const CHECKOUTS = ['straight', 'double'];

/**
 * sector: "1"..."20", "B25", "B50" o "MISS".
 * multiplier: 1, 2, 3 (per bull/miss deve essere 1).
 */
export function normalizeDart(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Freccetta non valida.');
  const sector = String(value.sector ?? '');
  const multiplier = Number(value.multiplier);
  if (['B25', 'B50', 'MISS'].includes(sector)) {
    if (multiplier !== 1) throw new Error('Bull e mancato bersaglio non hanno moltiplicatore.');
    const points = sector === 'B25' ? 25 : sector === 'B50' ? 50 : 0;
    return { sector, multiplier: 1, points, label: sector === 'MISS' ? 'MISS' : sector };
  }
  if (!/^(?:[1-9]|1\d|20)$/.test(sector) || ![1, 2, 3].includes(multiplier)) {
    throw new Error('Scegli un settore da 1 a 20 e S, D o T.');
  }
  return { sector, multiplier, points: Number(sector) * multiplier,
    label: `${['', 'S', 'D', 'T'][multiplier]}${sector}` };
}

export function isDoubleCheckout(dart) {
  return dart.sector === 'B50' || (/^(?:[1-9]|1\d|20)$/.test(dart.sector) && dart.multiplier === 2);
}

/**
 * Previsione turno per lanci sequenziali, null = lancio non ancora inserito.
 * complete diventa true con 3 freccette, vittoria o bust.
 * I lanci successivi a vittoria/bust non sono consumati.
 */
export function evaluateTurn(startScore, inputs, checkout) {
  if (!Number.isInteger(startScore) || startScore < 1) throw new Error('Punteggio iniziale non valido.');
  if (!CHECKOUTS.includes(checkout)) throw new Error('Regola di chiusura sconosciuta.');
  if (!Array.isArray(inputs) || inputs.length > 3) throw new Error('Un turno consente al massimo tre tiri.');

  const darts = [];
  let score = startScore;
  let rawPoints = 0;
  let bust = false;
  let win = false;
  let gap = false;
  for (const input of inputs) {
    if (input == null) { gap = true; continue; }
    if (gap && !bust && !win) throw new Error('Inserisci i tiri in ordine, senza caselle vuote.');
    if (bust || win) break;
    const dart = normalizeDart(input);
    darts.push(dart);
    rawPoints += dart.points;
    const nextScore = score - dart.points;
    if (nextScore < 0 || (checkout === 'double' && (nextScore === 1 ||
        (nextScore === 0 && !isDoubleCheckout(dart))))) {
      bust = true;
      score = startScore;
    } else {
      score = nextScore;
      if (score === 0) win = true;
    }
  }
  const complete = bust || win || darts.length === 3;
  return {
    darts, dartCount: darts.length, rawPoints,
    creditedPoints: bust ? 0 : startScore - score,
    remainingScore: score, bust, win, complete,
    missingDarts: complete ? 0 : 3 - darts.length,
  };
}

export function computeStats(data, matchFilter = null) {
  const players = new Map(data.players.map(p => [p.id, {
    id: p.id, name: p.name, played: 0, wins: 0, turns: 0, darts: 0,
    totalCredited: 0, totalRaw: 0, busts: 0, bestTurn: 0,
    visits100: 0, visits140: 0, visits180: 0,
  }]));
  const matches = data.matches.filter(m => m.status === 'completed' && (!matchFilter || m.id === matchFilter));
  const ids = new Set(matches.map(m => m.id));
  for (const match of matches) {
    for (const pid of match.playerIds) {
      const stat = players.get(pid);
      if (!stat) continue;
      stat.played++;
      if (pid === match.winnerId) stat.wins++;
    }
  }
  for (const turn of data.turns) {
    if (!ids.has(turn.matchId)) continue;
    const stat = players.get(turn.playerId);
    if (!stat) continue;
    stat.turns++;
    stat.darts += turn.darts.length;
    stat.totalRaw += turn.rawPoints;
    stat.totalCredited += turn.creditedPoints;
    if (turn.bust) stat.busts++;
    stat.bestTurn = Math.max(stat.bestTurn, turn.creditedPoints);
    if (turn.creditedPoints >= 100) stat.visits100++;
    if (turn.creditedPoints >= 140) stat.visits140++;
    if (turn.creditedPoints === 180) stat.visits180++;
  }
  return [...players.values()].map(s => ({...s,
    winRate: s.played ? 100 * s.wins / s.played : 0,
    averageVisit: s.turns ? s.totalCredited / s.turns : 0,
    average3: s.darts ? 3 * s.totalCredited / s.darts : 0,
  })).sort((a,b) => b.wins - a.wins || b.average3 - a.average3 || a.name.localeCompare(b.name, 'it'));
}
