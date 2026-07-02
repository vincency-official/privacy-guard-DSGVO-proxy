// Config-Loader: lädt und validiert `privacy-rules.json` und mergt sie mit den
// Defaults. Nur Node-Built-ins, keine externen Dependencies.

import { readFileSync } from 'node:fs';
import type { Config, DetectorConfig, ServerConfig, Rule } from './types.js';

// Standard-Detektoren: im Zweifel schützen — alle eingebauten Detektoren an.
export const DEFAULT_DETECTORS: DetectorConfig = {
  email: true,
  iban: true,
  creditCard: true,
  ipAddress: true,
  secrets: true,
};

// Standard-Ports: Proxy auf 8080, Dashboard auf 8081 (beide nur 127.0.0.1).
const DEFAULT_SERVER: ServerConfig = {
  port: 8080,
  dashboardPort: 8081,
};

// Standard-Pfad der Konfigurationsdatei (relativ zum Arbeitsverzeichnis).
const DEFAULT_PATH = './privacy-rules.json';

// Node-Fehler mit optionalem `code`-Feld (z. B. 'ENOENT' bei fehlender Datei).
interface NodeError extends Error {
  code?: string;
}

// Lädt die Konfiguration vom angegebenen Pfad (Default: ./privacy-rules.json).
// Fehlende Datei → vollständige Default-Config. Vorhandene Datei → gemergt mit
// den Defaults (fehlende Detektor-Felder = true, fehlende Ports = Default).
// Ungültiges JSON → aussagekräftiger Error (fail-fast beim Start).
export function loadConfig(path: string = DEFAULT_PATH): Config {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    // Fehlende Datei ist kein Fehler: wir starten mit sinnvollen Defaults.
    if ((err as NodeError).code === 'ENOENT') {
      return defaultConfig();
    }
    // Andere Lesefehler (z. B. fehlende Rechte) transparent weiterreichen.
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // Kaputtes JSON aussagekräftig melden, inkl. Pfad und Ursache.
    const grund = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Konfigurationsdatei "${path}" enthält ungültiges JSON: ${grund}`,
    );
  }

  return mergeWithDefaults(parsed);
}

// Erzeugt eine frische Default-Config (mit eigenständigen Objekt-/Array-Kopien,
// damit Aufrufer sie gefahrlos mutieren können).
function defaultConfig(): Config {
  return {
    rules: [],
    detectors: { ...DEFAULT_DETECTORS },
    server: { ...DEFAULT_SERVER },
  };
}

// Mergt ein geparstes JSON-Objekt mit den Defaults. Unbekannte oder fehlende
// Felder werden robust behandelt: nur die erwarteten Strukturen werden gelesen.
function mergeWithDefaults(parsed: unknown): Config {
  const obj: Record<string, unknown> =
    parsed !== null && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};

  const rules: Rule[] = Array.isArray(obj.rules) ? (obj.rules as Rule[]) : [];

  const detectorsInput: Record<string, unknown> =
    obj.detectors !== null && typeof obj.detectors === 'object'
      ? (obj.detectors as Record<string, unknown>)
      : {};

  // Jedes Detektor-Feld einzeln mergen: gesetzter Boolean gewinnt, sonst Default.
  const detectors: DetectorConfig = {
    email: bool(detectorsInput.email, DEFAULT_DETECTORS.email),
    iban: bool(detectorsInput.iban, DEFAULT_DETECTORS.iban),
    creditCard: bool(detectorsInput.creditCard, DEFAULT_DETECTORS.creditCard),
    ipAddress: bool(detectorsInput.ipAddress, DEFAULT_DETECTORS.ipAddress),
    secrets: bool(detectorsInput.secrets, DEFAULT_DETECTORS.secrets),
  };

  const serverInput: Record<string, unknown> =
    obj.server !== null && typeof obj.server === 'object'
      ? (obj.server as Record<string, unknown>)
      : {};

  const server: ServerConfig = {
    port: num(serverInput.port, DEFAULT_SERVER.port),
    dashboardPort: num(serverInput.dashboardPort, DEFAULT_SERVER.dashboardPort),
  };

  return { rules, detectors, server };
}

// Liefert den Wert, falls es ein Boolean ist, sonst den Default.
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

// Liefert den Wert, falls es eine endliche Zahl ist, sonst den Default.
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
