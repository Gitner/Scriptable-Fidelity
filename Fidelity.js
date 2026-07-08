// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: wallet;
/* ============================================================
   FIDELITY — Portafoglio carte fedeltà per Scriptable  v1.4.1
   ------------------------------------------------------------
   v1.4: scansione con fotocamera (BarcodeDetector nativo se
   disponibile, altrimenti jsQR per i QR e Quagga2 per i codici
   1D, scaricati e messi in cache al primo uso); rotazione a
   schermo pieno che non copre più il numero; i payload QR non
   vengono più privati degli spazi.
   v1.4.1: auto-verifica di avvio PERMANENTE (una sonda a 1,2s:
   se il boot non è sano appare un banner rosso in pagina e il
   dettaglio finisce nel log) + versione visibile nell'header,
   così una copia iCloud stantia si riconosce a colpo d'occhio.
   • Lista tessere a griglia (rapporto carta di credito), colori
     brand, preferita ★ in cima, ricerca istantanea.
   • Vista a schermo intero su sfondo BIANCO per la scansione:
     luminosità portata automaticamente al 100% e ripristinata
     alla chiusura. Tocca il barcode per ruotarlo di 90°,
     tocca il codice per copiarlo.
   • Formati: AUTO (EAN13/EAN8/UPC con verifica checksum, altrimenti
     CODE128), QR, CODE128, EAN13, EAN8, UPC, CODE39, ITF, MSI, codabar.
   • Dati nel Keychain (chiave "fidelity").
   • Librerie (JsBarcode + qrcode-generator) scaricate UNA volta
     al primo avvio, verificate nel contenuto e salvate in locale:
     poi tutto offline. Se un file risulta corrotto viene riscaricato
     da solo; ogni errore compare a schermo (mai schermate bianche).
   • Widget: mostra la tessera preferita (★) o quella indicata
     nel parametro del widget (nome o parte del nome).
     Il tap sul widget apre direttamente quel barcode.
   • Menu ⋯ : esporta/importa JSON dagli appunti, rigenera la
     cache PNG usata dal widget.
   ============================================================ */

const VERSION = '1.4.1'
const KEY  = 'fidelity'
const fm   = FileManager.local()
const DIR  = fm.joinPath(fm.libraryDirectory(), 'fidelity')
if (!fm.fileExists(DIR)) fm.createDirectory(DIR, true)

const LIBS = [
  { f: 'jsbarcode.min.js', sig: 'JsBarcode', u: [
      'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js',
      'https://unpkg.com/jsbarcode@3.11.6/dist/JsBarcode.all.min.js' ] },
  { f: 'qrcode-gen.js', sig: 'qrcode', u: [
      'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js',
      'https://unpkg.com/qrcode-generator@1.4.4/qrcode.js' ] }
]

// ---------------- Storage ----------------

function loadCards() {
  try {
    if (Keychain.contains(KEY)) {
      const v = JSON.parse(Keychain.get(KEY))
      if (Array.isArray(v)) return v
      if (v && Array.isArray(v.cards)) return v.cards
    }
  } catch (e) {}
  return []
}

function saveCards(cards) {
  Keychain.set(KEY, JSON.stringify(cards))
}

function pngPath(id) {
  return fm.joinPath(DIR, 'card_' + id + '.png')
}

function writePngs(pngs, cards) {
  const keep = new Set(cards.map(c => 'card_' + c.id + '.png'))
  try {
    for (const f of fm.listContents(DIR)) {
      if (f.indexOf('card_') === 0 && f.slice(-4) === '.png' && !keep.has(f)) {
        fm.remove(fm.joinPath(DIR, f))
      }
    }
  } catch (e) {}
  for (const id in pngs) {
    try { fm.write(pngPath(id), Data.fromBase64String(pngs[id])) } catch (e) {}
  }
}

// Respinge pagine d'errore HTML, redirect di captive portal e download
// troncati: era la causa della schermata bianca (un file "valido" solo
// per lunghezza finiva in cache e rompeva la pagina a ogni avvio).
function libOk(l, t) {
  if (typeof t !== 'string' || t.length < 20000) return false
  if (t.trim().charAt(0) === '<') return false
  return t.indexOf(l.sig) >= 0
}

async function loadLibs() {
  const out = []
  for (const l of LIBS) {
    const p = fm.joinPath(DIR, l.f)
    let src = fm.fileExists(p) ? fm.readString(p) : null
    if (!libOk(l, src)) {                    // assente o corrotta: (ri)scarica
      if (fm.fileExists(p)) fm.remove(p)
      src = null
      for (const u of l.u) {
        try {
          const r = new Request(u)
          r.timeoutInterval = 20
          const t = await r.loadString()
          if (libOk(l, t)) { src = t; break }
        } catch (e) {}
      }
      if (!src) throw new Error('Download fallito o file non valido: ' + l.f)
      fm.writeString(p, src)
    }
    out.push(src)
  }
  return out
}

// Librerie di decodifica per la scansione: scaricate solo al primo uso,
// stessa validazione e auto-riparazione delle librerie di disegno.
const SCAN_LIBS = [
  { k: 'jsqr', f: 'jsqr.min.js', sig: 'jsQR', u: [
      'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
      'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js' ] },
  { k: 'quagga', f: 'quagga2.min.js', sig: 'Quagga', u: [
      'https://cdn.jsdelivr.net/npm/@ericblade/quagga2@1.8.4/dist/quagga.min.js',
      'https://unpkg.com/@ericblade/quagga2@1.8.4/dist/quagga.min.js' ] }
]

async function loadScanLibs() {
  const out = {}
  for (const l of SCAN_LIBS) {
    const p = fm.joinPath(DIR, l.f)
    let src = fm.fileExists(p) ? fm.readString(p) : null
    if (!libOk(l, src)) {
      if (fm.fileExists(p)) fm.remove(p)
      src = null
      for (const u of l.u) {
        try {
          const r = new Request(u)
          r.timeoutInterval = 20
          const t = await r.loadString()
          if (libOk(l, t)) { src = t; break }
        } catch (e) {}
      }
      if (src) fm.writeString(p, src)
    }
    if (src) out[l.k] = src
  }
  return out
}

