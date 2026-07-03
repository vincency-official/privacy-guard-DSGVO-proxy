// Sanitizer: ersetzt echten Klartext durch stabile Tokens (echt → Token).
//
// sanitizeText ersetzt die von der Rule-Engine gefundenen Treffer im Text und
// vergibt über den Vault konsistente Tokens. sanitizeBody wendet das provider-
// spezifisch auf alle Textfelder eines Anfrage-Bodys an und mutiert diesen in-place.
//
// Sicherheitsprinzip: Für das Log wird zu jedem Ersatz nur ein MASKIERTER Wert
// festgehalten (z. B. "m***@gmx.de"), niemals der vollständige Klartext. Der
// echte Wert lebt ausschließlich im In-Memory-Vault. Nur Node-Built-ins, keine
// externen Dependencies.

import type { Config, Match, Provider, Replacement } from './types.js';
import type { Vault } from './vault.js';
import { findMatches } from './rules/engine.js';
import { buildDetectors } from './rules/detectors.js';
import { transformTexts } from './providers.js';
import { maskValue } from './events.js';

// Ersetzt alle übergebenen Treffer im Text durch ihre Tokens und liefert den
// bereinigten Text plus die Liste der durchgeführten Ersetzungen.
//
// Die Ersetzung erfolgt VON HINTEN NACH VORNE: dadurch bleiben die noch nicht
// verarbeiteten Positionen (start/end) der weiter vorne liegenden Treffer gültig,
// egal wie stark sich die Länge durch das Token ändert. Erwartet werden bereits
// überlappungsfreie, aufsteigend sortierte Matches aus findMatches().
export function sanitizeText(
  text: string,
  matches: Match[],
  vault: Vault,
): { text: string; replacements: Replacement[] } {
  // 1) Tokens in NATÜRLICHER Lese-Reihenfolge (aufsteigend nach start) vergeben.
  //    So folgt die fortlaufende Nummerierung dem Auftreten im Text: der erste
  //    neue Wert erhält [TYP_1], der nächste [TYP_2] usw. Eine Kopie sortieren,
  //    um das Eingabe-Array nicht zu mutieren.
  const aufsteigend = [...matches].sort((a, b) => a.start - b.start);

  const tokens = new Map<Match, string>();
  const replacements: Replacement[] = [];
  for (const match of aufsteigend) {
    const token = vault.tokenFor(match.value, match.type);
    tokens.set(match, token);
    // Ersatz fürs Log festhalten — mit maskiertem, nie vollständigem Wert.
    replacements.push({
      type: match.type,
      token,
      masked: maskValue(match.value),
    });
  }

  // 2) Ersetzung VON HINTEN NACH VORNE (absteigend nach start) anwenden, damit
  //    die Positionen der noch nicht ersetzten Treffer gültig bleiben, egal wie
  //    stark sich die Länge durch das Token ändert.
  let ergebnis = text;
  for (let i = aufsteigend.length - 1; i >= 0; i--) {
    const match = aufsteigend[i];
    const token = tokens.get(match) as string;
    ergebnis = ergebnis.slice(0, match.start) + token + ergebnis.slice(match.end);
  }

  return { text: ergebnis, replacements };
}

// Bereinigt einen kompletten Anfrage-Body in-place: baut die aktiven Detektoren
// aus der Config, läuft provider-spezifisch über alle Textfelder und ersetzt in
// jedem gefundenen Text die Treffer durch Tokens. Ein gemeinsamer Vault sorgt
// dafür, dass derselbe Klartext feldübergreifend dasselbe Token erhält. Liefert
// alle durchgeführten Ersetzungen (für das Log).
export function sanitizeBody(
  body: unknown,
  provider: Provider,
  cfg: Config,
  vault: Vault,
): Replacement[] {
  const detektoren = buildDetectors(cfg.detectors);
  const alle: Replacement[] = [];

  transformTexts(body, provider, (text) => {
    const matches = findMatches(text, cfg.rules, detektoren);
    if (matches.length === 0) {
      // Kein Treffer: Text unverändert lassen, keine unnötige Arbeit.
      return text;
    }
    const { text: bereinigt, replacements } = sanitizeText(text, matches, vault);
    alle.push(...replacements);
    return bereinigt;
  });

  return alle;
}
