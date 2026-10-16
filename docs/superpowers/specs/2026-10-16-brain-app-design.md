# Brain-App — Design-Spezifikation v1

- **Stand:** 16.10.2026 · **Status:** Entwurf zur Freigabe durch Fabio
- **Arbeitstitel:** „Brain“ (endgültiger Name wird vor der Verteilung an Kollegen entschieden, siehe §15)
- **Grundlagen:** Brainstorming 12.10. (Teil 1–3) und 16.10. (Teil 3 komplett, Teil 4), Recherche
  `~/brain/00_inbox/2026-10-16_brain-app-recherche.md` und `…/2026-10-16_brain-aufbau-beste-quellen.md`,
  bestehendes Kit (`fbrogno/second-brain-kit`, v0.5.0)
- **Nachtrag 16.10.2026 (nach M1):** Zielgruppe Fabio + Kollegen (§2) · Kern v2 um K11–K15 erweitert, K2 korrigiert
  (§12.2) · Alltags-Wirkung als Messung (§13.2) · Meilenstein „Erlebnis & Design“ vorgemerkt (§14). Grundlagen:
  Auswertung von 193 eigenen Sitzungen, Web-Recherche Schmerzpunkte 2026, Prüfung der Claude-Code-Hook-Doku
  (Stand v2.1.302).

---

## 1. Zweck und Versprechen

**„Ein Wissen, dem deine KI trauen kann — und jede KI fragt es gratis ab.“**

Die App macht das bestehende Second Brain (Karpathy-Muster: Rohquellen → KI-gepflegtes Wiki → Schema) für
jeden Mac-Nutzer (zunächst: Fabio und Kollegen, §2) mit wenigen Klicks nutzbar und hält es im Hintergrund sauber. Drei Säulen:

| Säule | Bedeutung | Woran man es misst |
|---|---|---|
| **Richtig** | Nichts Veraltetes oder Erfundenes gilt als wahr. Widersprüche entscheidet der Mensch. | Messlatte, Zitat-Treue des Autopiloten, offene Konflikte |
| **Vollständig** | Was in Sitzungen gelernt wird, landet im Brain. | Anteil eingearbeiteter Sitzungen, Lernschleife |
| **Effizient** | Abruf und Pflege kosten 0 Tokens; nur das Einarbeiten kostet, und das so wenig wie möglich. | Token-Zähler je Tag, gesparte Tokens in der Gesundheitsanzeige |

**Abgrenzung zum Wettbewerb:** Das Karpathy-Muster als Desktop-App gibt es bereits (nashsu/llm_wiki, Tauri,
~20k Sterne). Unser Alleinstellungsmerkmal ist die Kombination: 0-Token-Abruf per Hook in *jeden* Coding-Agenten
(Claude Code, Codex, Gemini CLI, Cursor) + Gültigkeit/Ablauf (`stand`, `pruefen_bis`) + Konflikte als
Mensch-entscheidet-Karten + Autopilot aus Sitzungen + sparsame native Mac-App ohne Server.

## 2. Rahmen

- **Plattform:** nur Apple Silicon (M1 und neuer), **macOS 26 oder neuer** (läuft auf allen M-Macs, kostenloses Update).
- **Zielhardware:** muss auf einem **M1 mit 8 GB RAM** flüssig laufen, während Claude Code und ein Browser offen sind.
- **Preis:** **komplett kostenlos**, kein Premium, keine Lizenzprüfung. Quelltext unter **MIT** (wie das Kit).
- **Ohne Server:** kein eigener Backend-Dienst, kein offener Netzwerk-Port, keine Telemetrie. Internet nur für
  optionale Dinge (§8).
- **Zielgruppe (Nachtrag):** Fabio und Kollegen aus der Firma — **jeder mit eigenem, persönlichem Brain**. Kein
  gemeinsames Firmen-Brain; Firmenwissen bleibt im Knowledge Collective (Brogno-MCP). Hauptnutzen der Verteilung:
  **einmal veröffentlichen → alle bekommen das Update** (App und Kit, §9.4). Priorität 1 bleibt Claude im Terminal
  (richtiges Wissen, 0 Tokens); die App ist der bequeme Zugang dazu.
- **Verteilung:** außerhalb des App Store, Developer-ID-signiert und notarisiert, DMG + Update-Feed (Quelle siehe §15).
- **Repo:** privates Repo unter dem GitHub-Account **fbrogno**; Veröffentlichung des Quelltexts ist kein Ziel mehr.

## 3. Nicht-Ziele v1

Handy (iPhone-Eingang per Kurzbefehl/iCloud oder Telegram, eigene iPhone-App) · Windows/Linux-App (das Kit läuft
dort weiter im Terminal) · Intel-Macs · Premium/Lizenzen · mehrere Brains gleichzeitig · Importe fremder Notiz-Systeme in der App
(Obsidian, Notion, Logseq — bleibt `brain import` im Terminal; das Startwissen in §9.1 ist davon ausgenommen) · eigenes lokales LLM ausliefern · Mac App Store.

Die Architektur lässt einen späteren Handy-Eingang zu: Er wäre nur eine weitere Quelle, die Dateien in die
Warteschlange (§5.3) legt.

## 4. Leitprinzipien

0. **Korrektheit vor allem.** „Lieber eine Lücke als ein Fehler.“ Bei jeder Abwägung gewinnt die Variante, die
   kein falsches Wissen erzeugt — vor Vollständigkeit, Token-Ersparnis und Bequemlichkeit. Verbindlich in §4a.
1. **Der Ordner ist die Wahrheit.** Das Brain ist ein normaler Ordner mit Markdown-Dateien und Git. Die App liest
   und schreibt nur dort; sie hat keine eigene Datenbank, die „mehr weiß“ als der Ordner. (Suchindex und Caches
   sind abgeleitet und jederzeit neu baubar.)
