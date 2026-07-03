// End-to-End: echter lauschender Proxy + echter Mock-Upstream + echtes Client-fetch.
// Prüft den vollständigen Roundtrip — der Upstream sieht nur Tokens, der Client
// erhält re-identifizierten Klartext — für Nicht-Stream, Stream (mit über eine
// Chunk-Grenze zerschnittenem Token) und Pass-Through. Zusätzlich wird verifiziert,
// dass der Auth-Header unverändert an den Upstream durchgereicht wird.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProxyServer } from '../src/server.js';
import { Vault } from '../src/vault.js';
import { Toggle } from '../src/toggle.js';
import { logBus } from '../src/events.js';
import type { Config, LogEntry } from '../src/types.js';

function leseBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const config: Config = {
  rules: [{ match: 'Max Mustermann', type: 'PERSON' }],
  detectors: { email: true, iban: true, creditCard: true, ipAddress: true, secrets: true },
  server: { port: 0, dashboardPort: 0 },
};

const CLIENT_BODY = JSON.stringify({
  model: 'gpt-4',
  messages: [{ role: 'user', content: 'Ich bin Max Mustermann' }],
});

let mockUpstream: Server;
let mockOrigin: string;
let empfangenerBody: string;
let empfangeneAuth: string | undefined;
let empfangeneHeaders: import('node:http').IncomingHttpHeaders;
let proxy: Server;
let proxyBasis: string;
let tempDir: string;
let togglePfad: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'pg-e2e-'));
  togglePfad = join(tempDir, '.privacy-disabled');
  empfangenerBody = '';
  empfangeneAuth = undefined;

  // Mock-Upstream: erfasst Body + Auth-Header und antwortet je nach Pfad mit JSON
  // oder mit einem SSE-Stream, dessen Token bewusst über zwei Chunks zerschnitten wird.
  mockUpstream = createServer(async (req, res) => {
    empfangenerBody = await leseBody(req);
    empfangeneAuth = req.headers['authorization'] as string | undefined;
    empfangeneHeaders = req.headers;
    const userText = (JSON.parse(empfangenerBody).messages[0].content) as string;

    if ((req.url ?? '').includes('stream')) {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
      const voll = `data: {"delta":"${userText}"}\n\n`;
      const schnitt = Math.floor(voll.length / 2);
      res.write(voll.slice(0, schnitt));
      await new Promise((r) => setTimeout(r, 20));
      res.write(voll.slice(schnitt));
      res.end();
      return;
    }

    const payload = JSON.stringify({
      choices: [{ message: { role: 'assistant', content: `Echo: ${userText}` } }],
    });
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(payload)),
    });
    res.end(payload);
  });
  await new Promise<void>((resolve) => mockUpstream.listen(0, '127.0.0.1', () => resolve()));
  mockOrigin = `http://127.0.0.1:${(mockUpstream.address() as AddressInfo).port}`;

  const vault = new Vault();
  const toggle = new Toggle(togglePfad);
  proxy = createProxyServer({ config, vault, toggle, originOverride: () => mockOrigin });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', () => resolve()));
  proxyBasis = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => proxy.close(() => resolve()));
  await new Promise<void>((resolve) => mockUpstream.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
});

describe('End-to-End Roundtrip', () => {
  test('Nicht-Stream: Upstream sieht Token, Client sieht Klartext, Auth durchgereicht', async () => {
    const r = await fetch(`${proxyBasis}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk-test-123' },
      body: CLIENT_BODY,
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { choices: { message: { content: string } }[] };

    // Client erhält re-identifizierten Klartext.
    expect(j.choices[0].message.content).toContain('Max Mustermann');
    expect(j.choices[0].message.content).not.toContain('[PERSON_1]');

    // Upstream hat ausschließlich das Token gesehen.
    expect(empfangenerBody).toContain('[PERSON_1]');
    expect(empfangenerBody).not.toContain('Max Mustermann');

    // Auth-Header wurde unverändert durchgereicht (Design-Entscheidung 1).
    expect(empfangeneAuth).toBe('Bearer sk-test-123');
  });

  test('Stream: über eine Chunk-Grenze zerschnittenes Token wird korrekt re-identifiziert', async () => {
    const r = await fetch(`${proxyBasis}/openai/v1/chat/completions?stream=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk-test-123' },
      body: CLIENT_BODY,
    });
    expect(r.status).toBe(200);
    const text = await r.text();

    // Vollständig re-identifiziert, kein zurückbleibendes oder zerbrochenes Token.
    expect(text).toContain('Max Mustermann');
    expect(text).not.toContain('[PERSON_1]');
    expect(text).not.toContain('[PERSON');

    // Upstream sah nur das Token.
    expect(empfangenerBody).toContain('[PERSON_1]');
  });

  test('reicht nur erlaubte Header an den Upstream weiter (Allowlist)', async () => {
    await fetch(`${proxyBasis}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sk-test-123',
        'x-internal-secret': 'streng-geheim',
      },
      body: CLIENT_BODY,
    });
    // Erlaubter Auth-Header erreicht den Upstream ...
    expect(empfangeneHeaders['authorization']).toBe('Bearer sk-test-123');
    // ... ein beliebiger interner Client-Header wird verworfen.
    expect(empfangeneHeaders['x-internal-secret']).toBeUndefined();
  });

  test('markiert einen nicht abgedeckten Endpunkt mit einer Warnung im Log', async () => {
    const eintraege: LogEntry[] = [];
    const zuhoerer = (e: LogEntry): void => {
      eintraege.push(e);
    };
    logBus.on('log', zuhoerer);
    try {
      await fetch(`${proxyBasis}/openai/v1/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer sk-test-123' },
        body: CLIENT_BODY,
      });
    } finally {
      logBus.off('log', zuhoerer);
    }
    const aktiv = eintraege.find((e) => e.mode === 'active');
    expect(aktiv?.warning).toBeTruthy();
    expect(aktiv?.warning).toContain('embeddings');
  });

  test('setzt für einen abgedeckten Chat-Endpunkt keine Warnung', async () => {
    const eintraege: LogEntry[] = [];
    const zuhoerer = (e: LogEntry): void => {
      eintraege.push(e);
    };
    logBus.on('log', zuhoerer);
    try {
      await fetch(`${proxyBasis}/openai/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer sk-test-123' },
        body: CLIENT_BODY,
      });
    } finally {
      logBus.off('log', zuhoerer);
    }
    const aktiv = eintraege.find((e) => e.mode === 'active');
    expect(aktiv?.warning).toBeUndefined();
  });

  test('Pass-Through: bei deaktiviertem Schutz sieht der Upstream den Klartext', async () => {
    // Marker-Datei anlegen → Pass-Through-Modus.
    writeFileSync(togglePfad, 'x', 'utf8');
    const r = await fetch(`${proxyBasis}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sk-test-123' },
      body: CLIENT_BODY,
    });
    expect(r.status).toBe(200);
    // Ungefiltert: der echte Name erreicht den Upstream.
    expect(empfangenerBody).toContain('Max Mustermann');
    expect(empfangenerBody).not.toContain('[PERSON_1]');
  });
});
