# Stand Kortex, 28.10.2026

Abgelegt vom CEO (FBL-117). Momentaufnahme aus Paperclip und GitHub. Gültig bleibt der jeweils aktuelle Stand in Paperclip. Links der Form `/FBL/issues/…` zeigen auf Paperclip.

## Dateien in diesem Ordner

| Datei | Inhalt | Quelle |
|---|---|---|
| [nordstern.md](nordstern.md) | Produktziel, Messlatte für „fertig“, Meilensteine 1–6 | FBL-66, Dokument „Nordstern Kortex“ |
| [produktplan.md](produktplan.md) | Ideen der Produktrunde 2, nach Hebel sortiert | FBL-66, Dokument „Produktplan“ |
| [roadmap-fbl-16.md](roadmap-fbl-16.md) | Phasen 0–5 und Prüfergebnis der Produktrunde 2 | FBL-16, Dokument „Roadmap“ |
| [pruefliste-veroeffentlichung.md](pruefliste-veroeffentlichung.md) | Prüfliste „bereit zur Veröffentlichung“, Lizenz-Vorschlag | FBL-75 |
| [stand-abend.md](stand-abend.md) | Nachtrag abends: Entscheidung „ein Repo, eine App“, gemergte und offene PRs, nächste Schritte | Claude Code |

Specs und Pläne liegen schon im Repo: `docs/superpowers/specs/` (App-Design, Studio v2, Lernkreislauf) und `docs/superpowers/plans/` (M1, M2a, B1–B3).

## Meilensteine

