// Tests für den Dashboard-Server: Status abfragen, Schutz per API umschalten,
// HTML-Oberfläche ausliefern. Der Toggle nutzt einen Temp-Pfad, damit nie die
// echte Marker-Datei im Arbeitsverzeichnis angefasst wird.

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { request as httpRequest, type Server } from 'node:http';
import { createDashboardServer } from '../src/dashboard/index.js';
import { Toggle } from '../src/toggle.js';

let tempDir: string;
let togglePfad: string;
let server: Server;
let basis: string;
let port: number;

// Roher HTTP-POST, mit dem sich beliebige (auch "forbidden") Header wie Origin
// und Sec-Fetch-Site setzen lassen — fetch() würde diese stillschweigend strippen.
function postRaw(
  pfad: string,
  headers: Record<string, string>,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: pfad, method: 'POST', headers },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'pg-dash-'));
  togglePfad = join(tempDir, '.privacy-disabled');
  const toggle = new Toggle(togglePfad);
  server = createDashboardServer(toggle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  basis = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(tempDir, { recursive: true, force: true });
});

describe('Dashboard-Server', () => {
  test('GET /api/status ist initial nicht deaktiviert (Schutz an)', async () => {
    const r = await fetch(`${basis}/api/status`);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ disabled: false });
  });

  test('POST /api/toggle schaltet den Schutz aus und legt die Marker-Datei an', async () => {
    const r = await fetch(`${basis}/api/toggle`, { method: 'POST' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ disabled: true });
    expect(existsSync(togglePfad)).toBe(true);
  });

  test('zweites POST /api/toggle schaltet wieder an und entfernt die Datei', async () => {
    await fetch(`${basis}/api/toggle`, { method: 'POST' });
    const r = await fetch(`${basis}/api/toggle`, { method: 'POST' });
    expect(await r.json()).toEqual({ disabled: false });
    expect(existsSync(togglePfad)).toBe(false);
  });

  test('GET / liefert die HTML-Oberfläche', async () => {
    const r = await fetch(`${basis}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/html');
    const html = await r.text();
    expect(html).toContain('Privacy-Guard');
  });

  test('unbekannte Route liefert 404', async () => {
    const r = await fetch(`${basis}/gibtsnicht`);
    expect(r.status).toBe(404);
  });

  test('POST /api/toggle mit Cross-Site-Herkunft wird abgelehnt (CSRF-Schutz)', async () => {
    const r = await postRaw('/api/toggle', { 'sec-fetch-site': 'cross-site' });
    expect(r.status).toBe(403);
    // Zustand unverändert — der Schutz wurde NICHT abgeschaltet.
    expect(existsSync(togglePfad)).toBe(false);
  });

  test('POST /api/toggle mit fremdem Origin wird abgelehnt', async () => {
    const r = await postRaw('/api/toggle', { origin: 'http://evil.example' });
    expect(r.status).toBe(403);
    expect(existsSync(togglePfad)).toBe(false);
  });

  test('POST /api/toggle mit same-origin (Sec-Fetch-Site) wird zugelassen', async () => {
    const r = await postRaw('/api/toggle', { 'sec-fetch-site': 'same-origin' });
    expect(r.status).toBe(200);
    expect(existsSync(togglePfad)).toBe(true);
  });
});
