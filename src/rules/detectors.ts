// Eingebaute Regex-Detektoren für gängige PII und Secrets.
//
// Jeder Detektor kombiniert ein Muster mit dem PII-Typ, den ein Treffer erhält.
// Alle Regexes tragen das globale (g-)Flag, damit die Rule-Engine später mit
// matchAll() sämtliche Vorkommen findet. buildDetectors() liefert bei jedem
// Aufruf frische RegExp-Instanzen, damit kein lastIndex-Zustand zwischen
// Aufrufen geteilt wird. Nur Node-Built-ins, keine externen Dependencies.

import type { DetectorConfig, PiiType } from '../types.js';

// Ein eingebauter Detektor: Typ des Treffers plus die zugehörige Regex (g-Flag).
export interface Detector {
  type: PiiType;
  regex: RegExp;
}

// Baut die Liste der aktiven Detektoren gemäß Konfiguration. Nur eingeschaltete
// Detektoren werden zurückgegeben; die Reihenfolge ist stabil (email, iban,
// creditCard, ipAddress, secrets). Bei jedem Aufruf entstehen neue RegExp-
// Instanzen, damit der lastIndex-Zustand nicht zwischen Aufrufen leckt.
export function buildDetectors(cfg: DetectorConfig): Detector[] {
  const detektoren: Detector[] = [];

  if (cfg.email) {
    // E-Mail: lokaler Teil, @, Domain mit mindestens einer Punkt-Endung.
    // case-insensitive, da Domains und lokale Teile beliebige Groß-/Kleinschreibung haben.
    detektoren.push({
      type: 'EMAIL',
      regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi,
    });
  }

  if (cfg.iban) {
    // IBAN: zwei Länder-Buchstaben, zwei Prüfziffern, dann entweder kompakt
    // 11–30 Zeichen ODER in 4er-Gruppen (Space-getrennt). An Wortgrenzen (\b)
    // verankert, damit kein Folgetext mitgefangen wird. Bewusst nur GROSS-
    // buchstaben ([A-Z0-9], kein i-Flag): IBANs sind per ISO 13616 uppercase —
    // das verhindert zugleich, dass leerzeichengetrennte Kleinbuchstaben-Wörter
    // (z. B. "... 3249 31 danke schoen") als IBAN-Gruppen verschluckt werden.
    detektoren.push({
      type: 'IBAN',
      regex:
        /\b[A-Z]{2}\d{2}(?:[A-Z0-9]{11,30}\b|(?: [A-Z0-9]{4}){2,7}(?: [A-Z0-9]{1,3})?\b)/g,
    });
  }

  if (cfg.creditCard) {
    // Kreditkarte: 13–19 Ziffern, optional durch Leerzeichen oder Bindestriche
    // getrennt. Struktur "Ziffer, dann 12–18× (optionaler Separator + Ziffer)",
    // damit die LETZTE Gruppe keinen nachlaufenden Separator mitfängt.
    // Reine Formatprüfung (Luhn kann später ergänzt werden).
    detektoren.push({
      type: 'CREDIT_CARD',
      regex: /\b\d(?:[ -]?\d){12,18}\b/g,
    });
  }

  if (cfg.ipAddress) {
    // IPv4: vier Oktette mit gültigem Wertebereich 0–255, durch Punkte getrennt.
    detektoren.push({
      type: 'IP',
      regex:
        /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    });
  }

  if (cfg.secrets) {
    // Secrets anhand bekannter Präfixe: OpenAI (sk-), GitHub (ghp_/gho_),
    // Slack (xox[baprs]-) und AWS-Access-Keys (AKIA...). Präfixe sind case-
    // sensitiv definiert, daher kein i-Flag.
    detektoren.push({
      type: 'SECRET',
      regex:
        /\b(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/g,
    });
  }

  return detektoren;
}
