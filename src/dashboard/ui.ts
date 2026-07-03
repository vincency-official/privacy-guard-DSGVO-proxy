// Dashboard-Oberfläche als eingebettete HTML-Konstante.
//
// Bewusst als TS-Modul statt separater .html-Datei: so wird das Markup vom
// TypeScript-Build unverändert nach dist/ übernommen und ist auch im gebauten
// `privacy-guard`-Binary verfügbar — ohne zusätzliches Kopier-Tooling. Die Seite
// ist vollständig eigenständig (kein externes CSS/JS), passend zum Prinzip
// „keine externen Dependencies".
//
// Die Seite zeigt den Schutzstatus, einen Mausklick-Toggle und ein Live-Log der
// Ersetzungen. Das Log wird per Server-Sent-Events (EventSource) live nachgeladen
// und enthält ausschließlich maskierte Werte — niemals Klartext-PII.

export const UI_HTML = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Privacy-Guard Proxy</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    background: #0f1115; color: #e6e8eb; line-height: 1.5;
  }
  header { padding: 24px 20px 8px; }
  h1 { margin: 0; font-size: 20px; font-weight: 650; letter-spacing: 0.2px; }
  .sub { color: #9aa4b2; font-size: 13px; margin-top: 2px; }
  main { padding: 12px 20px 40px; max-width: 860px; }
  .card { background: #171a21; border: 1px solid #262b36; border-radius: 12px; padding: 18px; margin-top: 16px; }
  .statusrow { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .badge { font-weight: 650; font-size: 15px; padding: 8px 14px; border-radius: 999px; }
  .badge.on  { background: #0f2f1d; color: #5ee6a0; border: 1px solid #1f5c3a; }
  .badge.off { background: #331717; color: #ff8a8a; border: 1px solid #5c2020; }
  button {
    font: inherit; font-weight: 600; cursor: pointer; border-radius: 10px;
    padding: 10px 18px; border: 1px solid #2f6feb; background: #2f6feb; color: white;
  }
  button.off { background: #b3402f; border-color: #b3402f; }
  button:disabled { opacity: 0.5; cursor: default; }
  .hint { color: #9aa4b2; font-size: 12.5px; margin-top: 10px; }
  h2 { font-size: 14px; color: #9aa4b2; font-weight: 600; margin: 24px 0 0; text-transform: uppercase; letter-spacing: 0.6px; }
  .log { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; }
  .entry { background: #131620; border: 1px solid #232937; border-radius: 10px; padding: 10px 12px; font-size: 13px; }
  .entry .meta { color: #9aa4b2; display: flex; gap: 10px; flex-wrap: wrap; font-variant-numeric: tabular-nums; }
  .entry .mode-active { color: #5ee6a0; } .entry .mode-passthrough { color: #ffb454; }
  .chips { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; }
  .chip { background: #1d2330; border: 1px solid #2c3444; border-radius: 6px; padding: 2px 8px; font-size: 12px; }
  .chip b { color: #8ab4ff; font-weight: 600; }
  .empty { color: #6b7280; font-style: italic; }
</style>
</head>
<body>
<header>
  <h1>🛡️ Privacy-Guard Proxy</h1>
  <div class="sub">Lokales DSGVO-Gateway · nur auf 127.0.0.1 · Zuordnung nur im Arbeitsspeicher</div>
</header>
<main>
  <div class="card">
    <div class="statusrow">
      <span id="badge" class="badge">…</span>
      <button id="toggle" disabled>…</button>
    </div>
    <div class="hint" id="hint">Status wird geladen …</div>
  </div>

  <h2>Live-Log der Ersetzungen</h2>
  <div class="log" id="log"><div class="empty">Noch keine Anfragen. Sobald Traffic über den Proxy läuft, erscheint er hier.</div></div>
</main>

<script>
  const badge = document.getElementById('badge');
  const btn = document.getElementById('toggle');
  const hint = document.getElementById('hint');
  const logEl = document.getElementById('log');
  let leer = true;

  // Status ist der SCHUTZ-Zustand: disabled=true bedeutet Pass-Through (ungeschützt).
  function render(disabled) {
    if (disabled) {
      badge.textContent = 'Pass-Through — ungeschützt';
      badge.className = 'badge off';
      btn.textContent = 'Schutz einschalten';
      btn.className = 'off';
      hint.textContent = 'Alle Daten werden ungefiltert an den US-Server durchgeleitet.';
    } else {
      badge.textContent = 'Schutz aktiv';
      badge.className = 'badge on';
      btn.textContent = 'Schutz ausschalten';
      btn.className = '';
      hint.textContent = 'Personenbezogene Daten und Secrets werden vor dem Versand tokenisiert.';
    }
    btn.disabled = false;
  }

  async function laden() {
    const r = await fetch('/api/status');
    const j = await r.json();
    render(j.disabled);
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const r = await fetch('/api/toggle', { method: 'POST' });
    const j = await r.json();
    render(j.disabled);
  });

  function zeit(iso) {
    try { return new Date(iso).toLocaleTimeString('de-DE'); } catch { return iso; }
  }

  function anhaengen(e) {
    if (leer) { logEl.innerHTML = ''; leer = false; }
    const div = document.createElement('div');
    div.className = 'entry';
    const modeCls = e.mode === 'active' ? 'mode-active' : 'mode-passthrough';
    const modeTxt = e.mode === 'active' ? 'aktiv' : 'pass-through';
    let chips = '';
    if (e.replacements && e.replacements.length) {
      chips = '<div class="chips">' + e.replacements.map(function (r) {
        return '<span class="chip"><b>' + r.type + '</b> ' + r.masked + '</span>';
      }).join('') + '</div>';
    } else if (e.mode === 'active') {
      chips = '<div class="chips"><span class="empty">keine Treffer</span></div>';
    }
    div.innerHTML = '<div class="meta"><span>' + zeit(e.timestamp) + '</span>' +
      '<span class="' + modeCls + '">' + modeTxt + '</span>' +
      '<span>' + e.provider + '</span><span>' + e.path + '</span></div>' + chips;
    logEl.prepend(div);
  }

  const es = new EventSource('/api/log');
  es.addEventListener('message', function (ev) {
    try { anhaengen(JSON.parse(ev.data)); } catch (_) {}
  });

  laden();
</script>
</body>
</html>`;