2. **Das Terminal hängt nie von der App ab.** Hooks, Suche und Skills funktionieren weiter, wenn die App
   geschlossen oder gelöscht ist.
3. **Kein Server.** Alles läuft lokal; jede Internet-Verbindung ist optional oder einmalig.
4. **0 Tokens, wo es geht.** Regelbasiert vor On-Device-Modell vor API (§6).
5. **Der Mensch entscheidet Strittiges.** Die KI löst Widersprüche nie still auf.
6. **Alles ist rückgängig zu machen.** Jede automatische Änderung ist ein eigener Git-Commit mit 1-Klick-Rücknahme.
7. **Sparsam per Verhalten.** RAM spart man nicht durch das Framework, sondern dadurch, dass nur läuft, was
   gerade gebraucht wird.

## 4a. Wahrheits-Regeln (verbindlich, jede Regel hat Tests in §13)

| # | Regel | Umsetzung |
|---|---|---|
| W1 | **Kein Fakt ohne Beleg.** | Jeder Fakt trägt ein wörtliches Zitat + Quelle; eine Regel prüft, dass das Zitat dort wirklich steht (Beleg per Commit-SHA/Quell-Hash statt nur Dateipfad; zu Großes wird abgelehnt, nicht gekürzt). Ohne Beleg wird nichts gespeichert. |
| W2 | **Herkunft entscheidet.** | Die Herkunft wird regelbasiert aus der Fundstelle des Zitats bestimmt: **du** (Nutzer-Nachricht) · **Tool** (Datei, Befehlsausgabe, Testergebnis) · **Web** (WebFetch/WebSearch-Ergebnis) · **KI** (nur Modell-Text). Du/Tool → kann Wissen werden. Web → nur Vorschlag. KI-Vermutung → wird nie Wissen, außer der Nutzer hat sie bestätigt. Vertrauen = Minimum aus Herkunft und Inhalt. |
| W3 | **Jeder Fakt hat eine Zeit.** | `stand`, neu `gilt_seit`; Veränderliches trägt `pruefen_bis`; ein korrigierter Fakt verdrängt den alten über neu `ersetzt_durch` (Historie bleibt, nie zwei gültige Versionen nebeneinander). |
| W4 | **Widerspruch = Stopp.** | Passt Neues nicht zu Bestehendem → Fragen-Karte. Nie stilles Überschreiben. |
| W5 | **Kritisches fasst der Autopilot nie an.** | Seiten mit `kritisch: true` (z. B. Server, Preise, Zugänge, Produktion) ändert nur der Mensch. |
| W6 | **Die KI sagt, wie sicher etwas ist.** | Hinweise liefern Stand und Zustand mit („Stand 05.10.“, ABGELAUFEN, PRÜFBEDÜRFTIG); `AGENTS.md` verpflichtet die KI, das bei der Antwort zu nennen. |
| W7 | **Fehler werden zum Signal.** | Korrigiert der Nutzer die KI direkt nach einem Brain-Hinweis („nein, das stimmt nicht“), wird die gehinweiste Seite regelbasiert als PRÜFBEDÜRFTIG markiert und eine Karte erzeugt (0 Tokens). |

**Folgen für den Betrieb:** Der Autopilot startet im Vorschlagsmodus (§6.2) · Zitat-Treue im Prüfset muss
100 % sein · die App zeigt einen Korrektheitswert aus dem Prüfset und den angenommenen/abgelehnten Vorschlägen.

## 5. Architektur

### 5.1 Überblick

```
┌──────────────────────── Brain.app (Swift, Menüleiste) ────────────────────────┐
│ Menüleisten-Symbol ✓⚠✕ · Fenster (WKWebView, brain://) · Einrichtung          │
│ Mitteilungen · Schlüsselbund · Sparkle-Updates · brain-fm (Apple-Modell)       │
└──────────────┬───────────────────────────────────────────────┬────────────────┘
               │ stdin/stdout (JSON-Zeilen), nur bei offenem    │ schreibt/lädt
               │ Fenster                                        │ LaunchAgent
               ▼                                                ▼
   Node-Prozess „Ansicht-Brücke“                  Hintergrunddienst (LaunchAgent)
               │                                   startet bei Arbeit, endet danach
               ▼                                                │
        ┌──────────── Kit im Brain-Ordner (.tools/, brain.mjs) ◄┘
        │  Suche · Lint · Index · Ernte/Autopilot · Pflege · Sicherung · Abgleich
        ▼
   Brain-Ordner (Markdown + Git)  ◄── Hooks aus Claude Code / Codex / Gemini / Cursor
        │
   ~/Library/Application Support/Brain/   (Node-Laufzeit, Warteschlange, Status, Logs)
```

### 5.2 Bausteine

Jeder Baustein hat genau eine Aufgabe und eine schmale Schnittstelle.

| # | Baustein | Aufgabe | Schnittstelle | Hängt ab von |
|---|---|---|---|---|
| 1 | **Brain.app** (Swift/SwiftUI, `LSUIElement`) | Menüleiste, Fenster, Einrichtung, Mitteilungen, Updates, Schlüsselbund | ruft `brain.mjs … --json`; liest `status.json` | Laufzeit (2), Kit (3) |
| 2 | **Laufzeit** | offizielles Node (arm64), im App-Paket mitgeliefert, beim ersten Start nach `Application Support/Brain/node/<version>/` kopiert; fester Aufrufpfad `…/Brain/bin/node` | Datei-Pfad | — |
| 3 | **Kit** (`.tools/` im Brain-Ordner) | die gesamte Logik (bestehend, ~50 Module) | CLI `brain.mjs <befehl> [--json]` | Laufzeit |
| 4 | **Ansicht-Brücke** | bedient die Web-Oberfläche, solange das Fenster offen ist | JSON-Zeilen über stdin/stdout; die Web-Oberfläche ruft `brain://api/…`, die App reicht es durch | Kit |
| 5 | **Hintergrunddienst** (LaunchAgent) | arbeitet die Warteschlange ab: Autopilot, Index, Lint, Sicherung/Abgleich | Dateien in `Application Support/Brain/queue/`; schreibt `status.json` | Kit, git |
| 6 | **brain-fm** (Swift-Hilfsprogramm im App-Paket) | Zugriff auf Apples On-Device-Modell | CLI, JSON rein/raus | macOS 26, Apple Intelligence |
| 7 | **Abgleich** (Teil des Kits) | GitHub-Sync über git-CLI | `brain sync --json` | git, Schlüsselbund-Zugang |

