// Bereinigung der Textinhalte eines Anfrage-Bodys — fail-safe und provider-übergreifend.
//
// Früher lief transformTexts über eine schmale Positiv-Liste (nur messages[].content
// und Anthropic-system). Das ließ PII in providerspezifischen Feldern unbemerkt im
// Klartext durch — insbesondere Function-/Tool-Calling: OpenAI
// tool_calls[].function.arguments, Anthropic tool_use.input und tool_result.content.
//
// Jetzt wird — symmetrisch zur Re-Identifikation (reidentify.ts walkAndReidentify) —
// der GESAMTE Body rekursiv durchlaufen und JEDER String-Wert über fn bereinigt.
// Das ist die sichere Grundhaltung: neue oder unbekannte Felder werden automatisch
// erfasst statt durchzurutschen. fn selbst ersetzt ohnehin nur erkannte PII, sodass
// gewöhnliche Inhalte ohne Treffer unverändert bleiben.
//
// Ausgenommen sind nur STRUKTURELLE Schlüssel, deren Werte reine Bezeichner/Enums
// sind und die die API zerbrechen würden, wenn man sie tokenisierte (role, type,
// model, Tool-/Funktionsnamen, IDs, URLs). Nur Node-Built-ins, keine externen
// Dependencies.

import type { Provider } from './types.js';

// Schlüssel, deren String-Werte NICHT bereinigt werden: reine Bezeichner/Enums
// bzw. Werte, die zum Provider passen müssen (Tool-/Funktionsnamen, IDs, URLs,
// Bild-Detailstufe, Medientyp, Encoding, Abbruchgründe).
const STRUKTUR_SCHLUESSEL = new Set<string>([
  'role',
  'type',
  'model',
  'name',
  'id',
  'tool_call_id',
  'tool_use_id',
  'index',
  'url',
  'detail',
  'media_type',
  'encoding_format',
  'object',
  'finish_reason',
  'stop_reason',
]);

// Schlüssel, deren String-Wert selbst serialisiertes JSON enthält (z. B. OpenAI
// Function-Calling-Argumente). Solche Werte werden geparst, rekursiv bereinigt und
// wieder serialisiert, damit darin enthaltene PII ebenfalls tokenisiert wird.
const JSON_STRING_SCHLUESSEL = new Set<string>(['arguments']);

// Bereinigt alle relevanten Textstellen des Bodys in-place. Der provider-Parameter
// bleibt aus Kompatibilitätsgründen Teil der Signatur; die Bereinigung ist bewusst
// provider-agnostisch (fail-safe für beide Formate).
export function transformTexts(
  body: unknown,
  _provider: Provider,
  fn: (text: string) => string,
): void {
  walk(body, fn);
}

// Läuft rekursiv durch Arrays und Objekte und wendet fn auf jeden String-Wert an —
// außer bei strukturellen Schlüsseln. Objekt-Schlüssel selbst bleiben unangetastet.
function walk(value: unknown, fn: (text: string) => string): void {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const element = value[i];
      if (typeof element === 'string') {
        // String direkt in einem Array (z. B. Anthropic tool_result.content als
        // String-Liste): Inhalt, also bereinigen.
        value[i] = fn(element);
      } else {
        walk(element, fn);
      }
    }
    return;
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const feld = record[key];
      if (typeof feld === 'string') {
        if (STRUKTUR_SCHLUESSEL.has(key)) {
          // Struktureller Bezeichner/Enum: unangetastet lassen.
          continue;
        }
        if (JSON_STRING_SCHLUESSEL.has(key)) {
          record[key] = sanitizeJsonString(feld, fn);
        } else {
          record[key] = fn(feld);
        }
      } else {
        walk(feld, fn);
      }
    }
  }
}

// Bereinigt einen String, der serialisiertes JSON enthält: parsen, rekursiv
// bereinigen, re-serialisieren. Ist der Inhalt kein JSON-Objekt/-Array (kaputt oder
// ein JSON-Primitive), wird er ersatzweise direkt als Text bereinigt — so bleibt
// auch dann fail-safe, dass PII darin tokenisiert wird.
function sanitizeJsonString(rohes: string, fn: (text: string) => string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rohes);
  } catch {
    return fn(rohes);
  }
  if (parsed !== null && typeof parsed === 'object') {
    walk(parsed, fn);
    return JSON.stringify(parsed);
  }
  return fn(rohes);
}
