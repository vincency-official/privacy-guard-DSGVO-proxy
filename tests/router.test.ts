import { describe, it, expect } from 'vitest';
import { resolveRoute } from '../src/router.js';

// Tests für den Router: Pfad-Präfix → Provider + Upstream-Ziel.
//
// Der Proxy hört auf Pfaden mit einem Provider-Präfix (/openai bzw. /anthropic)
// und leitet an den echten Provider weiter. resolveRoute() zerlegt den einge-
// henden Request-Pfad in den Provider, den Upstream-Origin und den Rest-Pfad,
// der an den Upstream gehängt wird. Das Präfix wird dabei entfernt, alles
// dahinter (inkl. Query-String) bleibt unverändert erhalten.

describe('resolveRoute', () => {
  it('löst einen OpenAI-Pfad auf und entfernt das Präfix', () => {
    const route = resolveRoute('/openai/v1/chat/completions');

    expect(route).not.toBeNull();
    expect(route!.provider).toBe('openai');
    expect(route!.upstreamOrigin).toBe('https://api.openai.com');
    // Das "/openai"-Präfix ist entfernt, der Rest bleibt exakt erhalten.
    expect(route!.upstreamPath).toBe('/v1/chat/completions');
  });

  it('löst einen Anthropic-Pfad auf und entfernt das Präfix', () => {
    const route = resolveRoute('/anthropic/v1/messages');

    expect(route).not.toBeNull();
    expect(route!.provider).toBe('anthropic');
    expect(route!.upstreamOrigin).toBe('https://api.anthropic.com');
    expect(route!.upstreamPath).toBe('/v1/messages');
  });

  it('erhält den Query-String im Upstream-Pfad', () => {
    const route = resolveRoute('/openai/v1/models?limit=5&order=desc');

    expect(route).not.toBeNull();
    expect(route!.provider).toBe('openai');
    // Query-String wird unverändert an den Upstream durchgereicht.
    expect(route!.upstreamPath).toBe('/v1/models?limit=5&order=desc');
  });

  it('behandelt das nackte Präfix ohne Rest-Pfad als Wurzel', () => {
    // "/openai" allein → Upstream-Wurzel "/".
    const route = resolveRoute('/openai');

    expect(route).not.toBeNull();
    expect(route!.provider).toBe('openai');
    expect(route!.upstreamPath).toBe('/');
  });

  it('behandelt "/openai/" (Präfix mit Slash) als Wurzel', () => {
    const route = resolveRoute('/openai/');

    expect(route).not.toBeNull();
    expect(route!.provider).toBe('openai');
    expect(route!.upstreamPath).toBe('/');
  });

  it('gibt bei unbekanntem Präfix null zurück', () => {
    expect(resolveRoute('/unbekannt/v1/chat')).toBeNull();
    expect(resolveRoute('/')).toBeNull();
    expect(resolveRoute('')).toBeNull();
  });

  it('verwechselt kein Präfix, das nur als Namensbestandteil vorkommt', () => {
    // "/openai-intern/..." ist NICHT der OpenAI-Provider, da das Präfix nicht an
    // einer Segment-Grenze endet.
    expect(resolveRoute('/openai-intern/v1/chat')).toBeNull();
    expect(resolveRoute('/anthropicx')).toBeNull();
  });
});