**Warum Swift statt Tauri** (Entscheidung 16.10.): Die App ist nur für Macs; Apples Modell, Mitteilungen,
Schlüsselbund, Speicherdruck und Sparkle sind in Swift direkt nutzbar; Tauri und WKWebView nutzen dieselbe
WebKit-Engine (kein belegter RAM-Vorteil); Tauri-Oberflächentests laufen auf macOS nicht; Erfahrung aus MacMonitor.

**Warum kein localhost-Server für die Oberfläche:** Die heutige Ansicht (`brain zeig`) startet einen HTTP-Dienst.
In der App lädt die Web-Oberfläche über ein eigenes URL-Schema (`brain://`, `WKURLSchemeHandler`); die App
reicht `brain://api/…`-Aufrufe als JSON-Zeile an die Ansicht-Brücke durch. Kein offener Port, keine
Angriffsfläche für andere Prozesse. `ansicht/api.js` bekommt eine dünne Weiche (Browser → HTTP wie bisher,
App → `brain://`), damit `brain zeig` im Terminal unverändert funktioniert.

### 5.3 Warteschlange und Status

- **Warteschlange:** `~/Library/Application Support/Brain/queue/` — ein Auftrag = eine kleine JSON-Datei
  (`<zeit>-<art>-<id>.json`, z. B. `art: sitzung` mit Pfad zum Transkript). Hooks (SessionEnd, PreCompact)
  legen Aufträge nur ab und kehren sofort zurück.
- **Status:** `status.json` (Zustand ✓/⚠/✕, letzter Lauf, Tokens heute, Budget, offene Karten, Dienst an/aus,
  letzter Fehler in Alltagssprache). Die App zeigt nur an, was dort steht.
- **Logs:** `Application Support/Brain/logs/` (rotierend, max. 5 × 1 MB).

## 6. Autopilot

### 6.1 Ablauf je Sitzung

```
SessionEnd-Hook → Auftrag in queue/ → Dienst startet
  Stufe 0 (regelbasiert, 0 Tokens):   Transkript zerlegen, bereits Gesehenes per Prüfsumme überspringen,
                                       Rauschen entfernen (Tool-Ausgaben, Code-Blöcke ohne Aussage)
  Stufe 1 (Apple-Modell, 0 API-Tokens): je Abschnitt (< ~2.000 Tokens) Fakten-Kandidaten mit
                                       {aussage, art, wörtliches_zitat}; danach Regel-Check (W1): Zitat muss
                                       wörtlich im Transkript stehen, sonst verworfen; Herkunft (W2) aus der
                                       Rolle der Fundstelle: KI-only → verworfen, Web → nur Karte
  Routing (regelbasiert, 0 Tokens):    betroffene Seiten per Suche, Entitäts-Aliasse und Index bestimmen
                                       (nicht per LLM); „ergänzen statt neu anlegen“; Seiten mit
                                       `kritisch: true` sind ausgeschlossen (W5)
  Stufe 2 (Haiku über `claude -p`):    nur die geprüften Kandidaten + betroffene Wiki-Seiten (per Suche):
                                       Änderungsvorschlag je Seite in einer Arbeitskopie (Git-Worktree)
  Prüfung (regelbasiert):              Lint + Schema + Secret-Riegel + Zitat-Bezug grün?
     ├─ Vorschlagsmodus (Start):       Änderung wird als Vorschlags-Karte angezeigt (Diff in Alltagssprache)
     └─ Freigeschaltet:                sichere Änderungen → ein Commit ins Brain; Unsicheres/Widersprüche → Karte
```

- **Fällt Stufe 1 aus** (kein Apple Intelligence, Sprache nicht unterstützt, gedrosselt): Stufe 2 bekommt die
  Abschnitte aus Stufe 0 direkt (so wie die heutige Ernte).
- **Ohne `claude`/ohne Internet:** Der Autopilot macht Stufe 0 + 1 und legt die Kandidaten als Karten ab;
  ins Wiki schreibt er dann nicht.
- **Widersprüche:** Stufe 0 findet Kandidaten (gleiche Entität, abweichende Zahl/Datum/Verneinung); Stufe 2
  beurteilt nur diese wenigen; das Ergebnis ist immer eine Karte, nie eine stille Auflösung.

### 6.2 Vorschlagsmodus und Freischaltung

- **Start:** Jede Wiki-Änderung des Autopiloten erscheint als Vorschlag (annehmen / ablehnen / ändern).
- **Messung:** Die App zählt angenommene vs. abgelehnte Vorschläge.
- **Freischaltung:** Ab mindestens 30 Vorschlägen mit ≥ 90 % Annahme bietet die App an, sichere Änderungen
  automatisch zu übernehmen. Der Nutzer entscheidet; zurückschalten jederzeit. Sinkt die Quote unter 80 %,
  schlägt die App das Zurückschalten vor.

### 6.3 Budget und Mitteilungen

