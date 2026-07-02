# Privacy-Guard Proxy

> **Status: in Arbeit.** Lokaler DSGVO-Reverse-Proxy für KI-Anfragen. Diese README wird während der Umsetzung schrittweise vervollständigt.

Ein lokaler Reverse-Proxy in Node.js/TypeScript, der personenbezogene Daten (PII)
und Secrets in ausgehenden KI-Anfragen (OpenAI, Anthropic) durch Platzhalter-Tokens
ersetzt und die Antwort des Providers wieder re-identifiziert. Per Datei-Toggle
abschaltbar, mit Web-Dashboard und Live-Log.

## Grundprinzipien

- **Keine externen Laufzeit-Abhängigkeiten** — ausschließlich Node-Built-ins.
- Der Server bindet **nur an `127.0.0.1`**, niemals an `0.0.0.0`.
- Klartext-PII wird **nie** geloggt oder auf Platte geschrieben; der Vault
  (echt ↔ Token) existiert ausschließlich im Arbeitsspeicher.
- **Fail-closed**: Kann eine Anfrage im aktiven Modus nicht bereinigt werden,
  wird sie blockiert statt ungeschützt weitergeleitet.

## Voraussetzungen

- Node.js ≥ 20 (getestet mit v22).

## Entwicklung

```bash
npm install      # Dev-Abhängigkeiten installieren
npm test         # Testsuite (Vitest) ausführen
npm run build    # TypeScript nach dist/ kompilieren
npm run dev      # CLI im Entwicklungsmodus (tsx) starten
```

## Konfiguration

Die Regeln und Detektoren werden in `privacy-rules.json` im Projektverzeichnis
konfiguriert. Als Vorlage dient `privacy-rules.example.json`. Details folgen,
sobald die entsprechenden Komponenten umgesetzt sind.