// Riduce la foto prima di passarla alla pagina: base64 più corto, decode più rapido.
function shrink(img, maxSide) {
  const w = img.size.width, h = img.size.height
  const k = Math.min(1, maxSide / Math.max(w, h))
  if (k >= 1) return img
  const dc = new DrawContext()
  dc.size = new Size(Math.round(w * k), Math.round(h * k))
  dc.respectScreenScale = false
  dc.opaque = true
  dc.drawImageInRect(img, new Rect(0, 0, dc.size.width, dc.size.height))
  return dc.getImage()
}

// ---------------- Widget ----------------

async function runWidget() {
  const cards = loadCards()
  const param = String(args.widgetParameter || '').trim().toLowerCase()
  let card = null
  if (param) {
    card = cards.find(c => c.id === param) ||
           cards.find(c => c.name.toLowerCase().indexOf(param) >= 0)
  }
  if (!card) card = cards.find(c => c.fav) || cards[0]

  const w = new ListWidget()
  w.backgroundColor = new Color('#ffffff')

  if (!card) {
    const t = w.addText('Nessuna tessera')
    t.font = Font.mediumSystemFont(12)
    t.textColor = new Color('#8b949e')
    t.centerAlignText()
  } else {
    w.url = URLScheme.forRunningScript() + '?card=' + encodeURIComponent(card.id)
    w.setPadding(10, 10, 10, 10)
    const name = w.addText(card.name.toUpperCase())
    name.font = Font.heavySystemFont(11)
    name.textColor = new Color(/^#[0-9a-fA-F]{6}$/.test(card.color || '') ? card.color : '#0b0f14')
    name.centerAlignText()
    name.lineLimit = 1
    w.addSpacer(6)
    const p = pngPath(card.id)
    if (fm.fileExists(p)) {
      const wi = w.addImage(fm.readImage(p))
      wi.centerAlignImage()
      wi.applyFittingContentMode()
    } else {
      const c = w.addText(card.code)
      c.font = Font.regularMonospacedSystemFont(13)
      c.textColor = new Color('#0b0f14')
      c.centerAlignText()
      w.addSpacer(4)
      const h = w.addText('Apri l’app per generare il barcode')
      h.font = Font.systemFont(9)
      h.textColor = new Color('#8b949e')
      h.centerAlignText()
    }
  }
  Script.setWidget(w)
}

// ---------------- HTML ----------------

function buildHTML(cards, autoOpen, libs) {
  const INIT = JSON.stringify(cards).replace(/</g, '\\u003c')
  const AUTO = JSON.stringify(autoOpen).replace(/</g, '\\u003c')
  // Le librerie viaggiano come stringhe JSON (ogni "<" diventa \u003c) e sono
  // eseguite con eval dentro la pagina: il parser HTML non può MAI essere
  // rotto dal loro contenuto. Se una libreria è invalida, l'errore diventa
  // un overlay leggibile con tasto di ripristino, non una schermata bianca.
  const LIBSRC = '[' +
    libs.map(s => JSON.stringify(s).replace(/</g, '\\u003c')).join(',\n') + ']'

  const CSS = String.raw`
:root{--bg:#080b10;--panel:#0d1219;--line:#1b2430;--txt:#e6edf3;--dim:#8b949e;
      --blue:#79c0ff;--green:#3fb950;--red:#f85149}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none}
html,body{overscroll-behavior:none}
body{margin:0;position:fixed;inset:0;overflow:hidden;background:var(--bg);color:var(--txt);
     font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-size:14px;
     -webkit-user-select:none;user-select:none}
body.lock #list{overflow:hidden}
button{font-family:inherit;font-size:14px;color:var(--txt);background:transparent;
       border:1px solid var(--line);border-radius:10px;padding:8px 12px}
button:active{opacity:.7}
.app{height:100%;display:flex;flex-direction:column}
header{display:flex;align-items:center;justify-content:space-between;
       padding:calc(12px + env(safe-area-inset-top)) 14px 8px}
.brand{display:flex;align-items:baseline;min-width:0}
h1{font-family:Syne,system-ui,sans-serif;font-weight:800;font-size:22px;
   letter-spacing:.06em;margin:0;color:var(--blue)}
#count{font-size:11px;color:var(--dim);margin-left:10px;letter-spacing:.08em;white-space:nowrap}
.hbtns{display:flex;gap:8px}
.ic{width:40px;height:40px;padding:0;font-size:20px;line-height:1;border-radius:12px}
.searchwrap{padding:0 14px 10px}
#search{width:100%;background:var(--panel);border:1px solid var(--line);color:var(--txt);
        border-radius:10px;padding:10px 12px;font-family:inherit;font-size:16px;
        -webkit-appearance:none;appearance:none}
#list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;
      padding:2px 14px calc(30px + env(safe-area-inset-bottom))}
#grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{aspect-ratio:1.586;border-radius:14px;padding:12px;position:relative;
      display:flex;flex-direction:column;justify-content:space-between;
      box-shadow:0 4px 14px rgba(0,0,0,.45);transition:transform .1s}
.card:active{transform:scale(.97)}
.card::after{content:'';position:absolute;inset:0;border-radius:14px;
             box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);pointer-events:none}
.card .nm{font-family:Syne,system-ui,sans-serif;font-weight:800;font-size:15px;
          line-height:1.15;letter-spacing:.02em;overflow:hidden;padding-right:16px}
.card .cd{font-size:11px;opacity:.85;letter-spacing:.08em}
.card .st{position:absolute;top:8px;right:11px;font-size:14px}
#empty{text-align:center;color:var(--dim);padding:70px 20px}
#empty .e1{font-family:Syne,system-ui,sans-serif;font-weight:700;font-size:17px;
           color:var(--txt);margin-bottom:8px}
#empty .e2{font-size:12px}
/* -------- dettaglio: stage bianco per la scansione -------- */
#detail{position:fixed;inset:0;background:#ffffff;color:#0b0f14;z-index:30;
        display:flex;flex-direction:column;
        padding:calc(10px + env(safe-area-inset-top)) 14px calc(10px + env(safe-area-inset-bottom))}
#detail .dbar{display:flex;align-items:center;gap:8px;position:relative;z-index:6}
#detail button{color:#0b0f14;border-color:#d0d7de;background:#fff}
#dName{flex:1;min-width:0;font-family:Syne,system-ui,sans-serif;font-weight:800;
       font-size:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.txt{font-size:13px;padding:9px 12px}
.stage{flex:1;display:flex;flex-direction:column;align-items:center;
       justify-content:center;gap:14px;min-height:0}
#dCanvas{max-width:min(92vw,560px);max-height:44vh;width:auto;height:auto;background:#fff}
/* rotazione (v1.4): il canvas ruotato diventa un layer fisso centrato nel
   viewport, così non si sovrappone più a codice/formato/note (che vengono
   solo nascosti finché è ruotato). max-width limita l'ALTEZZA visiva
   post-rotazione, max-height la LARGHEZZA visiva. */
#detail.rot #dCanvas{position:fixed;inset:0;margin:auto;transform:rotate(90deg);
  max-width:82vh;max-height:78vw;z-index:5}
#detail.rot #dCode,#detail.rot #dFmt,#detail.rot #dNote,#detail.rot #dHint{visibility:hidden}
.ver{font:600 10px 'JetBrains Mono',ui-monospace,monospace;color:var(--dim);
     letter-spacing:.08em;opacity:.7;align-self:flex-end;margin:0 0 4px 8px}
.coderow{display:flex;gap:8px}
.coderow input{flex:1;min-width:0}
#eScan{width:54px;flex:0 0 54px;font-size:20px;padding:0}
#dCode{font-size:17px;font-weight:600;letter-spacing:.16em;text-align:center;
       word-break:break-all;padding:0 8px}
#dFmt{font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:#57606a}
#dNote{font-size:12px;color:#57606a;text-align:center;padding:0 16px}
.derr{color:#a40e26;font-size:13px;text-align:center;padding:0 20px}
#dHint{font-size:10px;color:#8b949e;text-align:center;letter-spacing:.04em}
/* -------- fogli (editor / menu) -------- */
#editor,#menu{position:fixed;inset:0;background:rgba(2,4,8,.78);display:flex;align-items:flex-end}
#editor{z-index:40}
#menu{z-index:50}
.sheet{width:100%;background:var(--panel);border-top:1px solid var(--line);
       border-radius:18px 18px 0 0;padding:18px 16px calc(22px + env(safe-area-inset-bottom));
       max-height:92vh;overflow-y:auto;-webkit-overflow-scrolling:touch}
.stitle{font-family:Syne,system-ui,sans-serif;font-weight:800;font-size:17px;color:var(--blue)}
label{display:block;font-size:11px;letter-spacing:.14em;text-transform:uppercase;
      color:var(--dim);margin:15px 0 6px}
.fhint{color:var(--green);text-transform:none;letter-spacing:0;margin-left:6px}
input,select{width:100%;background:#0a0f16;border:1px solid var(--line);color:var(--txt);
             border-radius:10px;padding:12px;font-family:inherit;font-size:16px;
             -webkit-appearance:none;appearance:none;-webkit-user-select:text;user-select:text}
#ePv{background:#fff;border-radius:10px;margin-top:12px;padding:10px;
     display:flex;justify-content:center}
#eCanvas{max-width:100%;height:auto}
.err{color:#ffb4ae;font-size:12px;margin-top:8px}
.swatches{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;padding:4px 2px}
.sw{width:100%;aspect-ratio:1;border-radius:50%;border:2px solid transparent;
    box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}
.sw.sel{border-color:#fff}
.rowbtns{display:flex;gap:10px;margin-top:20px}
.rowbtns button{flex:1;padding:13px;font-size:15px}
.primary{background:var(--green);border-color:var(--green);color:#04140a;font-weight:600}
.danger{color:var(--red);border-color:rgba(248,81,73,.45)}
.wide{width:100%;margin-top:10px;padding:12px}
.row{display:block;width:100%;text-align:left;padding:15px 6px;border:0;border-radius:0;
     border-bottom:1px solid var(--line);font-size:15px}
.sheet .row:last-of-type{border-bottom:0}
.row.dim{color:var(--dim);text-align:center}
#toast{position:fixed;left:50%;bottom:calc(26px + env(safe-area-inset-bottom));
       transform:translateX(-50%);background:#0d1219;border:1px solid var(--line);
       color:var(--txt);padding:10px 16px;border-radius:12px;font-size:13px;
       z-index:60;max-width:86vw;text-align:center}
#toast.err{border-color:rgba(248,81,73,.5);color:#ffb4ae}
/* -------- errore fatale: sempre visibile, mai schermata bianca -------- */
#fatal{position:fixed;inset:0;background:var(--bg);z-index:100;display:flex;
       align-items:center;justify-content:center;padding:26px}
#fatal .box{max-width:420px;width:100%;text-align:center}
#fatal h2{font-family:Syne,system-ui,sans-serif;font-weight:800;font-size:18px;
          color:var(--red);margin:0 0 10px}
#fatal p{color:var(--dim);font-size:13px;line-height:1.55;word-break:break-word;margin:0}
#fatal button{display:block;width:100%;margin-top:14px;padding:13px;font-size:15px}
/* FIX v1.2 — ULTIMA regola, non spostare: le regole autore (#detail{display:flex},
   #editor/#menu/#fatal…) vincono sul foglio user-agent che implementa
   [hidden]{display:none}. Senza questa riga i pannelli sono TUTTI visibili e
   sovrapposti dal primo frame: il "bianco" è #detail a schermo intero.
   In fondo + !important vince su qualunque motore. */
[hidden]{display:none !important}
`

  const BODY = String.raw`
<div class="app">
  <header>
    <div class="brand"><h1>FIDELITY</h1><span class="ver">v${VERSION}</span><span id="count"></span></div>
    <div class="hbtns">
      <button class="ic" id="btnMenu" aria-label="Menu">&#8943;</button>
      <button class="ic" id="btnAdd" aria-label="Aggiungi">&#65291;</button>
    </div>
  </header>
  <div class="searchwrap">
    <input id="search" type="search" placeholder="Cerca tessera&#8230;"
           autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
  </div>
  <main id="list">
    <div id="grid"></div>
    <div id="empty" hidden>
      <div class="e1">Nessuna tessera</div>
      <div class="e2">Tocca &#65291; per aggiungere la prima</div>
    </div>
  </main>
</div>

<section id="detail" hidden>
  <div class="dbar">
    <button class="ic" id="dBack" aria-label="Indietro">&#8249;</button>
    <div id="dName"></div>
    <button class="ic" id="dStar" aria-label="Preferita">&#9734;</button>
    <button class="txt" id="dEdit">Modifica</button>
  </div>
  <div class="stage">
    <canvas id="dCanvas"></canvas>
    <div id="dErr" class="derr" hidden></div>
    <div id="dCode"></div>
    <div id="dFmt"></div>
    <div id="dNote"></div>
  </div>
  <div id="dHint">tocca il barcode per ruotarlo &#183; tocca il codice per copiarlo</div>
</section>

<section id="editor" hidden>
  <div class="sheet">
    <div class="stitle" id="eTitle">Nuova tessera</div>
    <label for="eName">Nome</label>
    <input id="eName" autocomplete="off" autocorrect="off" spellcheck="false">
    <label for="eCode">Codice</label>
    <div class="coderow">
      <input id="eCode" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
      <button type="button" id="eScan" aria-label="Scansiona con la fotocamera">&#128247;</button>
    </div>
    <label for="eFormat">Formato <span class="fhint" id="eFmtHint"></span></label>
    <select id="eFormat">
      <option value="AUTO">Auto (consigliato)</option>
      <option value="QR">QR</option>
      <option value="CODE128">CODE128</option>
      <option value="EAN13">EAN-13</option>
      <option value="EAN8">EAN-8</option>
      <option value="UPC">UPC-A</option>
      <option value="CODE39">CODE39</option>
      <option value="ITF">ITF</option>
      <option value="MSI">MSI</option>
      <option value="codabar">Codabar</option>
    </select>
    <div id="ePv" hidden><canvas id="eCanvas"></canvas></div>
    <div id="eErr" class="err" hidden></div>
    <label>Colore</label>
    <div id="eSw" class="swatches"></div>
    <label for="eNote">Note (opzionale)</label>
    <input id="eNote" autocomplete="off">
    <div class="rowbtns">
      <button id="eCancel">Annulla</button>
      <button class="primary" id="eSave">Salva</button>
    </div>
    <button class="danger wide" id="eDel" hidden>Elimina tessera</button>
  </div>
</section>

<section id="menu" hidden>
  <div class="sheet">
    <button class="row" id="mScan">Scansiona nuova tessera</button>
    <button class="row" id="mExport">Esporta JSON negli appunti</button>
    <button class="row" id="mImport">Importa JSON dagli appunti</button>
    <button class="row" id="mCache">Rigenera cache widget</button>
    <button class="row dim" id="mClose">Chiudi</button>
  </div>
</section>

<div id="toast" hidden></div>

<div id="fatal" hidden>
  <div class="box">
    <h2>Qualcosa &egrave; andato storto</h2>
    <p id="fMsg"></p>
    <button class="primary" id="fReset">Ripristina librerie</button>
    <button id="fClose">Continua comunque</button>
  </div>
</div>
`

  const PAGE = String.raw`
/* -------- bridge Scriptable <-> pagina (canale unico) -------- */
window.__boot && window.__boot.push('page')
window.__bridge = {
  q: [], w: null, p: {}, i: 0,
  emit: function (ev) {
    if (this.w) { var f = this.w; this.w = null; f(ev) } else this.q.push(ev)
  },
  next: function (cb, reply) {
    if (reply && reply.replyTo && this.p[reply.replyTo]) {
      this.p[reply.replyTo](reply.data); delete this.p[reply.replyTo]
    }
    if (this.q.length) cb(this.q.shift()); else this.w = cb
  },
  req: function (ev) {
    var self = this; ev.reqId = 'r' + (++this.i)
    return new Promise(function (res) { self.p[ev.reqId] = res; self.emit(ev) })
  }
}
var BR = window.__bridge
function send(ev) { BR.emit(ev) }

/* -------- errori sempre visibili -------- */
function fatal(msg) {
  document.getElementById('fMsg').textContent = String(msg)
  document.getElementById('fatal').hidden = false
}
window.onerror = function (m, s, ln) {
  fatal(m + (ln ? ' (riga ' + ln + ')' : ''))
  return true
}
if (window.__bootErr) fatal('Errore precoce: ' + window.__bootErr)

/* -------- bootstrap librerie (JsBarcode + qrcode-generator) -------- */
var LIB_ERR = null
;(function () {
  var srcs = ${LIBSRC}
  for (var i = 0; i < srcs.length; i++) {
    try { (0, eval)(srcs[i]) } catch (e) { LIB_ERR = e; break }
  }
  if (!LIB_ERR && (typeof window.JsBarcode !== 'function' ||
                   typeof window.qrcode !== 'function'))
    LIB_ERR = new Error('librerie caricate ma non valide')
})()

/* -------- font non bloccanti (fallback mono se offline) -------- */
;(function () {
  var l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href = 'https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=JetBrains+Mono:wght@400;600&display=swap'
  document.head.appendChild(l)
})()

/* -------- stato -------- */
var INITIAL = ${INIT}
var AUTO_OPEN = ${AUTO}
var CARDS = Array.isArray(INITIAL) ? INITIAL : []
var FORMATS = ['AUTO','QR','CODE128','EAN13','EAN8','UPC','CODE39','ITF','MSI','codabar']
var PAL = ['#f85149','#f2a007','#ffd33d','#3fb950','#39c5cf','#79c0ff',
           '#1f6feb','#bc8cff','#f778ba','#ff7b72','#d29922','#8b949e']
var currentId = null, editingId = null, editColor = PAL[5], delArmed = false, toastT = null

/* -------- helper -------- */
function $(s) {
  var e = document.querySelector(s)
  if (!e) throw new Error('Elemento mancante: ' + s)
  return e
}
function byId(id) { for (var i = 0; i < CARDS.length; i++) if (CARDS[i].id === id) return CARDS[i]; return null }
function newId() {
  return (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'c' + Date.now().toString(16) + Math.random().toString(16).slice(2, 8)
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  })
}
function hexRgb(h) {
  h = String(h).replace('#', '')
  return [parseInt(h.substr(0,2),16), parseInt(h.substr(2,2),16), parseInt(h.substr(4,2),16)]
}
function lum(h) { var r = hexRgb(h); return (0.299*r[0] + 0.587*r[1] + 0.114*r[2]) / 255 }
function shade(h, f) {
  var r = hexRgb(h).map(function (v) { return Math.max(0, Math.min(255, Math.round(v * f))) })
  return 'rgb(' + r.join(',') + ')'
}
function textOn(h) { return lum(h) > 0.62 ? '#0b0f14' : '#ffffff' }
function maskCode(c) { return c.length > 10 ? '\u00b7\u00b7\u00b7' + c.slice(-6) : c }
function spaceCode(c) {
  return (/^\d+$/.test(c) && c.length <= 20) ? c.replace(/(.{4})/g, '$1 ').trim() : c
}
function normCode(raw, format) {
  // I payload QR possono contenere spazi legittimi: si puliscono solo i bordi.
  return format === 'QR' ? String(raw).trim() : String(raw).replace(/\s+/g, '')
}

/* -------- formati e rendering -------- */
function eanOk(c) {
  var d = c.split('').map(Number), chk = d.pop(), s = 0
  d.reverse().forEach(function (n, i) { s += n * (i % 2 === 0 ? 3 : 1) })
  return (10 - (s % 10)) % 10 === chk
}
function detectFormat(code) {
  var c = String(code).trim()
  if (/^\d{13}$/.test(c) && eanOk(c)) return 'EAN13'
  if (/^\d{8}$/.test(c)  && eanOk(c)) return 'EAN8'
  if (/^\d{12}$/.test(c) && eanOk(c)) return 'UPC'
  return 'CODE128'
}
function resolveFormat(card) { return card.format === 'AUTO' ? detectFormat(card.code) : card.format }

function drawQR(cv, text, size, marginCells) {
  var qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  var n = qr.getModuleCount(), m = marginCells
  var cell = Math.max(2, Math.floor(size / (n + 2 * m)))
  var full = cell * (n + 2 * m)
  cv.width = full; cv.height = full
  var g = cv.getContext('2d')
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, full, full)
  g.fillStyle = '#000000'
  for (var r = 0; r < n; r++)
    for (var c = 0; c < n; c++)
      if (qr.isDark(r, c)) g.fillRect((c + m) * cell, (r + m) * cell, cell, cell)
}

function drawBarcode(cv, card, o) {  // lancia eccezione se il codice non è valido
  var fmt = resolveFormat(card)
  if (fmt === 'QR') { drawQR(cv, card.code, o.qr || 620, 4); return fmt }
  JsBarcode(cv, card.code, {
    format: fmt,
    width: o.w || 3, height: o.h || 130, margin: o.m || 18,
    displayValue: o.dv !== false, fontSize: o.fs || 26,
    font: 'Menlo, monospace', textMargin: 8,
    background: '#ffffff', lineColor: '#000000'
  })
  return fmt
}

/* -------- lista -------- */
function tile(c) {
  var tc = textOn(c.color)
  return '<div class="card" data-id="' + esc(c.id) + '" style="background:linear-gradient(140deg,' +
    c.color + ' 0%,' + shade(c.color, 0.55) + ' 100%);color:' + tc + '">' +
    (c.fav ? '<div class="st">&#9733;</div>' : '') +
    '<div class="nm">' + esc(c.name) + '</div>' +
    '<div class="cd">' + esc(maskCode(c.code)) + '</div>' +
    '</div>'
}
function renderList() {
  CARDS.sort(function (a, b) {
    if (!!a.fav !== !!b.fav) return a.fav ? -1 : 1
    return a.name.localeCompare(b.name, 'it')
  })
  var q = $('#search').value.trim().toLowerCase()
  var L = q ? CARDS.filter(function (c) {
    return c.name.toLowerCase().indexOf(q) >= 0 || c.code.indexOf(q) >= 0
  }) : CARDS
  $('#grid').innerHTML = L.map(tile).join('')
  $('#empty').hidden = CARDS.length > 0
  $('#count').textContent = CARDS.length
    ? CARDS.length + (CARDS.length === 1 ? ' tessera' : ' tessere') : ''
}

/* -------- persistenza + cache PNG per il widget -------- */
function persist() {
  var pngs = {}
  for (var i = 0; i < CARDS.length; i++) {
    var c = CARDS[i]
    try {
      var cv = document.createElement('canvas')
      drawBarcode(cv, c, { w: 4, h: 210, m: 26, dv: true, fs: 32, qr: 640 })
      pngs[c.id] = cv.toDataURL('image/png').split(',')[1]
    } catch (e) {}
  }
  send({ type: 'persist', cards: CARDS, pngs: pngs })
}

/* -------- dettaglio -------- */
function openDetail(id) {
  var c = byId(id); if (!c) return
  currentId = id
  $('#detail').classList.remove('rot')
  $('#dName').textContent = c.name
  $('#dStar').innerHTML = c.fav ? '&#9733;' : '&#9734;'
  try {
    var fmt = drawBarcode($('#dCanvas'), c, { w: 3, h: 150, m: 14, dv: false, qr: 620 })
    $('#dCanvas').hidden = false
    $('#dErr').hidden = true
    $('#dFmt').textContent = fmt
  } catch (e) {
    $('#dCanvas').hidden = true
    $('#dErr').hidden = false
    $('#dErr').textContent = 'Codice non valido per il formato ' + resolveFormat(c)
    $('#dFmt').textContent = ''
  }
  $('#dCode').textContent = spaceCode(c.code)
  $('#dNote').textContent = c.note || ''
  $('#detail').hidden = false
  document.body.classList.add('lock')
  send({ type: 'openCard', id: id })
}
function closeDetail() {
  if ($('#detail').hidden) return
  $('#detail').hidden = true
  document.body.classList.remove('lock')
  currentId = null
  send({ type: 'closeCard' })
}

/* -------- editor -------- */
function renderSw() {
  $('#eSw').innerHTML = PAL.map(function (p) {
    return '<div class="sw' + (p === editColor ? ' sel' : '') +
           '" data-c="' + p + '" style="background:' + p + '"></div>'
  }).join('')
}
function preview() {
  var code = normCode($('#eCode').value, $('#eFormat').value)
  var fake = { code: code, format: $('#eFormat').value }
  var cv = $('#eCanvas')
  if (!code) {
    $('#ePv').hidden = true; $('#eErr').hidden = true; $('#eFmtHint').textContent = ''
    return
  }
  try {
    drawBarcode(cv, fake, { w: 2, h: 64, m: 8, fs: 14, qr: 260 })
    $('#ePv').hidden = false
    $('#eErr').hidden = true
    $('#eFmtHint').textContent = resolveFormat(fake)
  } catch (e) {
    $('#ePv').hidden = true
    $('#eErr').hidden = false
    $('#eErr').textContent = 'Codice non valido per ' + resolveFormat(fake)
    $('#eFmtHint').textContent = ''
  }
}
function openEditor(id) {
  editingId = id || null
  delArmed = false
  var c = id ? byId(id) : null
  $('#eTitle').textContent = c ? 'Modifica tessera' : 'Nuova tessera'
  $('#eName').value = c ? c.name : ''
  $('#eCode').value = c ? c.code : ''
  $('#eFormat').value = c && FORMATS.indexOf(c.format) >= 0 ? c.format : 'AUTO'
  $('#eNote').value = c && c.note ? c.note : ''
  editColor = c ? c.color : PAL[Math.floor(Math.random() * PAL.length)]
  renderSw()
  $('#eDel').hidden = !c
  $('#eDel').textContent = 'Elimina tessera'
  preview()
  $('#editor').hidden = false
  document.body.classList.add('lock')
  if (!c) setTimeout(function () { $('#eName').focus() }, 100)
}
function hideEditor() {
  $('#editor').hidden = true
  delArmed = false
  if ($('#detail').hidden) document.body.classList.remove('lock')
}
function saveCard() {
  var name = $('#eName').value.trim()
  var code = normCode($('#eCode').value, $('#eFormat').value)
  if (!name || !code) { toast('Nome e codice obbligatori', 1); return }
  var fake = { code: code, format: $('#eFormat').value }
  try { drawBarcode(document.createElement('canvas'), fake, { w: 2, h: 40, m: 4, qr: 200 }) }
  catch (e) { toast('Codice non valido per ' + resolveFormat(fake), 1); return }
  if (editingId) {
    var c = byId(editingId)
    c.name = name; c.code = code; c.format = fake.format
    c.color = editColor; c.note = $('#eNote').value.trim()
  } else {
    CARDS.push({
      id: newId(), name: name, code: code, format: fake.format,
      color: editColor, note: $('#eNote').value.trim(),
      fav: CARDS.length === 0, created: Date.now()
    })
  }
  persist(); renderList()
  var reopen = (currentId && editingId === currentId) ? currentId : null
  hideEditor()
  if (reopen) openDetail(reopen)
  toast('Tessera salvata')
}
function askDelete() {
  if (!delArmed) {
    delArmed = true
    $('#eDel').textContent = 'Confermi eliminazione?'
    return
  }
  var id = editingId
  CARDS = CARDS.filter(function (c) { return c.id !== id })
  persist(); renderList(); hideEditor()
  if (currentId === id) closeDetail()
  toast('Tessera eliminata')
}

/* -------- import / export -------- */
function mergeImport(data) {
  var arr = Array.isArray(data) ? data
          : (data && Array.isArray(data.cards)) ? data.cards : null
  if (!arr) return -1
  var n = 0
  arr.forEach(function (c) {
    if (!c || typeof c.name !== 'string' || !c.name.trim()) return
    if (typeof c.code !== 'string' && typeof c.code !== 'number') return
    var fmt = FORMATS.indexOf(c.format) >= 0 ? c.format : 'AUTO'
    var code = normCode(String(c.code), fmt)
    if (!code) return
    var card = {
      id: (typeof c.id === 'string' && c.id) ? c.id : newId(),
      name: c.name.trim(),
      code: code,
      format: fmt,
      color: /^#[0-9a-fA-F]{6}$/.test(c.color || '') ? c.color : PAL[5],
      note: typeof c.note === 'string' ? c.note : '',
      fav: !!c.fav,
      created: c.created || Date.now()
    }
    var ix = -1
    for (var i = 0; i < CARDS.length; i++) if (CARDS[i].id === card.id) { ix = i; break }
    if (ix >= 0) CARDS[ix] = card; else CARDS.push(card)
    n++
  })
  return n
}

/* -------- scansione fotocamera -------- */
var SCAN_EVALED = false
function ensureScanLibs(libs) {
  if (SCAN_EVALED) return
  try {
    if (libs && libs.jsqr)   (0, eval)(libs.jsqr)
    if (libs && libs.quagga) (0, eval)(libs.quagga)
  } catch (e) {}
  if (typeof window.jsQR === 'function' || window.Quagga) SCAN_EVALED = true
}
var BD_MAP = { qr_code:'QR', ean_13:'EAN13', ean_8:'EAN8', upc_a:'UPC', upc_e:'UPC',
               code_128:'CODE128', code_39:'CODE39', itf:'ITF', codabar:'codabar' }
var QG_MAP = { ean_13:'EAN13', ean_8:'EAN8', upc_a:'UPC', code_128:'CODE128',
               code_39:'CODE39', i2of5:'ITF', codabar:'codabar' }
function decodeWithBD(canvas) {
  return new Promise(function (res) {
    if (!('BarcodeDetector' in window)) { res(null); return }
    try {
      new BarcodeDetector().detect(canvas).then(function (r) {
        res(r && r.length ? { code: r[0].rawValue, format: BD_MAP[r[0].format] || 'AUTO' } : null)
      }).catch(function () { res(null) })
    } catch (e) { res(null) }
  })
}
function decodeWithJsQR(ctx, w, h) {
  if (typeof window.jsQR !== 'function') return null
  try {
    var d = ctx.getImageData(0, 0, w, h)
    var r = window.jsQR(d.data, w, h)
    return (r && r.data) ? { code: r.data, format: 'QR' } : null
  } catch (e) { return null }
}
function decodeWithQuagga(dataURL) {
  return new Promise(function (res) {
    if (!window.Quagga) { res(null); return }
    try {
      window.Quagga.decodeSingle({
        src: dataURL, numOfWorkers: 0, locate: true,
        decoder: { readers: ['ean_reader','ean_8_reader','upc_reader','code_128_reader',
                             'code_39_reader','i2of5_reader','codabar_reader'] }
      }, function (r) {
        res(r && r.codeResult && r.codeResult.code
          ? { code: r.codeResult.code, format: QG_MAP[r.codeResult.format] || 'AUTO' }
          : null)
      })
    } catch (e) { res(null) }
  })
}
function decodeAll(cv, g, w, h) {
  return decodeWithBD(cv).then(function (hit) {
    if (hit) return hit
    hit = decodeWithJsQR(g, w, h)
    if (hit) return hit
    return decodeWithQuagga(cv.toDataURL('image/jpeg', 0.85))
  })
}
async function doScan() {
  var r = await BR.req({ type: 'scan', needLibs: !SCAN_EVALED })
  if (!r || !r.ok || !r.b64) {
    toast(r && r.err ? 'Scansione annullata' : 'Nessuna immagine', 1)
    return
  }
  ensureScanLibs(r.libs)
  var img = new Image()
  img.onload = async function () {
    var k = Math.min(1, 1280 / Math.max(img.width, img.height))
    var w = Math.max(1, Math.round(img.width * k))
    var h = Math.max(1, Math.round(img.height * k))
    var cv = document.createElement('canvas'); cv.width = w; cv.height = h
    var g = cv.getContext('2d')
    g.drawImage(img, 0, 0, w, h)
    var hit = await decodeAll(cv, g, w, h)
    if (!hit) {
      // secondo passaggio: ritaglio centrale, dove di solito sta il codice
      var cw = Math.round(w * 0.72), ch = Math.round(h * 0.5)
      var c2 = document.createElement('canvas'); c2.width = cw; c2.height = ch
      var g2 = c2.getContext('2d')
      g2.drawImage(cv, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch)
      hit = await decodeAll(c2, g2, cw, ch)
    }
    if (hit) {
      if (FORMATS.indexOf(hit.format) >= 0) $('#eFormat').value = hit.format
      $('#eCode').value = hit.code
      preview()
      toast('Codice letto (' + (hit.format === 'AUTO'
        ? resolveFormat({ code: hit.code, format: 'AUTO' }) : hit.format) + ')')
    } else {
      toast('Nessun codice riconosciuto: pi\u00f9 luce e codice centrato', 1)
    }
  }
  img.onerror = function () { toast('Immagine non valida', 1) }
  img.src = 'data:image/jpeg;base64,' + r.b64
}

/* -------- toast -------- */
function toast(msg, err) {
  var t = $('#toast')
  t.textContent = msg
  t.className = err ? 'err' : ''
  t.hidden = false
  clearTimeout(toastT)
  toastT = setTimeout(function () { t.hidden = true }, 2200)
}

/* -------- eventi UI -------- */
$('#btnAdd').addEventListener('click', function () { openEditor(null) })
$('#btnMenu').addEventListener('click', function () { $('#menu').hidden = false })
$('#search').addEventListener('input', renderList)
$('#grid').addEventListener('click', function (e) {
  var el = e.target.closest('.card')
  if (el) openDetail(el.dataset.id)
})
$('#dBack').addEventListener('click', closeDetail)
$('#dEdit').addEventListener('click', function () { openEditor(currentId) })
$('#dStar').addEventListener('click', function () {
  var c = byId(currentId); if (!c) return
  c.fav = !c.fav
  $('#dStar').innerHTML = c.fav ? '&#9733;' : '&#9734;'
  persist(); renderList()
})
$('#dCanvas').addEventListener('click', function () { $('#detail').classList.toggle('rot') })
$('#dCode').addEventListener('click', function () {
  var c = byId(currentId); if (!c) return
  send({ type: 'copy', text: c.code })
  toast('Codice copiato')
})
$('#eCode').addEventListener('input', preview)
$('#eScan').addEventListener('click', doScan)
$('#eFormat').addEventListener('change', preview)
$('#eSw').addEventListener('click', function (e) {
  var el = e.target.closest('.sw'); if (!el) return
  editColor = el.dataset.c
  renderSw()
})
$('#eSave').addEventListener('click', saveCard)
$('#eCancel').addEventListener('click', hideEditor)
$('#eDel').addEventListener('click', askDelete)
$('#editor').addEventListener('click', function (e) { if (e.target === this) hideEditor() })
$('#menu').addEventListener('click', function (e) { if (e.target === this) this.hidden = true })
$('#mClose').addEventListener('click', function () { $('#menu').hidden = true })
$('#mScan').addEventListener('click', function () {
  $('#menu').hidden = true
  openEditor(null)
  setTimeout(function () { $('#eName').blur() }, 180)
  doScan()
})
$('#mExport').addEventListener('click', function () {
  $('#menu').hidden = true
  send({ type: 'export', json: JSON.stringify({
    v: 1, app: 'Fidelity', exported: new Date().toISOString(), cards: CARDS
  }, null, 1) })
  toast('JSON copiato negli appunti')
})
$('#mImport').addEventListener('click', async function () {
  $('#menu').hidden = true
  var r = await BR.req({ type: 'import' })
  if (!r || !r.ok) { toast('Nessun JSON valido negli appunti', 1); return }
  var n = mergeImport(r.payload)
  if (n > 0) { persist(); renderList(); toast('Importate ' + n + ' tessere') }
  else toast('Nessuna tessera valida nel JSON', 1)
})
$('#mCache').addEventListener('click', function () {
  $('#menu').hidden = true
  persist()
  toast('Cache widget rigenerata')
})

$('#fReset').addEventListener('click', async function () {
  var btn = this
  btn.disabled = true
  var r = await BR.req({ type: 'resetLibs' })
  $('#fMsg').textContent = (r && r.ok)
    ? 'Librerie eliminate. Chiudi e riapri lo script: verranno riscaricate.'
    : 'Non sono riuscito a eliminare i file delle librerie.'
  btn.hidden = true
})
$('#fClose').addEventListener('click', function () { $('#fatal').hidden = true })

/* -------- avvio -------- */
renderList()
if (LIB_ERR) fatal('Librerie barcode danneggiate: ' + LIB_ERR.message +
  '. Tocca "Ripristina librerie" e riapri lo script.')
if (AUTO_OPEN) {
  var target = byId(AUTO_OPEN) || CARDS.filter(function (c) {
    return c.name.toLowerCase() === String(AUTO_OPEN).toLowerCase()
  })[0]
  if (target) openDetail(target.id)
}
window.__boot && window.__boot.push('ready')
`

  return '<!doctype html><html lang="it"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">' +
    '<meta name="format-detection" content="telephone=no">' +
    '<script>window.__boot=["head"];window.__bootErr=null;' +
    'window.onerror=function(m,s,l){window.__bootErr=String(m)+(l?" r"+l:"");return false}<\/script>' +
    '<style>' + CSS + '</style></head><body>' + BODY +
    '<script>' + PAGE + '<\/script>' +
    '</body></html>'
}

// ---------------- App (WebView + event loop) ----------------

function sleep(ms) { return new Promise(r => Timer.schedule(ms, false, () => r())) }

// Auto-verifica di avvio (permanente): una sonda a 1,2s dalla presentazione.
// Se il boot non arriva a "ready", c'è un errore precoce o il layout è
// anomalo, il dettaglio va nel log e un banner rosso appare DENTRO la
// pagina (funziona anche se il JS di pagina non è mai partito).
const BOOT_PROBE = 'JSON.stringify({boot:window.__boot||null,err:window.__bootErr||null,' +
  'w:innerWidth,h:innerHeight,' +
  'bg:getComputedStyle(document.body).backgroundColor,' +
  'hdr:(function(h){return h?Math.round(h.getBoundingClientRect().height):null})(document.querySelector("header")),' +
  'tiles:document.querySelectorAll("#grid .card").length})'

async function bootCheck(wv) {
  try {
    await sleep(1200)
    let raw = ''
    try { raw = await wv.evaluateJavaScript(BOOT_PROBE, false) }
    catch (e) { raw = '{"probeError":' + JSON.stringify(String(e)) + '}' }
    console.log('[avvio] ' + raw)
    let d = null
    try { d = JSON.parse(raw) } catch (e) {}
    const bad = !d || d.probeError || !d.boot || d.boot.indexOf('ready') < 0 || d.err ||
                String(d.bg || '').indexOf('8, 11, 16') < 0 || !d.hdr
    if (bad) {
      const msg = 'FIDELITY v' + VERSION + ' \u2014 avvio anomalo\n' +
        (raw || 'nessuna risposta dalla pagina') +
        '\nScreenshotta questo banner o copia la riga [avvio] dal log.'
      console.log(msg)
      try {
        await wv.evaluateJavaScript('(function(){var b=document.createElement("div");' +
          'b.style.cssText="position:fixed;top:0;left:0;right:0;z-index:99999;' +
          'background:#5a1015;color:#ffb4ae;font:11px Menlo,monospace;padding:8px;' +
          'padding-top:max(8px,env(safe-area-inset-top));white-space:pre-wrap;word-break:break-all";' +
          'b.textContent=' + JSON.stringify(msg) + ';' +
          '(document.body||document.documentElement).appendChild(b)})()', false)
      } catch (e) {}
    }
  } catch (e) {}
}

async function runApp() {
  const cards = loadCards()
  const auto = (args.queryParameters && args.queryParameters.card) || null

  let libs
  try {
    libs = await loadLibs()
  } catch (e) {
    const a = new Alert()
    a.title = 'Librerie mancanti'
    a.message = 'Al primo avvio serve internet per scaricare JsBarcode e il generatore QR (circa 100 KB). Poi tutto funziona offline.\n\n' + e.message
    a.addAction('OK')
    await a.present()
    return
  }

  const wv = new WebView()
  await wv.loadHTML(buildHTML(cards, auto, libs))

  let prevB = null
  let reply = null
  const presented = wv.present(true)
  const closed = presented.then(function () { return null })

  await bootCheck(wv)

  try {
    while (true) {
      const js = 'window.__bridge.next(completion, ' + JSON.stringify(reply) + ')'
      let ev
      try {
        ev = await Promise.race([closed, wv.evaluateJavaScript(js, true)])
      } catch (e) { break }
      if (!ev) break
      reply = null
      try {
        switch (ev.type) {
          case 'persist':
            saveCards(ev.cards || [])
            writePngs(ev.pngs || {}, ev.cards || [])
            break
          case 'openCard':
            if (prevB === null) prevB = Device.screenBrightness()
            Device.setScreenBrightness(1)
            break
          case 'closeCard':
            if (prevB !== null) { Device.setScreenBrightness(prevB); prevB = null }
            break
          case 'copy':
            Pasteboard.copyString(String(ev.text || ''))
            break
          case 'export':
            Pasteboard.copyString(String(ev.json || ''))
            break
          case 'import': {
            let out = { ok: false }
            try {
              const raw = Pasteboard.pasteString() || ''
              out = { ok: true, payload: JSON.parse(raw) }
            } catch (e2) { out = { ok: false } }
            reply = { replyTo: ev.reqId, data: out }
            break
          }
          case 'resetLibs': {
            let ok = true
            try {
              for (const l of LIBS) {
                const p = fm.joinPath(DIR, l.f)
                if (fm.fileExists(p)) fm.remove(p)
              }
            } catch (e3) { ok = false }
            reply = { replyTo: ev.reqId, data: { ok: ok } }
            break
          }
          case 'scan': {
            let out = { ok: false }
            try {
              const img = await Photos.fromCamera()
              if (img) {
                const jd = Data.fromJPEG(shrink(img, 1280))
                const b64 = jd ? jd.toBase64String() : null
                let libs = {}
                if (ev.needLibs) { try { libs = await loadScanLibs() } catch (e4) {} }
                out = { ok: !!b64, b64: b64, libs: libs }
              }
            } catch (e5) { out = { ok: false, err: String(e5) } }
            reply = { replyTo: ev.reqId, data: out }
            break
          }
        }
      } catch (e) {
        if (ev && ev.reqId) reply = { replyTo: ev.reqId, data: { ok: false, error: String(e) } }
      }
    }
  } finally {
    if (prevB !== null) {
      try { Device.setScreenBrightness(prevB) } catch (e) {}
    }
  }
  await presented
}

// ---------------- Main ----------------

async function main() {
  console.log('FIDELITY v' + VERSION + ' \u2014 ' + (config.runsInWidget ? 'widget' : 'app'))
  if (config.runsInWidget) { await runWidget(); return }
  await runApp()
}

await main()
Script.complete()
