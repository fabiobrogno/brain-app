# Einrichtung und KI-Konten wie bei Orca: ein Fenster, klare Konten, ehrliches Kontingent

Stand: 06.11.2026 · Branch `docs/einrichtung-orca` · nur Planung, kein Code geändert.

Auftrag des Nutzers: „Am Anfang, wenn man einen Vault einrichten will, öffnet sich noch ein Fenster über dem anderen. Und das ganze mit der Account-Auswahl etc. soll alles
viel besser funktionieren. Guck dir möglichst viele Sachen von Orca ab, die haben schon sehr viel und es funktioniert, einstellungsmäßig, Tracking etc.“

Dieses Papier baut auf `docs/plaene/design-wizards.md` (Orca-Lesung @cf5b462/@9bccd67, P1–P5), `docs/plaene/ki-konten.md` (Konten, Stufen, Pflege, P6) und
`docs/plaene/ki-programme.md` auf. Was dort schon umgesetzt ist (Design-Tokens, Dialoghülle, Einstellungsseite mit Suche, Kontingent-Grundlage), wird hier nicht neu geplant.

## 1. Quellen

| Quelle | Stand | Lizenz | Umgang |
|---|---|---|---|
| Orca, https://github.com/stablyai/orca | Commit **`239e17f84fc920bc2be62b6a73336dc57fc0150b`** (6.11.2026, `main`, flach geklont, nur gelesen, nichts ausgeführt) | MIT, Copyright (c) 2026 Lovecast Inc. | Muster, Maße, Abläufe und Konstanten dürfen übernommen werden; von Hand nachgebaut (Vanilla-JS, CSS, Swift), eigene Texte, Farben und Symbole, kein Name, keine Marke, kein Logo von Orca in der Oberfläche. Herkunft in `THIRD-PARTY-NOTICES.md` (Abschnitt Orca um diesen Commit ergänzen) und als Kurzkommentar an der Stelle. |
| Kortex, dieses Repo | `origin/main` @ `c5f9226` | MIT | Code gelesen; Vorschau (`scripts/vorschau.sh --mit-ki`) gebaut und gestartet, Fensterliste und ein Fensterfoto des eigenen Prozesses (nur Startbild, siehe 2.1). |

Orca-Pfade unten relativ zur Wurzel; `R/` = `src/renderer/src/components/`, `M/` = `src/main/`, `S/` = `src/shared/`.

---

## 2. Heute in Kortex (Befund)

### 2.1 Welche Fenster beim ersten Start aufgehen (Reihenfolge)

| # | Was | Wo (Datei:Zeile) | Art |
|---|---|---|---|
| 0 | Hinweis „Ordner Brain“ / „Laufzeit unvollständig“ (nur wenn zutreffend) | `Sources/BrainApp/AppZustand.swift:242`, `:258`, `:325` (`NSAlert.runModal`) | **modales Systemfenster** vor allem anderen |
| 1 | Assistent „Kortex einrichten“ | `AppZustand.swift:287` → `zeigeAssistent` `:676`; Fenster `Sources/BrainApp/FensterSteuerung.swift:473` (`baueEinrichtungsFenster`, 1200 × 780, nicht vergrößerbar, kein Minimieren) | **eigenes NSWindow** mit `einrichtung.html` |
| 1a | Ordner wählen | `FensterSteuerung.swift:530` (`NSOpenPanel.beginSheetModal`) | Sheet am Assistenten (gut) |
| 1b | „Später?“, Ordner-Rückfall | `Ressourcen/studio/einrichtung.js:716`, `:124` | Dialog in der Seite (gut) |
| 1c | GitHub-Gerätecode | `einrichtung.js:370` → Aktion `extern` | **Browser** |
| 1d | KI-Schritt: eigener 5-Schritt-Ablauf „Wählen · Konto · Stufe · Prüfen · Fertig“ | `einrichtung-ki.js:18` → `ki-verbinden.js:1–9` | Wizard **im** Wizard |
| 1e | Anmelden bei Claude/Codex | `ki-verbinden.js:92` → `KiRoute` öffnet **Terminal.app** (`AppZustand.swift:115–123`) | fremdes Fenster; **im Assistenten gar nicht verfügbar**, siehe 2.3 |
| 2 | Studio | nach `einrichtung-ende`: `AppZustand.swift:703–733` → `oeffneStudio` `:462` → `FensterSteuerung.swift:258` (85 % des Bildschirms) | **zweites NSWindow**, andere Größe; der Assistent schließt, das Studio geht auf |
| 2a | „Darf Kortex diesem Ordner vertrauen?“ (bei geöffnetem/geklontem Ordner) | `Ressourcen/studio/app.js:2463` (`fragVertrauenEinmal`) | Dialog im Studio **direkt nach** der Einrichtung |

Die Vorschau bestätigt Schritt 1: Beim Start existieren genau zwei Fenster des Prozesses, „Kortex einrichten“ (1200 × 780) und ein unsichtbares 500 × 500
(Menüleisten-Extra); das Studio ist noch zu. Weiter durchgeklickt wurde nicht (das ginge nur mit globalen Eingaben auf dem Bildschirm des Nutzers).

### 2.2 Ursache für „ein Fenster über dem anderen“

**Kortex hat für eine Aufgabe zwei Hauptfenster.** Der Assistent ist ein eigenes `NSWindow` (`FensterSteuerung.Art.einrichtung`), das Studio ein zweites. Sie
erscheinen übereinander, sobald das Studio schon offen ist — und das ist im Alltag der Normalfall:

1. **Studio ohne Vault → „Kortex einrichten …“.** Wer den Assistenten einmal schließt oder „Später“ wählt, landet im Studio mit der Karte „Noch kein Vault“
   (`app.js:2655–2666`, Text `texte.js:6`). Deren Hauptknopf schickt `einrichtung-oeffnen` (`app.js:2657`) → `AppZustand.swift:559` → `zeigeAssistent` öffnet das
   Assistentenfenster **mittig über** dem Studiofenster. Zwei gleich wichtige Fenster, beide mit eigener Ampel.
2. **Menü „Kortex einrichten …“ (⌘E)** in der Menüleiste und im Hauptmenü (`BrainApp.swift:126`, `MenueInhalt.swift:41`) — gleiche Folge, mit Vault ab `?ab=sicherung`.
3. **Fensterwechsel statt Übergang.** Am Ende schließt der Assistent, das Studio öffnet in anderer Größe (`EinrichtungsFenster.swift:24` vs. `StudioFenster.startrahmen`).
   Hat sich der Vault geändert, während das Studio offen war, wird das Studio **geschlossen und neu geöffnet** (`AppZustand.swift:724–728`).
