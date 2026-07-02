// Proxy-Server (Kern): verdrahtet Routing, Sanitizer, Re-Identifier, Toggle und
// Event-Log zu einem lokalen Reverse-Proxy.
//
// Ablauf pro Anfrage:
//  1. Pfad → Provider auflösen (resolveRoute). Unbekannt → 404.
//  2. Request-Body vollständig als Buffer lesen.
//  3. Toggle deaktiviert → PASS-THROUGH: Body unverändert weiterleiten, Antwort
//     1:1 zurück, Log-Eintrag mode:'passthrough'.
//  4. Sonst AKTIV: Body als JSON parsen (Fehler → 400, fail-closed), echt → Token
//     bereinigen (sanitizeBody), an den Upstream weiterleiten.
//  5. Antwort: SSE-Stream (text/event-stream) stream-sicher re-identifizieren;
//     sonst JSON sammeln, re-identifizieren, zurücksenden. Log mode:'active'.
//  6. Upstream-Fehler-Status transparent an den Client weiterreichen.
//
// Sicherheitsprinzipien:
//  - Der Server bindet ausschließlich an 127.0.0.1 (Bindung erfolgt beim Aufrufer
//    via server.listen; dieser Kern erzeugt nur den Server).
//  - Fail-closed: Kann im aktiven Modus nicht sauber bereinigt werden, wird die
//    Anfrage mit HTTP 400 blockiert statt ungeschützt durchgeleitet.
//  - Klartext-PII wird nie geloggt: der Log enthält nur maskierte Werte.
//  - Der Klartext lebt ausschließlich im In-Memory-Vault.
//
// Nur Node-Built-ins, keine externen Dependencies.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeWebReadableStream } from 'node:stream/web';
import type { Config, Provider, Replacement } from './types.js';
import type { Vault } from './vault.js';
import type { Toggle } from './toggle.js';
import { resolveRoute } from './router.js';
import { sanitizeBody } from './sanitize.js';
import { reidentifyJsonBody, createReidentifyTransform } from './reidentify.js';
import { emitLog } from './events.js';

// Abhängigkeiten des Proxy-Servers. `originOverride` erlaubt es, den Upstream-
// Origin je Provider zu ersetzen (für Tests mit lokalem Mock-Upstream und für eine
// spätere MITM-/Custom-Endpoint-Nutzung). Ohne Override gilt der Origin aus dem Router.
export interface ProxyDeps {
  config: Config;
  vault: Vault;
  toggle: Toggle;
  originOverride?: (provider: Provider) => string;
}

// Request-Header, die niemals unverändert an den Upstream gehen dürfen. `host`
// gehört zur Proxy-Verbindung; `content-length` wird nach der Bereinigung neu
// berechnet; `accept-encoding` wird auf `identity` gezwungen, damit die Antwort
// unkomprimiert ankommt und ohne gzip-Dekodierung re-identifiziert werden kann.
// `connection` ist hop-by-hop und gehört nicht weitergereicht.
const ZU_ENTFERNENDE_HEADER = new Set([
  'host',
  'content-length',
  'accept-encoding',
  'connection',
]);

// Erzeugt den Proxy-HTTP-Server. Die Netzwerk-Bindung (listen auf 127.0.0.1)
// übernimmt der Aufrufer; dieser Kern kapselt nur die Request-Verarbeitung.
export function createProxyServer(deps: ProxyDeps): Server {
  return createServer((req, res) => {
    // Fehler in der asynchronen Verarbeitung sauffangen und als 502 melden,
    // damit ein Upstream- oder Netzwerkfehler den Prozess nicht abreißen lässt.
    handleRequest(req, res, deps).catch((err) => {
      fehlerAntwort(res, err);
    });
  });
}

// Verarbeitet eine einzelne Anfrage gemäß dem oben beschriebenen Ablauf.
async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: ProxyDeps,
): Promise<void> {
  // 1) Pfad → Provider/Upstream auflösen. Unbekanntes Präfix → 404.
  const route = resolveRoute(req.url ?? '');
  if (route === null) {
    sendeJson(res, 404, {
      error: 'Unbekannter Pfad. Erlaubt sind /openai/... und /anthropic/...',
    });
    return;
  }

  // Upstream-Origin bestimmen: Override (Tests/Custom) hat Vorrang vor dem Router.
  const origin = deps.originOverride
    ? deps.originOverride(route.provider)
    : route.upstreamOrigin;
  const upstreamUrl = `${origin}${route.upstreamPath}`;

  // 2) Request-Body vollständig einlesen.
  const requestBody = await leseBody(req);

  // 3) Pass-Through, wenn der Schutz deaktiviert ist.
  if (deps.toggle.isDisabled()) {
    await passThrough(req, res, upstreamUrl, requestBody, route.provider);
    return;
  }

  // 4) Aktiver Modus: Body als JSON parsen. Fehlschlag → fail-closed (400).
  let body: unknown;
  try {
    // Leerer Body ist im aktiven Modus für die JSON-APIs nicht sinnvoll und wird
    // ebenfalls als Fehler behandelt (fail-closed).
    body = JSON.parse(requestBody.toString('utf8'));
  } catch {
    sendeJson(res, 400, {
      error:
        'Anfrage-Body ist kein gültiges JSON. Im aktiven Schutzmodus wird ' +
        'fail-closed blockiert statt ungeschützt weitergeleitet.',
    });
    return;
  }

  // Body in-place bereinigen: echt → Token. `replacements` enthält nur maskierte
  // Werte (für das Log), niemals Klartext.
  const replacements = sanitizeBody(body, route.provider, deps.config, deps.vault);
  const sanitizedBody = Buffer.from(JSON.stringify(body), 'utf8');

  // 5) An den Upstream weiterleiten und die Antwort re-identifizieren.
  await aktiveWeiterleitung(
    req,
    res,
    upstreamUrl,
    sanitizedBody,
    route.provider,
    deps,
    replacements,
  );
}

