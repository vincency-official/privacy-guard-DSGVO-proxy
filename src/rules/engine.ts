// Rule-Engine: findet PII-/Secret-Treffer im Text und löst Überlappungen auf.
//
// Zwei Trefferquellen werden zusammengeführt: explizite Nutzerregeln (exakter
// String, alle Vorkommen) und die eingebauten Regex-Detektoren. Anschließend
// werden Überlappungen deterministisch entfernt, sodass jede Textstelle höchstens
// einmal ersetzt wird. Nur Node-Built-ins, keine externen Dependencies.

import type { Match, Rule } from '../types.js';
import type { Detector } from './detectors.js';

// Interner Treffer mit Priorität: explizite Regeln (priority 0) haben bei
// deckungsgleichem Bereich Vorrang vor Detektoren (priority 1).
interface KandidatenMatch extends Match {
  priority: number;
}

// Sammelt alle Treffer aus Regeln und Detektoren, sortiert sie nach Startposition
// und liefert eine überlappungsfreie Auswahl zurück. Regeln für den exakten
// String an allen Vorkommen, Detektoren über ihre g-Regex mit matchAll().
export function findMatches(
  text: string,
  rules: Rule[],
  detectors: Detector[],
): Match[] {
  const kandidaten: KandidatenMatch[] = [];

  // 1) Explizite Regeln: jedes Vorkommen des exakten Strings finden. indexOf
  //    statt Regex, damit beliebiger Nutzer-Text keine Sonderzeichen-Probleme
  //    verursacht. Leere match-Strings werden übersprungen (Endlosschleifen-Schutz).
  for (const regel of rules) {
    if (regel.match.length === 0) {
      continue;
    }
    let von = text.indexOf(regel.match);
    while (von !== -1) {
      kandidaten.push({
        value: regel.match,
        type: regel.type,
        start: von,
        end: von + regel.match.length,
        priority: 0,
      });
      von = text.indexOf(regel.match, von + regel.match.length);
    }
  }

  // 2) Detektoren: alle Vorkommen über die g-Regex. Aus jedem Treffer entstehen
  //    Wert und exakte Grenzen [start, end).
  for (const detektor of detectors) {
    for (const m of text.matchAll(detektor.regex)) {
      const value = m[0];
      // Leere Treffer ignorieren, damit keine Null-Länge-Ersetzungen entstehen.
      if (value.length === 0) {
        continue;
      }
      kandidaten.push({
        value,
        type: detektor.type,
        start: m.index,
        end: m.index + value.length,
        priority: 1,
      });
    }
  }

  // 3) Sortierung, die alle Tie-Break-Regeln kodiert, sodass eine gierige
  //    Links-nach-rechts-Auswahl das gewünschte Ergebnis liefert:
  //    a) früherer Start zuerst,
  //    b) bei gleichem Start der längere Treffer zuerst (größeres end),
  //    c) bei gleichem Bereich die explizite Regel vor dem Detektor.
  kandidaten.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return b.end - a.end;
    return a.priority - b.priority;
  });

  // 4) Gierige, überlappungsfreie Auswahl: einen Kandidaten nur übernehmen, wenn
  //    er hinter dem Ende des zuletzt gewählten Treffers beginnt.
  const ergebnis: Match[] = [];
  let letztesEnde = -1;
  for (const k of kandidaten) {
    if (k.start >= letztesEnde) {
      ergebnis.push({
        value: k.value,
        type: k.type,
        start: k.start,
        end: k.end,
      });
      letztesEnde = k.end;
    }
  }

  return ergebnis;
}
