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

  it('erfasst fail-safe auch ein Top-Level-system-Feld bei OpenAI', () => {
    // Fail-safe: JEDES String-Feld wird bereinigt, auch providerfremde wie ein
    // Top-Level-system bei OpenAI — sonst könnte dort PII unbemerkt durchrutschen.
    const body = {
      system: 'enthält Max',
      messages: [{ role: 'user', content: 'Hallo' }],
    };

    transformTexts(body, 'openai', (t) => t.toUpperCase());

    expect(body.system).toBe('ENTHÄLT MAX');
    expect(body.messages[0].content).toBe('HALLO');
  });

  it('bereinigt fail-safe auch Strings in unbekannten/verschachtelten Feldern', () => {
    // Zahlen und Struktur bleiben; unbekannte String-Felder werden erfasst, statt
    // ungefiltert durchzurutschen.
    const body = { irgendwas: 42, tief: { x: 'geheim' } };

    expect(() => transformTexts(body, 'openai', (t) => t.toUpperCase())).not.toThrow();
    expect(body.irgendwas).toBe(42);
    expect(body.tief.x).toBe('GEHEIM');
  });

  it('bereinigt OpenAI tool_calls[].function.arguments (JSON-String); Name/ID/Typ bleiben', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'suche', arguments: '{"ort":"Berlin","wer":"geheim"}' },
            },
          ],
        },
      ],
    };

    transformTexts(body, 'openai', (t) => t.toUpperCase());

    const tc = (body.messages[0] as Record<string, any>).tool_calls[0];
    // Strukturelle Bezeichner bleiben unverändert (sonst bräche Tool-Calling).
    expect(tc.id).toBe('call_1');
    expect(tc.type).toBe('function');
    expect(tc.function.name).toBe('suche');
    // arguments wird als JSON geparst, die Werte bereinigt und re-serialisiert.
    const args = JSON.parse(tc.function.arguments);
    expect(args.ort).toBe('BERLIN');
    expect(args.wer).toBe('GEHEIM');
  });

  it('bereinigt Anthropic tool_use.input rekursiv; Name/ID bleiben', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'tu_1', name: 'lookup', input: { kunde: 'geheim', ort: 'Berlin' } },
          ],
        },
      ],
    };

    transformTexts(body, 'anthropic', (t) => t.toUpperCase());

    const block = (body.messages[0].content as Array<Record<string, any>>)[0];
    expect(block.name).toBe('lookup');
    expect(block.id).toBe('tu_1');
    expect(block.input.kunde).toBe('GEHEIM');
    expect(block.input.ort).toBe('BERLIN');
  });

  it('bereinigt Anthropic tool_result.content; tool_use_id bleibt', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: 'Ergebnis für geheim' }],
        },
      ],
    };

    transformTexts(body, 'anthropic', (t) => t.toUpperCase());

    const block = (body.messages[0].content as Array<Record<string, any>>)[0];
    expect(block.tool_use_id).toBe('tu_1');
    expect(block.content).toBe('ERGEBNIS FÜR GEHEIM');
  });

  it('wirft nicht bei null-Body oder Nicht-Objekten', () => {
    expect(() => transformTexts(null, 'openai', (t) => t)).not.toThrow();
    expect(() => transformTexts('string', 'anthropic', (t) => t)).not.toThrow();
    expect(() => transformTexts(123, 'openai', (t) => t)).not.toThrow();
  });
});
