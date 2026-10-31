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

## 7. Einstellungen als eigene Seite (P5)

Stand: 31.10.2026 · Branch `feat/einstellungen-geruest` · Paket P5 aus `UMSETZUNG.md` des freigegebenen Prototyps (`einstellungen.html`).

**Seite.** `studio/einstellungen.js/.css` (lädt bei Bedarf): ganzflächig über dem Studio (`#einstellungen-host`, das Studio dahinter ist `inert`), Seitenleiste 264 px mit den Gruppen Kortex / Wissen / Verbindungen / Mehr,
„Zurück zu Kortex“ (Esc), Suche (⌘F). Adresse `#einstellungen/<bereich>?ziel=<zeile>`; ein Sprungziel leuchtet 1,6 s auf. ⌘, öffnet die Seite (Hauptmenü „Kortex“ → „Einstellungen …“, Menüleiste, Zahnrad-Menü der Statusleiste);
ein natives Einstellungsfenster gab es nie, es entfiel also nichts. `StudioBefehl.einstellungenEintrag` hält Titel und Taste für beide Menüs und den Swift-Test.
Das Zahnrad-Menü der Statusleiste bleibt (Darstellung, KI, Vertrauen, Lizenzen …) und führt oben zur Seite.

**Register und Suche.** `studio/texte-einstellungen.js` ist das Register: Bereich → Abschnitt → Zeile `{ id, titel, text, woerter }` (Orca: title, description, keywords). `studio/einstellungen-suche.js` (reine Funktionen, in Node getestet)
wertet Bereichsname 900/850/800, Titel 700/650/600, Beschreibung 500/450/400, Stichwörter 300/250/200 (genau / beginnt mit / enthält), Umlaute und Groß/Klein egal, mehrere Wörter alle (150), höchstens 200 Zeichen.
Treffer werden markiert und je Bereich gezählt (Zähler in der Seitenleiste), Bereiche stehen nach ihrem besten Treffer; ohne Treffer gibt es „Keine Einstellung zu „…““ mit Vorschlägen.

**Speichern.** Kein Speichern-Knopf: Schalter, Segment, Menü, Regler und Listen schreiben sofort, Textfelder 700 ms nach der letzten Eingabe, beim Verlassen und beim Schließen (`einstellTextfeld`, `einstellPfad`, `einstellChips`,
`einstellRegler`, `einstellZeile`, `einstellAbschnitt` am Ende von `bausteine.js`).

**Route.** `GET/PUT /api/einstellungen` (`werkstatt/einstellungen.mjs`) führt zwei Speicher zusammen, ohne zweite Wahrheit: Werte eines Vaults über `kern/einstellungen.mjs` (`brain.config.json#automatik`, dieselbe Prüfung und Sperre wie
`brain einstellungen`), Werte der App in `<support>/einstellungen.json` (`gemeinsam/app-einstellungen.mjs`: Schriftgröße, Bewegung, Mitteilungswahl). `stand` = „<SHA-256 der Vault-Datei>.<SHA-256 der App-Datei>“; geprüft wird nur der Stand der berührten Speicher,
bei Abweichung 409 (art „konflikt“) und die Seite lädt neu und sagt es. Alles wird vor dem Schreiben geprüft (unbekannt/Typ/Bereich → 400, nichts geschrieben); Vault-Werte nur in einem vertrauten Vault (409 „nicht-vertraut“).
**Live:** `brain.config.json` im Vault und `einstellungen.json` melden dem bestehenden Ereignis-Strom `einstellungen` (eigene Schreibvorgänge ohne Echo); die Seite führt nach, ohne ein Feld zu stören, in dem gerade getippt wird.

**Bereiche.** Echt gefüllt: Allgemein, Darstellung (Thema, Schriftgröße, Bewegung, Textbreite), Mitteilungen (nur Schalter; die Mitteilungen selbst kommen mit P8), Vaults (Liste, Ordner/Themen ohne Lernen, Vertrauen), Pflege & Automatik, Sicherung & GitHub,
Datenschutz (ehrliche Aussagen, nichts Abschaltbares), Erweitert (MCP, Gesundheits-Schwellen, Gedächtnis-Pfade, Zurücksetzen), Über Kortex. Platzhalter mit Verweis auf die bestehende Ansicht: KI & Konten (zieht in P6 um),
Tastenkürzel (nur Anzeige, Editor ist P10); iPhone & iPad „bald“. Nicht umgesetzt, weil es dafür in der App noch nichts gibt: Autostart, Menüleisten-Symbol, Sprache, Update-Kanal, Akzentfarbe, Dichte.

