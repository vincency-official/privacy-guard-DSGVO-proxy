import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import {
  reidentifyText,
  reidentifyJsonBody,
  createReidentifyTransform,
} from '../src/reidentify.js';
import { Vault } from '../src/vault.js';

// Tests für den Re-Identifier: Token → echt. reidentifyText ersetzt alle
// [TYP_N]-Tokens im Text durch den ursprünglichen Klartext aus dem Vault.
// reidentifyJsonBody macht das provider-spezifisch für einen Antwort-Body.
// createReidentifyTransform liefert einen stream-sicheren Node-Transform, der
// auch dann korrekt arbeitet, wenn ein Token oder ein Multibyte-Zeichen über
// eine Chunk-Grenze zerschnitten wird.

// Sammelt alle Buffer-Chunks eines Readable zu einem einzigen UTF-8-String.
async function sammle(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

describe('reidentifyText', () => {
  it('ersetzt ein gemapptes Token durch den Klartext', () => {
    const vault = new Vault();
    // Token vergeben, damit valueFor("[PERSON_1]") = "Max" liefert.
    vault.tokenFor('Max', 'PERSON');

    expect(reidentifyText('Hallo [PERSON_1]', vault)).toBe('Hallo Max');
  });

  it('lässt ein unbekanntes Token unverändert', () => {
    const vault = new Vault();

    expect(reidentifyText('Wert [PERSON_9]', vault)).toBe('Wert [PERSON_9]');
  });

  it('ersetzt mehrere Tokens verschiedener Typen im selben Text', () => {
    const vault = new Vault();
    vault.tokenFor('Max Mustermann', 'PERSON');
    vault.tokenFor('a@b.de', 'EMAIL');

    expect(
      reidentifyText('[PERSON_1] schrieb an [EMAIL_1].', vault),
    ).toBe('Max Mustermann schrieb an a@b.de.');
  });

  it('lässt einen Text ohne Tokens unverändert', () => {
    const vault = new Vault();
    expect(reidentifyText('Nichts zu ersetzen.', vault)).toBe(
      'Nichts zu ersetzen.',
    );
  });
});

describe('reidentifyJsonBody', () => {
  it('re-identifiziert Tokens in einem OpenAI-Antwort-Body in-place', () => {
    const vault = new Vault();
    vault.tokenFor('Max Mustermann', 'PERSON');

    const body = {
      id: 'chatcmpl-1',
      choices: [
        { message: { role: 'assistant', content: 'Hallo [PERSON_1]!' } },
      ],
    };

    reidentifyJsonBody(body, 'openai', vault);

    expect(body.choices[0].message.content).toBe('Hallo Max Mustermann!');
  });

  it('re-identifiziert Tokens in Anthropic-Content-Teilen in-place', () => {
    const vault = new Vault();
    vault.tokenFor('Eva Beispiel', 'PERSON');

    // Anthropic-Antworten liefern content als Array typisierter Teile.
    const body = {
      role: 'assistant',
      content: [{ type: 'text', text: 'Antwort für [PERSON_1].' }],
    };

    reidentifyJsonBody(body, 'anthropic', vault);

    expect(body.content[0].text).toBe('Antwort für Eva Beispiel.');
  });
});

describe('createReidentifyTransform', () => {
  it('setzt ein über die Chunk-Grenze zerschnittenes Token korrekt zusammen', async () => {
    const vault = new Vault();
    vault.tokenFor('Max Mustermann', 'PERSON');

    const transform = createReidentifyTransform(vault);
    // Zwei Chunks, die das Token "[PERSON_1]" mitten im Namen zerschneiden.
    const eingabe = Readable.from(['Hallo [PERSO', 'N_1]!']);

    const ausgabe = await sammle(eingabe.pipe(transform));

    expect(ausgabe).toBe('Hallo Max Mustermann!');
  });

  it('behält einen über die Chunk-Grenze zerschnittenen Umlaut bei', async () => {
    const vault = new Vault();
    vault.tokenFor('Max Mustermann', 'PERSON');

    const transform = createReidentifyTransform(vault);
    // Das "ü" (2 Bytes in UTF-8) wird über die Grenze zerschnitten: der erste
    // Buffer endet mitten im Multibyte-Zeichen.
    const gruesse = Buffer.from('grüße [PERSON_1]', 'utf8');
    // Splitten wir so, dass das "ü" (Bytes 3-4) auf der Grenze liegt.
    const teil1 = gruesse.subarray(0, 4); // "gr" + erstes Byte von "ü"
    const teil2 = gruesse.subarray(4); // zweites Byte von "ü" + Rest
    const eingabe = Readable.from([teil1, teil2]);

    const ausgabe = await sammle(eingabe.pipe(transform));

    expect(ausgabe).toBe('grüße Max Mustermann');
  });

  it('gibt am Stream-Ende auch einen im Buffer verbliebenen Rest aus (flush)', async () => {
    const vault = new Vault();
    vault.tokenFor('Max', 'PERSON');

    const transform = createReidentifyTransform(vault);
    // Der letzte Chunk endet mit einer offenen Klammer ohne schließende — der
    // Rest muss beim _flush noch verarbeitet und ausgegeben werden.
    const eingabe = Readable.from(['[PERSON_1] und [', 'PERSON_1]']);

    const ausgabe = await sammle(eingabe.pipe(transform));

    expect(ausgabe).toBe('Max und Max');
  });

  it('lässt ein unbekanntes Token auch im Stream unverändert', async () => {
    const vault = new Vault();

    const transform = createReidentifyTransform(vault);
    const eingabe = Readable.from(['davor [UNBE', 'KANNT_5] danach']);

    const ausgabe = await sammle(eingabe.pipe(transform));

    expect(ausgabe).toBe('davor [UNBEKANNT_5] danach');
  });
});
