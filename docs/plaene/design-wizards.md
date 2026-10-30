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

## 6. Design-System v2 (P1)

Stand: 30.10.2026 · Branch `feat/design-fundament` · Paket P1 „Fundament“ aus `UMSETZUNG.md` des freigegebenen Prototyps (Orca-Niveau; Einrichtung und Hauptfenster).
Hier geht es nur um das **Fundament** (Tokens, Schrift, Bausteine, Optik der bestehenden Flächen). Die Struktur des Hauptfensters (P3) und der neue Einrichtungs-Assistent (P2)
folgen und bauen auf diesen Tokens auf.

**Herkunft.** Orca (MIT, Copyright (c) 2026 Lovecast Inc.), gelesen am Commit `9bccd6795593abbe47dfebc7c2df5393712ce69c` (30. Oktober 2026), Dateien
`src/renderer/src/assets/main.css`, `docs/STYLEGUIDE.md`, `components/ui/{button,input,switch,toggle-group,badge,dropdown-menu,command,dialog}.tsx`,
`assets/text-shimmer.css`. Übernommen sind Werte und Regeln, von Hand nachgebaut; kein Quelltext, keine Grafik, kein Name. Der Lizenztext steht in `THIRD-PARTY-NOTICES.md`,
an den Stellen im Code steht ein kurzer Herkunftskommentar (`studio/studio.css` Kopf, `studio/bausteine.css` Kopf, `studio/dialoge.css`, `studio/aufgaben.css`).

| Bereich | Wert | Quelle in Orca | Token in Kortex (`studio/studio.css`) |
|---|---|---|---|
| Flächen hell | Canvas `#fff`, Seitenleiste `#fafafa`, Muted `#f5f5f5`, Hover `#f4f4f5`, Active `#ececed` | `main.css` `:root` | `--papier`, `--seite`, `--seite-2`, `--hover`, `--hover-2`, `--erhoben` |
| Flächen dunkel | `#0a0a0a`, `#121212`, Card `#171717`, Muted `#222`, Hover `#1f1f1f`, Active `#2a2a2a` | `main.css` `.dark` | dieselben Tokens (`light-dark()`) |
| Text | `#0a0a0a` / `#fafafa`; gedämpft `#737373` / `#a1a1a1`; **tertiär `#8c8c8c` / `#787878`** (eigene Anhebung) | `--foreground`, `--muted-foreground` | `--text`, `--text-2`, `--text-3` |
| Ränder | `#e5e5e5` hell; dunkel weiß 7 % (Rand) und 13 % (Feld, stark) | `--border`, `--input` | `--linie`, `--linie-stark`, `--eingabe` |
| Radien | `--radius: 0.625rem` und die Faktoren 0,6 / 0,8 / 1 / 1,4 / 1,8 → 6 / 8 / 10 / 14 / 18 px | `@theme inline` | `--r-s`, `--r`, `--r-l`, `--r-xl`, `--r-2xl` |
| Höhenstufen | Haarlinie, `shadow-xs`, `shadow-floating` (0 10 24), Dialog/Palette (0 20 60) | `main.css`, `STYLEGUIDE.md` („Radius and elevation“), `ui/command.tsx` | `--schatten-klein`, `--schatten-float`, `--schatten-dialog`, `--dialog-rand` |
| Auswahl in Listen, Baum, Palette, Menüs | Vordergrund 7 % eingemischt (dunkel `#2c2c2c`) + innerer Ring 14 % / 12 % — **keine Akzentfläche** | `.jump-palette-item[data-selected]` | `--auswahl`, `--auswahl-ring` |
| Schrift | Geist, `letter-spacing: .01em`, Skala 14 / 13 / 12 / 11, Kategorien 11 px Großbuchstaben `.05em` | `@layer base`, `STYLEGUIDE.md` („Typography“) | `--schrift`, `--mono` (Geist Mono), `body` |
| Bewegung | 180 ms `cubic-bezier(.16,1,.3,1)` (Auf-/Zuklappen, Hover), 120 ms schnell, Layout 760 ms `(.22,1,.36,1)`, Dialog/Palette zoom 96 % + Einblenden | `main.css`, `OnboardingFlow.tsx` | `--ease-out`, `--ease-flow`, `--d-fast`, `--d`, `--d-layout`, `@keyframes zoom` |
| Knöpfe, Felder, Schalter, Segmente | Knopf outline = Rand + Karte + xs-Schatten; Feld 32 px, Fokus Rand Akzent 55 % + 3-px-Ring 38 %; Schalter 32 × 18 (Knauf 14); Segment = gedämpfte Fläche mit Rand, Wahl als Karte | `ui/button.tsx`, `input.tsx`, `switch.tsx`, `toggle-group.tsx` | `bausteine.css` (`.knopf`, `.bs-feld`, `.bs-schalter`, `.bs-segment`) |
| Text-Schimmer (laufende Vorgänge) | Verlauf 110°, 2 s linear | `assets/text-shimmer.css` (Quelle shadcn/ui, MIT) | `.bs-text-schimmer` (neu geschrieben) |