**Befund aus P1 (Geist ist breiter).** Verlauf-Panel: Tageskopf und „Ungesicherte Änderungen“ brechen um statt mit „…“ zu enden, der Autor entfällt in der schmalen Spalte (`verlauf.css`). Statusleiste: ab 1180 px verlieren Verlauf,
KI-Nutzung und Gesundheit ihre Beschriftung, lange Vault-Namen werden gekürzt — vorher schob ein langer Name das Zahnrad aus dem Fenster (`studio.css`). Getestet bei 1100/1000/900 px.

**Prüfung.** `Tests/Node/einstellungen-route.test.mjs` (Route, Konflikt, Validierung, Vertrauen, Live-Ereignis), `einstellungen-suche.test.mjs` (Wertung, Markierung, null Treffer), `Tests/Oberflaeche/einstellungen.spec.mjs`
(jeder Bereich hell/dunkel, Speichern, Konflikt, Live, Suche, Tastatur, Sprungziel, Vertrauen, enge Fenster, P1-Befund), Swift-Test für ⌘,.

## 8. Einrichtungs-Assistent im Studio (P2)

Stand: 30.10.2026 · Branch `feat/assistent-studio` · Paket P2 aus `UMSETZUNG.md` des Prototyps. **Ein** Assistent statt zweier Masken: Er lebt als Studio-Seite
(`Ressourcen/studio/einrichtung.html`, `einrichtung.js`, `einrichtung.css`, Bühne in `einrichtung-buehne.js`, KI-Schritt in `einrichtung-ki.js`, Texte in `texte-einrichtung.js`)
und wird in einem eigenen Fenster ohne Titelleiste angezeigt (1120 x 720 Punkte, begrenzt auf den sichtbaren Bildschirm, echte Ampel, Zieh-Streifen oben).