| # | Meilenstein | Paperclip | Stand |
|---|---|---|---|
| 1 | Produktrunde 2: Kontext-Paket, Posteingang, KI verbinden, Nutzungsmessung | FBL-67 | `brain_kontext` gemergt (#13). Posteingang (FBL-68) und Nutzungsmessung (FBL-72) in Arbeit, KI verbinden als PR #14 offen. Abnahme FBL-73 wartet. |
| 2 | Assistent „Kortex einrichten“ mit Vaults und git-Client | FBL-74 | GitHub-Anmeldung per Gerätecode als PR #12 offen. git-Prüfung (FBL-85), Assistent (FBL-87), Sicherung (FBL-88) und Abnahme (FBL-89) warten. |
| 3 | Zuverlässigkeit belegen, Suche und Frische härten | FBL-90 | Gesundheitswert (FBL-95) und Kit-Vorlage (FBL-96) fertig. Frische (Kit-PR #12) und Wächter (Kit-PR #13, im Review) offen. BM25-Probe (FBL-91) und ⚠ in der Menüleiste (FBL-94) stehen als Nächstes an. |
| 4 | Verteilung: DMG, Signatur, Notarisierung, Sparkle | – | In CI fertig (FBL-26, FBL-44, FBL-42, Rauchtest FBL-47). Test auf einem frischen Mac steht noch aus. |
| 5 | Kit/MCP auf Linux und Windows | FBL-81 | Backlog |
| 6 | Öffentliches Repo „Kortex“ (nur Vorbereitung) | FBL-75 | Prüfbericht private Daten fertig (FBL-76). Bereinigung, README und Cask im Backlog (FBL-77 bis FBL-80). |
| Kit | B1–B3 neu bauen (alter Code `kit-v0.7`–`v0.9` ist verloren) | FBL-98 | B1-6 `heikel.mjs` fertig. B1-1 `beleg.mjs` (Kit-PR #14) und B1-7 `seitenfelder.mjs` (Kit-PR #16, Review FBL-114) offen. B1-2 bis B1-10 bauen darauf auf. Danach werden B2 (FBL-109) und B3 (FBL-110) zugeschnitten. |

## Offene Pull Requests

**brain-app**
- #14 KI verbinden: Codex und Cursor, mit Selbsttest (FBL-70)
- #12 GitHub-Anmeldung per Gerätecode, Token nur im Schlüsselbund (FBL-86)

**second-brain-kit**
- #16 B1-7 `seitenfelder.mjs` + Lint (FBL-105)
- #14 B1-1 `beleg.mjs` (FBL-99)
- #13 Wächter für Zuführungen (FBL-93)
- #12 Suche: neuere Fakten gewinnen, Widerspruch anzeigen (FBL-92)
- #9 Kit-Adresse auf `fabiobrogno` umstellen (FBL-2; wartet auf den Windows-Fix FBL-55)

## Team

| Agent | Rolle |
|---|---|
| CEO | Produktziel, Aufsicht, Ansprechpartner für Fabio |
| Leitstand | Schneidet Meilensteine in Aufgaben (≤ 1 PR), verteilt sie, merged |
| Brain-Engineer | App (Swift, Studio) |
| Context-Engineer | Kit, MCP, Kontext |
| Reviewer | Review jedes PR vor dem Merge |
| Release-QA | CI, Rauchtest, Abnahmen |

## Entscheidungen, die nur Fabio trifft

- Kortex im echten `~/brain` live schalten (Spec §9)
- Öffentlicher Release, öffentliche Bundle-ID und Repo-Name
- Lizenz (Vorschlag: MIT beibehalten)
- Ob der 7-Tage-Dauerlauf (FBL-84) auf seinem Mac mit einem Test-Vault laufen darf

## Alle Kortex-Aufgaben nach Status

Ohne Aufgaben, die nichts mit Kortex zu tun haben (Müll-Erinnerung, Gmail, Telegram, Onboarding).

### In Arbeit (5)

| Aufgabe | Wer | Titel |
|---|---|---|
| FBL-68 | Brain-Engineer | Posteingang sichten: Verwerfen und Später direkt an der Karte (Studio) |
| FBL-72 | Context-Engineer | Lokale Nutzungsmessung: welche Seiten die KI per MCP abruft |
| FBL-99 | Context-Engineer | B1-1: beleg.mjs neu bauen (Zitat finden, Herkunft je Rolle) mit Prüfset |
| FBL-113 | CEO | Statuscheck: Arbeiten alle Agents produktiv? |
| FBL-117 | CEO | Aktuelle Pläne und Projektstände im brain-app-Repo ablegen |

### Im Review (2)

| Aufgabe | Wer | Titel |
|---|---|---|
| FBL-93 | Context-Engineer | Wächter für Zuführungen: stillstehende Quellen erkennen und im Tagesbericht melden |
| FBL-97 | CEO | Leitstand-Läufe bekommen keine GitHub-Anmeldung (für FBL-62) |

### Als Nächstes (4)

| Aufgabe | Wer | Titel |
|---|---|---|
| FBL-91 | Release-QA | Probe: Suche nur mit BM25 gegen BM25+Vektoren messen |
| FBL-94 | Brain-Engineer | Menüleiste: ⚠ wenn eine Zuführung still steht |
| FBL-114 | Reviewer | Review PR #16 (B1-7) |
| FBL-118 | CEO | Brain-Aufsicht: PRs, CI und hängende Aufgaben (brain-app) |

### Blockiert / wartet (26)

| Aufgabe | Wer | Titel |
|---|---|---|
| FBL-2 | Leitstand | Kit-Adressen von fbrogno auf fabiobrogno umstellen (PR) |
| FBL-16 | Leitstand | Second Brain weiterentwickeln: unsichtbares Kontext-Management + Mac-Brain-App (Name, Agent-Team) |
| FBL-55 | Release-QA | Kit-CI: Windows-Fehler in run-all.sh beheben (Voraussetzung für PR #9) |
| FBL-67 | Leitstand | Kortex Produktrunde: Ideen aus dem Produktplan prüfen, zuschneiden, verteilen und bauen lassen |
| FBL-70 | Leitstand | KI verbinden: Codex und Cursor zusätzlich zu Claude, mit Selbsttest |
| FBL-71 | Brain-Engineer | Posteingang: Notiz in eine Wiki-Seite übernehmen (Studio) |
| FBL-73 | Release-QA | Abnahme Produktrunde 2: Rauchtest und Selbstfotos für alle neuen Funktionen |
| FBL-74 | Leitstand | Meilenstein: Assistent „Kortex einrichten“ mit Vaults und git-Client |
| FBL-75 | Leitstand | Meilenstein: Kortex öffentlich-tauglich machen (Vorbereitung, kein Release) |
| FBL-85 | Brain-Engineer | Einrichtung: git prüfen und Apples Installationsdialog auslösen |
| FBL-87 | Brain-Engineer | Assistent „Kortex einrichten“: geführte Schritte von Vault bis Probe-Frage |
| FBL-88 | Context-Engineer | Assistent-Schritt „Sicherung“: privates GitHub-Repo anlegen oder wählen |
| FBL-89 | Release-QA | Abnahme „Kortex einrichten“: Rauchtest auf frischem macOS mit Selbstfotos aller Schritte |
| FBL-90 | Leitstand | Meilenstein: Suche und Frische härten (Ideen aus Video-Auswertung) |
| FBL-92 | Context-Engineer | Suche: neuere Fakten gewinnen, Widerspruch wird angezeigt |
| FBL-98 | Leitstand | Meilenstein: Kit B1–B3 nach den Plänen neu bauen (Wahrheit/Belege, Tageslauf, Pflege) |
| FBL-100 | Context-Engineer | B1-2: beleg-ernte.mjs – Sperre fürs eigene Brain, Fundstelle, Web-Adresse |
| FBL-101 | Context-Engineer | B1-3: Vorschläge tragen den Beleg (zitat, herkunft, fundstelle, quelle_url) |
| FBL-102 | Context-Engineer | B1-4: Ernte mit Zitat – Auftrag, Werkzeug-Ausgaben, Beleg-Prüfung, Log |
| FBL-103 | Context-Engineer | B1-5: W7 – Fehler-Signal „Hinweis → Antwort → Korrektur“ (w7.mjs, Auslöser) |
| FBL-105 | Brain-Engineer | B1-7: seitenfelder.mjs + Lint KRITISCH, GILT_SEIT, ERSETZT, ERSETZT-HINWEIS, ZWEIFEL |
| FBL-106 | Brain-Engineer | B1-8: fakten.mjs + Lint FAKT-BELEG |
| FBL-107 | Brain-Engineer | B1-9: aliasse.mjs – auch_genannt, .logs/aliasse.json, Lint ALIAS + DOPPELTER NAME |
| FBL-108 | Release-QA | B1-10: B1-Abschluss – Schema-Doku, READMEs, volle Suite, publish-check |
| FBL-109 | Leitstand | B2 Tageslauf zuschneiden: Plan gegen B1-Code lesen, Aufgaben anlegen, Vertrag festlegen |
| FBL-110 | Leitstand | B3 Pflege zuschneiden: Plan gegen B2-Code lesen, Aufgaben anlegen |

### Backlog (8)

| Aufgabe | Wer | Titel |
|---|---|---|
| FBL-77 | Brain-Engineer | brain-app: private Pfade und Namen entfernen, Bundle-ID konfigurierbar |
| FBL-78 | Context-Engineer | second-brain-kit: private Pfade und Namen entfernen |
| FBL-79 | Release-QA | Englisches README für Kortex mit Screenshots, Installation und Architektur-Kurzbild |
| FBL-80 | Release-QA | Entwurf Homebrew-Cask „kortex“ (nicht veröffentlichen) |
| FBL-81 | Context-Engineer | Kit/MCP auf Linux und Windows mit einem Installationsbefehl (ohne App) |
| FBL-82 | Context-Engineer | Tokens pro Tag im Tagesbericht ausweisen |
| FBL-83 | Release-QA | Wiederanlauf des Hintergrunddienstes nach Absturz, Neustart und Schlaf belegen |
| FBL-84 | Release-QA | 7-Tage-Dauerlauf des Hintergrunddienstes mit Herzschlag-Protokoll |

### Erledigt (57)

- FBL-5 Verfügbare Gmail-Werkzeuge auflisten
- FBL-6 Gmail-Werkzeuge per ToolSearch auflisten
- FBL-17 Bestandsaufnahme: Stand B1–B3 vs. Code und Lücken im unsichtbaren Kontext-Management
- FBL-18 macOS-CI für brain-app: swift build + swift test auf GitHub Actions
- FBL-19 Kortex: Rückfragen-Zähler und Ja/Nein-Ansicht in der Menüleiste, Tagesbericht
- FBL-20 Kortex: App-Anzeigename von „Brain“ auf „Kortex“ umstellen
- FBL-22 CI/CD und Deploy fürs Brain optimieren (Vorbild OpenClaw)
- FBL-23 App-CI: Cache, shellcheck, dev-Artefakt, Release-Prüfung (Beta-Prerelease), ENTWICKLUNG.md
- FBL-25 studio-v2 nach main übernehmen (Brain Studio, Editor, Vertrauen v2)
- FBL-26 App in CI signieren und notarisieren (Developer ID, DMG, Sparkle)
- FBL-27 Opus-5.5-Leitagent für die Arbeitsverteilung einsetzen; CEO nur noch für Überwachung (Fehler, Timeouts, Optimierung)
- FBL-28 Leitstand: Lieferung übernehmen, abgebrochene Aufgaben wieder aufnehmen
- FBL-29 Diagnose: warum stockt die Arbeit im Team
- FBL-30 Brain-Aufsicht: PRs, CI und hängende Aufgaben (brain-app)
- FBL-31 Brain weiterentwickeln über Leitstand (CEO nur Aufsicht)
- FBL-32 Klären, warum am Brain nicht durchgehend gearbeitet wird
- FBL-33 Brain-Team wieder auslasten: Review PR #6 und unabhängige Aufgaben aus FBL-16
- FBL-34 Review PR #6: studio-v2 nach main (FBL-25)
- FBL-35 Zweitblick-Befunde abgleichen: Stand je Befund (33) für PR #6
- FBL-36 Playwright-Oberflächentests als CI-Job
- FBL-37 App-Seite der Roadmap: Stand nach studio-v2 und nächste Aufgaben
- FBL-38 Abgebrochene Läufe neu anstoßen: FBL-34, FBL-35, FBL-36
- FBL-40 Brain-Aufsicht: PRs, CI und hängende Aufgaben (brain-app)
- FBL-41 Nachprüfung PR #6: Fix Rückfragen-Vertrauen (d0d6a64) freigeben
- FBL-42 Release-Prüfung: Tag gegen App-Version prüfen und Appcast-Feed-URL klären
- FBL-43 FBL-36 wieder anstoßen (Release-QA, abgebrochener Lauf)
- FBL-44 Sparkle-Updates in die App einbauen (öffentlicher Schlüssel, Feed-Adresse)
- FBL-45 Brain-Aufsicht: PRs, CI und hängende Aufgaben (brain-app)
- FBL-46 PR #10 (Sparkle) auf main nachziehen: Merge-Konflikt nach #9 lösen
- FBL-47 Rauchtest und Selbstfoto in der macOS-CI (Roadmap A3)
- FBL-48 Sicherheits-Befunde nachprüfen: Tests für die kritischen Fixes und zurückgestellte Befunde klären
- FBL-49 Stand an FBL-16 melden und FBL-47 auf blockiert setzen
- FBL-50 Review PR #7: Playwright-Oberflächentests als CI-Job (FBL-36)
- FBL-51 GitHub-Identität für Reviewer-Agent bereitstellen (PR-Reviews auf brain-app)
- FBL-52 Branch ci/rauchtest-macos pushen und Kit-Option a/b/c wählen (für FBL-47)
- FBL-53 Brain-Aufsicht: PRs, CI und hängende Aufgaben (brain-app)
- FBL-54 Review PR #11: Rauchtest-Workflow mit Selbstfoto (FBL-47)
- FBL-56 GitHub-Brücke: CI-Logs für FBL-55 und FBL-47 auslesen
- FBL-57 Brain-Aufsicht: PRs, CI und hängende Aufgaben (brain-app)
- FBL-58 Review PR #11 (brain-app): Rauchtest-Workflow mit Selbstfoto (FBL-47)
- FBL-59 PR #11 (brain-app) mergen: Rauchtest-Workflow (FBL-47)
- FBL-60 Brain-Aufsicht: PRs, CI und hängende Aufgaben (brain-app)
- FBL-61 Brain-Aufsicht: PRs, CI und hängende Aufgaben (brain-app)
- FBL-62 Windows-Fix test-pre-commit als PR umsetzen (für FBL-55)
- FBL-63 GitHub-Zugang für Agenten fehlt wiederholt (github_identity_unavailable)
- FBL-64 Brain-Aufsicht: PRs, CI und hängende Aufgaben (brain-app)
- FBL-66 CEO übernimmt Führung: Brain-App eigenständig weiterentwickeln lassen
- FBL-69 MCP-Werkzeug brain_kontext: Kontext-Paket zum aktuellen Projekt
- FBL-76 Prüfbericht: private Pfade, Namen und Daten in brain-app und second-brain-kit
- FBL-86 GitHub-Anmeldung per Gerätecode, Token nur im Schlüsselbund
- FBL-95 Wöchentliches Aufräumen: Gesundheitswert 0–100
- FBL-96 Kit-Vorlage: Karte unter 200 Zeilen, Index je Ordner, „Wahrheit vor Zustimmung“
- FBL-104 B1-6: heikel.mjs neu bauen (Geld, Recht, Person, Zugang) mit Abnahmetest
- FBL-111 Review PR #11 (B1-6)
- FBL-112 Review PR #14 (B1-1: beleg.mjs)
- FBL-115 CEO → Leitstand: Windows-Fix über Engineer pushen + doppelte „in Arbeit“-Aufgaben aufräumen
- FBL-116 Windows-Fix test-pre-commit: Branch pushen, PR öffnen, CI grün (für FBL-62)
