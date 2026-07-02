# Privacy-Guard Proxy — Design-Spezifikation

**Datum:** 2026-07-02
**Status:** Abgesegnet, bereit für Planung
**Sprache/Laufzeit:** Node.js + TypeScript

## 1. Zweck

Ein lokales DSGVO-Gateway. Ein minimaler Reverse-Proxy auf `127.0.0.1`, durch den
KI-Anfragen von IDEs/CLIs an OpenAI oder Anthropic laufen. Der Proxy ersetzt
personenbezogene Daten und Secrets im Prompt durch anonyme Tokens (z. B. `[PERSON_1]`),
schickt nur den bereinigten Prompt an den US-Server und setzt in der Antwort die echten
Werte lokal wieder ein (Re-Identifikation). Per Mausklick abschaltbar (Pass-Through).

## 2. Erfolgskriterien

- Kein in den Regeln/Detektoren erfasstes PII/Secret verlässt die Maschine im Klartext,
  solange der Schutz aktiv ist.
- Die IDE erhält die vollständige, re-identifizierte Antwort — inklusive Streaming (SSE).
- An/Aus per Mausklick über ein lokales Web-Dashboard; Umschalten ohne Neustart.
- Funktioniert mit Tools, die eine konfigurierbare Base-URL bieten (Claude Code, Cursor,
  Aider, Continue, OpenAI-/Anthropic-SDKs).

## 3. Nicht-Ziele (v1)

- Kein HTTPS-MITM-Modus (kein CA-Zertifikat). Als optionales Modul später vorgesehen.
- Keine ML-/NER-Namenserkennung. Später als Modul.
- Keine IDE-Extensions (VS Code, JetBrains). Später.
- Keine Persistenz der Token-Zuordnung über Neustarts hinweg. Bewusst nicht gewollt.
- Kein Multi-User-Betrieb, keine Cloud-Komponente.

## 4. Architektur & Datenfluss

```
                 ┌─────────────── 127.0.0.1 (nur lokal) ───────────────┐
  IDE / CLI ─▶   │  Proxy  ─▶  Toggle-Check  ─▶  Sanitizer ─▶ (Vault)   │  ─▶  api.openai.com
  (Base-URL)     │                                                      │      api.anthropic.com
  IDE / CLI ◀─   │  Re-Identifier  ◀──────────  Stream-Transform  ◀─────│  ◀─  (US-Antwort)
                 └──────────────────────────────────────────────────────┘
```

### Request-Weg
1. IDE sendet an `http://127.0.0.1:<port>/openai/v1/chat/completions` (bzw. `/anthropic/...`).
2. **Toggle-Check:** Existiert `.privacy-disabled` → 1:1 durchreichen (Pass-Through), Log-Eintrag.
3. Body als JSON parsen; relevante Textfelder extrahieren (OpenAI: `messages[].content`;
   Anthropic: `messages[].content` + `system`).
4. **Rule Engine** scannt Text → Treffer. Für jeden Treffer liefert der **Vault** ein
   konsistentes Token (`[PERSON_1]`, `[EMAIL_1]`, `[SECRET_1]` …).
5. Text ersetzen, Body neu serialisieren.
6. An Upstream weiterleiten. **Auth-Header (`Authorization` / `x-api-key`) bleibt echt** —
   er muss an den Provider.

### Response-Weg
7. Antwort empfangen (JSON oder SSE-Stream).
8. **Re-Identifier** ersetzt Tokens → echte Werte.
9. **Streaming:** Transform-Stream mit Tail-Puffer, damit ein über Chunk-Grenzen
   zerschnittenes Token korrekt zusammengesetzt und ersetzt wird.

## 5. Komponenten

| Modul | Verantwortung | Abhängigkeiten |
|---|---|---|
| `server.ts` | HTTP-Reverse-Proxy, bindet **nur** an 127.0.0.1 | router, toggle, sanitize, reidentify |
| `router.ts` | Upstream-Auflösung per Pfad-Präfix (`/openai`, `/anthropic`) | config |
| `rules/engine.ts` | Orchestriert Regel- + Musterabgleich, liefert Treffer | detectors, config |
| `rules/detectors.ts` | Eingebaute Regex-Detektoren (E-Mail, IBAN, Kreditkarte, IP, Secrets) | — |
| `vault.ts` | Bidirektionale Map echt ↔ Token, **nur In-Memory** | — |
| `sanitize.ts` | echt → Token im Request-Body | engine, vault |
| `reidentify.ts` | Token → echt in Antwort (JSON + Stream-Transform) | vault |
| `toggle.ts` | Beobachtet `.privacy-disabled`, hält Aktiv-Status | — |
| `dashboard/` | Web-UI: Toggle-Button + Live-Log der Ersetzungen (SSE) | toggle |
| `config.ts` | Lädt `privacy-rules.json`, Ports, Upstreams | — |
| `cli.ts` | `start`, `on`, `off`, `status` | server, toggle |

