---
name: rueckfragen
description: Offene Brain-Rückfragen beantworten — kurze Ja/Nein/A/B-Fragen aus dem Tageslauf (Widersprüche, heikle Fakten, Lektionen, Stichproben). Auslöser „Rückfragen“, „Brain fragt“
---

Der Tageslauf fragt nur, was er nicht allein entscheiden darf. Dieser Ablauf stellt die Fragen, speichert die Antworten und
stößt das Anwenden an. Nie selbst entscheiden, nie raten, nichts am Wiki ändern, nie Zugangsdaten in eine Notiz schreiben.
Sicherheits-Rückfragen (Typ `integritaet`, Kopf „Sicherheit“) nie selbst abhaken: dem User die betroffenen Pfade nennen, ihn
nachsehen lassen (git status, .git/hooks, .git/config, .tools) und „geprueft“ nur speichern, wenn er ausdrücklich sagt, dass er geprüft hat.

1. Liste holen (0 Tokens): `{{NODE}} "{{VAULT}}/.tools/brain.mjs" rueckfragen liste` → JSON
   `{ fragen: [{ id, typ, header, frage, beschreibung, optionen: [{ wahl, label, wirkung }], pflege?, vollstaendig?, datei?, hinweis? }], wartend }`.
   Leer → „Keine Rückfragen offen.“ und fertig.
2. In Blöcken zu höchstens 4 Fragen fragen. In Claude Code mit dem Werkzeug **AskUserQuestion**: je Rückfrage eine Frage —
   `question` = `frage` (die Aussage, kurz und klar) plus darunter das wörtliche Zitat und die Quelle aus `beschreibung`
   (gekürzt auf das Wesentliche, höchstens 300 Zeichen; das Zitat nie umformulieren; gilt nicht für Pflege-Vorschläge, s. u.), `header` = `header`,
   `options` = die `optionen` mit `label` = `label` und `description` = `wirkung`, `multiSelect` = false.
   Bei Fragen vom Typ „Prüfen“ (header) ohne `pflege: true` zusätzlich die Zeilen `Zielseite:`, `Einschätzung der Prüfung:` und — wenn vorhanden — `Hinweis:` aus
   `beschreibung` übernehmen (der Hinweis nennt „Seite seither geändert“ oder „Zitat älter als 7 Tage“; ohne ihn lässt sich nicht sicher urteilen), dann bis zu 700 Zeichen.
   So sieht der Nutzer Aussage, Zitat und Quelle vor der Wahl. Kurze, klare Sätze, kein Fachjargon.
   Andere KIs: dieselben Fragen als nummerierte Liste mit den Optionen.
   **Pflege-Vorschläge** (`pflege: true`, Frage beginnt mit „Pflege-Vorschlag:“) sind eine Ausnahme von jeder Kürzung: „Übernehmen“ wendet
   GENAU den gezeigten Diff an, also muss der User ihn vollständig gesehen haben. Je Vorschlag einzeln (nie im Block mit anderen):
   - Erst als normaler Text (nicht in der AskUserQuestion): die `frage`, dann den Inhalt von `beschreibung` wörtlich und vollständig —
     den Diff darin immer in einem ```diff-Codeblock (steht er schon in einem Block, unverändert übernehmen; sonst selbst umzäunen, mit einem
     Zaun, der länger ist als jede Backtick-Folge im Diff). Nie kürzen, nie zusammenfassen, nie umformulieren, nichts als „unwichtig“ weglassen
     (auch nicht die einsortierte Quelle oder Beleg-Dateien).
   - Ist er zu lang für eine Antwort: in mehreren Teilen nacheinander, aber vollständig und in der richtigen Reihenfolge; gefragt wird erst
     nach dem letzten Teil. Lässt sich nicht alles zeigen: den Vorschlag nicht beantworten lassen, sondern auf die Rückfrage-Datei im Inbox-Ordner
     `_rueckfragen/` verweisen.
   - `vollstaendig: false` oder leere `optionen`: den Vorschlag nie zur Antwort anbieten — dem User sagen, dass er zu lang ist, und `datei` nennen
     (er prüft sie dort; die Antwort gibt er dann selbst).
   - Danach die AskUserQuestion mit kurzem `question` (nur die `frage`; der Diff steht oben) und den `optionen` wie sonst.
3. Jede Antwort sofort speichern: `{{NODE}} "{{VAULT}}/.tools/brain.mjs" rueckfragen antwort <id> <wahl> "<notiz>"` — `<wahl>`
   ist die `wahl` der gewählten Option. Freitext („Other“): bei `lektion` → Wahl `aendern`, Notiz = die neue Regel; bei
   `zweifel` → Wahl `falsch`, Notiz = welche Stelle; sonst den Freitext als Notiz behalten und die Wahl nachfragen.
4. Nach dem letzten Block anwenden lassen (losgelöst, nicht warten):
   `{{NODE}} "{{VAULT}}/.tools/brain.mjs" tageslauf --nur-antworten --losgeloest`.
   Kurz melden: „N Antworten gespeichert, werden jetzt eingearbeitet. Noch M Rückfragen warten.“ (M = `wartend`).
5. Höchstens 10 Fragen je Sitzung, außer der User will ausdrücklich weitermachen.
