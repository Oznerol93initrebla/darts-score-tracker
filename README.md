# Darts Score Tracker v1.0.0

PWA **301 / 501** con HTML, CSS e JavaScript vanilla, da 1 a 8 giocatori, una sola leg, ingresso `straight-in`, uscita `straight-out` oppure `double-out`. I dati vengono salvati in **IndexedDB**; il file Excel `.xlsx` è prodotto direttamente in JavaScript, senza librerie CDN o pacchetti npm.

## 1. Avvio da VS Code su Windows

1. Estrai l'archivio ZIP nella cartella che preferisci, per esempio `C:\Progetti\darts-score-tracker-v1.0`.
2. In VS Code usa **File → Apri cartella** e scegli la cartella estratta, che contiene `index.html`.
3. Apri **Terminale → Nuovo terminale** e digita:

   ```powershell
   py -m http.server 5500
   ```

   Se il comando `py` non è disponibile, usa `python -m http.server 5500`.
4. Apri Chrome/Edge all'indirizzo **http://localhost:5500**.
5. Per interrompere il server premi **Ctrl+C** nel terminale.

**Non aprire direttamente `index.html` tramite `file://`:** moduli JavaScript, service worker e PWA richiedono un origin servito via HTTP(S). In sviluppo `localhost` è consentito.

In alternativa usa l'estensione VS Code **Live Server** (aprendo `index.html` con *Open with Live Server*). Mantieni fisso l'indirizzo e la porta quando lavori con lo storico: **IndexedDB è isolato per origin** e passare da `localhost:5500` a `127.0.0.1:5500` o cambiare porta potrebbe mostrarti uno storico apparentemente vuoto, non condiviso.

## 2. Installazione sullo smartphone

La PWA è progettata per essere installabile su smartphone, ma **il telefono non può installarla dal server `localhost` del PC**: per l'installazione ordinaria serve un URL **HTTPS** accessibile dal dispositivo. Esempio: pubblica i file statici con GitHub Pages (o servizio HTTPS equivalente) e visita quell'indirizzo dal telefono.

- Android/Chrome: menu del browser → **Installa app** / **Aggiungi a schermata Home**.
- iPhone/Safari: **Condividi** → **Aggiungi alla schermata Home** (nome/opzione possono variare a seconda della versione di iOS).
- Dopo che i file sono stati caricati in cache, l'app funziona offline. Il primo avvio richiede una connessione.

Le partite su PC e smartphone **non si sincronizzano automaticamente**. Per spostare i dati tra dispositivi usa backup JSON e relativo ripristino. Se usi due dispositivi in parallelo, un ripristino sostituisce lo storico sul dispositivo di destinazione, non fonde gli archivi.

## 3. Uso durante la partita

1. **Nuova**: scegli 301/501, checkout, numero e nomi dei giocatori. I nomi corrispondenti allo storico esistente (senza differenze di maiuscole) riutilizzano lo stesso profilo.
2. **Partita**: per ciascuno dei tre tiri seleziona il settore da **1 a 20**, **Bull esterno 25**, **Bull interno 50** o **MISS**; per i settori numerici scegli S, D o T. I bull non hanno moltiplicatore.
3. Leggi l'anteprima del punteggio e premi **Conferma turno**. La conferma è abilitata con tre freccette, oppure prima in caso di **bust** o **vittoria**.
4. In caso di bust il punteggio torna a quello iniziale del turno; **Annulla ultimo turno** ripristina solo l'ultima registrazione, inclusa un'eventuale chiusura.
5. **Storico**: riprendi una partita non conclusa, visualizza ogni turno e scarica un file Excel singolo o globale.
6. **Statistiche**: vengono conteggiate **solo le partite concluse**. Puoi rinominare un profilo senza perdere lo storico.

### Regole definite

