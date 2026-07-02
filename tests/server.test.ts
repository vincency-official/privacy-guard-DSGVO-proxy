import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { createProxyServer, type ProxyDeps } from '../src/server.js';
import { Vault } from '../src/vault.js';
import { Toggle } from '../src/toggle.js';
import { DEFAULT_DETECTORS } from '../src/config.js';
import type { Config } from '../src/types.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tests für den Proxy-Server (Kern). Der Server nimmt Anfragen unter einem
// Provider-Präfix (/openai bzw. /anthropic) entgegen, bereinigt im aktiven Modus
// den JSON-Body (echt → Token), leitet an den Upstream weiter und re-identifiziert
// die Antwort (JSON oder SSE-Stream). Im Pass-Through-Modus (Toggle deaktiviert)
// wird der Body unverändert durchgereicht.
//
// Statt des echten Providers wird ein lokaler Mock-Upstream (eigener http.Server
// auf 127.0.0.1:0) gestartet und dem Proxy über `originOverride` injiziert. So
// laufen die Tests komplett offline und beobachten, was der Upstream EMPFÄNGT.

// Hilfsstruktur: was der Mock-Upstream bei der letzten Anfrage empfangen hat.
interface Empfangen {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: string;
}

// Startet einen Mock-Upstream auf 127.0.0.1:0. Der Handler entscheidet die Antwort.
// Liefert Origin (z. B. "http://127.0.0.1:54321"), das zuletzt Empfangene und einen
// Stopp-Callback.
async function startMockUpstream(
  handler: (empfangen: Empfangen, res: ServerResponse) => void,
): Promise<{ origin: string; letzte: () => Empfangen | undefined; stop: () => Promise<void> }> {
  let letzteAnfrage: Empfangen | undefined;

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      letzteAnfrage = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      handler(letzteAnfrage, res);
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('Mock-Upstream hat keine Netzwerk-Adresse erhalten');
  }
  const origin = `http://127.0.0.1:${addr.port}`;

  return {
    origin,
    letzte: () => letzteAnfrage,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

// Startet den zu testenden Proxy-Server auf 127.0.0.1:0 und liefert seine Basis-URL.
async function startProxy(
  deps: ProxyDeps,
): Promise<{ base: string; server: Server; stop: () => Promise<void> }> {
  const server = createProxyServer(deps);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  if (addr === null || typeof addr === 'string') {
    throw new Error('Proxy hat keine Netzwerk-Adresse erhalten');
  }
  return {
    base: `http://127.0.0.1:${addr.port}`,
    server,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

// Baut eine Test-Config mit einer expliziten Person-Regel und Default-Detektoren.
function makeConfig(): Config {
  return {
    rules: [{ match: 'Max Mustermann', type: 'PERSON' }],
    detectors: { ...DEFAULT_DETECTORS },
    server: { port: 0, dashboardPort: 0 },
  };
}

describe('createProxyServer', () => {
  // Temp-Verzeichnis für die Toggle-Marker-Datei — nie die echte Datei anfassen.
  let tmp: string;
  let togglePfad: string;
  // Aufräum-Aufgaben (Server schließen) nach jedem Test.
  const aufraeumen: Array<() => Promise<void>> = [];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'pgp-server-'));
    togglePfad = join(tmp, '.privacy-disabled');
  });

  afterEach(async () => {
    // Erst alle Server schließen ...
    for (const stop of aufraeumen.splice(0)) {
      await stop();
    }
    // ... dann das Temp-Verzeichnis entfernen.
    rmSync(tmp, { recursive: true, force: true });
  });

  it('aktiv, nicht-Stream: Upstream empfängt Token, Client empfängt Klartext', async () => {
    // Der Mock antwortet mit JSON, das das Token im Assistenz-Text enthält.
    const upstream = await startMockUpstream((_empfangen, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'chatcmpl-1',
          choices: [
            { message: { role: 'assistant', content: 'Hallo [PERSON_1]!' } },
          ],
        }),
      );
    });
    aufraeumen.push(upstream.stop);

    const vault = new Vault();
    const deps: ProxyDeps = {
      config: makeConfig(),
      vault,
      toggle: new Toggle(togglePfad),
      originOverride: () => upstream.origin,
    };
    const proxy = await startProxy(deps);
    aufraeumen.push(proxy.stop);

    // Client sendet einen echten Namen — der muss vor dem Upstream tokenisiert werden.
    const resp = await fetch(`${proxy.base}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Ich bin Max Mustermann.' }],
      }),
    });

    expect(resp.status).toBe(200);

    // Der Upstream darf NIE den Klartext gesehen haben, nur das Token.
    const empfangen = upstream.letzte()!;
    expect(empfangen.body).toContain('[PERSON_1]');
    expect(empfangen.body).not.toContain('Max Mustermann');
    // Der richtige Upstream-Pfad wurde angesprochen.
    expect(empfangen.url).toBe('/v1/chat/completions');
    // Auth-Header wird durchgereicht.
    expect(empfangen.headers.authorization).toBe('Bearer test');

    // Der Client bekommt den re-identifizierten Klartext zurück.
    const json = (await resp.json()) as {
      choices: { message: { content: string } }[];
    };
    expect(json.choices[0].message.content).toBe('Hallo Max Mustermann!');
  });

  it('aktiv, Stream: über die Chunk-Grenze zerschnittenes Token wird re-identifiziert', async () => {
    // Der Mock antwortet als text/event-stream und zerschneidet das Token bewusst
    // über zwei Chunks. Der Proxy muss den Stream stream-sicher re-identifizieren.
    const upstream = await startMockUpstream((_empfangen, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: Hallo [PERSO');
      // Kleiner Delay, damit es wirklich zwei Chunks werden.
      setTimeout(() => {
        res.write('N_1]!\n\n');
        res.end();
      }, 10);
    });
    aufraeumen.push(upstream.stop);

    const vault = new Vault();
    const deps: ProxyDeps = {
      config: makeConfig(),
      vault,
      toggle: new Toggle(togglePfad),
      originOverride: () => upstream.origin,
    };
    const proxy = await startProxy(deps);
    aufraeumen.push(proxy.stop);

    const resp = await fetch(`${proxy.base}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        stream: true,
        messages: [{ role: 'user', content: 'Wer ist Max Mustermann?' }],
      }),
    });

    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toContain('text/event-stream');

    // Der komplette Stream-Text muss den re-identifizierten Namen enthalten.
    const text = await resp.text();
    expect(text).toBe('data: Hallo Max Mustermann!\n\n');
  });

  it('Pass-Through: bei deaktiviertem Schutz empfängt der Upstream den Klartext', async () => {
    const upstream = await startMockUpstream((_empfangen, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    aufraeumen.push(upstream.stop);

    // Toggle deaktiviert den Schutz (Marker-Datei anlegen) → Pass-Through.
    const toggle = new Toggle(togglePfad);
    toggle.disable();

    const deps: ProxyDeps = {
      config: makeConfig(),
      vault: new Vault(),
      toggle,
      originOverride: () => upstream.origin,
    };
    const proxy = await startProxy(deps);
    aufraeumen.push(proxy.stop);

    const resp = await fetch(`${proxy.base}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Ich bin Max Mustermann.' }],
      }),
    });

    expect(resp.status).toBe(200);

    // Im Pass-Through darf der Body NICHT bereinigt werden: der Upstream sieht den
    // vollständigen Klartext, kein Token.
    const empfangen = upstream.letzte()!;
    expect(empfangen.body).toContain('Max Mustermann');
    expect(empfangen.body).not.toContain('[PERSON_1]');
  });

  it('gibt bei unbekanntem Pfad-Präfix 404 zurück', async () => {
    const deps: ProxyDeps = {
      config: makeConfig(),
      vault: new Vault(),
      toggle: new Toggle(togglePfad),
      // Kein Upstream nötig — die Anfrage wird nie weitergeleitet.
      originOverride: () => 'http://127.0.0.1:1',
    };
    const proxy = await startProxy(deps);
    aufraeumen.push(proxy.stop);

    const resp = await fetch(`${proxy.base}/unbekannt/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });

    expect(resp.status).toBe(404);
  });

  it('fail-closed: aktiver Modus mit nicht-JSON-Body → 400, nichts wird weitergeleitet', async () => {
    let upstreamAngesprochen = false;
    const upstream = await startMockUpstream((_empfangen, res) => {
      upstreamAngesprochen = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    aufraeumen.push(upstream.stop);

    const deps: ProxyDeps = {
      config: makeConfig(),
      vault: new Vault(),
      toggle: new Toggle(togglePfad),
      originOverride: () => upstream.origin,
    };
    const proxy = await startProxy(deps);
    aufraeumen.push(proxy.stop);

    const resp = await fetch(`${proxy.base}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Kaputtes JSON — im aktiven Modus darf NICHT durchgeleitet werden.
      body: 'das-ist-kein-json{{{',
    });

    expect(resp.status).toBe(400);
    // Der Upstream darf gar nicht kontaktiert worden sein (fail-closed).
    expect(upstreamAngesprochen).toBe(false);
  });

  it('reicht Anthropic-Anfragen inkl. anthropic-version-Header durch und tokenisiert das system-Feld', async () => {
    const upstream = await startMockUpstream((_empfangen, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          role: 'assistant',
          content: [{ type: 'text', text: 'Verstanden, [PERSON_1].' }],
        }),
      );
    });
    aufraeumen.push(upstream.stop);

    const vault = new Vault();
    const deps: ProxyDeps = {
      config: makeConfig(),
      vault,
      toggle: new Toggle(togglePfad),
      originOverride: () => upstream.origin,
    };
    const proxy = await startProxy(deps);
    aufraeumen.push(proxy.stop);

    const resp = await fetch(`${proxy.base}/anthropic/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'sk-ant-test',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3',
        system: 'Der Nutzer heißt Max Mustermann.',
        messages: [{ role: 'user', content: 'Hallo' }],
      }),
    });

    expect(resp.status).toBe(200);

    const empfangen = upstream.letzte()!;
    // system-Feld wurde tokenisiert.
    expect(empfangen.body).toContain('[PERSON_1]');
    expect(empfangen.body).not.toContain('Max Mustermann');
    // Provider-spezifische Auth-/Versions-Header werden durchgereicht.
    expect(empfangen.headers['x-api-key']).toBe('sk-ant-test');
    expect(empfangen.headers['anthropic-version']).toBe('2023-06-01');
    expect(empfangen.url).toBe('/v1/messages');

    // Antwort re-identifiziert.
    const json = (await resp.json()) as { content: { text: string }[] };
    expect(json.content[0].text).toBe('Verstanden, Max Mustermann.');
  });

  it('reicht den Upstream-Fehler-Status transparent an den Client weiter', async () => {
    const upstream = await startMockUpstream((_empfangen, res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'rate limit' }));
    });
    aufraeumen.push(upstream.stop);

    const deps: ProxyDeps = {
      config: makeConfig(),
      vault: new Vault(),
      toggle: new Toggle(togglePfad),
      originOverride: () => upstream.origin,
    };
    const proxy = await startProxy(deps);
    aufraeumen.push(proxy.stop);

    const resp = await fetch(`${proxy.base}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hallo' }],
      }),
    });

    // Der Fehler-Status des Upstreams bleibt erhalten.
    expect(resp.status).toBe(429);
  });
});
