import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig, DEFAULT_DETECTORS } from '../src/config.js';

// Tests für den Config-Loader: fehlende Datei → Defaults; vorhandene Datei →
// gemergt mit Defaults (fehlende Felder gefüllt); kaputtes JSON → Fehler.

describe('loadConfig', () => {
  let dir: string;

  beforeEach(() => {
    // Frisches Temp-Verzeichnis pro Test, damit sich Dateien nicht überlagern.
    dir = mkdtempSync(join(tmpdir(), 'pg-config-'));
  });

  afterEach(() => {
    // Aufräumen: das komplette Temp-Verzeichnis entfernen.
    rmSync(dir, { recursive: true, force: true });
  });

  it('liefert bei nicht existierendem Pfad Defaults (leere rules, alle Detektoren true, Port 8080)', () => {
    const cfg = loadConfig(join(dir, 'gibt-es-nicht.json'));

    expect(cfg.rules).toEqual([]);
    expect(cfg.detectors.email).toBe(true);
    expect(cfg.detectors.iban).toBe(true);
    expect(cfg.detectors.creditCard).toBe(true);
    expect(cfg.detectors.ipAddress).toBe(true);
    expect(cfg.detectors.secrets).toBe(true);
    expect(cfg.server.port).toBe(8080);
    expect(cfg.server.dashboardPort).toBe(8081);
  });

  it('mergt eine vorhandene Datei mit den Defaults (fehlende Detektor-Felder = true)', () => {
    const file = join(dir, 'privacy-rules.json');
    writeFileSync(
      file,
      JSON.stringify({
        rules: [{ match: 'X', type: 'PERSON' }],
        detectors: { email: false },
      }),
      'utf8',
    );

    const cfg = loadConfig(file);

    // Regel wird übernommen.
    expect(cfg.rules).toEqual([{ match: 'X', type: 'PERSON' }]);
    // Explizit gesetztes Feld bleibt false.
    expect(cfg.detectors.email).toBe(false);
    // Fehlende Detektor-Felder werden aus den Defaults auf true gesetzt.
    expect(cfg.detectors.iban).toBe(true);
    expect(cfg.detectors.creditCard).toBe(true);
    expect(cfg.detectors.ipAddress).toBe(true);
    expect(cfg.detectors.secrets).toBe(true);
    // Fehlende Ports fallen auf die Defaults zurück.
    expect(cfg.server.port).toBe(8080);
    expect(cfg.server.dashboardPort).toBe(8081);
  });

  it('übernimmt gesetzte Ports und mergt fehlende', () => {
    const file = join(dir, 'privacy-rules.json');
    writeFileSync(
      file,
      JSON.stringify({ server: { port: 9090 } }),
      'utf8',
    );

    const cfg = loadConfig(file);

    // Gesetzter Port wird übernommen, fehlender dashboardPort fällt auf Default.
    expect(cfg.server.port).toBe(9090);
    expect(cfg.server.dashboardPort).toBe(8081);
    // Ohne Regeln bleibt die Liste leer, Detektoren sind alle true.
    expect(cfg.rules).toEqual([]);
    expect(cfg.detectors).toEqual(DEFAULT_DETECTORS);
  });

  it('wirft bei kaputtem JSON einen aussagekräftigen Fehler', () => {
    const file = join(dir, 'privacy-rules.json');
    writeFileSync(file, '{ das ist kein JSON', 'utf8');

    expect(() => loadConfig(file)).toThrow();
  });

  it('exportiert DEFAULT_DETECTORS mit allen Feldern auf true', () => {
    expect(DEFAULT_DETECTORS).toEqual({
      email: true,
      iban: true,
      creditCard: true,
      ipAddress: true,
      secrets: true,
    });
  });
});