- `straight-in` sempre: nessun `double-in`.
- 1 leg; il primo giocatore che raggiunge zero secondo la regola scelta vince.
- In **double-out** il tiro finale deve essere un **doppio numerico** oppure **B50**. Un residuo pari a 1, un residuo negativo o zero ottenuto senza doppio producono **bust**. In straight-out basta zero esatto.
- In caso di bust o vittoria gli eventuali tiri successivi non sono registrati.
- 3-dart average = `(somma dei punti accreditati / freccette effettivamente lanciate) × 3` su partite concluse. **Un bust accredita 0** punti ma le freccette lanciate contano. I tentativi di doppio mancati non vengono analizzati, perché si registra il settore *colpito*, non il bersaglio *mirato*.
- La categoria `180` conta solo i turni di 180 punti; `100+` e `140+` sono soglie inclusive e si sovrappongono (un 180 rientra in tutte e tre).

## 4. Storico Excel e backup

**Excel `.xlsx`**: file con fogli `Giocatori`, `Partite`, `Turni`, `Tiri`, `Statistiche`. L'esportatore è un modulo JavaScript standalone (`js/export.js`) che crea un vero file **OOXML/XLSX**, con un contenitore ZIP non compresso e celle di testo come stringhe; non necessita di rete e non tratta i nomi come formule.

**Backup `.json`**: esportazione di tutte le tabelle di IndexedDB. Il ripristino controlla l'integrità dell'intero storico (giocatori, sequenza tiri, punteggi e vincitore) **prima** di sostituire i dati; un backup incompatibile/non coerente viene respinto. **Ripristino = sostituzione**, non fusione. La dimensione di importazione massima gestita dall'interfaccia è 25 MB.

Lo storage locale non è garantito per sempre: eliminare dati sito, navigare in incognito, cambiare browser/origin o disinstallare la PWA può far sparire lo storico. Usa **Proteggi memoria locale** (quando supportato dal browser) e salva regolarmente un backup JSON su altro supporto. Il pulsante non annulla la necessità di un backup.

## 5. Struttura dei file

```text
darts-score-tracker-v1.0/
├── index.html                 # quattro schermate PWA
├── manifest.webmanifest       # installazione su smartphone
├── sw.js                      # cache offline dei file statici
├── css/
│   └── style.css              # interfaccia responsive/accessibile
├── js/
│   ├── app.js                 # interfaccia, eventi, flusso partite
│   ├── engine.js              # regole 301/501 e statistiche (funzioni pure)
│   ├── db.js                  # IndexedDB, transazioni e backup
│   └── export.js              # esportatore Excel XLSX e backup JSON
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── tests/
│   ├── engine.test.js
│   └── export.test.js
├── package.json               # solo comandi, nessuna dipendenza npm
└── README.md
```

## 6. Test automatici

Se Node.js è installato, apri un terminale nella radice del progetto:

```powershell
node --test tests/*.test.js
```

In PowerShell su Windows (se il glob non viene espanso dalla shell) usa `npm test` che lancia lo stesso comando; con Node 22 funziona correttamente. I test coprono: 180, double-out, bull, bust, tre freccette, validazione settori, statistiche e generazione del workbook.

Il workbook di test è stato verificato durante lo sviluppo anche con `openpyxl`: sono presenti tutti e cinque i fogli e i nomi contenenti segni come `=` restano celle di testo.

## 7. Limiti dichiarati v1.0

- Nessun server, account, sincronizzazione cloud o modalità a set/leg multipli.
- Non è previsto modificare turni diversi dall'ultimo confermato.
- Il backup sostituisce, non unisce, i dati presenti.
- L'interfaccia usa controlli nativi `<select>`: robusti e accessibili, ma non è ancora un tastierino visuale a forma di bersaglio.
- La persistenza dati e l'offline sono legati all'origin e alle politiche del browser.
- Il file XLSX è valido ma **non compresso**: il peso cresce più velocemente di un workbook esportato con librerie che usano ZIP deflate. Per l'uso locale con storico normale è una scelta accettabile e priva di dipendenze.

## 8. Manutenzione e aggiornamenti

La cache statica è identificata dalla costante `CACHE` in `sw.js`: se cambi i file distribuiti, modifica la versione della cache per forzare l'aggiornamento. **Non cancellare IndexedDB** durante un aggiornamento. Per esportare/ripristinare file JSON il campo `schemaVersion` è attualmente `1`: qualunque modifica incompatibile richiederà una migrazione.