- **Tagesbudget** in Tokens (Standard: 50.000 Haiku-Tokens/Tag, einstellbar). Ist es erreicht, wartet der Rest
  bis morgen; die App zeigt das an.
- **Mitteilungen:** höchstens 2 am Tag, gebündelt („3 neue Fragen-Karten“). Nie nachts (22–8 Uhr).

## 7. Ressourcen und Hintergrundverhalten

### 7.1 Zielwerte (in M1 und M3 auf dem Arbeits-Mac zu messen und ggf. anzupassen)

| Zustand | Ziel RAM (alle zugehörigen Prozesse) |
|---|---|
| Nur Menüleiste, Fenster zu, Dienst idle | ≤ 60 MB |
| Fenster offen, ohne 3D | ≤ 350 MB |
| Fenster offen, 3D sichtbar | ≤ 600 MB |
| Dienst arbeitet (ohne Suchmodell) | ≤ 250 MB zusätzlich, nur während des Laufs |
| Suchmodell geladen („leicht“) | ≤ 600 MB zusätzlich, entladen nach 5 min Leerlauf |

### 7.2 Regeln

- **Fenster zu = Webview weg.** Beim Schließen wird die WKWebView zerstört und die Ansicht-Brücke beendet.
- **3D nur sichtbar**, Einstellung „ruhig“ schaltet es ganz ab.
- **Dienst nur bei Arbeit:** LaunchAgent mit `QueueDirectories` auf `queue/`, zusätzlich `StartInterval` 3600 s
  als Sicherheitsnetz, `ProcessType=Background`, `LowPriorityIO`, `ThrottleInterval` 30. Ist die Warteschlange
  leer, beendet sich der Dienst.
- **Speicherdruck:** Vor jedem Auftrag `sysctl kern.memorystatus_vm_pressure_level` prüfen; bei Warnung oder
  kritisch: Auftrag zurückstellen, mit Backoff (5/15/60 min) neu versuchen.
- **Akku/Stromsparmodus:** nur Abgleich und Index; Autopilot wartet auf Netzteil (einstellbar).
- **Suchprofil nach RAM:** < 16 GB → „leicht“ (BM25 + Embedding + RRF, ohne Reranker/Expansion);
  ≥ 16 GB → „voll“ wählbar. Suchdienst entlädt nach 5 min (statt 30).
- **Ein Auftrag zur Zeit:** Sperre mit PID + Startzeit; verwaiste Sperren (Prozess weg) werden erkannt.

## 8. Internet: was, wohin, wozu

| Was | Wohin | Wann | Ohne Internet |
|---|---|---|---|
| Stufe 2 des Autopiloten | Anthropic, über das eigene `claude` des Nutzers | je Sitzung, im Budget | Stufe 0 + 1, Karten statt Wiki-Schreiben |
| Abgleich | GitHub, privates Repo des Nutzers | nach Änderungen, alle 15 min | Brain bleibt lokal |
| Update-Prüfung | statische Appcast-Datei auf GitHub Releases | 1× täglich, abschaltbar | keine Update-Hinweise |
| Suchmodell (~0,3 GB) | Hugging Face | einmal beim Wechsel auf „leicht“ | Minisuche ohne Modell |
| Apples On-Device-Modell | lädt macOS selbst | — | Stufe 1 entfällt |

## 9. Abläufe

### 9.1 Einrichtung (~1 Minute)

1. Willkommen → **„Neues Brain anlegen“** (Standard `~/Documents/Brain`) oder **„Vorhandenes Brain verbinden“**.
2. Laufzeit nach `Application Support` kopieren (offline).
3. **git prüfen** (`xcode-select -p`). Fehlt es: Erklärung + Apples Installationsdialog für die
   Befehlszeilenwerkzeuge auslösen; Einrichtung wartet, bis git da ist.
4. **KIs erkennen** (Claude Code, Codex, Gemini CLI, Cursor) → Adapter installieren; vorher Sicherungskopie
   der jeweiligen Einstellungsdateien.
5. **Sicherung/Abgleich:** GitHub (Login per Gerätecode, privates Repo anlegen oder wählen) | Ordner | keine.
6. **Budget** für den Autopiloten (Vorschlag 50k Tokens/Tag) und Hinweis zum Vorschlagsmodus.
7. **Suchprofil** automatisch nach RAM, Apple-Modell-Verfügbarkeit prüfen und anzeigen.
8. **Startwissen (optional, gegen das leere Brain am ersten Tag):** nur bereits Kuratiertes — vorhandene
   CLAUDE.md-/AGENTS.md-Dateien und Memory-Dateien der erkannten KIs werden als Quellen übernommen und als
   Vorschläge angeboten; dazu ein Kurz-Interview (5 Fragen, ~2 min) für die Ich-Karte. **Alte Sitzungen
   werden in v1 nicht eingelesen**; die App bietet das erst an, wenn das Prüfset bestanden ist (§13.2), und
   dann nur im Vorschlagsmodus.
9. **Test-Frage:** eine Beispielfrage durch die Suche schicken und das Ergebnis zeigen („Es funktioniert“).
10. LaunchAgent schreiben und laden; Hinweis, dass macOS ihn unter „Anmeldeobjekte“ anzeigt.

### 9.2 Quell-Vault-Schutz

Erkennt die App das Kit-Quell-Brain (`.tools/kit/export.mjs` vorhanden, `doctor` meldet „Quell-Vault“), nutzt
sie es normal (Ansicht, Karten, Autopilot), führt dort aber **keine Kit-Updates und Migrationen** aus und zeigt
einen dezenten Hinweis „Entwickler-Brain“.

### 9.3 Abgleich mehrerer Macs

- Login per **GitHub Device Flow** (GitHub App, Zugriff nur auf das gewählte Repo); Zugang im Schlüsselbund,
  git holt ihn über einen kleinen Credential-Helper (nie in `.git/config`).
