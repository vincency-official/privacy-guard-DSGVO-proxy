// Gemeinsame Typen für den Privacy-Guard Proxy.
// Diese Datei ist die einzige Quelle der Wahrheit für die geteilten Typen;
// alle weiteren Module importieren von hier, um Namensabweichungen zu vermeiden.

// Unterstützte PII-/Secret-Kategorien. Bestimmen das Token-Präfix (z. B. [PERSON_1]).
export type PiiType =
  | 'PERSON'
  | 'ORG'
  | 'EMAIL'
  | 'IBAN'
  | 'CREDIT_CARD'
  | 'IP'
  | 'SECRET';

// Explizite Nutzerregel: exakter Klartext-String, der als angegebener Typ ersetzt wird.
export interface Rule {
  match: string;
  type: PiiType;
}

// Schalter für die eingebauten Regex-Detektoren.
export interface DetectorConfig {
  email: boolean;
  iban: boolean;
  creditCard: boolean;
  ipAddress: boolean;
  secrets: boolean;
}

// Netzwerk-Ports für Proxy und Dashboard (beide binden nur an 127.0.0.1).
export interface ServerConfig {
  port: number;
  dashboardPort: number;
}

// Vollständige, gemergte Laufzeit-Konfiguration.
export interface Config {
  rules: Rule[];
  detectors: DetectorConfig;
  server: ServerConfig;
}

// Ein gefundener Treffer im Text: Wert, Typ und die Zeichen-Grenzen [start, end).
export interface Match {
  value: string;
  type: PiiType;
  start: number;
  end: number;
}

// Unterstützte Upstream-Provider.
export type Provider = 'openai' | 'anthropic';

// Ein durchgeführter Ersatz — für das Log. Enthält NIE den Klartext, nur den
// maskierten Wert (z. B. "m***@gmx.de") plus das vergebene Token.
export interface Replacement {
  type: PiiType;
  token: string;
  masked: string;
}

// Ein Log-Eintrag pro verarbeiteter Anfrage. Wird über den Event-Bus verteilt.
// `warning` ist optional gesetzt, wenn beim Verarbeiten etwas Beachtenswertes
// auffiel (z. B. ein nicht als Chat-Endpunkt bekannter Pfad).
export interface LogEntry {
  timestamp: string;
  mode: 'active' | 'passthrough';
  provider: string;
  path: string;
  replacements: Replacement[];
  warning?: string;
}
