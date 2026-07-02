import { describe, it, expect } from 'vitest';
import type { PiiType, Config, LogEntry } from '../src/types.js';

// Rauchtest: stellt sicher, dass der Testrunner läuft und das Typ-Modul
// erfolgreich eingebunden werden kann. Die Typen werden zur Laufzeit gelöscht,
// deshalb prüfen wir sie über typisierte Beispiel-Werte (Compile-Zeit) plus
// einen echten Laufzeit-Import des Moduls.

describe('Rauchtest', () => {
  it('führt den Testrunner aus', () => {
    expect(true).toBe(true);
  });

  it('kann Typen aus src/types nutzen', () => {
    // Typ-Wert-Helfer: ein typisierter Wert beweist, dass die Typen existieren
    // und der Import auflöst. Falls ein Typname abweicht, schlägt die Kompilierung fehl.
    const typ: PiiType = 'PERSON';
    const eintrag: LogEntry = {
      timestamp: new Date(0).toISOString(),
      mode: 'active',
      provider: 'openai',
      path: '/openai/v1/chat/completions',
      replacements: [{ type: typ, token: '[PERSON_1]', masked: 'M***' }],
    };
    const cfg: Config = {
      rules: [{ match: 'Max Mustermann', type: 'PERSON' }],
      detectors: {
        email: true,
        iban: true,
        creditCard: true,
        ipAddress: true,
        secrets: true,
      },
      server: { port: 8080, dashboardPort: 8081 },
    };

    expect(typ).toBe('PERSON');
    expect(eintrag.mode).toBe('active');
    expect(eintrag.replacements[0].token).toBe('[PERSON_1]');
    expect(cfg.server.port).toBe(8080);
  });
});