- Ablauf: `fetch` → nur Fast-Forward oder Merge → bei Konflikt `merge --abort` und Fragen-Karte
  „Welche Version gilt?“. Nie still auflösen.
- **Nur ein Haupt-Mac schreibt per Autopilot ins Wiki.** Andere Macs liefern Aufträge/Notizen mit eindeutigen
  Dateinamen. Haupt-Mac ist in der App umstellbar.
- Generierte Dateien (Index, Graph, Suchindex) werden nicht synchronisiert, sondern lokal neu gebaut.
- Secret-Riegel läuft vor jedem Push.

### 9.4 Updates

- **App:** Sparkle 2 mit EdDSA-Signatur; Appcast und DMG auf GitHub Releases.
- **Kit:** Nach einem App-Update führt die App die Kit-Migrationen aus (`migrate/`), vorher Sicherung
  (Git-Commit + Bundle). Schlägt eine Migration fehl: Rücksprung auf den Stand davor, ✕ mit Erklärung.
- **Signaturschlüssel** (Sparkle EdDSA, Developer ID): doppelt gesichert aufbewahren — ein Verlust bedeutet, dass
  Bestandsnutzer keine Updates mehr bekommen.

## 10. Fehlerbehandlung

| Situation | Was der Nutzer sieht | Was passiert |
|---|---|---|
| Dienst vom Nutzer unter Anmeldeobjekte abgeschaltet | ⚠ „Hintergrund aus — Autopilot pausiert“ + Knopf | App erkennt fehlenden LaunchAgent-Status |
| git fehlt / kaputt | ✕ mit Anleitung | Autopilot und Abgleich pausieren, Suche läuft weiter |
| Konflikt beim Abgleich | Fragen-Karte | Merge abgebrochen, lokaler Stand unverändert |
| Prüfung einer Autopilot-Änderung rot | nichts Störendes; Eintrag in „Aktivität“ | Arbeitskopie verworfen, Auftrag als „übersprungen“ protokolliert |
| Budget erschöpft | ⚠ „Budget heute aufgebraucht“ | Aufträge warten bis morgen |
| Apple-Modell nicht verfügbar | Hinweis in Einstellungen | Fallback Haiku bzw. nur Karten |
| Speicherdruck | nichts | Auftrag zurückgestellt (Backoff) |
| Migration fehlgeschlagen | ✕ mit Erklärung | Rücksprung auf Sicherung |
| Absturz | beim nächsten Start: „Bericht ansehen/teilen?“ | lokale Logs + macOS-Absturzbericht, nichts wird gesendet |
| Nutzer korrigiert die KI nach einem Brain-Hinweis (W7) | Fragen-Karte „Stimmt diese Seite noch?“ | Seite wird PRÜFBEDÜRFTIG, Hinweise zeigen das an |
| Zu viele offene Karten (> 10) | ⚠ „Fragen warten“ | Autopilot pausiert Unwichtiges; liegengebliebene Karten bleiben Vorschlag, nie stilles Wissen |

Fehlertexte immer in Alltagssprache, keine Stacktraces in der Oberfläche.

## 11. Sicherheit und Datenschutz

- Keine Telemetrie, keine Analyse, kein Absturz-Upload.
- Kein offener Netzwerk-Port (§5.2).
- Secret-Riegel (bestehender pre-commit) bei jedem Commit und vor jedem Push — auch für Autopilot-Commits.
- Zugänge (GitHub) nur im Schlüsselbund.
- Hardened Runtime + Notarisierung für App und `brain-fm`; die mitgelieferte Node-Laufzeit wird beim Kopieren
  per SHA256 gegen die Original-Prüfsummen geprüft.
- Die App fordert keine Vollzugriffsrechte auf die Festplatte an; sie arbeitet nur im Brain-Ordner, in
  `Application Support/Brain` und in den Einstellungsdateien der erkannten KIs (mit Sicherungskopie).

## 12. Kit härten und klüger machen (Kit v0.6)

Entwicklung **nicht direkt auf `main` des Live-Brains**, sondern in einem eigenen Worktree/Branch
(`~/brain-kit-v0.6`, Branch `kit-v0.6`, wie bei v0.1–v0.4); Zusammenführen erst, wenn alle Tests grün sind.

### 12.1 Härtung (für den Dauerbetrieb nötig)

1. **Feste Pfade entfernen:** Hooks und `AGENTS.md` rufen Node über `…/Brain/bin/node` bzw. einen erkannten Pfad
   auf statt `/opt/homebrew/bin/node`; Vault-Pfad nicht mehr fest eingetragen.
2. **Sicherung nicht bei jedem Sitzungsstart:** nur bei Änderungen und höchstens alle 15 min.
3. **Memory-Sync** (`~/.claude/projects/*/memory`) läuft durch den Secret-Riegel.
4. **Wiki-Schutz auch für Shell-Schreibzugriffe** (Prüfung im pre-commit statt nur im Edit-Hook).
5. **Sperre mit PID + Startzeit** statt 30-Minuten-Fenster.
6. **Suchprofil nach RAM** und Suchdienst-Leerlauf 5 min.
7. **Warteschlange:** Ernte-Auslöser legen nur Aufträge in `queue/` ab (statt selbst zu ernten), wenn der
   Hintergrunddienst eingerichtet ist (LaunchAgent geladen). Fehlt er — App gelöscht oder Dienst abgeschaltet —,
   bleibt das heutige Verhalten (Ernte direkt per Haiku). Fehlt `brain-fm` (liegt im App-Paket), entfällt Stufe 1.
8. **`--json`-Ausgabe** für alle Befehle, die die App nutzt (status, search, pflege, karten, sync, doctor).