// Pass-Through: Body unverändert an den Upstream, Antwort-Status/-Header/-Body 1:1
// zurück an den Client. Keine Bereinigung, keine Re-Identifikation.
async function passThrough(
  req: IncomingMessage,
  res: ServerResponse,
  upstreamUrl: string,
  requestBody: Buffer,
  provider: Provider,
): Promise<void> {
  const upstream = await fetch(upstreamUrl, {
    method: req.method ?? 'GET',
    headers: baueUpstreamHeader(req.headers, requestBody.length),
    body: leerlaubterBody(req.method) ? undefined : alsBodyInit(requestBody),
  });

  // Log: kein Ersatz durchgeführt (Pass-Through). Enthält keinerlei PII.
  emitLog({
    timestamp: new Date().toISOString(),
    mode: 'passthrough',
    provider,
    path: req.url ?? '',
    replacements: [],
  });

  // Antwort 1:1 durchreichen: Status, Header und Body-Bytes unverändert.
  const antwortHeader = kopiereAntwortHeader(upstream.headers);
  res.writeHead(upstream.status, antwortHeader);

  if (upstream.body === null) {
    res.end();
    return;
  }
  await pipeWebToRes(upstream.body, res);
}

// Aktive Weiterleitung: sanitized Body an den Upstream; Antwort je nach Typ
// stream-sicher (SSE) oder als JSON re-identifizieren.
async function aktiveWeiterleitung(
  req: IncomingMessage,
  res: ServerResponse,
  upstreamUrl: string,
  sanitizedBody: Buffer,
  provider: Provider,
  deps: ProxyDeps,
  replacements: Replacement[],
): Promise<void> {
  const upstream = await fetch(upstreamUrl, {
    method: req.method ?? 'POST',
    headers: baueUpstreamHeader(req.headers, sanitizedBody.length),
    body: alsBodyInit(sanitizedBody),
  });

  // Log: durchgeführte Ersetzungen (nur maskierte Werte).
  emitLog({
    timestamp: new Date().toISOString(),
    mode: 'active',
    provider,
    path: req.url ?? '',
    replacements,
  });

  const contentType = upstream.headers.get('content-type') ?? '';

  // 5a) Server-Sent-Events: Byte-Stream durch den stream-sicheren Re-Identify-
  //     Transform in die Client-Antwort pipen (Chunk-Grenzen-fest).
  if (contentType.includes('text/event-stream')) {
    const antwortHeader = kopiereAntwortHeader(upstream.headers);
    res.writeHead(upstream.status, antwortHeader);

    if (upstream.body === null) {
      res.end();
      return;
    }

    const quelle = Readable.fromWeb(upstream.body as NodeWebReadableStream<Uint8Array>);
    const transform = createReidentifyTransform(deps.vault);
    await pipeline(quelle, transform, res);
    return;
  }

  // 5b) Nicht-Stream: gesamten Body sammeln. Ist es JSON, den Baum in-place
  //     re-identifizieren; sonst den Body unverändert (aber ohne Tokens gibt es
  //     nichts zu ersetzen) zurückgeben.
  const rohBytes = upstream.body === null ? Buffer.alloc(0) : Buffer.from(await upstream.arrayBuffer());
  const antwortHeader = kopiereAntwortHeader(upstream.headers);

  let ausgabe: Buffer = rohBytes;
  if (contentType.includes('application/json')) {
    try {
      const json: unknown = JSON.parse(rohBytes.toString('utf8'));
      reidentifyJsonBody(json, provider, deps.vault);
      ausgabe = Buffer.from(JSON.stringify(json), 'utf8');
    } catch {
      // Kein gültiges JSON (trotz Header): unverändert durchreichen. Da nur der
      // Upstream Tokens erzeugt hätte, geht ohne Re-Identifikation nichts verloren.
      ausgabe = rohBytes;
    }
  }

  // content-length neu setzen, da sich die Byte-Länge durch die Re-Identifikation
  // (Token → längerer Klartext) verändert haben kann.
  antwortHeader['content-length'] = String(ausgabe.length);
  res.writeHead(upstream.status, antwortHeader);
  res.end(ausgabe);
}