Jedes Modul hat einen klar umrissenen Zweck, kommuniziert über schmale Schnittstellen
und ist isoliert testbar.

## 6. Bewusste Design-Entscheidungen

1. **API-Keys im Auth-Header werden durchgereicht.** Der echte Key muss an den Provider,
   sonst schlägt die Anfrage fehl. Ersetzt werden nur Keys/Secrets, die im **Prompt-Text**
   auftauchen.
2. **Fail-closed.** Schlägt die Bereinigung im aktiven Modus fehl (z. B. unparsbarer Body),
   wird die Anfrage **blockiert**, nicht ungefiltert durchgelassen.
3. **Mappings nur flüchtig.** Der Vault lebt nur im RAM, ist konsistent innerhalb einer
   Laufzeit (`[PERSON_1]` = dieselbe Person über mehrere Anfragen) und bei Neustart weg.
   Nie auf Platte.
4. **Streaming-Tail-Puffer.** Der Stream-Transform hält so viele Zeichen zurück, wie das
   längste mögliche Token lang ist, ersetzt nur im sicheren Bereich und flusht am Ende.
   Da Tokens ein festes Format `[TYP_N]` haben, ist die Maximallänge bekannt und begrenzt.

## 7. Konfiguration: `privacy-rules.json`

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

- `rules`: explizite Werte, die der Nutzer pflegt (Namen, Firmen, Kunden, Projektnamen).
- `detectors`: eingebaute generische Muster, einzeln an-/abschaltbar.
- Eine `privacy-rules.example.json` wird mitgeliefert.

## 8. Sicherheit & Datenschutz

- Bindung ausschließlich an `127.0.0.1`, nie `0.0.0.0`.
- Klartext-PII wird **nicht** geloggt. Das Dashboard-Log zeigt Token + Typ; der Originalwert
  wird maskiert dargestellt (z. B. `m***@gmx.de`).
- Vault ausschließlich im Speicher; keine Serialisierung auf Platte.
- Fail-closed bei Bereinigungsfehlern im aktiven Modus.

## 9. Fehlerbehandlung

- Upstream-Fehler (429, 5xx …) transparent durchreichen (Status + Body).
- Unparsbarer JSON-Body im **aktiven** Modus → blockieren (fail-closed) mit klarer
  Fehlermeldung an den Client.
- Unbekannte Endpunkte → im aktiven Modus mit Warnung im Log durchleiten.
- Im Pass-Through-Modus wird niemals geblockt.

## 10. Teststrategie

- **Unit:** Rule-Engine (Treffer/keine Treffer, Überlappungen), Vault (Konsistenz,
  Bidirektionalität, Kollisionsfreiheit), Sanitize↔Reidentify-Roundtrip (identischer Text).
- **Streaming:** gezielter Test, dass ein über eine Chunk-Grenze zerschnittenes Token
  korrekt re-identifiziert wird.
- **Integration:** Mock-Upstream, vollständiger Request→Response-Zyklus für OpenAI- und
  Anthropic-Format, Pass-Through-Modus.
- **Property/Golden:** „Kein erfasstes PII rutscht durch" über generierte Eingaben.

## 11. Projektstruktur

```
privacy-guard-proxy/
  src/
    server.ts
    router.ts
    rules/
      engine.ts
      detectors.ts
    vault.ts
    sanitize.ts
    reidentify.ts
    toggle.ts
    dashboard/
      index.ts        # Dashboard-HTTP-Server + SSE-Log
      ui.html         # Toggle + Live-Log-Ansicht
    config.ts
    cli.ts
    events.ts         # interner Event-Bus für Log-Einträge
  privacy-rules.example.json
  tests/
  package.json
  tsconfig.json
  README.md
```

## 12. Scope

**Drin (v1):** Base-URL-Reverse-Proxy (OpenAI + Anthropic), Regel-+Muster-Engine,
In-Memory-Vault, Streaming-Re-Identifikation, Toggle-Datei, Web-Dashboard mit Live-Log, CLI.

**Draußen (später):** HTTPS-MITM-Modus, ML-/NER-Erkennung, IDE-Extensions, Persistenz,
Multi-User.
