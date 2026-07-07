# 🛡️ Privacy-Guard Proxy

**Das lokale DSGVO-Gateway für die Arbeit mit US-KI-Modellen.**

![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)
![Runtime-Dependencies](https://img.shields.io/badge/runtime%20deps-0-brightgreen.svg)

Ein minimaler lokaler Reverse-Proxy in Node.js/TypeScript. Jede Anfrage deiner IDE
oder CLI an OpenAI oder Anthropic läuft zuerst durch diesen Proxy. Er ersetzt
personenbezogene Daten (Namen, E-Mails) und Secrets (API-Keys) durch anonyme Tokens
(z. B. `[PERSON_1]`), schickt nur den bereinigten Prompt an den US-Server und setzt
in der Antwort die echten Daten lokal wieder ein (Re-Identifikation). Per Mausklick
im Dashboard abschaltbar.

```
   IDE / CLI  ──▶  127.0.0.1  ──▶  Sanitizer (echt→Token)  ──▶  api.openai.com
   (Base-URL)                                                     api.anthropic.com
   IDE / CLI  ◀──  Re-Identifier (Token→echt) ◀── Streaming ◀───  (US-Antwort)
```

## Grundprinzipien

- **Keine externen Laufzeit-Abhängigkeiten** — ausschließlich Node-Built-ins.
- Der Server bindet **nur an `127.0.0.1`**, niemals an `0.0.0.0`.
- Klartext-PII wird **nie** geloggt oder auf Platte geschrieben; die Zuordnung
  echt ↔ Token (der „Vault") lebt ausschließlich im Arbeitsspeicher und ist bei
  jedem Neustart weg.
- **Fail-closed**: Kann eine Anfrage im aktiven Modus nicht sauber bereinigt werden,
  wird sie mit HTTP 400 blockiert statt ungeschützt weitergeleitet.
- Der echte API-Key im `Authorization`-/`x-api-key`-Header wird durchgereicht
  (er muss zum Provider); ersetzt werden nur Keys/Secrets, die im **Prompt-Text**
  auftauchen.

## Voraussetzungen

- Node.js ≥ 20 (getestet mit v22).

## Installation & Start

```bash
npm install
npm run build
node dist/cli.js start
```

Oder im Entwicklungsmodus ohne Build:

```bash
npm install
npm run dev -- start        # entspricht: tsx src/cli.ts start
```

Beim Start lauschen zwei lokale Server:

- **Proxy**: `http://127.0.0.1:8080`
- **Dashboard**: `http://127.0.0.1:8081`

## IDE / CLI anbinden (Base-URL umlenken)

Statt direkt auf die US-API zeigst du dein Tool auf den lokalen Proxy. Der Pfad
entscheidet über den Upstream: `/openai/...` → OpenAI, `/anthropic/...` → Anthropic.

| Tool | Einstellung |
|------|-------------|
| OpenAI-SDK / kompatible CLIs | `OPENAI_BASE_URL=http://127.0.0.1:8080/openai/v1` |
| Anthropic-SDK | `ANTHROPIC_BASE_URL=http://127.0.0.1:8080/anthropic` |
| Aider | `--openai-api-base http://127.0.0.1:8080/openai/v1` |
| Continue / Cursor | Base-URL des Providers auf obige URL setzen |

Der API-Key wird wie gewohnt gesetzt — er wird unverändert an den echten Provider
durchgereicht.

## Ein- und Ausschalten (Toggle)

Der Schutz wird über eine einzelne Marker-Datei `.privacy-disabled` im
Arbeitsverzeichnis gesteuert:

- **Datei fehlt** → Schutz **aktiv** (Daten werden tokenisiert).
- **Datei existiert** → **Pass-Through** (alles wird ungefiltert durchgeleitet).

Umschalten per Mausklick im **Dashboard** (`http://127.0.0.1:8081`) — dort siehst du
zusätzlich ein Live-Log aller Ersetzungen (nur maskierte Werte). Oder per CLI:

```bash
node dist/cli.js on       # Schutz an  (Marker-Datei löschen)
node dist/cli.js off      # Schutz aus (Pass-Through)
node dist/cli.js status   # aktuellen Zustand anzeigen
```

## Konfiguration: `privacy-rules.json`

Liegt im Arbeitsverzeichnis; als Vorlage dient `privacy-rules.example.json`. Fehlt
die Datei, gelten sichere Defaults (leere Regeln, alle Detektoren an, Ports 8080/8081).

```json
{
  "rules": [
    { "match": "Max Mustermann", "type": "PERSON" },
    { "match": "ACME GmbH", "type": "ORG" }
  ],
  "detectors": {
    "email": true,
    "iban": true,
    "creditCard": true,
    "ipAddress": true,
    "secrets": true
  },
  "server": { "port": 8080, "dashboardPort": 8081 }
}
```

- **`rules`** — explizite Werte, die du selbst pflegst (Namen, Firmen, Kunden,
  interne Projektnamen). Jede Regel hat einen `type` (`PERSON`, `ORG`, `EMAIL`,
  `IBAN`, `CREDIT_CARD`, `IP`, `SECRET`).
- **`detectors`** — eingebaute Muster-Erkennung, einzeln an-/abschaltbar:
  E-Mail, IBAN, Kreditkarte, IP-Adresse und bekannte Secret-Formate
  (`sk-…`, `ghp_…`, `AKIA…` u. a.).
- **`server`** — Ports für Proxy und Dashboard.

## Entwicklung

```bash
npm test          # Testsuite (Vitest)
npm run test:watch
npm run build     # TypeScript nach dist/
```

## Umfang & Grenzen (v1)

**Enthalten:** Base-URL-Reverse-Proxy für OpenAI und Anthropic, Regel- und
Muster-Erkennung, In-Memory-Vault, stream-sichere Re-Identifikation (SSE),
Datei-Toggle, Web-Dashboard mit Live-Log, CLI.

**Bewusst nicht enthalten (später):** HTTPS-MITM-Modus (für Tools ohne
konfigurierbare Base-URL), ML-/NER-Namenserkennung, IDE-Extensions, Persistenz.

## Mitwirken

Beiträge sind willkommen. Bitte:

1. Ein Issue eröffnen, um größere Änderungen vorab abzustimmen.
2. Für Pull Requests: `npm test` muss grün sein und `npm run build` sauber durchlaufen.
3. Neue Erkennungs-/Sanitize-Logik immer mit Tests absichern (das Projekt arbeitet
   testgetrieben; es gibt Regressionstests, die u. a. exakte Match-Grenzen festnageln).
4. Code-Stil folgt dem Bestehenden: fokussierte Module, deutsche Kommentare mit echten
   Umlauten, keine externen Laufzeit-Abhängigkeiten.

## Haftungsausschluss

Dieses Werkzeug bietet eine **best-effort**-Filterung personenbezogener Daten und Secrets
auf Basis von Regeln und Mustern. Es ist **keine Garantie** für Vollständigkeit und **keine
Rechtsberatung** und ersetzt keine datenschutzrechtliche Prüfung. Regeln und Detektoren
können Daten übersehen (oder zu viel erfassen). Prüfe in sensiblen Kontexten selbst, was
tatsächlich übertragen wird — das Live-Dashboard hilft dabei. Nutzung auf eigenes Risiko;
es gilt der Gewährleistungsausschluss der MIT-Lizenz.

## Lizenz

MIT — siehe [LICENSE](LICENSE). © 2026 Michael Kaiser.

[Vincency Digital Agency](https://vincency.com)
