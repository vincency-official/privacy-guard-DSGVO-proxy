import { describe, it, expect } from 'vitest';
import { findMatches } from '../src/rules/engine.js';
import { buildDetectors } from '../src/rules/detectors.js';
import type { Rule } from '../src/types.js';

// Tests für die Rule-Engine: sammelt Treffer aus expliziten Regeln und
// eingebauten Detektoren, sortiert nach Startposition und löst Überlappungen
// deterministisch auf (früherer Start gewinnt; bei gleichem Start der längere
// Treffer; explizite Regeln haben bei gleichem Bereich Vorrang vor Detektoren).

describe('findMatches', () => {
  it('findet eine explizite Regel im Text mit korrekten Grenzen', () => {
    const text = 'Hallo Max Mustermann.';
    const rules: Rule[] = [{ match: 'Max Mustermann', type: 'PERSON' }];

    const treffer = findMatches(text, rules, []);

    expect(treffer).toHaveLength(1);
    expect(treffer[0]).toEqual({
      value: 'Max Mustermann',
      type: 'PERSON',
      start: 6,
      end: 20,
    });
    // Die Grenzen müssen exakt den Klartext im Original umschließen.
    expect(text.slice(treffer[0].start, treffer[0].end)).toBe('Max Mustermann');
  });

  it('findet alle Vorkommen einer expliziten Regel', () => {
    const text = 'Max und nochmal Max';
    const rules: Rule[] = [{ match: 'Max', type: 'PERSON' }];

    const treffer = findMatches(text, rules, []);

    expect(treffer).toHaveLength(2);
    expect(treffer[0].start).toBe(0);
    expect(treffer[1].start).toBe(16);
  });

  it('kombiniert Regel und E-Mail-Detektor und sortiert nach Startposition', () => {
    const text = 'Hallo Max, schreib an a@b.de bitte.';
    const rules: Rule[] = [{ match: 'Max', type: 'PERSON' }];
    const detektoren = buildDetectors({
      email: true,
      iban: false,
      creditCard: false,
      ipAddress: false,
      secrets: false,
    });

    const treffer = findMatches(text, rules, detektoren);

    expect(treffer).toHaveLength(2);
    // Aufsteigend nach start sortiert: erst die Person, dann die E-Mail.
    expect(treffer[0].type).toBe('PERSON');
    expect(treffer[0].value).toBe('Max');
    expect(treffer[1].type).toBe('EMAIL');
    expect(treffer[1].value).toBe('a@b.de');
    expect(treffer[0].start).toBeLessThan(treffer[1].start);
  });

  it('behält bei überlappenden Regeln nur den längeren Treffer', () => {
    const text = 'Hallo Max Mustermann.';
    const rules: Rule[] = [
      { match: 'Max', type: 'PERSON' },
      { match: 'Max Mustermann', type: 'PERSON' },
    ];

    const treffer = findMatches(text, rules, []);

    // "Max" liegt vollständig in "Max Mustermann"; nur der längere bleibt.
    expect(treffer).toHaveLength(1);
    expect(treffer[0].value).toBe('Max Mustermann');
    expect(treffer[0].start).toBe(6);
    expect(treffer[0].end).toBe(20);
  });

  it('gibt bei fehlenden Treffern ein leeres Array zurück', () => {
    const text = 'Ein völlig harmloser Satz ohne Treffer.';
    const rules: Rule[] = [{ match: 'Erika', type: 'PERSON' }];
    const detektoren = buildDetectors({
      email: true,
      iban: true,
      creditCard: true,
      ipAddress: true,
      secrets: true,
    });

    const treffer = findMatches(text, rules, detektoren);

    expect(treffer).toEqual([]);
  });

  it('bevorzugt bei deckungsgleichem Bereich die explizite Regel vor dem Detektor', () => {
    // Regel und E-Mail-Detektor treffen exakt denselben Bereich (a@b.de).
    // Bei gleichem Start und gleicher Länge gewinnt die explizite Regel.
    const text = 'Kontakt a@b.de nutzen.';
    const rules: Rule[] = [{ match: 'a@b.de', type: 'PERSON' }];
    const detektoren = buildDetectors({
      email: true,
      iban: false,
      creditCard: false,
      ipAddress: false,
      secrets: false,
    });

    const treffer = findMatches(text, rules, detektoren);

    expect(treffer).toHaveLength(1);
    expect(treffer[0].type).toBe('PERSON');
    expect(treffer[0].value).toBe('a@b.de');
  });
});
