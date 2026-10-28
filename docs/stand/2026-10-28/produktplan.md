# Produktplan Kortex: nächste Runde (CEO, 28.10.2026)

## Ausgangslage
- Gebaut und auf `main` (brain-app): Rückfragen und Tagesbericht in der Menüleiste (FBL-19), Anzeigename Kortex (FBL-20), Sparkle-Updates (#10), Signieren und Notarisieren in der CI (FBL-26), Playwright-Tests (#7), Rauchtest mit Selbstfoto (#11).
- In den letzten Tagen ging die meiste Kraft in CI und Release. Am Produkt selbst ist wenig dazugekommen.
- GitHub-Zugang geht wieder (28.10.). Damit laufen FBL-62, FBL-55 und FBL-2 weiter.
- Einzige echte Abhängigkeit von Fabio: Der Kit-Code B1–B3 liegt nur auf seinem Mac (`kit-v0.7`–`v0.9` fehlen auf origin, Stand 28.10.). Alles, was den echten Tageslauf braucht, wartet darauf. Alles andere läuft ab jetzt ohne ihn.

## Leitidee
Kortex soll unbemerkt arbeiten. Gutes Wissen kommt von selbst in jede KI-Sitzung, Neues kommt von selbst in die Inbox, und Fabio braucht pro Tag höchstens 10 Sekunden zum Bestätigen.

## Ideen, nach Hebel sortiert (Leitstand prüft vor dem Bau gegen Code und Kit-Pläne)
1. **Kontext-Paket beim Sitzungsstart.** Das MCP-Werkzeug `brain_kontext` liefert zum aktuellen Projekt (cwd/Repo-Name) die 3–8 belegten, aktuellen Seiten, mit Quellen und knapp gehalten. Kortex richtet das per Klick als Claude-Code-SessionStart-Hook ein. *Prüfen:* Überschneidung mit B2 §5.5 „Sitzungsstart“. Nicht doppelt bauen, sondern die App-Seite und den MCP-Teil liefern.
2. **Inbox-Sichtung in der App.** Merkzettel aus `brain_merken` als Liste mit „Übernehmen in Seite X“, „Verwerfen“ und „Später“. Das ist reine App-Arbeit und braucht B1–B3 nicht.
3. **Wiedervorlage veralteter Seiten.** Der Menüleisten-Zähler zählt auch abgelaufene Seiten. Ein Klick auf „gilt noch“ setzt das Prüfdatum neu, ein anderer öffnet die Seite.
4. **Einrichtung für mehrere KI-Werkzeuge.** MCP per Klick nicht nur für Claude Code, sondern auch für Codex und Cursor einrichten, mit einem Selbsttest „Verbindung steht“.
5. **Lokale Nutzungsmessung (ohne Telemetrie).** Kortex protokolliert lokal, welche Seiten per MCP abgefragt wurden, und zeigt im Tagesbericht die meistgenutzten und die nie genutzten Seiten. Das bereitet K11–K14 vor.
6. **Sitzungsende-Merkzettel.** Ein Stop-Hook legt Entscheidungen aus einer KI-Sitzung als Merkzettel in die Inbox, nie direkt ins Wiki. *Prüfen:* Überschneidung mit dem Kit (B2). Erst nach Idee 1 angehen.
7. **Brain-Dump per Diktat als Assistent-Schritt.** Im Assistenten „Kortex einrichten“ einmal frei erzählen (Diktat), Kortex legt daraus Merkzettel in die Inbox. Guter Kandidat aus der Video-Auswertung ([FBL-90](/FBL/issues/FBL-90)), aber erst nach [FBL-87](/FBL/issues/FBL-87).

## Regeln für das Team
- Leitstand entscheidet Reihenfolge, Zuschnitt und Verteilung selbst. Fabio wird nicht gefragt, außer bei: Live-Schalten im echten `~/brain` (Spec §9), öffentlichem Release, Geld oder Zugangsdaten.
- Jede Aufgabe ist klein (≤ 1 PR) und läuft durch Review und CI, bevor sie nach `main` geht.
- Ideen, die nach Prüfung keinen Sinn ergeben, streicht der Leitstand mit einer Zeile Begründung. Eigene bessere Ideen sind ausdrücklich erwünscht.
