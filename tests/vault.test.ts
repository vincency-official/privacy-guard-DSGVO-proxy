import { describe, it, expect, beforeEach } from 'vitest';
import { Vault } from '../src/vault.js';

// Tests für den In-Memory-Vault: konsistente Token pro Wert, fortlaufende
// Nummerierung pro Typ, Rückwärts-Lookup, unbekannte Token und reset().

describe('Vault', () => {
  let vault: Vault;

  beforeEach(() => {
    // Frischer Vault pro Test, damit sich Zähler und Maps nicht überlagern.
    vault = new Vault();
  });

  it('vergibt für den gleichen Wert konsistent das gleiche Token', () => {
    const erst = vault.tokenFor('Max', 'PERSON');
    const wieder = vault.tokenFor('Max', 'PERSON');

    expect(erst).toBe('[PERSON_1]');
    expect(wieder).toBe('[PERSON_1]');
  });

  it('nummeriert pro Typ fortlaufend ab 1 durch', () => {
    expect(vault.tokenFor('Max', 'PERSON')).toBe('[PERSON_1]');
    expect(vault.tokenFor('Eva', 'PERSON')).toBe('[PERSON_2]');
    // Eigener Zähler pro Typ: EMAIL beginnt wieder bei 1.
    expect(vault.tokenFor('a@b.de', 'EMAIL')).toBe('[EMAIL_1]');
    expect(vault.tokenFor('c@d.de', 'EMAIL')).toBe('[EMAIL_2]');
    // Bereits bekannter PERSON-Wert liefert weiterhin das alte Token.
    expect(vault.tokenFor('Eva', 'PERSON')).toBe('[PERSON_2]');
  });

  it('löst Token rückwärts zum ursprünglichen Klartext auf', () => {
    const token = vault.tokenFor('Max Mustermann', 'PERSON');

    expect(token).toBe('[PERSON_1]');
    expect(vault.valueFor('[PERSON_1]')).toBe('Max Mustermann');
  });

  it('liefert für ein unbekanntes Token undefined', () => {
    expect(vault.valueFor('[PERSON_99]')).toBeUndefined();
    expect(vault.valueFor('kein-token')).toBeUndefined();
  });

  it('trennt gleichen Klartext bei unterschiedlichem Typ', () => {
    // Selten, aber definiert: Schlüssel = type + ' ' + value.
    const alsPerson = vault.tokenFor('Apple', 'PERSON');
    const alsOrg = vault.tokenFor('Apple', 'ORG');

    expect(alsPerson).toBe('[PERSON_1]');
    expect(alsOrg).toBe('[ORG_1]');
    expect(vault.valueFor('[PERSON_1]')).toBe('Apple');
    expect(vault.valueFor('[ORG_1]')).toBe('Apple');
  });

  it('leert mit reset() alle Zuordnungen und Zähler', () => {
    vault.tokenFor('Max', 'PERSON');
    vault.tokenFor('a@b.de', 'EMAIL');

    vault.reset();

    // Rückwärts-Lookup findet nach reset() nichts mehr.
    expect(vault.valueFor('[PERSON_1]')).toBeUndefined();
    expect(vault.valueFor('[EMAIL_1]')).toBeUndefined();
    // Zähler starten nach reset() wieder bei 1.
    expect(vault.tokenFor('Erika', 'PERSON')).toBe('[PERSON_1]');
  });
});