### 12.2 Brain-Kern v2 (richtiger, wirksamer, sparsamer — alles 0 Tokens im Betrieb)

| # | Baustein | Wirkt auf | Quelle/Begründung |
|---|---|---|---|
| K1 | **Wahrheits-Regeln W1–W7** (§4a): Schema-Felder `gilt_seit`, `ersetzt_durch`, `kritisch`, Herkunft je Fakt; Lint-Regeln dazu | Richtig | Zep, crajah, Singh, OWASP ASI06 |
| K2 | **Drei Momente:** Sitzungsstart liefert Ich-Karte + Projekt-Steckbrief (K14, gedeckelt ~300 Tokens; heute nur der Pfad) · Hinweis je Prompt (besteht) · **beim Lesen einer Datei** passende Regeln/Lektionen für genau diese Datei (PreToolUse auf `Read`, `additionalContext`). *Korrektur:* Kontext aus PreToolUse erreicht Claude erst zusammen mit dem Werkzeug-Ergebnis — ein Hinweis an `Edit`/`Write` käme nach der Änderung. Claude muss eine Datei vor `Edit` lesen; am `Read` kommt die Regel daher rechtzeitig. | Wirksam | Gist suwonleee: 0/8 → 8/8; Hook-Doku |
| K3 | **Intent-Gate:** Prompts ohne Wissensbedarf („ok“, „ja“, „weiter“) bekommen keinen Hinweis | Sparsam | Agent Zero Memory |
| K4 | **Drift-Linter:** Liste ausgemusterter Begriffe; lebende Erwähnungen werden gemeldet (Lint + pre-commit) | Richtig | Tuszynski |
| K5 | **Entitäts-Aliasse + Namens-Dubletten-Check** | Richtig | Tuszynski |
| K6 | **Ergänzen statt neu anlegen, neu schreiben statt anhängen**, Seitengrößen-Lint (~8 KB) | Vollständig/Sparsam | Gist HagaiHen, Letta, Paterson |
| K7 | **Prüfen nach Nutzung:** Prüf-Reihenfolge = Nutzung × Alter (aus vorhandenen Hinweis-/Lese-Logs); nie genutzte Seiten → Archiv-Vorschlag | Richtig/Sparsam | Mem0 „open problem“ |
| K8 | **Fehler-Signal W7** (Korrektur nach Hinweis → PRÜFBEDÜRFTIG + Karte) | Richtig | eigene Idee |
| K9 | **Regelbasiertes Routing** beim Einarbeiten (Suche + Aliasse + Index statt LLM) | Sparsam | Gist sassarini-marco (~72 % der Ingest-Tokens im Routing) |
| K10 | **Karten-Deckel:** max. 10 offene Karten, Ein-Tipp-Entscheidung mit Quelle | Richtig (Mensch ist Engpass) | eigene Idee |
| K11 | **Was war zuletzt:** Sitzungsstart (`startup`/`resume`/`clear`) liefert je Projekt höchstens ~600 Zeichen: die letzten 3 Sitzungen dieses Projekts (Datum + Titel aus dem Transkript, sonst erster Prompt gekürzt), Commits seit der letzten Sitzung (höchstens 5) und den Abschnitt „Offen“ der jüngsten `session_*`-Datei — nur wörtliche Auszüge mit Quelle, nichts von einer KI zusammengefasst | Vollständig | eigene Sitzungen: „was haben wir gestern gemacht“ mehrfach wortgleich; `/recap` deckt nur die laufende Sitzung ab |
| K12 | **Arbeitsstand über die Kompaktierung retten:** `PreCompact` schreibt (nur Seiteneffekt) `.logs/sitzungen/<session_id>.md`: Ziel der Sitzung (erste Nutzer-Nachricht), letzte Vorgaben/Entscheidungen des Nutzers (wörtlich, gekürzt), Commits der Sitzung, geänderte Dateien (aus `Edit`/`Write`-Aufrufen), offene Aufgaben (Aufgabenliste im Transkript) — durch den Secret-Riegel, git-ignoriert. `SessionStart` mit Matcher `compact` spielt sie wörtlich ein (≤ 8.000 Zeichen, Limit 10.000). Dazu ein Abschnitt `# Compact instructions` in der gerenderten `AGENTS.md`/CLAUDE.md (Entscheidungen, Pfade, offene Punkte erhalten). Ersetzt den heutigen Hinweis „Skill handoff“. | Vollständig | eigene Sitzungen: 27 Auto- + 16 manuelle Kompaktierungen, „merk dir das, damit ich compacten kann“; Issue #75759 (07/2026); Hook-Doku „what survives compaction“ |
| K13 | **Was läuft parallel:** `SessionStart` trägt die Sitzung in `.logs/laufend/` ein (Repo/Ordner, Titel, Start), jeder Prompt erneuert den Zeitstempel, `SessionEnd` trägt aus; Einträge ohne Lebenszeichen > 2 h zählen nicht. Beim Start — und beim Prompt nur, wenn neu — Hinweis „Parallel im selben Repo: ‚<Titel>‘ seit 20:14“, mit Verweis auf das eingebaute Cross-Session-Messaging. Nur gleiches Git-Repo bzw. gleicher Vault zählt. | Richtig | 16.10.: fremder Commit in `~/brain` während des Kit-Merges; Claude Code warnt nicht von selbst |
| K14 | **Projekt-Steckbrief:** Projektseiten bekommen feste Felder `pruefen` (Test-/Lint-/Rauchtest-Befehle), `ziel` (test/prod + Freigaberegel) und `fallen`; Stack und Versionen werden **nicht gepflegt, sondern beim Sitzungsstart aus dem Repo gelesen** (`package.json`, `Package.swift`, `go.mod`, `pyproject.toml` …, 0 Tokens, immer aktuell). Lint meldet Projektseiten ohne `pruefen`. Firmen-Fachwissen bleibt im Knowledge Collective. | Richtig/Wirksam | eigene Sitzungen: größte Gruppe „ungeprüft/kaputt“ (55 Nachrichten / 28 Sitzungen); Issue #53993 erfundene API-Aufrufe |
| K15 | **Alltags-Wirkung messen:** `brain wirkung` wertet lokal die Transkripte der letzten 30 Tage aus (nur Nutzer-Nachrichten, Musterlisten): Korrekturen je 100 Nachrichten nach Gruppe, „wo waren wir“-Fragen, Wiederholungen, Kompaktierungen, Brain-Hinweise mit folgender Korrektur. Zusätzlich der **Anteil großer Werkzeug-Ausgaben am Kontext** (Bash/Read/MCP-Ergebnisse > 5 KB, aus den Transkripten). Gespeichert werden nur Zahlen, keine Zitate; monatlich im Pflegebericht; Ausgangswert vom 16.10.2026 als Messprotokoll. Ist der Anteil hoch, wird das Auslagern großer Ausgaben (Muster von `mksglu/context-mode`) als eigener Baustein geplant — nicht vorher. | alle drei | ohne Messung kein Beleg, dass das Brain im Alltag hilft; context-mode (Elastic-2.0, speichert Prompts unverschlüsselt in SQLite, hängt an allen Werkzeug-Aufrufen) wird nicht installiert, nur seine Ideen geprüft |

