import { describe, it, expect } from 'vitest';
import { logBus, emitLog, maskValue } from '../src/events.js';
import type { LogEntry } from '../src/types.js';

// Tests für den Event-Bus und die Wert-Maskierung fürs Log.
//
// Sicherheitsprinzip: maskValue() darf einen Klartext-Wert niemals vollständig
// preisgeben. Der Event-Bus verteilt Log-Einträge an interessierte Zuhörer
// (z. B. das Dashboard) — die Einträge enthalten selbst nur maskierte Werte.

describe('maskValue', () => {
  it('maskiert eine E-Mail: erstes Zeichen sichtbar, Domain erhalten, Sterne enthalten', () => {
    const maskiert = maskValue('michael@gmx.de');

    // Erstes Zeichen des lokalen Teils bleibt sichtbar.
    expect(maskiert.startsWith('m')).toBe(true);
    // Die Domain (inkl. "@") bleibt vollständig sichtbar.
    expect(maskiert).toContain('@gmx.de');
    // Es wird tatsächlich maskiert (mindestens ein Stern).
    expect(maskiert).toContain('*');
    // Der lokale Teil "michael" wird nicht vollständig verraten.
    expect(maskiert).not.toContain('michael');
  });

  it('gibt bei einem Namen nicht den vollständigen Klartext preis', () => {
    const maskiert = maskValue('Max Mustermann');

    // Der Nachname darf nicht im Klartext auftauchen.
    expect(maskiert).not.toContain('Mustermann');
    // Der komplette Wert darf nicht unverändert durchgereicht werden.
    expect(maskiert).not.toBe('Max Mustermann');
    // Es wird maskiert.
    expect(maskiert).toContain('*');
  });

  it('maskiert sehr kurze Werte (≤ 2 Zeichen) vollständig', () => {
    // Bei ein bis zwei Zeichen gibt es keine sinnvolle Teil-Preisgabe.
    expect(maskValue('Ab')).toBe('**');
    expect(maskValue('X')).toBe('*');
  });

  it('verrät bei langen Secrets die Länge nicht (Sterne gedeckelt)', () => {
    const geheim = 'sk-' + 'a'.repeat(40);
    const maskiert = maskValue(geheim);

    // Das Ergebnis ist deutlich kürzer als der Originalwert.
    expect(maskiert.length).toBeLessThan(geheim.length);
    // Der volle Klartext taucht nicht auf.
    expect(maskiert).not.toBe(geheim);
  });
});

describe('emitLog / logBus', () => {
  it('löst beim Zuhörer das "log"-Event mit dem übergebenen Eintrag aus', () => {
    const eintrag: LogEntry = {
      timestamp: new Date().toISOString(),
      mode: 'active',
      provider: 'openai',
      path: '/openai/v1/chat/completions',
      replacements: [{ type: 'PERSON', token: '[PERSON_1]', masked: 'Ma********' }],
    };

    const empfangen: LogEntry[] = [];
    const zuhoerer = (e: LogEntry) => empfangen.push(e);

    logBus.on('log', zuhoerer);
    try {
      emitLog(eintrag);
    } finally {
      // Zuhörer wieder entfernen, damit sich Tests nicht gegenseitig beeinflussen.
      logBus.off('log', zuhoerer);
    }

    expect(empfangen).toHaveLength(1);
    expect(empfangen[0]).toBe(eintrag);
    expect(empfangen[0].provider).toBe('openai');
    expect(empfangen[0].replacements[0].token).toBe('[PERSON_1]');
  });
});