4. **Drei Einstiegsoberflächen für dasselbe:** Assistent (`einrichtung.js`), Studio-Willkommen (`willkommen.js:499`, über „Anderen Weg wählen“ `app.js:2658`) und die
   Karte „Noch kein Vault“. Dazu „KI verbinden“ an sechs Stellen (Statusleiste `app.js:1800`, Palette, Konto-Menü, Assistent, Willkommen, Einstellungen — `ki-verbinden.js:7`).
5. Fremde Fenster mitten im Ablauf (Terminal.app zum Anmelden, Browser für GitHub) und ein `NSAlert` vor dem Start.

Orca hat das Problem nicht, weil es **ein** Hauptfenster gibt und die Einrichtung ein Overlay darin ist (siehe 3.1).

### 2.3 Konten: Reibungspunkte

| # | Befund | Beleg |
|---|---|---|
| K1 | **Anmelden im Assistenten geht nicht.** Das Assistentenfenster bekommt keine `KiRoute` (`zeigeAssistent` übergibt kein `ki:`; `FensterSteuerung.swift:278` reicht nur `ki` weiter). `/api/ki/anmelden` landet bei der Werkstatt → 409 „geht nur in der Kortex-App“, `/api/ki/anmeldestatus` → „unbekannt“, `/api/ki/programme` sucht ohne Login-Shell-PATH. Man ist aber in der App. | `AppZustand.swift:696`, `Ressourcen/werkstatt/handler.mjs:416–429` |
| K2 | Anmelden öffnet **Terminal.app** mit einem `.command`-Skript und fragt 10 min lang alle 3 s nach. Der Nutzer verlässt Kortex. | `ki-verbinden.js:22–23`, `KiRoute.swift` |
| K3 | Ein Konto zeigt **keine Identität** (keine E-Mail, kein Plan), nur Programm + Ordnername („System-Standard“, `claude-privat`). Zwei Konten sind kaum zu unterscheiden; Doppelte (derselbe Login in zwei Ordnern) bleiben unbemerkt. | `werkstatt/konten-erkennung.mjs:1–8`, `ki-konten.md` 1.1 |
| K4 | **Vier Begriffe für „welches Konto“:** MCP-Verbindung je Konto, Stufe je Konto × Vault, Frag-Standard (im `localStorage` der WebView, `kontingent.js:173–191`), Pflege-Konto je Vault (`ki-konten.json`). Es gibt kein „aktives Konto“. | `einstellungen-ki.js`, `kontingent.js` |
| K5 | Neue Konten starten „gesperrt“; im Assistenten ist die Stufe ein eigener Unterschritt. Richtig als Sicherheitsregel, aber die Wahl kommt zu früh und zu technisch. | `ki-konten.md` P1-Entscheidung 1 |
| K6 | „Konto hinzufügen“ legt den Ordner **vor** der Anmeldung an; ein abgebrochener Login hinterlässt ein Konto „nicht angemeldet“. | `ki-konten.md` P6 („Konto hinzufügen“) |
| K7 | `GET /api/ki/konten` legt beim Lesen Konten an (bekannt, deshalb liest die KI-Zeile `/api/ki/erkennen`). | `design-wizards.md` §9 |
| K8 | „Später“ ohne Vault legt **still** `~/Kortex` an. | `einrichtung.js:730` |

### 2.4 Kontingent („Tracking“): Stand und Lücken

Umgesetzt (P7, nach Orca @9bccd67): Claude über eine **Statuszeilen-Kette** (`gemeinsam/kortex-statuszeile.mjs`, schreibt `rate_limits` nach `<Support>/kontingent/<konto>.json`),
Codex über `codex app-server` → `account/rateLimits/read` (`gemeinsam/kontingent.mjs`), Takt 15 min / frühestens 5 min / Fehlerpause 30 s–15 min / „veraltet“ nach 30 min,
Balken grau < 60 % · gelb 60–79 % · rot ≥ 80 %, Anzeige in Statusleiste, Frag-Feld und Einstellungen (`studio/kontingent.js`).

Lücken: (a) Claude-Werte gibt es **erst nach Einwilligung je Konto** (Eingriff in `settings.json`, beim Standardkonto mit Zusatzbestätigung) **und erst, wenn danach eine
Claude-Code-Sitzung läuft** — vorher steht nichts da, ohne zu sagen warum; (b) keine Übersicht aller Konten auf einen Blick; (c) keine Wahl „verbraucht/übrig“; (d) kein
Schutz gegen veraltete Werte einer ruhenden Sitzung (eine alte Sitzung kann einen niedrigeren Stand melden); (e) keine Token-/Kostenübersicht.

---

## 3. Orca (Commit 239e17f)

### 3.1 Erster Start und Fenster

- **Ein Fenster.** Die Einrichtung ist ein Overlay im Hauptfenster: `src/renderer/src/app-shell/AppRootSurfaces.tsx:105` (lazy), `:358–371` (`createPortal` in `document.body`,
  Fehlergrenze mit „erneut versuchen / schließen“). Hintergrund `fixed inset-0 bg-black/50 p-4`, Karte `role="dialog"` max. 1100 × 960 px, `rounded-xl`, 32 px hoher
  Zieh-Streifen oben (`R/onboarding/OnboardingFlow.tsx`). Breitenwechsel 760 ms `cubic-bezier(.22,1,.36,1)`.
- **Schritte** (`R/onboarding/use-onboarding-flow-types.ts`, `S/onboarding-defaults.ts`: `ONBOARDING_FINAL_STEP = 5`, `ONBOARDING_FLOW_VERSION = 4`): Arbeitsweise → Standard-Agent →
  Aussehen → Integrationen → (Windows) → Mitteilungen. Erfüllte Schritte entfallen von selbst (`onboarding-flow-state.ts`: Integrationen, wenn `gh` schon da ist).
- **Vorgaben** (`use-onboarding-flow.ts`): erkannter Agent wird einmal vorausgewählt, ein Klick des Nutzers wird nie überschrieben; Thema wirkt sofort als Vorschau,
  Überspringen stellt es zurück.