## 13. Tests und Messungen

### 13.1 Automatische Tests

| Ebene | Werkzeug | Was |
|---|---|---|
| Kit-Logik | bestehende Node-Tests (609) + Shell-Suiten, erweitert | Warteschlange, Sperre, Budget, Zitat-Check, Vorschlagsmodus, Sync-Konfliktpfad, Migrationen |
| App-Logik | XCTest | Einrichtungs-Schritte, Status-Auswertung, Schlüsselbund, LaunchAgent schreiben/laden, Brücke |
| Oberfläche | Playwright gegen die Web-Oberfläche (im Browser) | Übersicht, Karten annehmen/ablehnen, Einstellungen |
| App-Rauchtest | XCUITest | App startet, Menüleiste, Fenster öffnet/schließt, Einrichtung bis Test-Frage |

### 13.2 Messungen und Evals

- **Korrektheits-Prüfset (läuft bei jeder Kit-Änderung, deterministisch bewertet — kein KI-Richter):** je
  Wahrheits-Regel feste Fälle, u. a. Zitat steht nicht in der Quelle → abgelehnt (W1) · KI-Vermutung ohne
  Bestätigung → nie Wissen, Web-Inhalt → nur Karte (W2) · **korrigierter Fakt darf nicht wiederkommen** (W3,
  „selective forgetting“ nach MemoryAgentBench) · Widerspruch → Karte statt Überschreiben (W4) · `kritisch`-Seite
  bleibt unverändert (W5) · abgelaufene Seite wird im Hinweis markiert (W6) · Korrektur nach Hinweis → Seite
  PRÜFBEDÜRFTIG (W7).
- **Autopilot-Eval:** 30–50 echte Sitzungen aus Fabios Brain als festes Prüfset. Gemessen: Zitat-Treue (Ziel
  100 % — Kandidaten ohne wörtliches Zitat dürfen nie durchkommen), Präzision der Fakten, Tokens je Sitzung.
  Vergleich: nur Haiku (heute) vs. Apple-Modell + Haiku. Läuft bei jedem macOS-Update erneut (Apple kann das
  Modell ändern).
- **Suche:** bestehende Messlatte (heute 57/61 bzw. 75/81) darf mit Profil „leicht“ nicht unter einen
  festgelegten Wert fallen; Ergebnis entscheidet die Standard-Schwelle.
- **RAM/Energie (kein 8-GB-Testgerät — gemessen wird auf dem Arbeits-Mac, M4 Pro):**
  - Szenario-Skript (Fenster zu/offen/3D/Dienst/Suche) misst den **physischen Speicherbedarf** aller beteiligten
    Prozesse (`footprint` bzw. Aktivitätsanzeige „Speicher“, inkl. WebContent- und GPU-Prozess) und vergleicht ihn
    mit den Zielwerten aus §7.1. Der Speicherbedarf hängt kaum vom Chip ab, die Werte gelten daher auch für einen M1.
  - **Speicherdruck simuliert** (macOS-Werkzeug `memory_pressure`): der Dienst muss zurückstellen und danach
    wieder anlaufen.
  - **Optional eine macOS-VM mit 8 GB** für das Gesamtbild (Einrichtung + Claude + Browser gleichzeitig).
    Apples On-Device-Modell steht in VMs vermutlich nicht zur Verfügung; Stufe-1-Tests laufen auf dem Host.
  - **Beta-Rückmeldung:** die App zeigt ihren eigenen Speicherbedarf unter „Aktivität“; Tester mit 8-GB-Macs
    können den Wert freiwillig melden (nichts wird automatisch gesendet).
- **Frischer Mac:** Einrichtung in einer frischen VM ohne git/Homebrew/Node, offline und online.
- **Robustheit:** Abbruch mitten im Autopilot-Commit, Mac schläft ein, Speicherdruck künstlich erzeugt,
  Netz weg beim Abgleich, zwei Macs ändern dieselbe Seite.
- **Alltags-Wirkung (K15, monatlich):** Ausgangswert 16.10.2026 — 193 Hauptsitzungen, 2.600 Nutzer-Nachrichten,
  u. a. „ungeprüft/kaputt“ 55, „inhaltlich falsch“ 39, Wiederholungen 37, Regelbruch 20, Gedächtnisverlust 10,
  43 Kompaktierungen. Ziel ist ein **Trend nach unten** bei Gedächtnisverlust, Regelbruch und Wiederholungen nach
  K2/K11/K12; die Musterzählung ist grob (Rauschen bekannt) und wird daher nur mit sich selbst verglichen.
