import { describe, it, expect } from 'vitest';
import { transformTexts } from '../src/providers.js';

// Tests für die provider-spezifische Textextraktion. transformTexts läuft über
// alle Textfelder des Anfrage-Bodys (je nach Provider) und wendet die Funktion
// in-place an; Nicht-Textfelder bleiben unangetastet.

describe('transformTexts', () => {
  it('transformiert OpenAI-messages mit String-content', () => {
    const body = {
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'Sei hilfreich.' },
        { role: 'user', content: 'Hallo Welt' },
      ],
    };

    transformTexts(body, 'openai', (t) => t.toUpperCase());

    expect(body.messages[0].content).toBe('SEI HILFREICH.');
    expect(body.messages[1].content).toBe('HALLO WELT');
    // Nicht-Textfelder bleiben unverändert.
    expect(body.model).toBe('gpt-4');
    expect(body.messages[0].role).toBe('system');
  });

  it('transformiert OpenAI-messages mit Array-content (nur text-Teile)', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'erster Teil' },
            { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
            { type: 'text', text: 'zweiter Teil' },
          ],
        },
      ],
    };

    transformTexts(body, 'openai', (t) => `[${t}]`);

    const parts = body.messages[0].content as Array<Record<string, unknown>>;
    expect(parts[0].text).toBe('[erster Teil]');
    // Der Bild-Teil bleibt völlig unangetastet.
    expect(parts[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/a.png' },
    });
    expect(parts[2].text).toBe('[zweiter Teil]');
  });

  it('transformiert bei Anthropic zusätzlich das system-Feld als String', () => {
    const body = {
      model: 'claude-3',
      system: 'Du bist ein Assistent.',
      messages: [{ role: 'user', content: 'Frage' }],
    };

    transformTexts(body, 'anthropic', (t) => t.toUpperCase());

    expect(body.system).toBe('DU BIST EIN ASSISTENT.');
    expect(body.messages[0].content).toBe('FRAGE');
  });

  it('transformiert bei Anthropic das system-Feld als Array (nur text-Teile)', () => {
    const body = {
      system: [
        { type: 'text', text: 'Regel eins' },
        { type: 'text', text: 'Regel zwei' },
      ],
      messages: [],
    };

    transformTexts(body, 'anthropic', (t) => t.toUpperCase());

    const sys = body.system as Array<Record<string, unknown>>;
    expect(sys[0].text).toBe('REGEL EINS');
    expect(sys[1].text).toBe('REGEL ZWEI');
  });

  it('rührt das system-Feld bei OpenAI NICHT als Extrafeld an', () => {
    // Bei OpenAI wird nur messages[].content transformiert; ein etwaiges
    // Top-Level-system-Feld ist kein OpenAI-Konzept und bleibt unangetastet.
    const body = {
      system: 'unangetastet',
      messages: [{ role: 'user', content: 'Hallo' }],
    };

    transformTexts(body, 'openai', (t) => t.toUpperCase());

    expect(body.system).toBe('unangetastet');
    expect(body.messages[0].content).toBe('HALLO');
  });

  it('lässt unbekannte oder fehlende Felder unangetastet', () => {
    // Kein messages-Feld, nur Fremdfelder: nichts darf sich ändern und es darf
    // nicht werfen.
    const body = { irgendwas: 42, tief: { x: 'y' } };

    expect(() => transformTexts(body, 'openai', (t) => t.toUpperCase())).not.toThrow();
    expect(body).toEqual({ irgendwas: 42, tief: { x: 'y' } });
  });

  it('wirft nicht bei null-Body oder Nicht-Objekten', () => {
    expect(() => transformTexts(null, 'openai', (t) => t)).not.toThrow();
    expect(() => transformTexts('string', 'anthropic', (t) => t)).not.toThrow();
    expect(() => transformTexts(123, 'openai', (t) => t)).not.toThrow();
  });
});
