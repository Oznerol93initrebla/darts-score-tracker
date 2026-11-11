/** Unione pura di archivi GIÀ validati dal motore di gioco.
 * Non modifica i dati in input: l'applicazione IndexedDB avviene separatamente e in modo atomico.
 */
const playerKey = name => name.toLocaleLowerCase('it');
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);

function sameTurn(a,b) {
  return a.id === b.id && a.matchId === b.matchId && a.playerId === b.playerId &&
    a.sequence === b.sequence && a.createdAt === b.createdAt &&
    a.startScore === b.startScore && a.endScore === b.endScore &&
    a.rawPoints === b.rawPoints && a.creditedPoints === b.creditedPoints &&
    a.bust === b.bust && a.win === b.win && equal(a.darts,b.darts);
}

function sameIdentity(a,b) {
  return a.id === b.id && a.initialScore === b.initialScore &&
    a.checkout === b.checkout && a.createdAt === b.createdAt && equal(a.playerIds,b.playerIds);
}

export function mergeValidatedArchives(current, archives) {
  if (!Array.isArray(archives) || archives.length === 0) throw new Error('Scegli almeno un backup JSON.');
  const data = {
    players:[...current.players], matches:[...current.matches], turns:[...current.turns],
  };
  const byPlayerId=new Map(data.players.map(p=>[p.id,p]));
  // Ricorda gli ID alternativi visti nei file della stessa importazione, anche dopo una rinomina.
  const idAliases=new Map(byPlayerId);
  const byPlayerName=new Map(data.players.map(p=>[playerKey(p.name),p]));
  const byMatchId=new Map(data.matches.map((m,i)=>[m.id,i]));
  const turnsByMatch=new Map();
  for (const t of data.turns) {
    if (!turnsByMatch.has(t.matchId)) turnsByMatch.set(t.matchId,[]);
    turnsByMatch.get(t.matchId).push(t);
  }
  const summary={files:archives.length,newPlayers:0,newMatches:0,updatedMatches:0,
    skippedMatches:0,newTurns:0};

  for (const archive of archives) {
    const playersIds=new Map();
    for (const player of archive.players) {
      // L'ID ha precedenza sul nome: una rinomina non genera una persona nuova.
      let existing=idAliases.get(player.id) || byPlayerName.get(playerKey(player.name));
      if (!existing) {
        existing={...player};
        byPlayerId.set(existing.id,existing);
        byPlayerName.set(playerKey(existing.name),existing);
        data.players.push(existing);
        summary.newPlayers++;
      }
      idAliases.set(player.id,existing);
      playersIds.set(player.id,existing.id);
    }
    const inputTurns=new Map();
    for (const turn of archive.turns) {
      if (!inputTurns.has(turn.matchId)) inputTurns.set(turn.matchId,[]);
      inputTurns.get(turn.matchId).push({...turn,playerId:playersIds.get(turn.playerId)});
    }
    for (const match of archive.matches) {
      const playerIds=match.playerIds.map(id=>playersIds.get(id));
      if (new Set(playerIds).size !== playerIds.length) {
        throw new Error(`Nella partita ${match.id} due giocatori corrispondono allo stesso profilo: importazione annullata.`);
      }
      const incoming={...match,playerIds,
        winnerId:match.winnerId==null?null:playersIds.get(match.winnerId),
        scores:Object.fromEntries(match.playerIds.map(id=>[playersIds.get(id),match.scores[id]]))};
      const incomingTurns=(inputTurns.get(match.id)||[]).sort((a,b)=>a.sequence-b.sequence);
      const index=byMatchId.get(match.id);
      if (index === undefined) {
        byMatchId.set(match.id,data.matches.length);
        data.matches.push(incoming);
        data.turns.push(...incomingTurns);
        turnsByMatch.set(match.id,incomingTurns);
        summary.newMatches++;
        summary.newTurns+=incomingTurns.length;
        continue;
      }
      const existing=data.matches[index];
      if (!sameIdentity(existing,incoming)) {
        throw new Error(`Conflitto sulla partita ${match.id}: impostazioni o giocatori differenti. Nessun dato importato.`);
      }
      const previousTurns=(turnsByMatch.get(match.id)||[]).slice().sort((a,b)=>a.sequence-b.sequence);
      const common=Math.min(previousTurns.length,incomingTurns.length);
      for (let i=0;i<common;i++) {
        if (!sameTurn(previousTurns[i],incomingTurns[i])) {
          throw new Error(`Conflitto sui tiri della partita ${match.id} (turno ${i+1}). Nessun dato importato.`);
        }
      }
      if (incomingTurns.length > previousTurns.length) {
        if (existing.status==='completed') {
          throw new Error(`La partita ${match.id} risulta già conclusa con turni differenti.`);
        }
        // Una copia successiva può completare una partita presente in un vecchio backup.
        data.matches[index]=incoming;
        const extra=incomingTurns.slice(previousTurns.length);
        data.turns.push(...extra);
        turnsByMatch.set(match.id,incomingTurns);
        summary.updatedMatches++;
        summary.newTurns+=extra.length;
      } else {
        // Versione uguale o più vecchia: conserva anche l'eventuale bozza locale.
        summary.skippedMatches++;
      }
    }
  }
  return {data,summary};
}