- **Hook-Laufzeit:** Sitzungsstart- und Prompt-Hooks bleiben unter ihrem Zeitlimit (Ausgabe wird sonst verworfen);
  gemessen je Hook im Kit-Test, Ziel < 300 ms beim Prompt.
- **Update-Kette:** signieren → notarisieren → stapeln → Appcast → Update von Version n auf n+1 in der VM.

### 13.3 Freigabekriterien Beta

Alle automatischen Tests grün · Zitat-Treue 100 % im Eval · RAM-Zielwerte (§7.1) auf dem Arbeits-Mac gemessen
eingehalten oder bewusst angepasst · Einrichtung im frischen Mac < 3 min ohne Hilfe · Update n → n+1 erfolgreich ·
kein offener Port (`lsof -i` leer für App-Prozesse).

## 14. Meilensteine

Reihenfolge nach dem Grundsatz „erst läuft die App, dann wird optimiert — aber nichts, was Wissen schreibt,
ohne die Wahrheits-Regeln“. Die App-Hülle schreibt kein Wissen und kann deshalb zuerst kommen; der Autopilot
kommt erst, wenn W1–W7 umgesetzt und getestet sind.

| Meilenstein | Inhalt | Ergebnis |
|---|---|---|
| **M1 – App läuft** | Brain.app: Menüleiste mit Status, Fenster mit `brain://` + Ansicht-Brücke (kein Port), mitgelieferte Laufzeit, Einrichtung „vorhandenes Brain verbinden“ inkl. Quell-Vault-Schutz; dafür nötige Kit-Teile (feste Pfade weg, `--json`, Brücken-Modus der Ansicht); erste RAM-Messung mit der echten App (Footprint auf dem Arbeits-Mac) | Fabio nutzt die App täglich mit seinem echten Brain (lesend: Ansicht, Status, Pflege, Karten aus dem Bestand) |
| **M2 – Wahrheit + Kern v2** | §4a W1–W7, §12.1 Härtung, §12.2 K1–K15, Korrektheits-Prüfset, Ausgangsmessung Alltags-Wirkung (Kit v0.6, Worktree) | Brain richtiger, wirksamer, sparsamer — auch ohne App; Claude weiß, was zuletzt lief, und verliert über die Kompaktierung nichts |
| **M3 – Messen + Autopilot** | `brain-fm` + Autopilot-Eval (Apple-Modell vs. Haiku); LaunchAgent, Warteschlange, Stufen 0–2, Vorschlagsmodus, Karten, Budget, Mitteilungen | Autopilot im Vorschlagsmodus |
| **M4 – Neues Brain + Abgleich** | Einrichtung „neues Brain anlegen“ inkl. Startwissen + Kurz-Interview; Device Flow, Credential-Helper, Sync, Haupt-Mac | App für andere einrichtbar, mehrere Macs |
| **ME – Erlebnis & Design** (nach M3, vor M4) | Aus der Menüleisten-App wird eine **richtige Dock-App mit Hauptfenster** (Vorbild MXTerm Pro): Seitenleiste mit Start · Gehirn (3D) · Wissen · Entscheiden · Eingang · Einstellungen, Statusleiste, Themes, Logo, Animationen, „Einstieg & Tour“; die Menüleiste bleibt als Zusatz. Ändert §5.2 (`LSUIElement`). Vor dem Start eigene Brainstorming-Runde + Spec-Ergänzung | App fühlt sich wie ein fertiges Produkt an; Kollegen finden sich ohne Hilfe zurecht |
| **M5 – Verteilung** | Developer ID, Notarisierung, Sparkle (App **und** Kit-Update), DMG, Test mit einem Kollegen | interne Verteilung an Kollegen mit automatischen Updates |

Jeder Meilenstein bekommt einen eigenen Umsetzungsplan; die Messung in M3 entscheidet, ob Stufe 1 (Apple-Modell)
standardmäßig an ist.

## 15. Offene Punkte (vor dem jeweiligen Meilenstein zu klären)

| Punkt | Wer | Spätestens |
|---|---|---|
| App-Name | Fabio | vor M5 |
| Zertifikat „Developer ID Application“ anlegen (bisher nur „Apple Development“ vorhanden) + `notarytool`-Profil | Fabio (Secrets nur selbst eingeben) | vor M5 |
| Mitgliedschaft im Apple Developer Program aktiv? (zeigt sich daran, ob Xcode „Developer ID Application“ anbietet) | Fabio | vor M5 |
| Test-Kollege (eigener Mac, ohne Terminal-Erfahrung) für den Einrichtungstest | Fabio | vor M5 |
| GitHub App für Device Flow registrieren (Client-ID ist öffentlich, kein Secret) | Fabio + Claude | vor M4 |
| Update-Quelle: Das Repo ist privat, Updates müssen aber ohne Anmeldung ladbar sein — öffentliches Repo nur mit Release-Dateien, oder ein Firmen-Speicherort | Fabio + Claude | vor M5 |
| Speicherziele nach M1-Messung (Fenster offen 640 MB vs. ≤ 600, zu 64 MB vs. ≤ 60) bestätigen oder anpassen | Fabio | vor M3 |

## 16. Später (nicht v1)

iPhone-Eingang (Kurzbefehl → iCloud-Drive-Briefkasten oder Telegram-Bot, den der Mac abfragt) · eigene
iPhone-App zum Nachschlagen · mehrere Brains · Importe in der App · OKF-Export (Google Open Knowledge Format) ·
Swift-Ersatz für den heißesten Hook-Pfad (Hinweis je Prompt), falls Node-Startzeit stört.
