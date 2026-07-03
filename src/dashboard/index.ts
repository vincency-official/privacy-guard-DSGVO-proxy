// Dashboard-HTTP-Server: schlanke lokale Steuer- und Beobachtungsoberfläche.
//
// Routen:
//  - GET  /            → HTML-Oberfläche (Toggle + Live-Log)
//  - GET  /api/status  → { disabled: boolean }  (Schutz-Zustand)
//  - POST /api/toggle  → schaltet den Schutz um, liefert { disabled }
//  - GET  /api/log     → Server-Sent-Events: je Log-Eintrag ein `data:`-Frame
//
// Der Live-Log speist sich aus dem gemeinsamen logBus (Event 'log') und enthält
// ausschließlich maskierte Werte — niemals Klartext-PII. Die Netzwerk-Bindung
// (listen auf 127.0.0.1) übernimmt der Aufrufer. Nur Node-Built-ins.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Toggle } from '../toggle.js';
import type { LogEntry } from '../types.js';
import { logBus } from '../events.js';
import { UI_HTML } from './ui.js';

// Erzeugt den Dashboard-Server für den gegebenen Toggle. Der Toggle wird geteilt
// mit dem Proxy, damit ein Umschalten hier sofort dort wirkt (und umgekehrt).
export function createDashboardServer(toggle: Toggle): Server {
  // Mehrere gleichzeitige SSE-Verbindungen (mehrere offene Tabs) sollen keine
  // MaxListeners-Warnung auslösen; ein lokales Dashboard hat nur wenige Zuhörer.
  logBus.setMaxListeners(50);

  return createServer((req, res) => {
    const url = (req.url ?? '/').split('?')[0];
    const method = (req.method ?? 'GET').toUpperCase();

    if (method === 'GET' && (url === '/' || url === '/index.html')) {
      sendeHtml(res, 200, UI_HTML);
      return;
    }

    if (method === 'GET' && url === '/api/status') {
      sendeJson(res, 200, { disabled: toggle.isDisabled() });
      return;
    }

    if (method === 'POST' && url === '/api/toggle') {
      // Umschalten: ist der Schutz aus (disabled), wieder anschalten — sonst aus.
      if (toggle.isDisabled()) {
        toggle.enable();
      } else {
        toggle.disable();
      }
      sendeJson(res, 200, { disabled: toggle.isDisabled() });
      return;
    }

    if (method === 'GET' && url === '/api/log') {
      starteSse(req, res);
      return;
    }

    sendeJson(res, 404, { error: 'Unbekannte Dashboard-Route.' });
  });
}

// Startet einen Server-Sent-Events-Stream und leitet jeden Log-Eintrag als
// `data:`-Frame weiter. Räumt den Listener bei Verbindungsende sauber ab.
function starteSse(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  // Reconnection-Hinweis für den Browser-EventSource-Client.
  res.write('retry: 3000\n\n');

  const zuhoerer = (entry: LogEntry): void => {
    res.write(`data: ${JSON.stringify(entry)}\n\n`);
  };
  logBus.on('log', zuhoerer);

  const aufraeumen = (): void => {
    logBus.off('log', zuhoerer);
  };
  req.on('close', aufraeumen);
  res.on('close', aufraeumen);
}

// Sendet eine HTML-Antwort.
function sendeHtml(res: ServerResponse, status: number, html: string): void {
  const body = Buffer.from(html, 'utf8');
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(body.length),
  });
  res.end(body);
}

// Sendet eine JSON-Antwort.
function sendeJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
  });
  res.end(body);
}