**Schritte und Zustände.** Willkommen (selbstzeichnende Windung, stille git-Prüfung: bereit, fehlt, wird installiert, läuft nicht) · 1 Vault (neu, Beispiel, Ordner öffnen
mit Zählung und „zu breit“, von GitHub holen mit Adresse-Prüfung und Umweg über die Anmeldung bei privaten Repositories) · 2 Sicherung (Gerätecode mit Countdown, abgelaufen,
abgelehnt, kein Netz, GitHub nicht eingerichtet, schon gesichert, blockiert, Repository anlegen oder ein vorhandenes nehmen, „Nur auf diesem Mac“) · 3 KI (erkannte Programme mit
Schalter, Konto und Stufe, „Weitere Programme“ mit echten Logos, Rückfrage beim Umstellen, Befehl zum Kopieren bei Fehlern, Pflege-Konto bei „Erweitert“, nichts gefunden) ·
4 Fertig (Zusammenfassung mit „Ändern“, Probe-Suche mit Quellen, Studio öffnen). Tastatur: ↩ (nicht im Textfeld), ⌘↩, ⌘[, 1–4, Pfeile, Esc (Später-Rückfrage).
`prefers-reduced-motion` schaltet Gleiten, Kreisen, Fließen und Schimmer ab. Die Windung ist zusätzlich die Fortschrittsanzeige (Idee aus Prototyp B): ein Punkt wandert je Schritt eine Bahn weiter.

**Was in Swift bleibt** (Aktionskanal `aktion`, Prüfung in `AppAktion`): `git-pruefen`, `git-installieren`, `ordner-waehlen` (mit Zählung und Breite-Prüfung), `extern`, `kopieren`,
`einrichtung-ende` (fertig/später, schreibt `einrichtung.json`, öffnet das Studio), `einrichtung-oeffnen` (Menü, Studio ohne Vault). Alles andere läuft über die vorhandene API.

**Bewusst anders als im Prototyp.** Der Schalter „Automatisch sichern“ fehlt (es gibt keine solche Einstellung; die tägliche Pflege gleicht ab, das steht dort stattdessen). „Hierher ziehen“
fehlt (eine WebView bekommt von einem gezogenen Ordner keinen Pfad). Die Probe ist eine echte Suche über den MCP-Weg der KI mit den Fundstellen als Chips, keine erfundene Antwort; beim
Apple-Installer steht kein Prozentbalken (er meldet keinen Fortschritt), sondern ein unbestimmter. KI-Auswahl: Übergangsvariante mit `ki-logos.js`, bis der Baustein „KI-Auswahl“ aus
`feat/ki-katalog` auf main ist.

**Vertrauen und Sperren (Review).** Der Assistent vergibt nie Vertrauen: „Ordner öffnen“ öffnet den Ordner, ob er „dein Vault“ ist, fragt wie bisher das Studio; der Schalter dort betrifft nur den Versionsverlauf. Eine KI-Stufe geht nur als „ausdrücklich“ an die Werkstatt, wenn du sie selbst angeklickt hast; die Vorbelegung kommt aus `GET /api/ki/konten` (Stufe des Kontos in diesem Vault), ein vom Nutzer gesperrtes Konto bleibt gesperrt. „Zusätzlich, wenn du möchtest“ (Hooks, Prüfung vor dem Speichern, Hintergrunddienst), „Trennen“ und „Konfiguration kopieren“ sind zurück, über dieselben Routen wie die Einstellungen (`/api/kern/stand|verdrahten`, `/api/mcp/trennen|konfiguration`). Die Pflege-Zeile im Schritt „Fertig“ kommt aus `GET /api/ki/pflege` (`dienst.fuerVault`). Aus dem Einrichtungsfenster öffnet `extern` nur https auf github.com; git, Zwischenablage und „Ende“ gelten nur dort.

## 9. Hauptfenster (P3)

Stand: 31.10.2026 · Branch `feat/hauptfenster` · Paket P3 aus `UMSETZUNG.md` des Prototyps (`app.html`, Bilder `a1`–`a8`). Gestaltungswerte wie in §6; neu ist nur die **Struktur**. Alles, was das Studio vorher konnte, bleibt
(alle Ansichten, Palette, Editor, Eigenschaften, Verlauf, Aufgaben-Board, Posteingang, Live-Aktualisierung, Hinweis zur Umstellung, Vertrauen); verschoben ist nur, wo es steht.

**Raster.** `#app` ist ein Grid: Seitenleiste und rechte Spalte über die ganze Höhe, dazwischen die **Kopfzeile** (44 px, `#kopf`) über Liste und Editor, darunter Liste und Editor, unten die Statusleiste (28 px).
Spaltenbreiten setzt weiter `app.js` (`--b-seite`, `--b-liste`, `--b-info-voll`, neu `--b-frage`); `--b-rechts` ist die Breite der rechten Spalte je nach Zustand. Die Dateien: `hauptfenster.css` (neu), `ki-zeile.js` (neu), Anpassungen in `studio.css`, `frage.css`, `aufgaben.css`.

| Bereich | Vorher | Jetzt |
|---|---|---|
| Kopf des Editors (`.werkzeug`) | Zeile im Editor: Brotkrumen, Frag, Werkzeuge, Eigenschaften | entfällt; **Kopfzeile** `#kopf`: links Brotkrumen (`#pfad`; im Board und ohne Notiz der Name der Ansicht), Mitte Suchfeld „Suchen oder Befehl … ⌘K“ (öffnet die Palette), rechts Status der Notiz, Speicherstand, Notiz-Werkzeuge (`#werkzeuge`: Favorit, Rohtext, Breite, Gliederung), Verlauf (`#knopf-verlauf`), Eigenschaften (`#knopf-info`, Symbol Seitenleiste), „Frag“ (`#knopf-frage`) |
| Seitenleiste oben | Vault-Wechsler; „Neu“ und „Schnell merken“ als Knöpfe unten | Vault-Wechsler (wechseln, hinzufügen/öffnen, entfernen) und darunter das Feld **„Schnell erfassen ⌥ Leer“** (`#fuss-merken`, öffnet den Merken-Dialog) mit Stift-Knopf für „Neue Notiz“ (`#fuss-neu`) |
| Bereiche | Posteingang, Aufgaben, Rückfragen, Alle Notizen, Wissen, Archiv | Posteingang (Zähler in Akzent), Alle Notizen, Aufgaben (⌘1 ⌘2 ⌘3), Rückfragen (nur wenn offen), **Frag deinen Vault**; Wissen und Archiv unter „Sichten“ |
| Favoriten | eine Zeile | die Zeile „Favoriten“ (alle in der Liste) und darunter bis zu fünf Notizen zum direkten Öffnen |
| Unten in der Seitenleiste | – | **KI-Zeile** („3 KIs · 1 braucht dich“ mit Logos): Zahl = KI-Programme, die Kortex auf diesem Mac erkannt hat (`GET /api/ki/erkennen`, nur lesend; bewusst **nicht** `/api/ki/konten`: das gleicht beim Lesen die Konten-Liste ab und legt Konten an, das darf ein Start nicht auslösen), „braucht dich“ = offene Rückfragen im Vault; Anmeldungen rät sie nicht. Klick: KI & Konten, ohne KI „KI verbinden“ |
| Frag deinen Vault | Panel über der rechten Spalte (fest, mit Animation „ein“) | **rechte Spalte**: gleitet in 280 ms herein, schiebt den Editor beiseite, wenn er danach mindestens 400 px hat (`data-frage-modus="schiebt"`), sonst liegt es mit Schatten darüber (`"deckt"`). Der Knopf „Eigenschaften“ holt die Eigenschaften zurück und schließt Frag. Die Frag-Logik (`frage.js`) ist dieselbe; neu: `oeffneMit(text)` |
| Palette | Notizen, Befehle | wie der Prototyp: „Zuletzt geöffnet“, Symbole, Tasten als Chips, Esc-Chip, Fußzeile mit den Tasten; **Ausweg „Frag deinen Vault: „…““** unter den Treffern, **⌘↵** öffnet Frag mit dem getippten Text im Feld (gesendet wird erst nach deinem Klick auf „Fragen“) |
| Statusleiste | Vault, Version, Zweig, Remote, Abgleichen, Änderungen, Verlauf … | Abgleichen, Änderungen, Verlauf, Zweig/Remote, Ort des Vaults (`~/…`), Version; rechts **Platz für P7** (`[data-st="platz-kontingent"]`, leer und unsichtbar, Kommentar „SLOT P7“ in `zeichneStatus`), **Wörter**, **Format** („Markdown“), KI, Gesundheit, Nutzung, Darstellung, Einstellungen |

**Tastatur.** ⌘1 Posteingang, ⌘2 Alle Notizen, ⌘3 Aufgaben · ⌘K Palette · ⌘J Frag · ⌘\ Eigenschaften ein/aus (wie ⌘⌥I; der Prototyp hat keine zweite einklappbare Seitenleiste) · ⌘N, ⌘⇧M, ⌘⇧A, ⌘⇧F, ⌘/ unverändert.
Esc schließt Frag, wenn der Fokus im Panel oder nirgends ist (wie vorher).

**Bewegung.** Nur die rechte Spalte gleitet (Klasse `glatt` am `#app` für 360 ms, damit Ziehen und Fenstergröße nicht nachlaufen); „Bewegung reduzieren“ (System oder Einstellung) schaltet sie ab, das Panel ist dann sofort da und weg.

**Enge Fenster.** Kopfzeile ≤ 980 px: nur die letzte Brotkrume, Status als Punkt, Speicherstand als Häkchen; ≤ 820 px: Suchfeld und „Frag“ nur als Symbol. Statusleiste: Format ab 1180 px, Wörter und Ort ab 960 px ausgeblendet. Getestet bei 1100 und 1180 px (nichts läuft über).

**Bewusst offen.** KI-Vorschlag als Block im Editor, Mitteilungs-Glocke (P8) und Konto/Kontingent (P7) kommen mit ihren Paketen; für P7 steht der Platz bereit. Das Board behält seinen eigenen Kopf (Titel, Erfassen, Filter).
Die Konfliktansicht (PR #73) hängt sich an Statusleiste und Banner (`#banner-host`), die es weiter gibt.

**Gefunden und behoben.** Das Frag-Panel schrieb bei nur einem erlaubten Konto das Wort „null“ ins Formular (`replaceChildren(null)`); jetzt gefiltert.

**Prüfung.** `Tests/Oberflaeche/hauptfenster.spec.mjs` (Aufbau, KI-Zeile, Tastatur, Gleiten, reduzierte Bewegung, Palette mit Ausweg, Favoriten, Board, leerer Vault, hell/dunkel mit Kontrast, 1100/1180 px, 1440 px); angepasst nur die Reihenfolge in `aufgaben.spec.mjs`.
Bilder im Scratchpad (`ui-p3/`), verglichen mit den Prototyp-Bildern `a1`–`a7`.

## 10. Bewegung und Feinschliff (P4)

Stand: 31.10.2026 · Branch `feat/bewegung` · Paket P4 aus `UMSETZUNG.md` (Abschnitt 7, Prinzip „Bewegung mit Bedeutung“ aus Prototyp B). Gestaltungswerte der Kurven und Dauern weiter wie in §6 (Orca, MIT, siehe dort);
neu ist **ein** Bewegungssystem, das alle Flächen benutzen, und die Bewegungen, die etwas erklären. Dateien: `studio.css` (Tokens), `bewegung.css` (Stile), `bewegung.js` (Helfer, Ruhenetz, Scrollkanten, Tooltips), `windung.js` (Zeichen und Ladeanzeige),
Anpassungen in `app.js`, `frage.js`, `aufgaben.js`, `einrichtung*.js`, `einrichtung-buehne.js`.

### Ein Bewegungssystem

| Token | Wert | Wofür |
|---|---|---|
| `--d-1` | 120 ms | Rückmeldung: Hover, Fokus, Drücken, Schließen von Popovers |
| `--d-2` | 200 ms | Einblenden, Aufklappen, Karten, Listen, Tooltips |
| `--d-3` | 280 ms | Flächen: Spalten, Frag-Panel, Ansichtswechsel, Landen einer Karte |
| `--d-4` / `--d-5` / `--d-6` | 480 / 760 / 1600 ms | Auftritte der Bühne im Assistenten · Szenenwechsel · Hervorheben (Leuchten einer neuen Karte) |
| `--ease-out` | `cubic-bezier(.25, 1, .5, 1)` (ease-out-quart) | Standard für alles; `--ease` und `--ease-flow` sind Alt-Namen darauf |
| `--ease-feder` | `linear(…)` (echte Feder, Safari ab 17.2 / Chromium ab 113), sonst `cubic-bezier(.34, 1.45, .64, 1)` | Landen von Karten, Zähler, Flug |
| `--ease-in` / `--ease-lin` | `cubic-bezier(.5, 0, .75, 0)` / `linear` | Abgang · Dauerläufer |
| `--d-dreh` / `--d-puls` / `--d-schimmer` | 0,8 s / 1,6 s / 2 s | Dauerläufer (Ladeanzeigen, Skelett, Text-Schimmer) |

Alle festen Zeiten in den Stilen (Animationen und Übergänge in elf CSS-Dateien) sind auf diese Tokens umgestellt; die Alt-Namen `--d-fast`, `--d`, `--d-panel`, `--d-layout`, `--t` zeigen auf sie. JavaScript liest dieselben Tokens
(`bewegung.js`: `dauer("--d-2")`, `kurve("--ease-feder")`), nie eigene Zahlen.

**Bewegung reduzieren.** Die Systemeinstellung (`prefers-reduced-motion`) und der Schalter in Einstellungen → Darstellung (`data-bewegung="reduziert"`) wirken gleich: alle Dauer-Tokens 0 ms, `animation`/`transition: none !important`, JS-Helfer tun nichts
(`ruhig()`). Regeln, die bisher nur die Systemeinstellung kannten (Skelett, Knopf im Ladezustand, Text-Schimmer, Popover, Live-Rahmen), gelten jetzt auch für den Schalter (`bewegung.css`, „Spiegel“). Einzige Ausnahme sind drei **Lebenszeichen**:
die laufenden Ladeanzeigen (Drehkringel im Knopf, `rm-spinner`, die Windung) — die Windung steht dann ruhig da und atmet nur leise.

**Inhalt hängt nie an einer Animation.** WebKit pausiert Animationen und `requestAnimationFrame`, wenn das Fenster nicht sichtbar ist; ein Einblenden mit Deckkraft 0 am Anfang bliebe dann stehen (Fehler aus der Vorschau: Startbild des Assistenten leer, bis man ins Fenster klickte).
Gegenmaßnahmen: (1) **Ruhenetz** (`ruhenetz()`, in Studio und Assistent): alle 500 ms und bei Sichtbarkeits-/Fokuswechsel prüft es endliche Animationen; kommt eine nicht voran (oder ist das Dokument verborgen), setzt es sie zu Ende — der Endzustand ist immer der normale Stil.
(2) Nichts wartet auf `animationend`/`transitionend`: Aufräumen und Folgeschritte laufen über Timer (Flug, Zuklappen, Landen). (3) Die rAF-Pfade im Assistenten (`windungFortschritt`, `linienBald`) setzen den Endstand zusätzlich per Timer.
Getestet mit pausierten Animationen (Init-Skript `animation-play-state: paused`) und einer Gegenprobe ohne Netz (dort bleibt der Hero bei Deckkraft 0).

### Was sich wo bewegt (Bewegung mit Bedeutung)

| Wo | Bewegung | Technik |
|---|---|---|
| Schnell erfassen → Posteingang | Die erfasste Notiz fliegt als kleine Marke (Titel) vom Dialog in den Posteingang der Seitenleiste; bei Ankunft hüpft der Zähler (federnd). Steigt der Zähler aus anderem Grund (Live-Ereignis, MCP), hüpft er sofort. | `fliege()`, `huepfe()` (Web-Animation, `transform`/`opacity`); Ankunft per Timer |
| Frag: Antwort | Wort für Wort: neue Wörter blenden gestaffelt (höchstens 180 ms) ein; der Text steht sofort im DOM, nichts wird zurückgehalten (kein Fake-Tippen). Schon gezeigte Wörter bleiben still. | `worteEinblenden()` auf dem fertig gebauten Markdown-Baum, nur Deckkraft |
| Board | Karten beim Ziehen: Nachbarn gleiten (FLIP, `--d-2`); beim Loslassen schwebt die Karte federnd in die Lücke (`--ease-feder`), federt kurz nach und der Spaltenzähler hüpft | `aufgaben.js`, `lande()`, `huepfe()` |
| Listen (Notizliste, Posteingang) | Neue Einträge blenden ein (gestaffelt, höchstens 6), verschwundene klappen in der Höhe zu und blenden aus (stille Hülle ohne `data-karte`, räumt per Timer auf); beim Wechsel der Sicht keine Einzelanimation | `listenUebergang()` in `app.js`, `blendeEin()`, `klappeZu()` |
| Ansichtswechsel | Notizen ↔ Aufgaben ↔ Posteingang blendet über 200 ms ein, ohne Versatz (nur Deckkraft, kein Layout-Sprung) | `weicherWechsel()`, `ansicht-ein` |
| Rechte Spalte, Palette, Dialoge, Popover, Toast | wie bisher, jetzt aus den Tokens (280 / 200 / 200 / 180–120 / 200 ms) | CSS |
| „Frag deinen Vault“ lädt, Abgleich läuft | Die **Windung** (Zeichen des Logos, eine Linie in sechs Bahnen) als Ladeanzeige: feine Spur, ein Lichtstreifen läuft hindurch; statt des Drehkringels | `windungLaden()` (`windung.js`), `.windung-laden` |

### Feinschliff

- **Zustände einheitlich:** Hover, Drücken (`:active`, `--hover-2`; Symbolknöpfe zusätzlich `scale(.94)`) und Fokusring (2 px Akzent) für Knöpfe, Seitenleiste, Listen, Palette, Baum, Statusleiste aus einer Regel; gleiche Übergangsdauer `--d-1`.
- **Keine Sprünge beim Laden:** erste Ladung zeigt Platzhalter (Liste sechs Karten, Seitenleiste fünf Zeilen) an der Stelle des Inhalts, erst nach 150 ms sichtbar (kein Flackern bei schnellen Ladungen); gemessen CLS beim Start 0,009.
- **Scrollkanten:** Seitenleiste, Notizliste, Eigenschaften, Frag, Palette, Board-Spalten laufen dort, wo es weiter geht, mit 18 px Verlauf aus (`data-kanten` → `data-kante`, Maske).
- **Tooltips:** jeder Symbolknopf mit `title` zeigt den eigenen Tooltip (500 ms bei Maus, sofort bei Tastaturfokus) statt des trägen System-Tooltips; das `title` kehrt danach zurück, der zugängliche Name (`aria-label`) bleibt.
- **Statusleiste ohne Doppelungen:** KI steht nur einmal: ohne Konto der einzige Knopf „KI verbinden“ (der leere Konto-Platz ist ausgeblendet), mit Konto nur Konto und Kontingent (der Eintrag „KI verbinden“ ist per CSS weg); der lokale Stand heißt „Keine Änderungen“ statt zweitem „Alles gesichert" neben dem Abgleich-Stand; Test: jede Angabe der Leiste kommt genau einmal vor.
- **Leere Zustände** gleichen Aufbau (Symbol in Kachel, Titel, ein Satz, höchstens eine Aktion); kleine Hinweise zentriert.
- **Kein „null“/„undefined“:** Prüfung des sichtbaren Texts in Liste, Posteingang, Board, Notiz, Frag, Palette (Test).
- **Schmale Fenster:** einzeilige Texte (Seitenleiste, Kopf, Karten, Statusleiste) kürzen statt umzubrechen; getestet bei 1000 px.

### Leistung

Es bewegen sich nur `transform` und Deckkraft (Ausnahmen: die Höhe der einen zuklappenden Hülle für 200 ms; der Lichtstreifen der Windung ist ein Strich-Versatz an einem winzigen SVG). Lange Listen: Karten in Stücken zu 40 (vorher 120) und `content-visibility: auto`
mit gemerkter Höhe — nicht Sichtbares wird nicht gezeichnet. Gemessen mit Playwright (Chromium, Headless; `bewegung.spec.mjs`, Test „Bildzeiten“, 5.000 Notizen):

| Messung (150 bzw. 70 Bilder) | Mittel / p95 | Schlechtestes Bild |
|---|---|---|
| Scrollen der Notizliste, 5.000 Notizen, 90 px je Bild | 17,5 ms / 16,7 ms | einzelne Ausreißer 33–100 ms (Headless-Rauschen und Nachladen eines Stücks) |
| Frag öffnen und schließen (280 ms Gleiten) | – / 16,7 ms | 16,8 ms |
| Palette öffnen und schließen | – / 16,8 ms | 16,8 ms |
| CLS beim Start / über Start, Posteingang, Board, Alle Notizen, Frag | 0,009 / 0,009 | – |

Grenzen der Messung: Chromium im Headless-Betrieb (60-Hz-Takt, Software-Zeichnen), nicht WKWebView; Intel-Macs sind nicht gemessen. Die Werte sind eine Untergrenze für Regressionen (die Tests verlangen p95 < 34 ms, schlechtestes Bild < 150 ms),
keine Zusage für ältere Hardware. Der Vergleich ohne `content-visibility` und ohne Scrollkanten-Maske zeigte im Headless-Test keinen Unterschied; beides bleibt, weil es nur Arbeit spart.

### Gefunden und behoben

- **Startbild des Assistenten hing an Animationen** (Fehler aus der Vorschau): `.e-hero > *` und das sich zeichnende Zeichen starten mit Deckkraft 0 bzw. leerem Strich und warten auf die Animation; in einem Fenster, das WebKit nicht sichtbar findet, kam sie nie.
  Jetzt Ruhenetz plus Timer-Endstände (siehe oben); Test mit pausierten Animationen und Gegenprobe.
- **Skelett unsichtbar bei „Bewegung reduzieren“ (Einstellung):** die Regel dafür kannte nur die Systemeinstellung; jetzt gespiegelt.

### Prüfung

`Tests/Oberflaeche/bewegung.spec.mjs` (Tokens; reduzierte Bewegung als System- und als App-Einstellung über Liste, Palette, Frag, Board, Posteingang, Erfassen: alle Dauern 0 ms, keine laufende endliche Animation; Ruhenetz im Studio und im Assistenten bei pausierten Animationen samt Gegenprobe; Wort für Wort;
CLS beim Start und beim langsamen Laden; Flug und Zähler; Liste ein/zu; Board-Landung; Windung bei Abgleich und Frag; kein „null/undefined“ und kein Überlauf/Umbruch bei 1000 px; Tooltips; Bildzeiten mit 5.000 Notizen; Bilder hell/dunkel),
`frage.spec.mjs` (Wörter blenden beim Streaming ein), angepasst `tokens.spec.mjs` und `ui-runde2.spec.mjs` (neue Dauern). Bilder im Scratchpad (`ui-p4/`).