**Eigen (nicht aus Orca).** Kortex-Lila bleibt die einzige Akzentfarbe (`--akzent` hell `#5b4ed6` / dunkel `#a89fff`, `--akzent-hover`, `--akzent-tinte` für Text auf weicher
Akzentfläche); Zustandsfarben (grün, gelb, rot) bleiben die der App; Symbole bleiben das eigene Set (`symbole.js`).

**Schrift.** Geist und Geist Mono (SIL OFL 1.1, schon in den Hinweisen) liegen jetzt auch unter `Ressourcen/studio/vendor/fonts/` und werden per `@font-face` mit relativer URL geladen
(Content-Security-Policy `font-src 'self'`; nichts von außen). Standard im Studio, im Editor und für Code.

**Kontrast** (Test `Tests/Oberflaeche/tokens.spec.mjs`, gemessen in der echten Oberfläche, hell und dunkel): `--text` ≥ 4,5:1 auf Papier, Seite, Karte, Hover und Auswahl;
`--text-2` ≥ 4,5:1 auf Papier, Seite und Karte (hell 4,74 / 4,54 / 4,74); **`--text-3` ≥ 3:1** auf Papier, Seite, Karte und Hover (hell 3,36 / 3,22 / 3,36 / 3,06, dunkel 4,48 / 4,24 / 4,06 / 3,73);
Akzent als Text und Text auf Akzentfläche ≥ 4,5:1. Der alte Wert `--text-3 #a09d96` lag bei etwa 2,7:1.

**Was sich sichtbar ändert.** Neutrale Graustufen statt warmer Grautöne; Geist statt der Systemschrift; die gewählte Zeile (Seitenleiste, Baum, Notizliste, Palette, Menüs) ist grau mit feinem Ring
statt Lila-Fläche; Notizliste als einzelne abgerundete Zeilen ohne Trennlinien; Menüs, Toasts und Palette als deckende Karten mit Höhenstufen (Toast jetzt unten rechts, Eintritt von rechts);
Dialoge und Palette erscheinen per Zoom; Aufgaben-Board mit Spalten (Radius 14) und Karten (Radius 10); Statusleiste 28 px. **Unverändert:** Struktur, Funktionen, Tastenkürzel, Maße der Spalten (P3).

**Prüfung.** Alle Playwright-Specs (angepasst nur dort, wo Farbwerte geprüft werden: Hintergrund dunkel `rgb(10, 10, 10)`, Chip-Text `#4c3fc6`, Fokusrand Akzent 55 %), neue Spec `tokens.spec.mjs`;
Bilder des echten Studios hell/dunkel vorher/nachher im Scratchpad (`ui-p1/`), verglichen mit dem Prototyp.
