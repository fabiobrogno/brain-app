# Kortex-Vault — Arbeitsregeln für KI-Agenten

Dieses Verzeichnis ist ein Kortex-Vault (Notizen und Wissen des Nutzers, verwaltet von der App Kortex). Gilt für jeden Agenten (Claude Code, Codex, Gemini CLI, Cursor …).

## Wissensfragen (Vault zuerst)
{{WENN:ichKarte}}Lies zuerst `{{WIKI}}/ich.md` — wer die Person ist, woran sie arbeitet, was ihr wichtig ist (entfällt, wenn sie schon als „Kortex-Ich-Karte" im Kontext steht).

{{/WENN}}Gibt es `{{WIKI}}/_lektionen.md`, einmal kurz hineinschauen — gelernte Lektionen aus wiederholten Korrekturen
oder Fehlschlägen (kurze Liste, je Eintrag ≤ 3 Zeilen). Bei Claude Code liegen diese stattdessen im eigenen
Memory (Skill **lektion** schreibt sie dorthin); diese Datei ist für andere Werkzeuge.

1. `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" search "<frage>"` → beste Datei lesen. Nie den ganzen Vault breit einlesen.
2. Liefert dein Werkzeug schon einen „Kortex-Treffer" (Hook), diese Seite nur lesen, wenn sie zur Aufgabe passt.
3. Rohquelle nur öffnen, wenn eine Seite PRÜFBEDÜRFTIG ist oder eine Entscheidung an einer Aussage hängt.
4. Jeder Wiki-Ordner hat eine generierte Übersicht `_<ordnername>.md` (oben: `{{WIKI}}/_index.md`) — erst dort nachsehen, dann gezielt die Seite öffnen.

**Wahrheit vor Zustimmung:** Widerspricht eine Anfrage den Fakten im Vault, sag es klar.

## Schreiben
- `{{WIKI}}/` nur über den Skill **ingest** (`{{KERN}}/skills/ingest/SKILL.md`), Schema: `{{WIKI}}/_schema.md`.
- Neues Wissen als Notiz nach `{{INBOX}}/`, dann Skill ingest. Rohquellen und generierte Dateien (INDEX.md, graph.json, `_index.md`) nie editieren.
- Keine Secrets, niemals. Der git pre-commit-Hook blockiert Credential-Muster, rev-Fehler und tote Links — nie umgehen.

## Alltag
- „merk dir …" → Notiz nach `{{INBOX}}/`, dann Skill **ingest**.
- „was weiß ich über …" → `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" search "<frage>"`.
- „leg eine Aufgabe an …" / „erinnere mich an …" → Skill **aufgabe** (`{{KERN}}/skills/aufgabe/SKILL.md`), kurz: `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" aufgabe neu "<titel>"`.
- „sichere meinen Vault" / „sichere mein Brain" → `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" backup`.
- „richte mir eine Sicherung ein" → Skill **backup** (`{{KERN}}/skills/backup/SKILL.md`).
- Updates: Kortex aktualisiert sich selbst; der Kern gehört zur App.
- „zeig mir meinen Vault" / "show me my vault" (ebenso: „zeig mir mein Brain" / "show me my brain") → `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" zeig`.
- „importiere meinen alten Vault aus <Ordner>" / „importiere mein altes Brain aus <Ordner>" (Obsidian, Notion-Export, Logseq, Ordner mit Notizen) → Skill **import**
  (`{{KERN}}/skills/import/SKILL.md`), kurz: `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" import <ordner|zip> [--name x]`.
- „wie gut ist mein Vault" / „wie gut ist mein Brain" → `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" analyse`.
- „hilft mir Kortex im Alltag?" / „wie wirkt Kortex?" (ebenso: „hilft mir das Brain im Alltag?" / „wie wirkt das Brain?") → `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" wirkung` (zählt lokal,
  0 Tokens, speichert nur Zahlen; Vergleich nur innerhalb des Rauschbands, das die Ausgabe nennt).
- „was ist im Vault zu tun" / „was ist im Brain zu tun" / „was muss gepflegt werden" → `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" pflege` (abgelaufene
  Seiten, offene Konflikte und Entscheidungen, Dubletten, je mit nächstem Schritt in Alltagssprache).
- „mach die Suche besser" (Vorschlag aus `brain doctor`) → qmd nachrüsten: `npm i -g --prefix "{{DATEN}}" @tobilu/qmd`
  (lädt aus dem Internet), danach `suche.profil` in
  `brain.config.json` auf `leicht` setzen und `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" refresh` ausführen.
- „repariere meine Kortex-Einstellungen" / „repariere meine Brain-Einstellungen" (Vorschlag aus `brain doctor`) → `{{VAULT}}/brain.config.json` öffnen,
  den JSON-Fehler finden, der Person zeigen was kaputt ist, und GEMEINSAM mit ihr reparieren — nie eigenmächtig
  überschreiben oder raten.

## Befehle
- Node und git immer so aufrufen, wie hier angegeben: Node = `{{NODE}}`, git = `{{GIT}}` (auf frisch eingerichteten
  Rechnern liegen sie oft nicht im PATH).
- Zeit, Lock und Prüfsumme nie per Shell-Werkzeug, sondern: `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" jetzt` · `… lock` · `… unlock` · `… sha <datei>`.

## Skills
ingest · import · lint · review · feedback · handoff · backup · lektion · aufgabe — je `{{KERN}}/skills/<name>/SKILL.md`. Kann dein Werkzeug keine Skills laden, lies die Datei und arbeite sie ab.

# Compact instructions

Beim Zusammenfassen erhalten: Ziel der Sitzung, Vorgaben und Entscheidungen des Nutzers (möglichst wörtlich),
geänderte Dateien mit Pfad, Commits, offene Punkte und den nächsten Schritt. Der Kortex-Arbeitsstand
(`.logs/sitzungen/<sitzung>.md`) wird nach der Kompaktierung wörtlich eingespielt — ihn nicht nacherzählen.
