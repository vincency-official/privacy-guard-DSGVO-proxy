// Re-Identifier: ersetzt Tokens wieder durch den echten Klartext (Token → echt).
//
// Der Vault hält die Zuordnung Token → Klartext ausschließlich im Speicher.
// reidentifyText ersetzt alle [TYP_N]-Tokens in einem String, reidentifyJsonBody
// macht das provider-spezifisch für einen gesammelten Antwort-Body, und
// createReidentifyTransform liefert einen Node-Transform für Streams (SSE), der
// auch dann korrekt bleibt, wenn ein Token oder ein Multibyte-Zeichen über eine
// Chunk-Grenze zerschnitten wird. Nur Node-Built-ins, keine externen Dependencies.

import { Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import type { Provider } from './types.js';
import type { Vault } from './vault.js';

// Erkennt ein Token im Format [TYP_N]: Großbuchstaben/Unterstriche für den Typ,
// gefolgt von "_" und einer Zahl. Das "g"-Flag ersetzt alle Vorkommen.
const TOKEN_REGEX = /\[[A-Z_]+_\d+\]/g;

// Ersetzt alle [TYP_N]-Tokens im Text durch den zugehörigen Klartext aus dem
// Vault. Ein unbekanntes Token (kein Eintrag im Vault) bleibt unverändert
// stehen — so gehen fremde eckige Klammern im Modell-Output nicht verloren.
export function reidentifyText(text: string, vault: Vault): string {
  return text.replace(TOKEN_REGEX, (token) => {
    const echt = vault.valueFor(token);
    return echt === undefined ? token : echt;
  });
}

// Re-identifiziert alle Text-Strings eines Antwort-Bodys in-place.
//
// Anders als beim Sanitizer wird hier der GESAMTE JSON-Baum rekursiv durchlaufen
// und jeder String rücktransformiert. Grund: Antwort-Bodys unterscheiden sich je
// Provider stark im Aufbau (OpenAI: choices[].message.content; Anthropic:
// content[].text) und enthalten Tokens potenziell an unterschiedlichen Stellen.
// Ein String ohne Token bleibt durch reidentifyText ohnehin unverändert, daher
// ist der pauschale Durchlauf sicher. Der provider-Parameter bleibt Teil der
// Signatur (für spätere provider-spezifische Sonderfälle), wird aktuell aber
// nicht benötigt.
export function reidentifyJsonBody(
  body: unknown,
  _provider: Provider,
  vault: Vault,
): void {
  walkAndReidentify(body, vault);
}

// Läuft rekursiv durch Objekte und Arrays und ersetzt jeden String-Wert in-place
// durch seine re-identifizierte Fassung. Objekt-Schlüssel bleiben unangetastet.
function walkAndReidentify(value: unknown, vault: Vault): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const element = value[i];
      if (typeof element === 'string') {
        value[i] = reidentifyText(element, vault);
      } else {
        walkAndReidentify(element, vault);
      }
    }
    return;
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const feld = record[key];
      if (typeof feld === 'string') {
        record[key] = reidentifyText(feld, vault);
      } else {
        walkAndReidentify(feld, vault);
      }
    }
  }
}

// Erzeugt einen Node-Transform, der einen Byte-Stream (z. B. SSE) durchläuft und
// darin alle Tokens durch den Klartext ersetzt — stream-sicher an Chunk-Grenzen.
//
// Zwei Fallstricke werden behandelt:
//  1. Multibyte-Zeichen (z. B. "ü") können über eine Chunk-Grenze zerschnitten
//     sein. Ein StringDecoder puffert das unvollständige Byte intern und gibt es
//     erst mit dem nächsten Chunk als vollständiges Zeichen zurück.
//  2. Ein Token (z. B. "[PERSON_1]") kann über eine Chunk-Grenze zerschnitten
//     sein. Deshalb wird nur bis zur letzten "offenen" Klammer ohne folgendes
//     "]" ersetzt; der potentiell unvollständige Rest bleibt im Puffer, bis der
//     nächste Chunk (oder _flush) ihn vervollständigt.
export function createReidentifyTransform(vault: Vault): Transform {
  const decoder = new StringDecoder('utf8');
  // Noch nicht sicher verarbeitbarer Rest (möglicher Token-Anfang am Chunk-Ende).
  let buffer = '';

  return new Transform({
    transform(chunk, _encoding, callback) {
      // Bytes dekodieren; unvollständige Multibyte-Sequenzen hält der Decoder zurück.
      buffer += decoder.write(chunk as Buffer);

      // Bis zur letzten offenen "[" ohne folgendes "]" ist alles eindeutig und
      // damit sicher ersetzbar; ab dort könnte ein Token unvollständig sein.
      const lastOpen = buffer.lastIndexOf('[');
      let safeEnd = buffer.length;
      if (lastOpen !== -1 && buffer.indexOf(']', lastOpen) === -1) {
        safeEnd = lastOpen;
      }

      const safe = buffer.slice(0, safeEnd);
      buffer = buffer.slice(safeEnd);

      if (safe.length > 0) {
        this.push(Buffer.from(reidentifyText(safe, vault), 'utf8'));
      }
      callback();
    },

    flush(callback) {
      // Etwaige zurückgehaltene Multibyte-Reste anhängen ...
      buffer += decoder.end();
      // ... und den verbliebenen Rest final ersetzen und ausgeben.
      if (buffer.length > 0) {
        this.push(Buffer.from(reidentifyText(buffer, vault), 'utf8'));
        buffer = '';
      }
      callback();
    },
  });
}
