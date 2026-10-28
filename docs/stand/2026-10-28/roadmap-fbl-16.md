# Roadmap: Second Brain, unsichtbares Kontext-Management + Mac-App

Stand: 28.10.2026 (Produktrunde 2 ergänzt) · Grundlage: [Bestandsaufnahme FBL-17](/FBL/issues/FBL-17#document-bestandsaufnahme) und eine eigene Prüfung des Kit-Repos.

## Neuer Befund nach FBL-17

Das Kit liegt öffentlich auf GitHub: `fabiobrogno/second-brain-kit`. Auf `main` liegt **v0.5.1** (12.10.2026). Dort gibt es keine Datei aus B1–B3 (`beleg.mjs`, `heikel.mjs`, `tageslauf.mjs`, `b3.mjs` fehlen), und es gibt keinen Branch `kit-v0.7`/`v0.8`/`v0.9`. Die Arbeit an B1–B3 liegt also **nur lokal auf Fabios Mac** und ist nicht gesichert. Erst wenn diese Branches gepusht sind, können wir sie prüfen, testen (die Kit-CI läuft bereits auf ubuntu/macos/windows) und weiterbauen.

## Ziel

Das Brain soll im KI-Alltag nebenher laufen: Es nimmt Wissen auf, hält es aktuell, belegt es und stellt es bereit. Fabio greift nur ein, wenn eine Rückfrage wirklich nötig ist, und das dauert dann 10 Sekunden in der Menüleiste.

## Phasen

| Phase | Inhalt | Wer | Abhängig von |
|---|---|---|---|
| **0 Fundament** | (a) Kit-Branches v0.7–v0.9 pushen · (b) macOS-CI für `brain-app` (Build + Tests auf GitHub Actions) | (a) Fabio · (b) Brain-Engineer → Reviewer | – |
| **1 Stand belegen** | FBL-17 §1 mit Datei-Belegen nachziehen, Kit-Tests von B1/B2 hier unter Linux laufen lassen | Context-Engineer | 0a |
| **2 B1+B2 live** | Merge nach `~/brain`, `automatik.tageslauf an`, `brain dienst an` | Fabio (bewusst manuell, Spec §9) | 1 |
| **3 Rückfragen in der App** | Menüleisten-Zähler, Ja/Nein-Ansicht für Rückfragen, Tagesbericht, `zurueck` per Klick | Brain-Engineer → Reviewer → Release-QA | 0b; Vertrag wird nach 1 gegen den echten Kit-Code geprüft |
| **4 Wirkung messen** | K11–K14 live, K15-Vergleich nach 30 Tagen | Release-QA + Fabios Sitzungen | 2 |
| **5 B3 Pflege-Intelligenz** | Inbox headless, Konsolidieren, neue Seiten | Context-Engineer | 2 und gemessene B2-Fehlerquote ≤ 5 % |

Phase 3 ist der größte Hebel für „unbemerkt“: Ohne App-Ansicht bremsen die Rückfragen die Einschwingphase (≤ 10 offene Prüfplätze), weil man dafür ein Terminal braucht.

## Sofort gestartet

- macOS-CI für `brain-app` (Phase 0b)
- Rückfragen-Ansicht (Phase 3), blockiert durch die CI, damit kein ungetesteter Swift-Code entsteht

## Bewusst nicht

- B3 vor gemessener B2-Qualität
- Automatisches Live-Schalten durch Agenten (Spec §9)
- Umbenennen von Repo/Bundle-ID, bevor der Name feststeht

## Entscheidungen (27.10.2026)

- **App-Name: Kortex.** Umgestellt wird nur der sichtbare Name ([FBL-20](/FBL/issues/FBL-20)). Bundle-ID `io.github.fbrogno.brain`, Modulnamen und Repo bleiben, damit auf dem Mac Einstellungen und Berechtigungen erhalten bleiben. Marken- und App-Store-Prüfung vor einer Veröffentlichung, weil es den Namen „Kortex“ für andere Produkte schon gibt.
- **Kit-Code:** Fabio pusht `kit-v0.7`–`v0.9` nach `fabiobrogno/second-brain-kit`. Danach startet Phase 1 ([FBL-21](/FBL/issues/FBL-21), Context-Engineer).

## Aufgaben

| Aufgabe | Phase | Status |
|---|---|---|
| [FBL-18](/FBL/issues/FBL-18) macOS-CI | 0b | läuft |
| [FBL-21](/FBL/issues/FBL-21) Stand B1–B3 belegen + Vertrag | 1 | wartet auf Push (0a) |
| [FBL-19](/FBL/issues/FBL-19) Rückfragen in der Menüleiste | 3 | wartet auf CI |
| [FBL-20](/FBL/issues/FBL-20) Anzeigename Kortex | – | wartet auf CI |

## Produktrunde 2 (ab 28.10.2026, [FBL-67](/FBL/issues/FBL-67))

Grundlage: [Produktplan](/FBL/issues/FBL-66#document-produktplan). Leitidee: Kortex arbeitet unbemerkt. Geprüft gegen `brain-app` main und Kit-Pläne B1–B3.

| Idee | Ergebnis der Prüfung |
|---|---|
| 1 Kontext beim Sitzungsstart | **Zugeschnitten.** Das Kit hat schon einen SessionStart-Hook für Claude Code. Wir bauen nur das MCP-Werkzeug `brain_kontext` und eine Zeile in der Regeldatei, damit jede KI es nutzt. Kein zweiter Hook. |
| 2 Inbox-Sichtung | **Gebaut in zwei Schritten.** Posteingang gibt es im Studio schon, es fehlen Verwerfen/Später und Übernehmen in eine Seite. |
| 3 Wiedervorlage veralteter Seiten | **Gestrichen.** Doppelung: Kit K7 legt `veraltet`-Rückfragen mit „Stimmt noch“ an, die App zeigt Rückfragen schon (FBL-19). |
| 4 Mehrere KI-Werkzeuge | **Gebaut:** Codex und Cursor zusätzlich zu Claude, mit Selbsttest. |
| 5 Nutzungsmessung | **Zugeschnitten.** Das Kit zählt nur Brain-Hinweise. Wir protokollieren MCP-Abrufe lokal im gleichen Format (`.logs/mcp.log`) und zeigen sie im Studio. Das Kit kann sie später mitzählen. |
| 6 Sitzungsende-Merkzettel | **Gestrichen.** Doppelung: Die Kit-Ernte läuft schon am Sitzungsende (SessionEnd/PreCompact) und legt Vorschläge an. |

| Aufgabe | Wer | Abhängig von | Stand |
|---|---|---|---|
| [FBL-68](/FBL/issues/FBL-68) Posteingang: Verwerfen und Später | Brain-Engineer | – | läuft |
| [FBL-69](/FBL/issues/FBL-69) MCP `brain_kontext` | Context-Engineer | – | läuft |
| [FBL-70](/FBL/issues/FBL-70) Codex und Cursor verbinden + Selbsttest | Release-QA | – | läuft |
| [FBL-71](/FBL/issues/FBL-71) Posteingang: in Seite übernehmen | Brain-Engineer | FBL-68 | wartet |
| [FBL-72](/FBL/issues/FBL-72) Lokale MCP-Nutzungsmessung | Context-Engineer | FBL-69 | wartet |
| [FBL-73](/FBL/issues/FBL-73) Abnahme mit Rauchtest und Selbstfotos | Release-QA | alle oben | wartet |

Jede Aufgabe: ein PR, dann Review durch den Reviewer, dann Merge durch den Leitstand nach grüner CI. Fabio wird in dieser Runde nicht gebraucht.
