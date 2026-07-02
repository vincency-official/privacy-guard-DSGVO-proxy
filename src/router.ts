// Router: bildet einen eingehenden Request-Pfad auf einen Upstream-Provider ab.
//
// Der Proxy nimmt Anfragen unter einem Provider-Präfix entgegen (/openai bzw.
// /anthropic) und leitet sie an den echten Provider weiter. resolveRoute() prüft
// das Präfix, wählt den passenden Upstream-Origin und liefert den Rest-Pfad, der
// unverändert (inklusive Query-String) an den Upstream gehängt wird.
//
// Sicherheitsprinzip: Nur die beiden bekannten Präfixe werden akzeptiert; jeder
// andere Pfad ergibt null und wird vom Server als 404 abgewiesen — der Proxy ist
// kein offener Weiterleiter. Nur Node-Built-ins, keine externen Dependencies.

import type { Provider } from './types.js';

// Aufgelöstes Ziel für eine eingehende Anfrage.
export interface Route {
  provider: Provider;
  upstreamOrigin: string;
  upstreamPath: string;
}

// Zuordnung Provider-Präfix → Upstream-Origin. Origin ohne abschließenden Slash,
// der Rest-Pfad beginnt immer mit "/".
const PROVIDER_ORIGINS: Record<Provider, string> = {
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
};

// Zerlegt den Request-Pfad in Provider, Upstream-Origin und Rest-Pfad.
//
// - "/openai/v1/chat/completions" → openai, ".../v1/chat/completions"
// - "/anthropic/v1/messages"      → anthropic, ".../v1/messages"
// - Query-String bleibt erhalten: "/openai/v1/models?limit=5" → "/v1/models?limit=5"
// - Nacktes Präfix ("/openai" oder "/openai/") → Rest-Pfad "/"
// - Unbekanntes Präfix oder kein Segment-Match → null
export function resolveRoute(reqPath: string): Route | null {
  for (const provider of Object.keys(PROVIDER_ORIGINS) as Provider[]) {
    const prefix = `/${provider}`;

    if (!reqPath.startsWith(prefix)) {
      continue;
    }

    // Das Zeichen direkt hinter dem Präfix bestimmt, ob es an einer Segment-
    // Grenze endet. Erlaubt sind: Ende des Strings, "/" (nächstes Segment) oder
    // "?" (Query-String). Damit matcht "/openai-intern" NICHT den openai-Provider.
    const rest = reqPath.slice(prefix.length);
    if (rest !== '' && rest[0] !== '/' && rest[0] !== '?') {
      continue;
    }

    // Rest-Pfad zusammenbauen. "" oder "/" (nacktes Präfix) wird zur Wurzel "/".
    // "?..." (Präfix direkt gefolgt vom Query-String) bekommt die Wurzel "/"
    // vorangestellt.
    let upstreamPath: string;
    if (rest === '' || rest === '/') {
      upstreamPath = '/';
    } else if (rest[0] === '?') {
      upstreamPath = `/${rest}`;
    } else {
      upstreamPath = rest;
    }

    return {
      provider,
      upstreamOrigin: PROVIDER_ORIGINS[provider],
      upstreamPath,
    };
  }

  return null;
}
