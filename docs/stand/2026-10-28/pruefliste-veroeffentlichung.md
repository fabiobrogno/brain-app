# Prüfliste „bereit zur Veröffentlichung“ (Kortex)

Stand 28.10.2026, Leitstand. Jeder Punkt wird erst abgehakt, wenn der Beleg (PR, CI-Lauf, Dokument) verlinkt ist. Nichts wird veröffentlicht; die Repos bleiben privat.

| # | Punkt | Aufgabe | Status | Beleg |
|---|---|---|---|---|
| 1 | Prüfbericht: alle privaten Pfade, Namen, Daten gefunden (beide Repos, inkl. Historie) | FBL-76 | offen | – |
| 2 | brain-app ohne private Pfade/Namen, Bundle-ID und Feed-URL konfigurierbar, CI-Prüfung „privat“ grün | FBL-77 | offen | – |
| 3 | second-brain-kit ohne private Pfade/Namen, CI-Prüfung grün | FBL-78 | offen | – |
| 4 | Englisches README mit Screenshots, Installation, Architektur-Kurzbild | FBL-79 | offen | – |
| 5 | Lizenz-Vorschlag | – | Vorschlag steht, **Entscheidung Fabio** | siehe unten |
| 6 | Homebrew-Cask-Entwurf, `brew audit` + Installation im CI grün | FBL-80 | offen | – |
| 7 | Kit/MCP auf Linux und Windows mit einem Befehl, CI-Beleg | FBL-81 | offen | – |
| 8 | Tokens pro Tag im Tagesbericht | FBL-82 | offen | – |
| 9 | Wiederanlauf nach Absturz/Neustart/Schlaf belegt | FBL-83 | offen | – |
| 10 | 7-Tage-Dauerlauf ausgewertet | FBL-84 | offen (frühestens 7 Tage nach Start von FBL-84) | – |

## Lizenz-Vorschlag (Entscheidung: Fabio)
**MIT** beibehalten (liegt schon im Repo): kürzeste, bekannteste Lizenz, keine Hürde für Nutzung und Beiträge.
Alternative: Apache-2.0, falls ein ausdrücklicher Patentschutz gewünscht ist. Urheberzeile in `LICENSE` bleibt der einzige erlaubte Personenname.

## Offene Punkte für die Freigabe (nur Fabio)
- Öffentliche Bundle-ID und Repo-Name „Kortex“ beim Release (Wechsel der Bundle-ID beendet Updates der heute installierten App).
- Lizenzwahl.
- Ob der Mac-Dauerlauf auf Fabios Mac mit Test-Vault laufen darf (siehe FBL-84).