// Liest den kompletten Request-Body als Buffer ein.
function leseBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Wandelt einen Node-Buffer in einen exakt zugeschnittenen ArrayBuffer, damit er
// als `BodyInit` an das globale fetch() übergeben werden kann.
//
// Grund: Mit dem aktuellen @types/node akzeptiert die fetch-Signatur zwar `string`
// und `ArrayBuffer`, aber weder `Buffer` noch `Uint8Array` direkt (bekannte Ecke
// in der undici-BodyInit-Typisierung). Ein ArrayBuffer ist byte-exakt und trägt
// auch beliebige Binärdaten korrekt. Die Bytes werden in einen frischen, garantiert
// echten ArrayBuffer kopiert (buf.buffer wäre nur `ArrayBufferLike` und teilt sich
// intern einen größeren Pool).
function alsBodyInit(buf: Buffer): ArrayBuffer {
  const kopie = new Uint8Array(buf.byteLength);
  kopie.set(buf);
  return kopie.buffer;
}

// Baut die Header für die Upstream-Anfrage: übernimmt alle eingehenden Header außer
// den hop-by-hop-/verbindungsspezifischen, erzwingt `accept-encoding: identity`
// (unkomprimierte Antwort) und setzt eine passende `content-length`. Auth-Header
// (authorization, x-api-key, anthropic-version) bleiben dadurch automatisch erhalten.
function baueUpstreamHeader(
  eingehend: IncomingMessage['headers'],
  contentLength: number,
): Record<string, string> {
  const header: Record<string, string> = {};

  for (const [name, wert] of Object.entries(eingehend)) {
    if (wert === undefined) {
      continue;
    }
    if (ZU_ENTFERNENDE_HEADER.has(name.toLowerCase())) {
      continue;
    }
    // Mehrfach-Header (Array) zu einem Komma-getrennten Wert zusammenführen.
    header[name] = Array.isArray(wert) ? wert.join(', ') : wert;
  }

  // Unkomprimierte Antwort erzwingen, damit die Re-Identifikation direkt auf dem
  // Klartext-Stream arbeiten kann (kein gzip zu dekodieren).
  header['accept-encoding'] = 'identity';

  // content-length passend zum tatsächlich gesendeten Body setzen.
  if (contentLength > 0) {
    header['content-length'] = String(contentLength);
  }

  return header;
}

// Kopiert die Antwort-Header des Upstreams in ein einfaches Objekt für res.writeHead.
// Verbindungs-/Encoding-Header, die auf die Proxy→Client-Strecke nicht mehr zutreffen,
// werden entfernt: `content-length` wird bei Bedarf neu gesetzt, `content-encoding`
// entfällt (Antwort ist durch `accept-encoding: identity` unkomprimiert), und
// hop-by-hop-Header (`connection`, `transfer-encoding`) gehören nicht weitergereicht.
function kopiereAntwortHeader(headers: Headers): Record<string, string> {
  const raus: Record<string, string> = {};
  const auslassen = new Set([
    'content-length',
    'content-encoding',
    'connection',
    'transfer-encoding',
  ]);
  headers.forEach((wert, name) => {
    if (auslassen.has(name.toLowerCase())) {
      return;
    }
    raus[name] = wert;
  });
  return raus;
}

// Sendet eine JSON-Antwort mit gegebenem Status.
function sendeJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
  });
  res.end(body);
}

// Meldet einen unerwarteten Verarbeitungsfehler als 502 (Bad Gateway), sofern die
// Antwort noch nicht begonnen hat. Der Fehlertext enthält keine PII.
function fehlerAntwort(res: ServerResponse, err: unknown): void {
  const grund = err instanceof Error ? err.message : String(err);
  if (res.headersSent) {
    // Antwort läuft bereits (z. B. Stream) — nur noch sauber beenden.
    res.end();
    return;
  }
  sendeJson(res, 502, {
    error: `Upstream nicht erreichbar oder Verarbeitungsfehler: ${grund}`,
  });
}

// True, wenn die HTTP-Methode üblicherweise keinen Body trägt (GET/HEAD). fetch()
// verbietet einen Body bei diesen Methoden.
function leerlaubterBody(method: string | undefined): boolean {
  const m = (method ?? 'GET').toUpperCase();
  return m === 'GET' || m === 'HEAD';
}

// Pipet einen Web-ReadableStream (fetch-Antwort) in die Node-Server-Antwort.
async function pipeWebToRes(
  webBody: ReadableStream<Uint8Array>,
  res: ServerResponse,
): Promise<void> {
  const node = Readable.fromWeb(webBody as NodeWebReadableStream<Uint8Array>);
  await pipeline(node, res);
}
