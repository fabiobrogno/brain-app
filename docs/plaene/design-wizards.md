# Einrichtung, Wizards und Dialoge: ruhiger und mit weniger Schritten

Stand: 30.10.2026 · Branch `feat/wizards-einfach`

Auftrag des Nutzers: Einrichtung, Wizards und Dialoge sollen so schlicht werden wie bei den Vorbildern: weniger sichtbare Entscheidungen, ein
Hauptknopf, sinnvolle Vorgaben, nichts Technisches im Weg, „später“ statt Pflichtschritte. Dieses Papier hält fest, **was** übernommen wurde,
**woher** es stammt und **wie** Kortex es umsetzt.

## 1. Quellen und Lizenzen

| Quelle | Lizenz | Umgang |
|---|---|---|
| **Orca** (https://github.com/stablyai/orca, Website https://orca.dev), gelesen am Commit `cf5b462fba8462678256b25d05cec2adb8dca412` | MIT, Copyright (c) 2026 Lovecast Inc. | Hauptvorbild. Gestaltung und Maße dürfen übernommen werden. Wir übertragen sie von Hand (CSS, Vanilla-JS, SwiftUI), mit eigenen Texten, Farben und Symbolen. Herkunft steht in `THIRD-PARTY-NOTICES.md` und als Kommentar an den Stellen. Keine Marke, kein Logo, kein Name von Orca. |
| **Tolaria** (https://github.com/refactoringhq/tolaria, Vorstellung https://refactoring.fm/p/introducing-tolaria) | AGPL-3.0 | Nur Inspiration. Es wird **kein** Code, Wortlaut oder Bild übernommen, nur Prinzipien in eigenen Worten. Kortex steht unter MIT. |

Gelesene Dateien in Orca (alle unter `src/renderer/src/`, Stand wie oben):

- `components/onboarding/OnboardingFlow.tsx`, `OnboardingFooter.tsx`, `OnboardingSkipConfirmationDialog.tsx`, `AgentStep.tsx`, `IntegrationsStep.tsx`, `ThemeStep.tsx`
  (Einrichtung beim ersten Start: Schrittzahl, Fußleiste, Tastatur, Überspringen),
- `components/sidebar/AddRepoStartSteps.tsx`, `AddRepoDialogChrome.tsx`, `AddRepoStepIndicator.tsx` (der Dialog „Add a project“: Vault anlegen, öffnen, klonen),
- `components/ui/dialog.tsx`, `button.tsx`, `card.tsx`, `input.tsx` (Dialog- und Knopfmaße),
- `components/native-chat/NativeChatEmptyState.tsx`, `components/sidebar/worktree-list/listing/EmptyState.tsx`, `components/automations/AutomationTemplateEmptyState.tsx` (leere Zustände),
- `assets/main.css` (Farb- und Radiuswerte, hell/dunkel),
- LICENSE (MIT, Copyright (c) 2026 Lovecast Inc.).

Zu Tolaria wurde die frühere Recherche (Stand 29.10.2026, nur gelesen) weiterverwendet: `site/start/first-launch.md`, `site/start/install.md`, README, `docs/ARCHITECTURE.md`
und `docs/ABSTRACTIONS.md` im Repo sowie https://refactoring.fm/p/introducing-tolaria. WebFetch liefert Zusammenfassungen, keine Wortlaute; Belegtes steht unten, Offenes ist
als „nicht belegt“ markiert.

## 2. Was macht die Vorbilder ruhig? Die übernommenen Prinzipien

| # | Prinzip | Beleg | Umsetzung in Kortex |
|---|---|---|---|
| 1 | **Ein Hauptweg, die anderen ruhig gruppiert.** Eine große Zeile, darunter „Andere Wege“ als Liste. | Orca `AddRepoStartSteps.tsx` (Browse als Hauptzeile, „Other ways to add“ als Gruppe); Tolaria `first-launch.md`: drei Startwege (Beispiel-Vault klonen, Ordner öffnen, leeren Vault anlegen) | SwiftUI-Willkommen: „Neuen Vault anlegen“ groß, darunter „Andere Wege“ (Ordner öffnen, Von GitHub holen, Erst mal ausprobieren). Studio-Willkommen: Vorlage als Hauptweg, drei weitere in einer Gruppe. |
| 2 | **Vorgaben statt Fragen.** Wer nichts ändert, bekommt das Richtige. | Tolaria: Beispiel-Vault, keine Anmeldung; Orca: jeder Schritt hat eine Vorauswahl, „Continue“ genügt | Name „Kortex“, Ort `~/Kortex`, Vorlage mit Beispielseiten, KI-Stufe „Posteingang“. Der Name wird nicht mehr abgefragt; der Ort ist ein kleiner „Ort ändern …“-Link. git prüft Kortex ohne eigenes Bild. |
| 3 | **Keine Pflicht nach dem Nötigen.** Alles Weitere ist freiwillig und später nachholbar. | Orca: „Skip to project setup“ in jedem Schritt, Esc fragt nach dem Überspringen; Tolaria: der KI-Hinweis nach dem Öffnen ist optional und wegklickbar | Der Assistent verlangt nur git (ohne Klick) und einen Vault. KI verbinden, bei GitHub sichern und die Probe sind Karten „Wenn du magst“ auf dem Abschlussbild; auch aus dem Menü „Kortex einrichten …“ erreichbar. |
| 4 | **Eine Dialoghülle.** Titel, ein Satz, Inhalt, Fußleiste mit genau einem Hauptknopf rechts. | Orca `dialog.tsx` (Kopf mit Titel und Beschreibung, Fußleiste rechts), `OnboardingFooter.tsx` (leise Wege links, Hauptknopf rechts) | `dialog({ titel, satz, rumpf, knoepfe })` in `hilfen.js`; Maße in `studio/dialoge.css`; SwiftUI `Fussleiste`. Alle Dialoge der Liste (siehe 4) laufen darüber. |
| 5 | **Tastatur zuerst.** Enter bestätigt, Esc geht zurück, Pfeile wählen. Der Hauptknopf zeigt seine Taste. | Orca: ⌘⏎ und Enter-Chip am Hauptknopf, Esc, Pfeiltasten in der Startliste; Tolaria: Befehlspalette ⌘K, Einstellungen ⌘, | Enter löst den Hauptknopf aus (im mehrzeiligen Feld mit ⌘↩), Esc schließt; Hauptknöpfe tragen ein ↩-Zeichen; im Willkommen wählen ↑ ↓ die Zeile und ↩ führt sie aus. |
| 6 | **Leerer Zustand: Symbol, ein Satz, eine Aktion.** Kein Fließtext, keine Tastenliste. | Orca `NativeChatEmptyState.tsx` (Kreis 48 px, Titel, kurzer Untertitel), `EmptyState.tsx` (eine Schaltfläche) | `leerBlock()` in `bausteine.js` (Aktion über `knopf()`): Alle Notizen leer → „Neue Notiz“, Posteingang → „Schnell merken“, andere Ansichten → „Alle Notizen zeigen“, Aufgaben → „Erste Aufgabe erfassen“, Suche ohne Treffer → „Suche löschen“, leerer Editor → „Neue Notiz“. |
| 7 | **Technik versteckt, bis man sie braucht.** | Tolaria: Rechte-Modi je KI nur im Einstellungsbereich (nicht belegt: genaue Beschriftung); Orca: Details hinter „Advanced“ | KI-Zeile zeigt „Darf diesen Vault: Posteingang · Ändern“; die Stufenwahl klappt erst nach „Ändern“ auf. Keine Fachwörter (git, Remote, Upstream) im Willkommen. |
| 8 | **Fortschritt nur, wo er etwas sagt.** Zwei Bilder brauchen keine Leiste; Warten bekommt einen Kreisel mit einem Satz. | Orca zeigt bei fünf Schritten einen Stepper („1 of 5“) – bei zwei Bildern entfällt er | Keine Fortschrittsleiste mehr im Assistenten; nur „Dein Vault wird angelegt …“ während der Arbeit. |

### Bewusst nicht übernommen

- Orcas Vollbild-Overlay mit großem Titel (34 px) und Theme-/Benachrichtigungsschritten: Kortex hat dafür keinen Bedarf.
- Tolarias Befehlspalette als eigenes Konzept: Kortex hat die Palette ⌘K schon.
- Jeder Code, jede Grafik und jeder Text beider Projekte; Marken- und Produktnamen.

## 3. Übernommene Tokens (Werte aus Orca, mit Kortex-Farben)

| Bereich | Wert | Ort in Orca | Ort in Kortex |
|---|---|---|---|
| Dialog: Innenabstand | 24 px | `ui/dialog.tsx` (`p-6`) | `--dlg-rand: 24px` in `studio/dialoge.css` |
| Dialog: Abstand der Teile | 16 px | `ui/dialog.tsx` (`gap-4`) | `--dlg-abstand: 16px` |
| Dialog: Titel | 17–18 px, 600 | `dialog.tsx` (`text-lg font-semibold`) | 17 px / 650 (`.dialog-kopf`) |
| Dialog: Satz | 13–14 px, gedämpft | `DialogDescription` (`text-sm text-muted-foreground`) | 13,5 px, `--text-2` (`.dialog-satz`) |
| Fußleiste | rechtsbündig, 8 px Abstand; leise Wege links | `DialogFooter`, `OnboardingFooter.tsx` | `.dialog-fuss`, SwiftUI `Fussleiste` |
| Hauptknopf | Enter-Chip ⏎ am Knopf | `OnboardingFooter.tsx` | `.dialog-fuss .knopf.primaer::after` („↩“) |
| Startzeile | Symbolkachel 28 px, Ecke 6 px; Titel 14 px/500, Beschreibung 12 px | `AddRepoStartSteps.tsx` | SwiftUI `WegZeile`; Studio `.w-gruppe-wege` (Kachel 32 px) |
| Gruppe | Ecke 6 px, 1 px Rahmen, feine Trennlinien, Überschrift 11 px Großbuchstaben mit Sperrung | `AddRepoStartSteps.tsx` | `WegGruppe`, `.w-andere` |
| Leerer Zustand | Kreis 48 px, Titel 14 px/500, Satz 12–13 px, höchstens 280 px breit | `NativeChatEmptyState.tsx` | `.leer-liste .zeichen`, `leerBlock()` |
| Radien | 6 px (Zeile, Gruppe), 8 px (Hauptzeile), 10–14 px (Dialog) | `main.css` (`--radius: 0.625rem`) | wie links; Dialog 14 px |

Farben, Schrift (Geist ist in Kortex schon dabei) und Symbole bleiben Kortex' eigene (ein Akzent, `studio.css`).

## 4. Umsetzung

### Kortex-Assistent (SwiftUI)

Vorher: bis zu sechs Schritte mit Fortschrittsleiste (git, Vault, GitHub, Sicherung, KI, Probe), „Zurück“, „Überspringen“, „Später“.
Nachher: **zwei Bilder**.

1. **Willkommen** (nur wenn kein Vault da ist): ein Hauptweg „Neuen Vault anlegen“ (Vorgabe `~/Kortex`, ↩ legt ihn an), darunter „Andere Wege“: Vorhandenen Ordner öffnen,
   Von GitHub holen (eigenes Bild mit nur der Adresse, bei privaten Repositories die Anmeldung dort), Erst mal ausprobieren. git prüft Kortex von selbst; nur wenn es fehlt, erscheint
   ein Bild „Ein Werkzeug von Apple fehlt noch“. „Später“ links unten.
2. **Fertig** („Dein Vault ist bereit“): Karten „Wenn du magst“: *Deine KI verbinden*, *Bei GitHub sichern*, *Kurze Probe*. Jede öffnet den früheren Schritt als Karte
   mit „Zurück“/„Fertig“. Hauptknopf „Studio öffnen“.

Im Code bleibt die Zustandsmaschine (`EinrichtungsZustand`, `EinrichtungsAblauf`) mit allen sechs Schritten; sichtbar sind nur die Hauptschritte `git`, `vault`
(`EinrichtungsSchritt.istHauptschritt`). Ab git und Vault gilt der Assistent als durchgelaufen (`grundeingerichtet`, `einrichtung.json` → `abgeschlossen`), die übrigen
Schritte laufen als Karten (`ladeKarten()` liest GitHub-Konto, Sicherung und gefundene KI-Programme im Hintergrund; die Probe läuft erst beim Öffnen ihrer Karte).

Alle bisherigen Funktionen bleiben erreichbar: Menü „Kortex einrichten …“ (öffnet bei vorhandenem Vault direkt das Abschlussbild mit den Karten), Studio → Einstellungen
(KI-Konten, Remote, Sicherung).

### Studio

- **Dialoghülle** (`hilfen.js`/`dialoge.css`): Neue Notiz, Schnell merken, Änderungen sichern, Remote hinzufügen, Gesundheit, KI-Nutzung, Lizenzen, Tastenkürzel nutzen dieselbe
  Hülle mit Titel, einem Satz und einem Hauptknopf rechts. KI-Konten, Abgleich/Konflikt und der Willkommen-Ablauf haben eigene Inhalte, übernehmen aber dieselben Maße (`.dialog`).
- **Willkommen im Studio**: ein Hauptweg (Vorlage) plus Gruppe „Andere Wege“; Inhalte und Tastatur (Pfeile, Home/End) unverändert.
- **Leere Zustände**: siehe Prinzip 6.
- Felder, Responsiv und Statusleiste gehören zu `feat/ui-runde2`; hier wurde nur die Hülle (Kopf, Satz, Fußleiste) angefasst.

## 5. Prüfung

- Swift: `EinrichtungsZustandTests`, `EinrichtungsAblaufTests` (angepasst: nach dem Vault gilt die Einrichtung als fertig; neue Tests für Karten).
- Studio: Playwright-Specs (`willkommen`, `lizenzen`, `studio`, `v2`, `verlauf`, `git-oberflaeche` u. a.) laufen unverändert; Bilder vorher/nachher hell und dunkel.
- Bilder: SwiftUI per `NSHostingView` offscreen, Studio per Playwright, jeweils hell und dunkel (Ablage im Scratchpad, nicht im Repo).
