#!/usr/bin/env node
// CLI und Verdrahtung des Privacy-Guard Proxy.
//
// Befehle:
//   privacy-guard start   → startet Proxy (127.0.0.1:port) und Dashboard
//   privacy-guard on      → Schutz AN  (Marker-Datei löschen)
//   privacy-guard off     → Schutz AUS (Marker-Datei anlegen, Pass-Through)
//   privacy-guard status  → aktuellen Schutz-Zustand ausgeben
//
// Die Befehlslogik steckt in der reinen, testbaren Funktion runCli(); das
// Starten der Server ist in startServers() gekapselt (schließbar, für Tests).
// Nur Node-Built-ins, keine externen Dependencies.

import type { Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import type { Config } from './types.js';
import { loadConfig } from './config.js';
import { Vault } from './vault.js';
import { Toggle } from './toggle.js';
import { createProxyServer } from './server.js';
import { createDashboardServer } from './dashboard/index.js';

// Optionale Abhängigkeiten für runCli — erlaubt Tests, einen Toggle-Pfad zu
// injizieren, statt die echte Marker-Datei im Arbeitsverzeichnis anzufassen.
export interface CliDeps {
  togglePath?: string;
}

// Startet Proxy- und Dashboard-Server und bindet sie ausschließlich an 127.0.0.1.
// Gibt beide Server (und den geteilten Toggle) zurück, damit Aufrufer sie sauber
// schließen können. Proxy und Dashboard teilen sich denselben Toggle, sodass ein
// Umschalten im Dashboard sofort auf den Proxy wirkt.
export function startServers(
  config: Config = loadConfig(),
  togglePath?: string,
): { proxy: Server; dashboard: Server; toggle: Toggle } {
  const vault = new Vault();
  const toggle = new Toggle(togglePath);
  const proxy = createProxyServer({ config, vault, toggle });
  const dashboard = createDashboardServer(toggle);

  const port = config.server.port;
  const dashPort = config.server.dashboardPort;

  proxy.listen(port, '127.0.0.1', () => {
    console.log(`🛡️  Privacy-Guard Proxy läuft auf http://127.0.0.1:${port}`);
    console.log(`   OpenAI-Base-URL    → http://127.0.0.1:${port}/openai/v1`);
    console.log(`   Anthropic-Base-URL → http://127.0.0.1:${port}/anthropic`);
  });
  dashboard.listen(dashPort, '127.0.0.1', () => {
    console.log(`   Dashboard          → http://127.0.0.1:${dashPort}`);
  });

  return { proxy, dashboard, toggle };
}

// Führt einen CLI-Befehl aus und liefert den Prozess-Exit-Code (0 = ok, 1 = Fehler).
// 'start' startet die Server und kehrt mit 0 zurück; die laufenden Server halten
// danach den Event-Loop am Leben.
export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const cmd = (argv[0] ?? '').toLowerCase();

  switch (cmd) {
    case 'on': {
      new Toggle(deps.togglePath).enable();
      console.log('Privacy-Guard: Schutz AKTIV — Daten werden vor dem Versand tokenisiert.');
      return 0;
    }
    case 'off': {
      new Toggle(deps.togglePath).disable();
      console.log('Privacy-Guard: PASS-THROUGH — Daten werden ungefiltert durchgeleitet.');
      return 0;
    }
    case 'status': {
      const disabled = new Toggle(deps.togglePath).isDisabled();
      console.log(disabled ? 'pass-through (ungeschützt)' : 'aktiv (geschützt)');
      return 0;
    }
    case 'start': {
      startServers(loadConfig(), deps.togglePath);
      return 0;
    }
    default: {
      console.error('Unbekannter Befehl. Nutzung: privacy-guard <start|on|off|status>');
      return 1;
    }
  }
}

// Direktaufruf-Erkennung: Nur wenn diese Datei direkt als Programm läuft (nicht
// beim Import in Tests), wird die CLI ausgeführt. Bei den Einmal-Befehlen wird der
// Prozess mit dem Exit-Code beendet; bei 'start' laufen die Server weiter.
const direkterAufruf =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (direkterAufruf) {
  const argv = process.argv.slice(2);
  const code = await runCli(argv);
  if ((argv[0] ?? '').toLowerCase() !== 'start') {
    process.exit(code);
  }
}
