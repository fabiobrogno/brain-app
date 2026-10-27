# Opus-Review Studio v2, Wellen 1+2 (24.10.2026)

Geprüft: `git diff b03f991..8144b3c` (66 Dateien, ~11.000 Zeilen), nur lesend mit Proben in Temp-Ordnern
(Proben lagen im Scratchpad der Sitzung, nicht im Repo). Ergebnis: 2 K, 6 W, 13 k. Zielbild der Korrekturen: Spec v2 §8.

| Nr | Befund | Korrektur (Commit; Stand 23:00 noch nicht gegengeprüft) |
|---|---|---|
| K1 | Swift startete `<vault>/.tools/brain.mjs status` und die Kit-Übersicht ohne „Erlauben“ (AppZustand, BrueckenVerbindung) | d28475a, 53bd77b (Swift fragt `vertrauen-pruefen.mjs`) |
| K2 | Vertrauen hing nur am Pfad: frischer fremder Klon nach `~/Brain` erbte alte Freigabe | c8e852a (Ordner-Kennung + Code-Fingerabdruck), a734228 (klonen/neu/entfernen vergessen) |
| W1 | Fremde `.git/config` (`core.fsmonitor`, `diff.external`, Hooks) führte beim Öffnen Befehle aus | 5e5b399 (Härtung, Sperre ohne Vertrauen) |
| W2 | „Versionsverlauf einschalten“ schickte `git:true`, Backend las `gitEinschalten` | a734228 (Alias), 3561bbd (Oberfläche) |
| W3 | Swift-Zeitlimit kürzer als Node-Arbeit; bei oeffnen/neu konnte Node danach still den Vault wechseln | a734228, c071578, d28475a, 3561bbd (Gesamtfristen, Neuladen nach Zeitüberschreitung) |
| W4 | MCP an den damals offenen Vault gebunden, „verbunden ✓“ ohne Beleg, Probe nicht über den MCP | c071578, 3561bbd |
| W5 | Aktiven Vault entfernen: 400 nach dem Speichern, `aktiv` auf fehlenden Ordner | a734228, c071578 |
| W6 | Anderen Vault entfernen verwarf ungespeicherten Text | 3561bbd |
| k1–k13 | Verlauf-Paging (`weitere`), fehlende `/api/kit/hooks`, `GIT_SSH_COMMAND` übersteuerte `core.sshCommand`, Defekt-Sicherung überschrieben, vaults.json ungeprüft, SIGTERM mitten im Git, GIT_*-Umgebung, latente CSS-Injektion über Typfarben, Fehlalarm „neu installieren“, Menübefehl nach 5 s verworfen, Rauchtest schrieb echte Defaults, `--vault`-Neustart, Last beim Speichern | größtenteils in den Commits oben; k13 (drei Index-Abrufe je Speichern) offen |

Zusätzlich in derselben Runde gefunden und behoben: Datei-Kopf ließ sich nicht aufklappen, Zeilen unter H1/Datei-Kopf
waren um 14/12 px versetzt (95a58fb).

Zweitblick des Prüfers auf die Korrekturen: siehe Sitzungsstand (offen, falls hier nicht nachgetragen).
