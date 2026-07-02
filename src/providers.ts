// Provider-spezifische Textextraktion aus dem Anfrage-Body.
//
// Verschiedene Provider legen den zu bereinigenden Klartext an unterschiedlichen
// Stellen des JSON-Bodys ab. transformTexts läuft über genau diese Textfelder und
// wendet eine Funktion in-place an — der Body wird direkt mutiert, Nicht-Textfelder
// (z. B. Bild-Teile, Modell-Name, Rollen) bleiben unangetastet. Die eigentliche
// Ersetzungslogik (echt → Token) steckt in der übergebenen Funktion, sodass dieses
// Modul provider-agnostisch bleibt. Nur Node-Built-ins, keine externen Dependencies.

import type { Provider } from './types.js';

// Wendet die Transformationsfunktion `fn` auf alle relevanten Textfelder des
// Bodys an. Für OpenAI sind das alle `messages[].content` (String oder Array mit
// `{type:'text', text}`-Teilen). Für Anthropic zusätzlich das `system`-Feld
// (String oder Array). Der Body wird in-place mutiert.
export function transformTexts(
  body: unknown,
  provider: Provider,
  fn: (text: string) => string,
): void {
  // Nur echte Objekte verarbeiten; alles andere (null, String, Zahl) ignorieren.
  if (!isRecord(body)) {
    return;
  }

  // messages[].content bei beiden Providern bereinigen.
  transformMessages(body.messages, fn);

  // Anthropic legt den System-Prompt in einem eigenen Top-Level-Feld ab.
  if (provider === 'anthropic') {
    if (typeof body.system === 'string') {
      body.system = fn(body.system);
    } else {
      transformContentParts(body.system, fn);
    }
  }
}

// Läuft über ein messages-Array und bereinigt jeweils das content-Feld. Ist
// messages kein Array, passiert nichts.
function transformMessages(
  messages: unknown,
  fn: (text: string) => string,
): void {
  if (!Array.isArray(messages)) {
    return;
  }
  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }
    if (typeof message.content === 'string') {
      // Einfacher Fall: content ist direkt der Text.
      message.content = fn(message.content);
    } else {
      // Multimodaler Fall: content ist ein Array aus typisierten Teilen.
      transformContentParts(message.content, fn);
    }
  }
}

// Bereinigt ein Array aus Content-Teilen: nur Teile mit `type:'text'` und einem
// String-Feld `text` werden transformiert; alle anderen Teile (Bilder, Tool-Aufrufe
// usw.) bleiben unangetastet.
function transformContentParts(
  parts: unknown,
  fn: (text: string) => string,
): void {
  if (!Array.isArray(parts)) {
    return;
  }
  for (const part of parts) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      part.text = fn(part.text);
    }
  }
}

// Type-Guard: prüft auf ein echtes, nicht-Array-Objekt (Record).
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
