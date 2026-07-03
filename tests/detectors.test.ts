import { describe, it, expect } from 'vitest';
import { buildDetectors, type Detector } from '../src/rules/detectors.js';
import { DEFAULT_DETECTORS } from '../src/config.js';
import type { DetectorConfig, PiiType } from '../src/types.js';

// Tests für die eingebauten Regex-Detektoren: pro Detektor je ein Positiv- und
// ein Negativbeispiel, korrekte Typ-Zuordnung, nur aktivierte Detektoren werden
// zurückgegeben und jede Regex trägt das globale (g-)Flag.

// Alle Detektoren aus, damit Einzeltests exakt einen Detektor aktivieren können.
const ALLE_AUS: DetectorConfig = {
  email: false,
  iban: false,
  creditCard: false,
  ipAddress: false,
  secrets: false,
};

// Kleiner Helfer: liefert den Detektor eines Typs oder wirft, falls er fehlt.
function detektorFuer(detektoren: Detector[], type: PiiType): Detector {
  const treffer = detektoren.find((d) => d.type === type);
  if (!treffer) {
    throw new Error(`Detektor für Typ ${type} nicht gefunden`);
  }
  return treffer;
}

// Prüft, ob die Regex irgendwo im Text trifft. Nutzt .test() auf einer frischen
// Regex-Kopie, damit der lastIndex-Zustand der g-Regex den Test nicht verfälscht.
function trifft(regex: RegExp, text: string): boolean {
  return new RegExp(regex.source, regex.flags).test(text);
}

describe('buildDetectors', () => {
  it('liefert bei nur aktiviertem E-Mail-Detektor genau einen EMAIL-Detektor', () => {
    const detektoren = buildDetectors({ ...ALLE_AUS, email: true });

    expect(detektoren).toHaveLength(1);
    expect(detektoren[0].type).toBe('EMAIL');
  });

  it('liefert bei allen aktivierten Detektoren fünf Detektoren mit den erwarteten Typen', () => {
    const detektoren = buildDetectors(DEFAULT_DETECTORS);
    const typen = detektoren.map((d) => d.type);

    expect(detektoren).toHaveLength(5);
    expect(typen).toEqual(['EMAIL', 'IBAN', 'CREDIT_CARD', 'IP', 'SECRET']);
  });

  it('gibt deaktivierte Detektoren nicht zurück', () => {
    const detektoren = buildDetectors({
      ...ALLE_AUS,
      iban: true,
      secrets: true,
    });
    const typen = detektoren.map((d) => d.type);

    expect(typen).toEqual(['IBAN', 'SECRET']);
    expect(typen).not.toContain('EMAIL');
    expect(typen).not.toContain('CREDIT_CARD');
    expect(typen).not.toContain('IP');
  });

  it('versieht jede Regex mit dem globalen (g-)Flag', () => {
    const detektoren = buildDetectors(DEFAULT_DETECTORS);

    for (const d of detektoren) {
      expect(d.regex.flags).toContain('g');
    }
  });

  it('liefert bei jedem Aufruf frische Regex-Instanzen ohne geteilten lastIndex', () => {
    const ersteRunde = buildDetectors({ ...ALLE_AUS, email: true })[0].regex;
    // lastIndex vorschieben, um geteilten Zustand aufzudecken.
    ersteRunde.exec('max@firma.de max@firma.de');
    expect(ersteRunde.lastIndex).toBeGreaterThan(0);

    const zweiteRunde = buildDetectors({ ...ALLE_AUS, email: true })[0].regex;
    expect(zweiteRunde.lastIndex).toBe(0);
  });
});

describe('EMAIL-Detektor', () => {
  const regex = detektorFuer(buildDetectors({ ...ALLE_AUS, email: true }), 'EMAIL')
    .regex;

  it('erkennt eine gültige E-Mail-Adresse', () => {
    expect(trifft(regex, 'Bitte an max.mustermann@firma-xy.de senden.')).toBe(true);
  });

  it('erkennt reinen Text ohne @ nicht', () => {
    expect(trifft(regex, 'keine-mail-hier keinatzeichen.de')).toBe(false);
  });
});

