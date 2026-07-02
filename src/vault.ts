// In-Memory-Vault: bidirektionale Zuordnung zwischen Klartext und Token.
//
// Sicherheitsprinzip: Der Vault hält Klartext-PII AUSSCHLIESSLICH im Speicher.
// Nichts wird geloggt oder auf Platte geschrieben; mit Prozessende oder reset()
// ist alles weg. Nur Node-Built-ins, keine externen Dependencies.

import type { PiiType } from './types.js';

export class Vault {
  // Vorwärts-Zuordnung: Schlüssel "TYP Wert" → Token. Der Typ ist Teil des
  // Schlüssels, damit derselbe Klartext je Typ getrennt bleibt (selten, aber
  // definiert): z. B. "Apple" als PERSON und als ORG ergeben zwei Token.
  private valueToToken = new Map<string, string>();

  // Rückwärts-Zuordnung: Token → ursprünglicher Klartext (für die Re-Identifikation).
  private tokenToValue = new Map<string, string>();

  // Fortlaufender Zähler pro Typ, beginnend bei 1. Fehlender Eintrag = 0.
  private counters = new Map<PiiType, number>();

  // Liefert das Token für einen Wert eines Typs. Gleicher Wert (und Typ) ergibt
  // konsistent dasselbe Token; ein neuer Wert erhält die nächste Nummer des Typs.
  tokenFor(value: string, type: PiiType): string {
    const key = `${type} ${value}`;
    const bekannt = this.valueToToken.get(key);
    if (bekannt !== undefined) {
      return bekannt;
    }

    const nummer = (this.counters.get(type) ?? 0) + 1;
    this.counters.set(type, nummer);

    const token = `[${type}_${nummer}]`;
    this.valueToToken.set(key, token);
    this.tokenToValue.set(token, value);
    return token;
  }

  // Liefert den ursprünglichen Klartext zu einem Token oder undefined, falls das
  // Token unbekannt ist (dann bleibt es bei der Re-Identifikation unverändert).
  valueFor(token: string): string | undefined {
    return this.tokenToValue.get(token);
  }

  // Leert sämtliche Zuordnungen und setzt die Zähler zurück. Danach beginnt die
  // Nummerierung pro Typ wieder bei 1.
  reset(): void {
    this.valueToToken.clear();
    this.tokenToValue.clear();
    this.counters.clear();
  }
}
