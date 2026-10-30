# Prüfliste „bereit zur Veröffentlichung“ (Kortex)

Ursprünglich Stand 28.10.2026 (Leitstand), **aktualisiert am 30.10.2026**. Das Repo ist seit dem 29.10. öffentlich. Jeder Punkt wird
erst abgehakt, wenn der Beleg (PR, CI-Lauf, Dokument) verlinkt ist. Der Weg zum Release steht in
[docs/veroeffentlichen.md](../../veroeffentlichen.md). Kanal bis zum Umzug auf das Firmenkonto: nur Betas (`vX.Y.Z-beta.N`).

| # | Punkt | Aufgabe | Status | Beleg |
|---|---|---|---|---|
| 1 | Prüfbericht: private Pfade, Namen, Daten (Repo, Historie) | FBL-76 | Historie am 29.10. geprüft, keine Geheimnisse; private Pfade in `docs/` ersetzt (Platzhalter `<home>`, `<tmp>`, `<name>`); die Historie bleibt unverändert | Release-Vorbereitung (PR) |
| 2 | brain-app ohne private Pfade/Namen, CI-Prüfung „privat“ | FBL-77 | Pfade in `docs/` bereinigt; eine CI-Prüfung „privat“ gibt es noch nicht | – |
| 3 | second-brain-kit ohne private Pfade/Namen | FBL-78 | außerhalb dieses Repos; Kit wird archiviert, sobald die Umstellung (P7) released ist | – |
| 4 | Englisches README | FBL-79 | erledigt in Kurzfassung (`README.en.md`); Screenshots und Architektur-Kurzbild fehlen | Release-Vorbereitung (PR) |
| 5 | Lizenz | – | **MIT** (`LICENSE`); Lizenzen von Dritten in `THIRD-PARTY-NOTICES.md`, im Paket und in der App („Lizenzen …“), Test `Tests/Node/lizenzen.test.mjs` | Release-Vorbereitung (PR) |
| 6 | Homebrew-Cask-Entwurf, `brew audit` im CI | FBL-80 | offen; erst nach der ersten echten DMG-Adresse | – |
| 7 | Kit/MCP auf Linux und Windows mit einem Befehl | FBL-81 | offen | – |
| 8 | Tokens pro Tag im Tagesbericht | FBL-82 | offen | – |
| 9 | Wiederanlauf nach Absturz/Neustart/Schlaf belegt | FBL-83 | offen | – |
| 10 | 7-Tage-Dauerlauf ausgewertet | FBL-84 | offen (frühestens 7 Tage nach Start von FBL-84) | – |
| 11 | Signier- und Notar-Kette: **echter** Lauf mit Apple, Gatekeeper-Prüfung in der CI (`spctl`, `stapler`) | – | Trockenlauf belegt (28.10.), Prüfschritte im Workflow ergänzt, echter Lauf bei der ersten Stable-Version | – |
| 12 | Sparkle-Update-Weg 0.3.0 → 0.3.1 an einer echten Installation | – | offen | – |
| 13 | Test am frischen Mac (Git-Voraussetzung, Assistent, Gatekeeper) | – | offen, **nur Fabio** | – |
| 14 | Privater Sparkle-Schlüssel an zwei getrennten Orten gesichert | – | **nur Fabio bestätigt** (nicht prüfbar) | – |
| 15 | Markenrecht „Kortex“ geprüft | – | offen, **nur Fabio** (`docs/namensrecherche-2026-10-24.md`) | – |

## Entscheidungen (Stand 30.10.)

- **Lizenz:** MIT beibehalten (Alternative Apache-2.0 nur bei Wunsch nach Patentschutz). Die Urheberzeile in `LICENSE` bleibt der einzige erlaubte Personenname.
- **Kanal:** bis zum Umzug auf das Firmenkonto nur Betas ohne Update-Versprechen.
- **Offen (nur Fabio):** Bundle-ID `io.github.fbrogno.brain` behalten oder ändern (nach dem ersten Release mit Updates nicht mehr änderbar), Repo-Name „Kortex“, ob der Mac-Dauerlauf auf Fabios Mac mit Test-Vault laufen darf (FBL-84).