describe('IBAN-Detektor', () => {
  const regex = detektorFuer(buildDetectors({ ...ALLE_AUS, iban: true }), 'IBAN')
    .regex;

  it('erkennt eine formatierte deutsche IBAN', () => {
    expect(trifft(regex, 'Konto: DE44 5001 0517 5407 3249 31')).toBe(true);
  });

  it('erkennt einen zu kurzen IBAN-Fragment nicht', () => {
    expect(trifft(regex, 'nur DE44 ohne Rest')).toBe(false);
  });

  it('fängt keine nachfolgenden Wörter mit in den Treffer (exakte Grenze)', () => {
    const treffer = new RegExp(regex.source, regex.flags).exec(
      'Ueberweise auf DE44 5001 0517 5407 3249 31 danke schoen',
    );
    expect(treffer?.[0]).toBe('DE44 5001 0517 5407 3249 31');
  });

  it('erkennt auch die kompakte (ungruppierte) IBAN ohne Folgetext', () => {
    const treffer = new RegExp(regex.source, regex.flags).exec(
      'IBAN DE44500105175407324931 bitte pruefen',
    );
    expect(treffer?.[0]).toBe('DE44500105175407324931');
  });
});

describe('CREDIT_CARD-Detektor', () => {
  const regex = detektorFuer(
    buildDetectors({ ...ALLE_AUS, creditCard: true }),
    'CREDIT_CARD',
  ).regex;

  it('erkennt eine 16-stellige Kartennummer mit Leerzeichen', () => {
    expect(trifft(regex, 'Karte 4111 1111 1111 1111 gültig')).toBe(true);
  });

  it('erkennt eine viel zu kurze Ziffernfolge nicht', () => {
    expect(trifft(regex, 'PIN 1234')).toBe(false);
  });

  it('fängt kein nachfolgendes Trennzeichen mit in den Treffer', () => {
    const mitSpace = new RegExp(regex.source, regex.flags).exec(
      'Karte 4111 1111 1111 1111 fertig',
    );
    expect(mitSpace?.[0]).toBe('4111 1111 1111 1111');

    const mitStrich = new RegExp(regex.source, regex.flags).exec(
      'nr 4111-1111-1111-1111-ende',
    );
    expect(mitStrich?.[0]).toBe('4111-1111-1111-1111');
  });
});

describe('IP-Detektor', () => {
  const regex = detektorFuer(
    buildDetectors({ ...ALLE_AUS, ipAddress: true }),
    'IP',
  ).regex;

  it('erkennt eine gültige IPv4-Adresse', () => {
    expect(trifft(regex, 'Server läuft auf 192.168.0.1 im LAN')).toBe(true);
  });

  it('erkennt eine ungültige IPv4-Adresse mit Oktett > 255 nicht', () => {
    expect(trifft(regex, 'Adresse 999.999.999.999 existiert nicht')).toBe(false);
  });
});

describe('SECRET-Detektor', () => {
  const regex = detektorFuer(
    buildDetectors({ ...ALLE_AUS, secrets: true }),
    'SECRET',
  ).regex;

  it('erkennt einen OpenAI-artigen sk-Schlüssel', () => {
    expect(trifft(regex, 'API-Key sk-abcdEFGH1234567890xyz benutzen')).toBe(true);
  });

  it('erkennt einen GitHub- und AWS-Schlüssel', () => {
    expect(trifft(regex, 'Token ghp_ABCDEFGHIJKLMNOPQRST1234567890')).toBe(true);
    expect(trifft(regex, 'Zugang AKIAIOSFODNN7EXAMPLE aktiv')).toBe(true);
  });

  it('erkennt harmlosen Text ohne bekanntes Präfix nicht', () => {
    expect(trifft(regex, 'das ist nur ein normaler satz ohne geheimnis')).toBe(false);
  });
});
