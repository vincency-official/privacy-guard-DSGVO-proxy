import { describe, it, expect } from 'vitest';
import { sanitizeText, sanitizeBody } from '../src/sanitize.js';
import { findMatches } from '../src/rules/engine.js';
import { buildDetectors } from '../src/rules/detectors.js';
import { Vault } from '../src/vault.js';
import type { Config, Rule } from '../src/types.js';

// Tests für den Sanitizer: echt → Token. sanitizeText ersetzt gefundene Treffer
// stabil von hinten nach vorne und liefert die durchgeführten Ersetzungen (mit
// maskiertem Wert). sanitizeBody wendet das provider-spezifisch auf alle
// Textfelder des Bodys an und mutiert ihn in-place.

// Hilfsfunktion: nur E-Mail-Detektor aktiv, damit Tests fokussiert bleiben.
function nurEmailDetektoren() {
  return buildDetectors({
    email: true,
    iban: false,
    creditCard: false,
    ipAddress: false,
    secrets: false,
  });
}

describe('sanitizeText', () => {
  it('ersetzt Person-Regel und E-Mail-Detektor durch Tokens', () => {
    const text = 'Hallo Max, mail a@b.de';
    const rules: Rule[] = [{ match: 'Max', type: 'PERSON' }];
    const matches = findMatches(text, rules, nurEmailDetektoren());
    const vault = new Vault();

    const { text: ergebnis, replacements } = sanitizeText(text, matches, vault);

    expect(ergebnis).toBe('Hallo [PERSON_1], mail [EMAIL_1]');
    expect(replacements).toHaveLength(2);
    // Die Rückwärts-Auflösung im Vault muss den Original-Klartext liefern.
    expect(vault.valueFor('[PERSON_1]')).toBe('Max');
    expect(vault.valueFor('[EMAIL_1]')).toBe('a@b.de');
  });

  it('liefert Replacements mit Typ, Token und maskiertem Wert (kein Klartext)', () => {
    const text = 'Hallo Max, mail a@b.de';
    const rules: Rule[] = [{ match: 'Max', type: 'PERSON' }];
    const matches = findMatches(text, rules, nurEmailDetektoren());
    const vault = new Vault();

    const { replacements } = sanitizeText(text, matches, vault);

    const person = replacements.find((r) => r.type === 'PERSON');
    const email = replacements.find((r) => r.type === 'EMAIL');
    expect(person?.token).toBe('[PERSON_1]');
    expect(email?.token).toBe('[EMAIL_1]');
    // masked darf den vollständigen Klartext nicht enthalten.
    expect(person?.masked).toBeTruthy();
    expect(person?.masked).not.toBe('Max');
    expect(email?.masked).not.toBe('a@b.de');
    // Für die E-Mail bleibt die Domain sichtbar (Nutzbarkeit fürs Log).
    expect(email?.masked).toContain('@b.de');
  });

  it('nutzt für einen wiederholten Wert dasselbe Token', () => {
    const text = 'Max und nochmal Max';
    const rules: Rule[] = [{ match: 'Max', type: 'PERSON' }];
    const matches = findMatches(text, rules, []);
    const vault = new Vault();

    const { text: ergebnis, replacements } = sanitizeText(text, matches, vault);

    expect(ergebnis).toBe('[PERSON_1] und nochmal [PERSON_1]');
    // Zwei Ersetzungen (jedes Vorkommen), aber beide auf dasselbe Token.
    expect(replacements).toHaveLength(2);
    expect(replacements[0].token).toBe('[PERSON_1]');
    expect(replacements[1].token).toBe('[PERSON_1]');
  });

  it('gibt bei leeren Matches den Text unverändert zurück', () => {
    const vault = new Vault();
    const { text, replacements } = sanitizeText('Nichts hier.', [], vault);

    expect(text).toBe('Nichts hier.');
    expect(replacements).toEqual([]);
  });

  it('ersetzt korrekt auch bei mehreren Treffern hintereinander (Positionsstabilität)', () => {
    // Drei aufeinanderfolgende Person-Treffer unterschiedlicher Länge; die
    // Rückwärts-Ersetzung darf keine Positionen verschieben.
    const text = 'A BB CCC';
    const rules: Rule[] = [
      { match: 'A', type: 'PERSON' },
      { match: 'BB', type: 'ORG' },
      { match: 'CCC', type: 'PERSON' },
    ];
    const matches = findMatches(text, rules, []);
    const vault = new Vault();

    const { text: ergebnis } = sanitizeText(text, matches, vault);

    expect(ergebnis).toBe('[PERSON_1] [ORG_1] [PERSON_2]');
  });
});

describe('sanitizeBody', () => {
  // Minimal-Config mit einer Person-Regel und nur E-Mail-Detektor.
  function config(): Config {
    return {
      rules: [{ match: 'Max Mustermann', type: 'PERSON' }],
      detectors: {
        email: true,
        iban: false,
        creditCard: false,
        ipAddress: false,
        secrets: false,
      },
      server: { port: 8080, dashboardPort: 8081 },
    };
  }

  it('bereinigt einen OpenAI-Body in-place und liefert Replacements', () => {
    const body = {
      model: 'gpt-4',
      messages: [
        { role: 'user', content: 'Ich bin Max Mustermann, mail max@firma.de' },
      ],
    };
    const vault = new Vault();

    const replacements = sanitizeBody(body, 'openai', config(), vault);

    expect(body.messages[0].content).toBe(
      'Ich bin [PERSON_1], mail [EMAIL_1]',
    );
    expect(replacements).toHaveLength(2);
    expect(vault.valueFor('[PERSON_1]')).toBe('Max Mustermann');
    expect(vault.valueFor('[EMAIL_1]')).toBe('max@firma.de');
  });

  it('bereinigt bei Anthropic auch das system-Feld', () => {
    const body = {
      model: 'claude-3',
      system: 'Nutzer heißt Max Mustermann.',
      messages: [{ role: 'user', content: 'Frage von max@firma.de' }],
    };
    const vault = new Vault();

    const replacements = sanitizeBody(body, 'anthropic', config(), vault);

    expect(body.system).toBe('Nutzer heißt [PERSON_1].');
    expect(body.messages[0].content).toBe('Frage von [EMAIL_1]');
    // Person aus system + E-Mail aus message.
    expect(replacements).toHaveLength(2);
  });

  it('teilt ein Token über mehrere Textfelder hinweg (konsistenter Vault)', () => {
    const body = {
      system: 'System kennt Max Mustermann.',
      messages: [{ role: 'user', content: 'Ich bin Max Mustermann.' }],
    };
    const vault = new Vault();

    sanitizeBody(body, 'anthropic', config(), vault);

    // Derselbe Klartext in zwei Feldern erhält dasselbe Token.
    expect(body.system).toBe('System kennt [PERSON_1].');
    expect(body.messages[0].content).toBe('Ich bin [PERSON_1].');
  });

  it('liefert bei einem Body ohne Treffer ein leeres Replacement-Array', () => {
    const body = {
      messages: [{ role: 'user', content: 'Ein harmloser Satz.' }],
    };
    const vault = new Vault();

    const replacements = sanitizeBody(body, 'openai', config(), vault);

    expect(replacements).toEqual([]);
    expect(body.messages[0].content).toBe('Ein harmloser Satz.');
  });
});
