---
name: lektion
description: Übernommene Lektionen (aus wiederholten Korrekturen/Fehlschlägen) an den richtigen Ort schreiben — Memory, Lektionsliste oder Skill-Entwurf
---

Übernommene Lektionen liegen als Auftrag im Inbox-Unterordner `_lektionen/` (übernommen im Gehirn unter Vorschläge).
Dieser Ablauf schreibt sie an den richtigen Ort und archiviert sie danach. Nie etwas installieren, nie Secrets schreiben.

1. Liste holen (lokal, 0 Tokens): `{{NODE}} "{{KERN}}/lektionen.mjs" --vault "{{VAULT}}" liste` → je Lektion `id`, `titel`, `ziel`
   (`memory` oder `skill`), `regel`, `warum`, `wie`, `text` (Auszug). Leere Liste → kurz melden, fertig.
2. Rohkandidat (`regel` leer): aus dem Auszug EINE Regel (1 Satz), **Warum** (1 Satz) und **Wie anwenden** (1–2 Sätze)
   formulieren und dem User zur Bestätigung zeigen. Ist es keine echte Lektion → nach Okay nur archivieren (Schritt 5).
3. `ziel: memory` — je nach KI:
   - **Regel für bestimmte Dateien (alle KIs, auch Claude Code):** Betrifft die Regel nur bestimmte Dateien, statt
     einer Feedback-Datei `{{NODE}} "{{KERN}}/lektionen.mjs" --vault "{{VAULT}}" ins-wiki <id> --gilt-fuer '<muster>, …'` nutzen
     (höchstens 5 Glob-Muster wie `*.swift`, `~/source/<repo>/**`, `**/Package.swift`; Formulierung wie unten). Dann
     spielt der Read-Hook die Regel genau beim Lesen solcher Dateien ein. `ins-wiki` archiviert selbst.
   - **Claude Code:** im eigenen Auto-Memory-Ordner dieses Projekts eine Datei `feedback_<kurzname>.md` anlegen
     (Format der Feedback-Einträge: Frontmatter `name`, `description`, `type: feedback`; Text = Regel, dann
     `**Warum:**` und `**Wie anwenden:**`). In der Index-Datei `MEMORY.md` unter „Feedback" EINE Zeile ergänzen:
     `- [<Titel>](feedback_<kurzname>.md) — <Regel in Kurzform>`. Gibt es einen ähnlichen Eintrag, ihn ergänzen statt
     einen zweiten anzulegen. Danach archivieren (Schritt 5).
   - **Andere KIs (Codex, Gemini, Cursor …):** `{{NODE}} "{{KERN}}/lektionen.mjs" --vault "{{VAULT}}" ins-wiki <id>` — schreibt die
     Lektion (≤ 3 Zeilen) in `_lektionen.md` im Wiki-Ordner und archiviert sie. Bei einem Rohkandidaten die bestätigte
     Formulierung mitgeben: `… ins-wiki <id> --regel '<Satz>' --warum '<Satz>' --wie '<Satz>'` (ohne einfache
     Anführungszeichen im Text).
4. `ziel: skill` — `{{NODE}} "{{KERN}}/lektionen.mjs" --vault "{{VAULT}}" skill-entwurf <id>` legt einen Entwurf
   `_lektionen/skill-<name>.md` mit SKILL.md-Gerüst an und archiviert die Lektion. Den Entwurf NICHT installieren —
   dem User den Pfad nennen; er entscheidet, ob und wo daraus ein Skill wird.
5. Archivieren ohne Schreiben (nur nach Okay): `{{NODE}} "{{KERN}}/lektionen.mjs" --vault "{{VAULT}}" erledigt <id>`.
6. Einzeilig bestätigen: wie viele Lektionen wohin geschrieben wurden.
