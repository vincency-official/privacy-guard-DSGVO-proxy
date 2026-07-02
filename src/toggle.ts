// Datei-basierter Toggle für den Pass-Through-Modus.
//
// Prinzip: Eine einzelne Marker-Datei (Default: ./.privacy-disabled) steuert, ob
// der Proxy schützt oder nur durchreicht. Existiert die Datei, ist der Schutz AUS
// (disabled → Pass-Through); fehlt sie, ist der Schutz AN.
//
// Der Datei-Ansatz ist bewusst gewählt: der Zustand überlebt Neustarts, ist von
// aussen (CLI, Dashboard, manuell) leicht umschaltbar und bringt keine externen
// Dependencies mit. Nur Node-Built-ins.

import { existsSync, writeFileSync, rmSync } from 'node:fs';

// Standard-Pfad der Marker-Datei (relativ zum Arbeitsverzeichnis).
const DEFAULT_PATH = './.privacy-disabled';

// Inhalt der Marker-Datei: rein informativ. Enthält bewusst KEINE PII, nur einen
// erklärenden Hinweis mit echten Umlauten.
const MARKER_INHALT =
  'Privacy-Guard: Schutz ist deaktiviert (Pass-Through-Modus).\n' +
  'Diese Datei löschen oder "privacy-guard on" ausführen, um den Schutz zu aktivieren.\n';

export class Toggle {
  // Pfad der Marker-Datei. Für Tests injizierbar, damit nie die echte Datei im
  // Arbeitsverzeichnis angefasst wird.
  private readonly filePath: string;

  constructor(filePath: string = DEFAULT_PATH) {
    this.filePath = filePath;
  }

  // True, wenn der Schutz deaktiviert ist (Marker-Datei existiert → Pass-Through).
  isDisabled(): boolean {
    return existsSync(this.filePath);
  }

  // Schaltet den Schutz AUS: legt die Marker-Datei an. Idempotent — erneutes
  // disable() überschreibt die Datei unschädlich mit demselben Inhalt.
  disable(): void {
    writeFileSync(this.filePath, MARKER_INHALT, 'utf8');
  }

  // Schaltet den Schutz AN: löscht die Marker-Datei. Idempotent — `force: true`
  // wirft nicht, falls die Datei bereits fehlt.
  enable(): void {
    rmSync(this.filePath, { force: true });
  }
}
