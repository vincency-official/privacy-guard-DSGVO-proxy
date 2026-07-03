// Tests für die CLI-Befehlslogik (runCli). Nutzt einen Temp-Toggle-Pfad, damit
// nie die echte Marker-Datei angefasst wird. Der 'start'-Befehl wird hier bewusst
// nicht ausgeführt (würde Server binden) — er ist über startServers separat gekapselt.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCli } from '../src/cli.js';

let tempDir: string;
let pfad: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pg-cli-'));
  pfad = join(tempDir, '.privacy-disabled');
  // Konsolen-Ausgaben der CLI im Testlauf unterdrücken.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

describe('runCli', () => {
  test('off schaltet den Schutz aus und legt die Marker-Datei an', async () => {
    const code = await runCli(['off'], { togglePath: pfad });
    expect(code).toBe(0);
    expect(existsSync(pfad)).toBe(true);
  });

  test('on schaltet den Schutz an und entfernt die Marker-Datei', async () => {
    await runCli(['off'], { togglePath: pfad });
    const code = await runCli(['on'], { togglePath: pfad });
    expect(code).toBe(0);
    expect(existsSync(pfad)).toBe(false);
  });

  test('status liefert Exit-Code 0', async () => {
    expect(await runCli(['status'], { togglePath: pfad })).toBe(0);
  });

  test('unbekannter Befehl liefert Exit-Code 1', async () => {
    expect(await runCli(['gibtsnicht'], { togglePath: pfad })).toBe(1);
  });

  test('fehlender Befehl liefert Exit-Code 1', async () => {
    expect(await runCli([], { togglePath: pfad })).toBe(1);
  });
});
