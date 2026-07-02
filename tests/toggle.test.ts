import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Toggle } from '../src/toggle.js';

// Tests für den datei-basierten Toggle: Existenz der Marker-Datei steuert den
// Pass-Through. Vorhandene Datei = Schutz AUS (disabled); keine Datei = Schutz AN.
// Alle Tests laufen gegen einen frischen Temp-Pfad, nie gegen das echte
// ./.privacy-disabled im Arbeitsverzeichnis.

describe('Toggle', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    // Frisches Temp-Verzeichnis pro Test, damit sich die Marker-Datei nicht
    // über Tests hinweg überlagert.
    dir = mkdtempSync(join(tmpdir(), 'pg-toggle-'));
    file = join(dir, '.privacy-disabled');
  });

  afterEach(() => {
    // Aufräumen: komplettes Temp-Verzeichnis entfernen.
    rmSync(dir, { recursive: true, force: true });
  });

  it('ist initial nicht disabled (keine Marker-Datei vorhanden)', () => {
    const toggle = new Toggle(file);

    expect(toggle.isDisabled()).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it('legt bei disable() die Marker-Datei an und meldet disabled', () => {
    const toggle = new Toggle(file);

    toggle.disable();

    expect(toggle.isDisabled()).toBe(true);
    expect(existsSync(file)).toBe(true);
  });

  it('entfernt bei enable() die Marker-Datei und meldet nicht mehr disabled', () => {
    const toggle = new Toggle(file);
    toggle.disable();

    toggle.enable();

    expect(toggle.isDisabled()).toBe(false);
    expect(existsSync(file)).toBe(false);
  });

  it('ist bei enable() idempotent (doppeltes enable() wirft nicht)', () => {
    const toggle = new Toggle(file);

    // Bereits im aktiven Zustand: enable() darf ohne vorhandene Datei nicht werfen.
    expect(() => toggle.enable()).not.toThrow();
    // Und ein weiteres Mal ebenso wenig.
    expect(() => toggle.enable()).not.toThrow();
    expect(toggle.isDisabled()).toBe(false);
  });

  it('ist bei disable() idempotent (doppeltes disable() wirft nicht)', () => {
    const toggle = new Toggle(file);

    toggle.disable();
    // Zweiter Aufruf bei bereits vorhandener Datei bleibt fehlerfrei.
    expect(() => toggle.disable()).not.toThrow();
    expect(toggle.isDisabled()).toBe(true);
    expect(existsSync(file)).toBe(true);
  });
});