- **Fortschritt:** Pillen 4 px hoch (aktiv 40 px breit, erledigt 24 px 70 %, offen 24 px 25 %), jede anklickbar, rechts „N of M“; übersprungene Seiten fehlen in der Leiste.
- **Fußleiste** (`OnboardingFooter.tsx`): links leise „Skip to project setup“, rechts „Back“ und Hauptknopf mit Tastenchip ⌘↩. **Tastatur:** ⌘↩ weiter (nicht in Feldern,
  Sperre gegen Tastenwiederholung), Esc → Rückfrage `OnboardingSkipConfirmationDialog.tsx` (360 px, „Skip onboarding?“ / „It won't take long!“, Klick auf den Hintergrund ebenso).
- **Fortsetzen:** jeder Schritt speichert `lastCompletedStep` (`M/ipc/onboarding.ts`, `use-onboarding-flow-persistence.ts`); nach Beenden geht es dort weiter; ältere
  Ablauf-Versionen werden umgerechnet. Wieder öffnen: `show-onboarding-event.ts`.
- **Ende:** schließt das Overlay und öffnet **im selben Fenster** den Dialog „Add a project“ (`use-onboarding-flow-actions.ts`); dahinter liegt der leere Zustand `R/Landing.tsx`.
- **Projekt hinzufügen** (`R/sidebar/project-admission/`): ein Dialog als Startmenü mit Unterformularen (Ordner wählen als Hauptzeile mit ↩-Chip, darunter „Other ways“: Klonen, Neu,
  Remote), „← Back“, Klick nach außen gesperrt während des Klonens; Fehlertexte mit nächstem Schritt (`S/repo-create-failure-copy.ts`, z. B. fehlende git-Identität mit dem
  genauen Befehl); nach Erfolg kein Erfolgsbild, sondern direkt ins Projekt.
- **Fensterführung:** `app.requestSingleInstanceLock()` (`M/startup/single-instance-lock.ts`), „vorhandenes Fenster holen“ (`M/window/focus-existing-window.ts`: wiederherstellen,
  bis 3 Versuche à 300 ms, kein Doppelfenster), Fenster erst zeigen, wenn es bereit ist; gemerkte Größe nur, wenn mindestens halb auf einem Bildschirm
  (`main-window-state-lifecycle.ts`). Weitere Fenster nur für ausdrückliche Pop-outs; Dialoge immer im Fenster, Systemdialoge nur für Datei-/Ordnerwahl, dann als Sheet.
- **Nach der Einrichtung:** leerer Zustand mit zwei Knöpfen und drei Tastenhinweisen (`R/Landing.tsx`); ruhige Hinweiskarte nur bei echtem Mangel (git fehlt;
  `landing-preflight-issues.ts`); **Checkliste** in der Seitenleiste mit Fortschrittsring, ausblendbar (`R/setup-guide/SetupGuideModal.tsx`, `R/sidebar/SetupGuideSidebarEntry.tsx`);
  Tipps höchstens einer je Sitzung, nie während der Einrichtung, „gesehen“ schon beim Zeigen (`R/feature-tips/`, `S/feature-tips.ts`).
- **Anmelden im Fenster:** eingebettetes Terminal, das den Befehl **eintippt, aber nicht ausführt** (der Nutzer drückt Enter), dazu „Erneut prüfen“
  (`R/onboarding/OnboardingInlineCommandTerminal.tsx`, `IntegrationsStep.tsx`).
- **Telemetrie** (nicht übernommen): neue Installationen sind eingeschaltet, Bestandsnutzer sehen ein Banner (`M/telemetry/consent.ts`, `R/FirstLaunchBanner.tsx`).

### 3.2 Konten

- **Konto = eigener Konfigurationsordner**, „System default“ = `~/.claude` bzw. `~/.codex` (`M/claude-accounts/claude-profile-paths.ts`, `M/codex-accounts/codex-managed-home-path.ts`).
- **Erst nach erfolgreicher Anmeldung veröffentlicht:** die Marke `profile.json` wird zuletzt geschrieben, abgebrochene Ordner werden aufgeräumt (`claude-account-registration.ts`).
- **Anmelden ohne Terminalfenster:** Orca startet `claude auth login --claudeai` mit `CLAUDE_CONFIG_DIR` (`claude-login-session.ts:60`, 10 min), lenkt `BROWSER` auf einen Shim, um die
  Adresse zu fassen und „Link kopieren“ anzubieten (`claude-sign-in-browser.ts`, `R/settings/accounts/claude/claude-sign-in-link-menu.tsx`); Variante „Code einfügen“ liest die Adresse
  aus der Ausgabe und schreibt den Code auf stdin (`claude-pasted-code-login.ts`). Codex: `codex login` (3 min) oder `codex login --device-auth` mit Code im Fenster (15 min,
  `codex-device-auth-prompt.ts`).
- **Identität:** E-Mail und Organisation aus `oauthAccount` in `.claude.json` des Ordners (`claude-account-folder.ts`), bei Codex aus `auth.json`; Doppelte = E-Mail (klein) +
  Organisation (`claude-duplicate-account.ts`).
- **Aktives Konto je Programm** (global), ein Zeiger, den ein `claude`-Shell-Wrapper bei jedem Start liest; „gilt für die nächste Sitzung“ (`claude-profile-router.ts:74`).
  Wechsel bei laufenden Sitzungen: Einstellung fragen/neu starten/behalten mit „nicht mehr fragen“ (`R/ClaudeAccountSwitchDialog.tsx`, `R/CodexRestartChip.tsx`).
- **Seite „AI Provider Accounts“** (`R/settings/accounts/AccountsPane.tsx`): je Programm eine Karte mit Einleitung („Optional … add accounts only if you want quick switching“),
  Zeile „System default“ mit Abzeichen *Active* / *Needs sign-in*, weitere Konten (E-Mail, Organisation, Plan, Verbrauch), „Add Account“; Fehlertexte mit nächstem Schritt.

### 3.3 Kontingent („Tracking“)

- **Datenquellen** (`M/rate-limits/`): Claude über `GET api.anthropic.com/api/oauth/usage` mit dem OAuth-Token aus dem Schlüsselbund bzw. `.credentials.json`
  (`claude-oauth-usage-request.ts`, `M/claude-accounts/keychain.ts`) **plus** Statuszeilen-Einspeisung (`S/claude-statusline-rate-limits.ts`, `M/claude/statusline-install.ts`;
  höchstens alle 15 s, Doppelte 30 s verworfen); Codex über `codex app-server` (`codex-rpc-rate-limit-probe.ts`) und `chatgpt.com/backend-api/wham/usage`. Orca erneuert nie selbst einen Token.
- **Takt** (`M/rate-limits/service/service-types.ts:99–121`): 15 min, frühestens 5 min, Fehlerpause 30 s bis 15 min (höchstens 8 in Folge), veraltet 30 min, lange veraltet 24 h,
  nicht aktive Konten höchstens alle 60 s und um 2 s versetzt, `Retry-After` bis 24 h bindend; abgefragt wird **nur bei sichtbarem, aktivem Fenster**, Aktivieren löst eine Abfrage aus
  (`service-polling.ts`).
- **Veraltete Werte verwerfen** (`claude-usage-window.ts`): Innerhalb eines Fensters steigt der Verbrauch nur; ein kleinerer Wert oder eine ältere Rücksetzzeit ist der alte Stand einer
  ruhenden Sitzung und zählt nicht; Rücksetzzeiten innerhalb 60 s gelten als dasselbe Fenster.
- **Anzeige:** Statusleiste je Anbieter Balken 48 × 6 px und „NN % used“/„NN % left“ nach Wahl (`S/usage-percentage-display.ts`), Ton nach dem knappsten Fenster, 60/80
  (`R/status-bar/provider-extra-usage-section.tsx:9–10`); Warndreieck erst, wenn eine Abfrage scheiterte **und** der Wert älter als 30 min ist („ruhig veraltet“,
  `StatusBarProviderSegment.tsx:35`); Popover „Usage / all agents“ mit Auffrischen, Kompakt/Ausführlich, „Manage Accounts …“ (`UsageRosterPanel.tsx`); Konto-Karte „Updated {Zeit}“.
- **Fehlertexte** (`usage-error-copy.ts`): „Updates when Claude runs“, „Sign in again“, „Network issue“, „No subscription“; ein Abfragefehler heißt ausdrücklich nicht „abgemeldet“
  („Agent sessions may still be signed in“).
- **Lokale Statistik** (getrennt vom Kontingent): Orca liest `~/.claude/projects/**/*.jsonl` und Codex-`sessions` aller Konten inkrementell in einem Worker (`M/claude-usage/`,
  `M/codex-usage/`, `M/usage/`), Preistabellen je Modell (`claude-model-pricing.ts`), Ansicht mit Zeitraum und Zuschnitt (`R/stats/StatsPane.tsx`, Schalter „Enable … usage analytics“).
- Keine Systemmitteilung beim Annähern an ein Limit; nur Farben.

### 3.4 Einstellungen, Statusleiste, Mitteilungen, Aktualisierung

Kortex hat Seite, Gruppen, Suche (Wertung 900…200) und Sofort-Speichern (700 ms) schon nach Orca gebaut (`design-wizards.md` §7). Neu bzw. noch nicht übernommen:

- **Einstellungen:** nur der aktive Bereich wird gebaut (`R/components/settings/page/settings-page-renderer.tsx`); Sprungziel als Datenobjekt `{bereich, abschnitt, absicht}`, wartet
  bis das Ziel da ist, leuchtet 3 s (`page/use-settings-page-effects.ts:160–245`); Herkunftsmarke je Einstellung („gilt für diesen Mac“ / „gilt für dieses Projekt“,
  `page/setting-ownership.ts`); Checkliste „Onboarding checklist“ mit Ring auch oben in der Einstellungs-Seitenleiste (`navigation/SettingsSidebar.tsx`); Unterzeilen höchstens eine
  Zeile, ~80 Zeichen, sagen *was*, nicht *wie* (`docs/styleguide/ux-review-rubric.md`).
- **Statusleiste** (`R/components/status-bar/`): 24 px; links Kontingent je Anbieter, rechts feste Teile; **Dichte-Leiter** in fünf Stufen (voll → kompakt → nur knappstes Fenster →
  ruhige Anbieter als „+N“, dringende bleiben → nur Symbole), gemessen per `ResizeObserver` vor dem Zeichnen (`status-bar-density.ts`); Rechtsklick blendet Teile ein/aus
  (`StatusBarVisibilityMenu.tsx`), nicht installierte Programme fallen aus der Liste.
- **Mitteilungen** (`M/notifications/notification-delivery-service.ts`): Systemmitteilung nur für Hintergrund-Ereignisse; nicht, wenn das auslösende Fenster vorne ist
  (`suppressWhenFocused`, Vorgabe an); 5 s Sperre je Schlüssel (`S/notification-burst-cooldown.ts`); zugestellte Banner werden beim Lesen zurückgezogen
  (`announced-notification-registry.ts`); macOS: Erlaubnis zuerst lesen, bei „abgelehnt/unbestimmt“ eine **Erlaubnis-Karte in den Einstellungen** statt still nichts
  (`R/components/notifications/mac-notification-permission-card.tsx`, prüft alle 2,5 s, höchstens ~3 min); „Probe senden“ aktualisiert diese Karte statt Toasts.
  Passiv: Punkt am Menüleisten-Symbol (`M/tray/tray-attention-icon.ts`) und Dock-Zahl (`M/dock/unread-badge.ts`).
- **Toasts und Karten:** Toasts unten rechts (`R/components/ui/sonner.tsx`, Breite `min(26rem, 100vw − 2rem)`), darunter ein bleibender **Kartenstapel** 360 px (Update, Hinweise;
  `R/components/NotificationCardStack.tsx`), der seine Höhe als CSS-Variable meldet, damit Toasts ihn nie verdecken. Stilregel: Toast für Ergebnisse, Fehler zum Lesen/Kopieren bleiben im Fenster.
- **Rückfragen:** eine Bestätigung als Versprechen mit Warteschlange (`R/components/confirmation-dialog.tsx`); „Nicht mehr fragen“ wird nur beim Bestätigen gemerkt, danach Toast
  „Wird beim nächsten Mal übersprungen“ mit Knopf „Einstellungen öffnen“ (Sprung zur Zeile, `confirmation-skip-preference.ts`); Schutz gegen das Enter/Doppelklick des Öffnens.
- **Aktualisierung** (`M/updater/`, `R/components/UpdateCard.tsx`): Prüfung beim Start und alle 24 h, Wiederholung 1 h bis 6 h; Laden erst auf Klick; Karte mit Neuigkeiten, danach
  Statusleisten-Teil „Update bereit“; „Update erst nach N Tagen“ (0/1/3/7/14/30, `S/update-delay.ts`). Kortex hat Sparkle; übernehmbar sind nur Karte + Statusleisten-Teil.
- **Tastatur:** Tastenchip nur am Hauptknopf, nie an Abbrechen/Links; Chips immer aus dem Register (`ShortcutKeyCombo.tsx`, `ButtonKeyHint.tsx`) — Kortex macht das schon so.

---

## 4. Kortex neu

### 4.1 Grundsatz: ein Fenster

- **Das Studio ist das einzige Hauptfenster** — vom ersten Start an. Die Einrichtung ist ein **Overlay im Studio** (wie `AppRootSurfaces.tsx`), kein eigenes `NSWindow`.
  Das Assistentenfenster (`FensterSteuerung.Art.einrichtung`, `baueEinrichtungsFenster`) entfällt.
- Menü „Kortex einrichten …“, die Karte ohne Vault und `einrichtung-oeffnen` öffnen das Overlay im Studio (Studio nach vorn, `StudioBefehl.einrichtung(ab:)`), nie ein zweites Fenster.
- Am Ende schließt das Overlay; das Studio ist schon da und lädt den neuen Vault **in der Seite** (`ladeAlles`), ohne Fenster zu schließen und neu zu öffnen.
- Erlaubte Zusatzfenster bleiben nur dort, wo sie ein eigener Zweck sind: „Schnell erfassen“ (globales Schwebefenster) und die Übersicht. Rückfragen-Fenster (`AppZustand.swift:614`)
  und Start-`NSAlert`s (`:325`) werden zu Bannern bzw. Ansichten im Studio (eigenes Paket, E7).
- Systemdialoge nur für die Ordnerwahl, immer als Sheet am Studio. Mitteilungs-Erlaubnis nur nach einem Klick („Probe senden“ / Schalter), nie beim Start.
- Fenstergröße beim ersten Start: wie heute 85 % mittig; das Overlay ist höchstens 1100 × 900 und nutzt die gleiche Hülle wie die Dialoge (Radius, Schatten aus §6 design-wizards).

### 4.2 Ablauf vom ersten Start bis zum fertigen Vault

```
App startet ─► Studio-Fenster (leer, Hintergrund ruhig) ─► Overlay „Kortex einrichten“
   1 Vault   ── Neuer Vault (↩, Vorgabe ~/Kortex) │ Ordner öffnen │ Von GitHub holen │ Beispiel ansehen
   2 KI      ── gefundene Programme · ein Klick „Verbinden“ (System-Konto, Stufe Posteingang) · Anmelden im Overlay
   3 Sicherung ─ GitHub-Gerätecode im Overlay · „Nur auf diesem Mac“            (entfällt, wenn der Vault schon gesichert ist)
   └─► Overlay schließt, Studio zeigt den Vault; in der Seitenleiste „Einrichtung 2/4“ mit Ring für den Rest
```

| Thema | Heute | Orca | Kortex neu |
|---|---|---|---|
| Ort | eigenes Fenster 1200 × 780 | Overlay im Hauptfenster | Overlay im Studio, Zieh-Streifen 32 px, Studio dahinter `inert` |
| Willkommen | eigener Schritt 0 (Hero, git-Prüfung) | keiner, Augenbraue „Welcome to …“ auf Seite 1 | Hero-Kopf (Zeichen, Augenbraue, Titel) **über** Schritt 1; git still geprüft, Karte nur bei Mangel |
| Schritte | Willkommen · Vault · Sicherung · KI · Fertig | 4–5, erfüllte entfallen | **Vault · KI · Sicherung**; KI entfällt, wenn schon eine KI für den Vault verbunden ist; Sicherung, wenn ein Remote da ist; kein „Fertig“-Bild |
| KI-Schritt | Wizard im Wizard (5 Unterschritte) | Kachel wählen, fertig | Liste der gefundenen Programme, je Zeile ein Knopf; Konto nur, wenn es mehr als eins gibt (kleine Auswahl in der Zeile); Stufe als Vorgabe „Posteingang“ mit „Ändern“; Prüfen läuft still mit, das Ergebnis steht als Haken in der Zeile |
| Anmelden | Terminal.app, im Assistenten kaputt (K1) | im Fenster (Shim, Code, Gerätecode) | im Overlay, siehe 4.4 |
| Fortschritt | Windung + „N von 4“ | Pillen + „N of M“, anklickbar | Pillen nach Orca-Maßen + „1 von 3“, anklickbar bis zum weitesten erreichten Schritt |
| Tastatur | ↩, ⌘↩, ⌘[, 1–4, Esc | ⌘↩, Esc | ⌘↩ weiter (↩ nur außerhalb von Feldern und Knöpfen), ⌘[ zurück, Esc → Rückfrage, Sperre gegen Wiederholung |
| Überspringen | „Später“ legt still `~/Kortex` an (K8) | „Skip to project setup“ + Rückfrage | „Später“ (links unten) mit Rückfrage „Einrichtung überspringen? Du findest sie in der Seitenleiste.“; **legt nichts an**; danach leerer Zustand mit „Neuer Vault“ / „Ordner öffnen“ |
| Fortsetzen | Fenster geht beim nächsten Start wieder auf (ab Anfang der Seite) | `lastCompletedStep` + `flowVersion` | `einrichtung.json` bekommt `letzterSchritt` und `ablaufVersion`; Overlay macht dort weiter; alte Dateien werden umgerechnet |
| Vertrauen | Dialog im Studio **nach** der Einrichtung | – | beim Weg „Ordner öffnen“/„Von GitHub holen“ als Zeile im Vault-Schritt („Diesem Ordner vertrauen“, Vorgabe aus, Erklärung wie heute); kein Dialog danach |
| Ende | Fensterwechsel mit Animation | Overlay zu, Dialog „Add a project“ im selben Fenster | Overlay zu (Zeichen schrumpft in die Seitenleiste, 280 ms, bei reduzierter Bewegung sofort); Toast „Dein Vault ist bereit“ |
| Danach | – | Landing, Checkliste mit Ring, ein Tipp je Sitzung | leerer Zustand nach `Landing.tsx` (zwei Knöpfe, drei Tastenhinweise); **Checkliste „Einrichtung“** in der Seitenleiste mit Ring (KI verbinden, Sicherung, Kontingent anzeigen, Mitteilungen), ausblendbar |

### 4.3 Konten (Einstellungen → „KI & Konten“, Bereich „Konten“)

| Thema | Heute | Orca | Kortex neu |
|---|---|---|---|
| Aufbau | Programmkarten, Kontozeilen, Matrix, Ampel, Frag, Pflege, Schalter, Aktivität auf einer Seite | je Programm eine Karte, Einleitung „optional“ | Unterbereiche **Konten** · **Zugriff** (Matrix, Ampel) · **Kontingent** · **Pflege & Frag**; „Konten“ zuerst, je Programm eine Karte nach `AccountsPane.tsx` |
| Kontozeile | Name, Ordner, Zustandspunkte | E-Mail, Organisation, Plan, Verbrauch, Abzeichen | Name (umbenennbar), darunter Identität (falls freigegeben, 4.5 E1), Abzeichen **Aktiv** · **Anmelden nötig** · **Abgelaufen**, Mini-Balken des Kontingents, Menü (Anmelden, Umbenennen, Entfernen) |
| Aktives Konto | gibt es nicht (K4) | ein aktives Konto je Programm | **ein aktives Konto je Programm** in `ki-konten.json` (nicht `localStorage`): Vorgabe für Frag, für neue Verbindungen und als Vorschlag fürs Pflege-Konto. Pflege-Konto je Vault bleibt als Abweichung unter „Pflege & Frag“. „Wechsel gilt ab der nächsten Frage“ |
| Hinzufügen | Ordner sofort, dann Terminal | erst Anmeldung, dann veröffentlichen | Ordner als `…/ki-konten-ordner/.neu-<id>`; erst nach bestätigter Anmeldung umbenannt und in die Liste; Abbruch räumt auf (K6) |
| Doppelte | – | E-Mail + Organisation | nur mit freigegebener Identität: Hinweis „Gleiches Konto wie ‚Privat‘“, kein Automatismus |
| Lesen ohne Nebenwirkung | `GET /api/ki/konten` legt an (K7) | – | `GET` nur lesend, Abgleich nur über `POST /api/ki/konten/abgleich` (Plan war das schon, `ki-konten.md` 3.3) |
| Stufe | im Assistenten eigener Schritt | – | Vorgabe „Posteingang“ für das Konto, das der Nutzer im Overlay verbindet; Änderung über „Ändern“ in der Zeile; Regeln aus `ki-konten.md` bleiben (neue Konten gesperrt, Sperren mit Rückfrage) |

### 4.4 Anmelden im Fenster

- Swift startet die Anmeldung **ohne Terminalfenster** als Kindprozess mit gebauter Umgebung (`CLAUDE_CONFIG_DIR` bzw. `CODEX_HOME` des Kontos, alle anderen Konto-/XDG-Variablen
  entfernt; Muster aus `KiErkennung`), eigener Prozessgruppe und Frist (Claude 10 min, Codex 3 min, Codex-Gerätecode 15 min — Orca-Werte).
- Claude: `claude auth login` mit `BROWSER` auf einen Kortex-Shim, der nur die Adresse an die App meldet; das Overlay zeigt „Im Browser anmelden“ (öffnet sie), „Link kopieren“ und —
  falls das Programm einen Code verlangt — ein Feld „Code einfügen“, der auf stdin geht. **Kortex liest nur die Adresse aus der Ausgabe, nie Token oder Dateien des Logins.**
- Codex: `codex login --device-auth`; Code und Adresse stehen im Overlay wie heute beim GitHub-Gerätecode.
- Fertig erkennt Kortex wie heute über `claude auth status` / `codex login status` (nur ja/nein).
- Rückfall, wenn das Programm die Adresse nicht ausgibt oder eine Version das anders macht: der heutige Weg über Terminal.app, als leiser Link „Im Terminal anmelden“.
- Damit verschwindet K1 von selbst (das Overlay läuft im Studio, das die `KiRoute` hat).

### 4.5 Kontingent (Einstellungen → „KI & Konten“ → „Kontingent“, Statusleiste)

| Thema | Heute | Orca | Kortex neu |
|---|---|---|---|
| Claude-Quelle | Statuszeilen-Kette nach Einwilligung | OAuth-Endpunkt + Statuszeile | **Statuszeile bleibt die Quelle** (keine Zugangsdaten, kein Anbieter-Aufruf). Einwilligung wird Teil des KI-Schritts („Kontingent in Kortex anzeigen“, Vorgabe an für von Kortex angelegte Konten, mit Satz was geändert wird) |
| Ohne Werte | leer | „Updates when Claude runs“ | „Erscheint, sobald Claude Code das nächste Mal läuft“ statt Leere |
| Veraltete Sitzungen | übernommen | monotone Regel | Orca-Regel übernehmen: im selben Fenster nur steigend, Rücksetzzeiten ±60 s gleich |
| Takt | 15/5 min, Fehlerpause | dazu nur bei sichtbarem Fenster, Aktivieren frischt auf, `Retry-After` | übernehmen (Codex-Abfrage nur bei sichtbarem Studio; bei Aktivieren, wenn älter als 5 min) |
| Anzeige | Balken je Konto | Popover „alle Agenten“, verbraucht/übrig, ruhig veraltet | Popover „Kontingent“ aus der Statusleiste mit allen Konten, Auffrischen, „Konten verwalten …“; Wahl **verbraucht/übrig** (Einstellung); Warnzeichen erst bei Fehler **und** > 30 min |
| Warnungen | – | keine Systemmitteilung | Kortex-eigene, abschaltbare Mitteilung bei 80 % und 100 % je Fenster, höchstens einmal je Fenster (bestehender `MitteilungsPlaner`) |
| Statistik | – | lokale JSONL-Auswertung, Preise | **optional, aus, lokal**: Token je Tag/Modell/Konto aus den Sitzungsprotokollen der eigenen Konten; nur Zahlenfelder werden gelesen, nichts verlässt den Mac (E6) |

### 4.6 Einstellungen, Statusleiste, Mitteilungen

| Thema | Heute | Orca | Kortex neu |
|---|---|---|---|
| Statusleiste eng | feste Breakpoints 1180/960 px blenden Teile aus (`design-wizards.md` §9) | Dichte-Leiter, gemessen | Dichte-Leiter für den Kontingent-Teil (voll → kompakt → knappstes Fenster → „+N“ → Symbol); Rest wie heute |
| Teile wählen | – | Rechtsklick-Menü | Rechtsklick auf die Statusleiste: Kontingent je Konto, Wörter, Format ein/aus |
| Mitteilungs-Erlaubnis | erst bei „Probe“ gefragt, sonst still | Erlaubnis-Karte mit Zustand | Karte oben in Einstellungen → Mitteilungen (prüfen · erlaubt · abgelehnt mit „Systemeinstellungen öffnen“); Probe aktualisiert sie |
| Mitteilung bei offenem Fenster | Schalter „nur im Hintergrund“ | `suppressWhenFocused`, 5 s Sperre, Rückzug beim Lesen | 5 s Sperre je Schlüssel ergänzen; Rückzug gibt es schon (`ziehtZugestelltesZurueck`) |
| Hinweise | Toasts, Banner | Toasts über einem Kartenstapel | Kartenstapel unten rechts für bleibende Hinweise (Update bereit, Kontingent voll, „Neues KI-Konto gefunden“), Toasts darüber |
| „Nicht mehr fragen“ | – | nur bei Bestätigen, Toast mit Rückweg | übernehmen für Sperren-Rückfrage, Umstellen und Vault entfernen |
| Sprung in Einstellungen | `#einstellungen/<bereich>?ziel=` (1,6 s) | Datenobjekt, wartet auf Ziel, 3 s | Ziel aus Toasts/Karten nutzbar machen (`absicht`), wartet auf das Ziel |

### 4.7 Übernahme-Liste

**1:1 (Werte, Muster, Logik)**

1. Einrichtung als Overlay im einen Hauptfenster; Ende ohne Fensterwechsel (`AppRootSurfaces.tsx`, `OnboardingFlow.tsx`).
2. Pillen-Fortschritt mit Maßen (4 px; 40/24 px; 100/70/25 %), anklickbar, „N von M“; erfüllte Schritte fallen aus der Leiste (`onboarding-flow-state.ts`).
3. ⌘↩ weiter mit Tastenchip, Esc → kleine Rückfrage 360 px, Sperre gegen Tastenwiederholung (`OnboardingFooter.tsx`, `screen-submit-shortcut.ts`).
4. Fortsetzen über „letzter erledigter Schritt“ + Ablauf-Version mit Umrechnung (`use-onboarding-flow-persistence.ts`).
5. Erkannte Auswahl einmal vorbelegen, Nutzerklick nie überschreiben (`use-onboarding-flow.ts`).
6. Konto erst nach erfolgreicher Anmeldung veröffentlichen, Abbruch räumt auf (`claude-account-registration.ts`).
7. Anmelde-Fristen 10 min / 3 min / 15 min; Gerätecode-Muster `[A-Z0-9]{4,}(-[A-Z0-9]{4,})+` (`codex-device-auth-prompt.ts`).
8. Kontingent-Takt inkl. „nur bei sichtbarem Fenster“, Aktivieren frischt auf, `Retry-After` ≤ 24 h, max. 8 Fehler in Folge (`service-types.ts:99–121`, `service-polling.ts`).
9. Monotone Regel gegen veraltete Statuszeilen-Werte, ±60 s (`claude-usage-window.ts`).
10. „Ruhig veraltet“: Warnzeichen erst bei Fehler und > 30 min (`StatusBarProviderSegment.tsx:35`); Farbschwellen 60/80 (schon da).
11. Leerer Zustand: zwei Knöpfe, drei Tastenhinweise; Mangelkarte nur bei echtem Mangel (`Landing.tsx`, `landing-preflight-issues.ts`).
12. Checkliste mit Ring in der Seitenleiste, ausblendbar; Tipps: einer je Sitzung, nie während der Einrichtung, „gesehen“ beim Zeigen (`SetupGuideSidebarEntry.tsx`, `S/feature-tips.ts`).
13. Ein-Instanz-Regel und „vorhandenes Fenster holen“ mit Wiederherstellen (`focus-existing-window.ts`) — Kortex prüft beim Start, ob schon eine Instanz derselben Kennung läuft.
14. Mitteilungen: 5 s Sperre je Schlüssel (`S/notification-burst-cooldown.ts`), Erlaubnis-Karte mit Abfrage alle 2,5 s bis ~3 min (`mac-notification-permission-card.tsx`).
15. Rückfrage mit „Nicht mehr fragen“, gemerkt nur beim Bestätigen, Toast mit Sprung zur Einstellung (`confirmation-dialog.tsx`, `confirmation-skip-preference.ts`).
16. Kartenstapel 360 px unten rechts, Toasts darüber über eine Höhen-Variable (`NotificationCardStack.tsx`, `ui/sonner.tsx`); Dichte-Leiter der Statusleiste (`status-bar-density.ts`).

**Anpassen**

- Schritte: Orca fragt Arbeitsweise, Agent, Aussehen, Mitteilungen; Kortex fragt **Vault, KI, Sicherung** (Aussehen folgt dem System, Mitteilungen in die Checkliste).
- Anmelden: statt eingebettetem Terminal (Kortex hat keins) die Shim-/Gerätecode-Variante im Overlay; Terminal.app nur als Rückfall.
- Aktives Konto: Orca braucht einen Shell-Wrapper für Terminals; Kortex startet `claude` nur selbst (Frag, Pflege) und setzt die Umgebung dort — **kein** Eingriff in die Shell des Nutzers.
- Identität (E-Mail/Plan): siehe offene Entscheidung E1.
- Vertrauen in den Vault-Schritt ziehen (eigene Kortex-Regel, kein Orca-Vorbild).
- Wechsel bei laufenden Sitzungen: Kortex hat nur Frag-Läufe; statt Dialog der Satz „gilt ab der nächsten Frage“.
- Kontingent-Warnung als Kortex-eigene Mitteilung (Orca hat keine).

**Bewusst nicht**

- OAuth-Token aus Schlüsselbund oder `.credentials.json` und Aufrufe von `api.anthropic.com/api/oauth/usage` bzw. `chatgpt.com/backend-api/wham/usage` (Kortex-Regel: keine fremden Zugangsdaten,
  kein Anbieter-Aufruf; siehe offene Entscheidung E2).
- Telemetrie jeder Art (Orca: an für Neuinstallationen, `agent-token-usage-reporter.ts`); Stern-Bitte, Cloud-Konto, „Unexpected signout“-Karte.
- `claude`-Shell-Wrapper, Profil-Verlinkung von `~/.claude` in neue Konten (`claude-profile-sharing.ts`) — greift tief in die Einrichtung des Nutzers ein.
- Schritt „Aussehen“, Sprachwahl, Windows/WSL, Remote/SSH.
- Name, Logo, Programmlogos und Texte von Orca.

---

## 5. Offene Entscheidungen (mit Empfehlung)

| # | Frage | Empfehlung |
|---|---|---|
| E1 | Darf Kortex die **Identität** eines Kontos anzeigen (E-Mail, Plan)? Orca liest `oauthAccount` aus `.claude.json`. | Ja, aber nur über das Programm selbst: `claude auth status` (bzw. `codex login status`) liefert je nach Version mehr als ja/nein — **ungeprüft, vor dem Bau mit einem Platzhalter-Programm und der echten Ausgabe nachsehen**. Nur anzeigen, nicht speichern; Schalter „Kontonamen vom Programm zeigen“ (Vorgabe an). Kein Lesen von `.claude.json`. |
| E2 | Kontingent auch ohne laufende Claude-Sitzung (Orca: OAuth-Endpunkt)? | Nein, Regel bleibt. Stattdessen ehrlicher Text („erscheint beim nächsten Lauf“) und die Statuszeile im KI-Schritt einschalten. |
| E3 | Lokale Token-Statistik (E6) überhaupt? | Ja, aber eigenes späteres Paket, Vorgabe aus, nur Zahlenfelder. |
| E4 | Rückfragen-Fenster ins Studio? | Ja (E7), passt zum Ein-Fenster-Grundsatz. |

---

## 6. Arbeitspakete (Reihenfolge)

| # | Paket | Größe | Risiko | Prüfung | Prototyp zuerst? |
|---|---|---|---|---|---|
| E0 | **Klickbarer HTML-Prototyp**: Studio leer + Overlay mit drei Schritten (inkl. KI-Zeile mit Konto-Auswahl, Anmelden mit Link/Code, Gerätecode), Überspringen-Rückfrage, Ende ins Studio, Checkliste mit Ring, Popover „Kontingent“, Bereich „Konten“; hell/dunkel, mit echten `bausteine.js`-Bausteinen | M | gering | Durchklicken mit dem Nutzer, Bilder hell/dunkel | — (ist der Prototyp) |
| E1 | **Ein Fenster** (Swift + Studio): `Art.einrichtung` entfällt; `einrichtung.js` wird Modul im Studio (`#einrichtung-host`, Studio `inert`); `zeigeAssistent`/`einrichtung-oeffnen`/Menü → `StudioBefehl`; Rechte der Aktionen `git-pruefen`, `git-installieren`, `kopieren`, `einrichtung-ende` an „Overlay offen“ statt an das Fenster binden (`EinrichtungsFenster.nurAusEinrichtung`); Vault-Wechsel ohne Studio-Neustart; Start-`NSAlert`s als Banner | L | **hoch** (Startpfad, Aktionsrechte, Vorschau) | Swift: Startentscheidung, Aktionsrechte; Playwright: Overlay, Tastatur, Fortsetzen; Vorschau-Test „genau ein Studiofenster“ über `fenster-auf` im Log; `scripts/teste-vorschau.sh --app` | Gestaltung aus E0 |
| E2 | **Ablauf neu**: drei Schritte, Auto-Überspringen, Pillen, ⌘↩/Esc, Fortsetzen (`einrichtung.json` v2 mit Umrechnung), „Später“ ohne stilles Anlegen, Vertrauen im Vault-Schritt, leerer Zustand, Checkliste | M | mittel | Playwright je Weg (neu, öffnen, klonen, Beispiel; mit/ohne git, mit/ohne KI), Swift-Test für die Dateiumrechnung | ja (E0) |
| E3 | **Anmelden im Overlay**: Swift-Anmeldelauf mit Shim, Code-Feld, Codex-Gerätecode, Fristen, Prozessgruppe; Konto erst nach Anmeldung veröffentlichen | M–L | **hoch** (Prozesse, nie Zugangsdaten lesen) | Swift mit Platzhalter-`claude`/`codex` im Vorschau-PATH (geben Adresse/Code aus); nie echte Logins; Test, dass nichts außer der Adresse gelesen wird | ja (E0) |
| E4 | **Konten-Bereich**: Unterbereiche, aktives Konto je Programm in `ki-konten.json` (Migration aus `localStorage`), Abzeichen, `GET` ohne Nebenwirkung, Identität nach E1 | M | mittel | Node: Migration, Parität Kern/Werkstatt; Playwright: Bereich hell/dunkel, Wechsel | ja (E0) |
| E5 | **Kontingent wie Orca**: Popover, verbraucht/übrig, ruhig veraltet, monotone Regel, Takt nur bei sichtbarem Fenster, `Retry-After`, Mitteilung 80/100 %, Einschalten im KI-Schritt | M | mittel | Node: reine Funktionen (Monotonie, Takt, Texte); Playwright: Popover, Statusleiste | Popover in E0 |
| E6 | Lokale Nutzungsstatistik (optional, aus) | L | mittel (Datenschutz) | Node mit erfundenen JSONL-Dateien, Test „nur Zahlenfelder“ | ja, eigener kleiner Prototyp |
| E7 | Rückfragen und Hinweise ins Studio, Ein-Instanz-Prüfung, Tipps-Regel; Kartenstapel, Erlaubnis-Karte, 5-s-Sperre, „Nicht mehr fragen“, Dichte-Leiter und Rechtsklick-Menü der Statusleiste (4.6) | M | mittel | Swift + Playwright (enge Fenster 900/1000/1180 px, Mitteilungs-Planer-Tests) | Kartenstapel und Statusleiste in E0 |
| — | **Ein Opus-Review** über E1–E5 (frischer Kontext, ganzer Diff), dann nachbessern | — | — | — | — |

Stand: E1 (ein Fenster) und E2 (Ablauf neu: Vault · KI · Sicherung, Auto-Überspringen, Fortsetzen mit `einrichtung.json` Fassung 2, Vertrauen im Vault-Schritt, Checkliste, Sitzung von der Seite bestätigt) sind umgesetzt; Beschreibung in `docs/ENTWICKLUNG.md` („Ein Fenster“).
E5 (Kontingent wie Orca: Takt nur bei sichtbarem Fenster, monotone Regel, Dichte-Leiter und Rechtsklick-Menü der Statusleiste, Popover „Kontingent“, verbraucht/übrig, ruhig veraltet, Mitteilung bei 80/100 %) ist umgesetzt; Beschreibung in `docs/ENTWICKLUNG.md` („Kontingent wie Orca“). Die Leiste zeigt die Konten, die Werte haben oder erwarten; ein noch nicht eingerichtetes Konto steht nur im Popover und in den Einstellungen. Abweichung zum Plan: Wählen des aktiven Kontos ist aus dem Statusleisten-Menü in „KI & Konten → Konten“ und das Frag-Feld gewandert.
Abweichung von 4.2: Die Umrechnung von `einrichtung.json` liegt in Swift (`EinrichtungsDatei.umgerechnet()`), weil die Datei der Hülle gehört; geprüft in `EinrichtungsZustandTests`. Der Haken für E3 ist `studio/einrichtung-anmeldung.js`.

Reihenfolge: E0 → (Freigabe) → E1 → E2 → E3 → E4 → E5 → Review → E6/E7. E1 und E2 gehören eng zusammen (gleiche Dateien); E3 hängt an E1 (KiRoute im Overlay), E4 und E5 sind danach
unabhängig voneinander.

**Fertig heißt:** Vom ersten Start bis zum fertigen Vault ist genau ein Studiofenster offen (Log, Vorschau); kein Weg öffnet mehr ein Assistentenfenster; Anmelden bei Claude/Codex
gelingt im Platzhalter-Test ohne Terminal.app; alle bestehenden Specs grün; THIRD-PARTY-NOTICES nennt Commit `239e17f` und die neuen Muster.

## 7. Was nicht geprüft ist

- Ob `claude auth login` die Adresse über `BROWSER` ausgibt bzw. auf einen Shim hört, und was `claude auth status` außer ja/nein liefert — nur aus Orcas Code abgeleitet, nicht mit
  dem echten Programm getestet (bewusst: keine echten Logins).
- Den Ablauf in der Vorschau habe ich nur bis zum Startbild gesehen; die Stapelfälle 2.2 (1)–(3) sind aus dem Code belegt, nicht per Foto.
- Orca selbst nicht gestartet; alle Orca-Angaben aus dem Quelltext @239e17f, teils über Unteragenten gelesen und stichprobenartig nachgeprüft (Overlay, Takt-Konstanten, 60/80, Schrittzahl).
