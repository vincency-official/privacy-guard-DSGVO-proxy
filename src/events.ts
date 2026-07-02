// Event-Bus für Log-Einträge und die kanonische Wert-Maskierung.
//
// Der Proxy meldet pro verarbeiteter Anfrage einen LogEntry über emitLog(); das
// Dashboard (und potenziell andere Zuhörer) abonnieren das 'log'-Event auf dem
// gemeinsamen logBus und streamen die Einträge live weiter.
//
// Sicherheitsprinzip: Ein LogEntry enthält NIEMALS Klartext-PII — nur maskierte
// Werte. maskValue() ist die kanonische Maskierung; sie zeigt gerade genug, um
// einen Ersatz wiederzuerkennen, ohne den vollständigen Wert preiszugeben. Nur
// Node-Built-ins, keine externen Dependencies.

import { EventEmitter } from 'node:events';
import type { LogEntry } from './types.js';

// Gemeinsamer Event-Bus. Ein einzelner, prozessweiter Emitter, den Proxy und
// Dashboard teilen. Verteiltes Event: 'log' mit einem LogEntry als Nutzlast.
export const logBus: EventEmitter = new EventEmitter();

// Verteilt einen Log-Eintrag an alle Zuhörer des 'log'-Events. Bewusst schlank
// gehalten — die Entscheidung, was geloggt wird (und dass es maskiert ist),
// trifft der Aufrufer (der Proxy).
export function emitLog(entry: LogEntry): void {
  logBus.emit('log', entry);
}

// Maskiert einen Klartext-Wert für die Log-Anzeige, ohne ihn vollständig
// preiszugeben.
//
// - E-Mail ("x@y"): erstes Zeichen des lokalen Teils sichtbar, Rest als "***",
//   Domain bleibt sichtbar → z. B. "m***@gmx.de".
// - Sonst: die ersten ein bis zwei Zeichen sichtbar, der Rest durch "*" ersetzt
//   (Länge grob gewahrt, aber gedeckelt, um lange Werte nicht zu verraten).
// - Werte mit höchstens zwei Zeichen: komplett maskiert (keine Teil-Preisgabe).
export function maskValue(value: string): string {
  const at = value.indexOf('@');
  if (at > 0) {
    const lokal = value.slice(0, at);
    const domain = value.slice(at); // enthält das "@"
    const ersterBuchstabe = lokal[0] ?? '';
    return `${ersterBuchstabe}***${domain}`;
  }

  // Werte ≤ 2 Zeichen vollständig maskieren.
  if (value.length <= 2) {
    return '*'.repeat(value.length);
  }

  // Erste zwei Zeichen sichtbar, Rest maskiert; Sternanzahl auf 8 deckeln, damit
  // sehr lange Werte (z. B. Secrets) ihre Länge nicht verraten.
  const sichtbar = value.slice(0, 2);
  const sterne = '*'.repeat(Math.min(value.length - 2, 8));
  return `${sichtbar}${sterne}`;
}
