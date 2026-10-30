# M2a „Alltag“ (K11–K15, K2, K3) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Kit (Brain v0.6) macht Claude im Alltag spürbar klüger — ohne einen einzigen Token im Betrieb: Es misst die Alltags-Wirkung (K15), rettet den Arbeitsstand über die Kompaktierung (K12), sagt beim Start, was zuletzt lief (K11) und was parallel läuft (K13), liefert einen Projekt-Steckbrief (K14), spielt beim Lesen einer Datei die passenden Regeln ein (K2) und schweigt bei Prompts ohne Wissensbedarf (K3).

**Architecture:** Ein neues Lesemodul `verlauf.mjs` kennt als einzige Stelle das JSONL-Format der Claude-Code-Verläufe (robust gegen unbekannte/halbe Zeilen, große Dateien nur stückweise). Darauf bauen reine Logikmodule (`wirkung.mjs`, `arbeitsstand.mjs`, `zuletzt.mjs`, `laufend.mjs`, `projekt.mjs`, `regeln.mjs`, `gezeigt.mjs`), die von dünnen Hooks unter `.tools/adapters/claude-code/` aufgerufen werden: `session-start.mjs` (erweitert, sammelt die Ausgabe mit Zeichenbudget), `brain-hint.mjs` (K3-Gate, K13-Lebenszeichen), neu `kompakt-sichern.mjs` (PreCompact), `sitzung-ende.mjs` (SessionEnd), `regeln-lesen.mjs` (PreToolUse auf `Read`). Alles Eingespielte ist wörtlicher Auszug mit Quelle; alles Gespeicherte liegt unter `.logs/` (git-ignoriert) und läuft vorher durch den Secret-Riegel `secrets-muster.mjs`.

**Tech Stack:** Node-ESM (nur Standardbibliothek), `node --test`, Bash-Testsuiten des Kits (`.tools/tests/run-all.sh`), git-CLI. Keine neuen Abhängigkeiten.

**Spec:** `<home>/source/brain-app/docs/superpowers/specs/2026-10-16-brain-app-design.md` — Kopf-„Nachtrag“, §2, §4/§4a, §11, §12.2 (K2, K3, K11–K15), §13.2 (Alltags-Wirkung, Hook-Laufzeit), §14 (M2).

## Global Constraints

- **0 Tokens im Betrieb** (§4.4, §12.2): kein LLM-Aufruf in einem neuen Hook oder Modul — alles regelbasiert.
- **Korrektheit vor allem** (§4.0, „lieber eine Lücke als ein Fehler“): Eingespieltes ist **wörtlicher Auszug mit Quelle**, nie eine KI-Zusammenfassung. Im Zweifel weglassen statt raten.
- **Hooks blockieren nie die Sitzung:** jeder Fehler → still (Exit 0, höchstens eine Zeile ins Log). Prompt-Hooks **< 300 ms** (§13.2, ohne die bestehende Suche), Sitzungsstart schnell (< 1 s im Test), SessionEnd im 1,5-s-Budget von Claude Code, PreCompact < 5 s auch bei sehr großen Verläufen.
- **Secret-Riegel:** Alles, was Nutzer-Nachrichten oder Werkzeugdaten speichert oder einspielt, läuft vorher durch `.tools/secrets-muster.mjs` (`hatSecretsImKontext`, `ohneSecrets`); Titel aus Nutzertext zusätzlich durch `.tools/pii-muster.mjs` (`hatPii`). Gespeichert wird nur unter `<vault>/.logs/` (git-ignoriert). K15 speichert **nur Zahlen**, keine Zitate.
- **Ausgabegrenzen** (Hook-Doku v2.1.30x: 10.000 Zeichen je String, darüber Datei + 2.000-Zeichen-Vorschau): SessionStart gesamt ≤ **9.500** Zeichen; K12-Arbeitsstand ≤ **8.000**; K11 ≤ **600**; Projekt-Steckbrief ≤ **1.200** (~300 Tokens, K2-Deckel); Regeln beim `Read` ≤ **1.200**; Brain-Hinweis je Prompt ≤ **600**. Bei Überschreitung **ganze Einträge** in Rangfolge statt alle gekürzt.
- **Hook-Ausgabekanäle** (Hook-Doku): SessionStart und UserPromptSubmit dürfen plain stdout nutzen; **PreToolUse nur JSON** `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"…"}}` — plain stdout erreicht Claude dort nicht. PreCompact: Ausgabe wird nicht eingespielt → nur Seiteneffekte.
- **Zuordnung strikt über `session_id`:** Was eine Sitzung speichert (K12-Stand, K13-Eintrag, Gezeigt-Liste), bekommt nie eine andere Sitzung eingespielt. „Anbieten, nicht beanspruchen“: K11/K13 zeigen nur an und markieren nichts als übernommen.
- **Arbeitsort:** Worktree `~/brain-kit-v0.6`, Branch `kit-v0.6`. Nie direkt in `~/brain` ändern. Zusammenführen und Hook-Registrierung erst im letzten Task und **nur nach Fabios ausdrücklichem Okay**; `~/.claude/settings.json` und `~/.claude-<profil2>/settings.json` ändert nur Fabio selbst (fertiger `!`-Befehl über den bestehenden Installer).
- **Unverändert bleiben:** alle bestehenden Hooks und Tests (grün), `brain zeig`, `brain status --json`, die Ansicht-Brücke (M1-App-Schnittstellen), das Einstellungs-Schema `einstellungen.mjs#SCHEMA` (keine neuen Schalter in M2a).
- **Stil:** Bezeichner Deutsch ohne Umlaute (`ae/oe/ue`), Kommentare Deutsch, Stil wie im Kit; Pfade immer mit Leerzeichen/Umlauten testen.
- **Git:** `git add` nur mit expliziten Dateien (kein `-A`, kein `.`); jede Commit-Nachricht endet mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Shell-Falle:** Ein Hook hält Bash-Befehle an, deren Text `rm` enthält — neue Dateien immer mit dem Write-Werkzeug anlegen; Aufräumen in Tests nur über `fs.rmSync` im Testcode.

## Review Focus

1. **Verlaufsformat ändert sich / unbekannte, kaputte oder halb geschriebene Zeilen** (Claude Code schreibt laufend; neue Zeilenarten kommen mit Updates): Nichts stürzt ab, Unbekanntes wird still übersprungen, eine halbe letzte Zeile zählt erst beim nächsten Lauf. → Tests in Task 1 (`leseKopf/leseAb: halbe letzte Zeile …`), Task 4 (`sammle: … unbekannte/kaputte/halbe Zeilen still …`), Task 2 (kaputte Zeile im Zählverlauf).
2. **Sehr große Verläufe (Hunderte MB):** Kein Hook liest eine Datei ganz in den Speicher; PreCompact liest höchstens 16 MB ab der letzten Marke, mit 3-s-Frist, und meldet die Lücke im Arbeitsstand; K15 liest als Strom mit Zeitlimit und markiert die Messung als unvollständig. → Tests in Task 1 (`leseAb: großes Stück …`, `jeEintrag: … Frist`), Task 5 (`kompakt-sichern: 40-MB-Verlauf …`), Task 11 (`laufzeit-hooks.mjs`: PreCompact mit 40 MB < 5 s), Task 2 (`messeWirkung: Zeitlimit …`).
3. **Zugangsdaten in Nutzer-Nachrichten** („passwort=…“, Tokens): erscheinen nie in `.logs/sitzungen/*`, nie in Titeln (K11/K13), nie in `wirkung.jsonl`. → Tests in Task 4 (`sammle/render: Zugangsdaten …`), Task 6 (`letzteSitzungen: … Zugangsdaten nie im Titel`), Task 7 (`titelAusPrompt …`), Task 2 (`speichereMessung: nur Zahlen …`).
4. **Mehrere Sitzungen gleichzeitig** (schreiben parallel nach `.logs/`; eine stürzt ab, ohne SessionEnd): je Sitzung eigene Datei, atomar per tmp+rename; der K12-Stand von Sitzung A erreicht nie Sitzung B; Altlasten ohne Lebenszeichen > 2 h zählen nicht, > 24 h werden aufgeräumt. → Tests in Task 5 (`zwei parallele Sitzungen bekommen nie den Stand der anderen …`), Task 7 (`20 gleichzeitige Prozesse …`, `abmelden und Altlasten …`).
5. **cwd außerhalb jedes Git-Repos, Repo ohne Projektseite, Pfade mit Leerzeichen/Umlauten:** still, kein Absturz, keine falsche Zuordnung (Fabio startet die meisten Sitzungen in `~`, das kein Repo ist). → Tests in Task 6 (`wasWarZuletzt: ohne Git …`, Repo „Garten App“ in „Arbeit Ü“), Task 7 (`Hooks: … cwd ohne Repo still`), Task 8 (`SessionStart: … Repo ohne Projektseite still`), Task 9 (`regeln-lesen: Datei außerhalb jeder Regel …`).

## Entscheidungen und Abweichungen (bewusst)

- **Keine neuen Schalter in M2a.** K11/K12/K13 laufen immer (0 Tokens, nur lokale Dateien); Steckbrief (K14) und Steckbrief-beim-Lesen (K2) hängen am bestehenden Schalter `projektAutomatik`. Grund: neue Schalter brauchen Maske, Texte (DE/EN) und App-Einstellungen — das gehört in ME/M2c.
- **K11 „je Projekt“** = Claude Codes eigener Projektordner (die Geschwister-Verläufe neben `transcript_path`, gleiches cwd); Commits kommen aus dem Git-Repo des cwd; „Offen“ aus der jüngsten `session_*.md` im `memory/`-Ordner daneben.
- **K2-Regelquelle** = `<wiki>/_lektionen.md`, Einträge mit neuer Zeile `  Gilt für: \`<muster>\`, …` (Lektion-CLI bekommt `--gilt-fuer`). Zusätzlich kommt der Projekt-Steckbrief beim **ersten `Read` in einem Repo** je Sitzung, weil die meisten Sitzungen in `~` starten.
- **K12 Nutzer-Nachrichten:** wörtlich seit der letzten Kompaktierung; neueste drei ganz (≤ 1.500 Zeichen je Nachricht), ältere auf 200 Zeichen mit „(gekürzt)“, der Rest mit Zählhinweis ausgelassen. Nach einer Kompaktierung kommt der Arbeitsstand **zuerst** in die SessionStart-Ausgabe.
- **K12 Compact instructions** nur in der gerenderten Vault-`AGENTS.md` (wirkt in Sitzungen im Brain-Ordner). Ein Eintrag im globalen `CLAUDE.md` ist Fabios Entscheidung (Task 12 nennt den Satz).
- **K15 Musterlisten** 1:1 aus `an.py` übernommen (Musterliste `v1`). JavaScript-`\b` arbeitet nur auf ASCII — die Node-Zahlen werden daher nur mit der Node-Ausgangsmessung verglichen; die Python-Zahlen vom 16.10. stehen nur zur Einordnung im Messprotokoll. „Hinweis mit folgender Korrektur“ zählt wie in `an2.py` je Sitzung.
- **K15 Rauschband (vorab festgelegt):** Eine Änderung je Gruppe gilt erst als echt, wenn sie **≥ 1,0 je 100 Nachrichten UND ≥ 25 % des Vorwerts** beträgt und **beide Zeiträume ≥ 500 Nutzer-Nachrichten** haben, bei gleicher Musterliste. Anteil großer Werkzeug-Ausgaben **≥ 30 %** gilt als „hoch“ → Vorschlag eines eigenen Bausteins (Auslagern großer Ausgaben) an Fabio, kein Bau in M2a.
- **K3-Gate-Zählung** in eigenem Log `.logs/intent-gate.log` (nicht in `hint.log`), damit `brain analyse` und das Brain-Band unverändert rechnen.
- **Installation** in beiden Claude-Profilen (`~/.claude` und `~/.claude-<profil2>`), weil Fabio beide nutzt.

## Was M2a für M2b/M2c offenlässt (nicht bauen, nicht verbauen)

- **M2b (W1–W7, K1, K8):** K8/W7 (Korrektur nach Hinweis → PRÜFBEDÜRFTIG) kann die Erkennung „Hinweis, danach Korrektur“ aus `wirkung.mjs` (`HINWEIS_KORREKTUR`) und `verlauf.mjs#hookAusgabe` wiederverwenden. K12/K11 schreiben kein Wissen — W1/W2 betreffen sie nicht.
- **M2c (K4–K7, K9, K10, §12.1):** §12.1.7 (Warteschlange) betrifft nur Ernte-Auslöser — `kompakt-sichern.mjs` bleibt ein direkter Hook (muss vor der Kompaktierung fertig sein). §12.1.1 (feste Pfade): neue Hooks werden genau wie die bestehenden über `nodeBefehl()` registriert. K7 (Prüfen nach Nutzung) kann `.logs/gezeigt/` als zusätzliche Nutzungsquelle lesen. Neue Schalter für K11–K13 kommen bei Bedarf mit der Einstellungs-Maske (ME).

## Dateistruktur

Alle Pfade relativ zum Worktree `~/brain-kit-v0.6`.

**Neu (Module):**
- `.tools/verlauf.mjs` — JSONL-Verläufe lesen + Zeilen deuten + kleine Text-Helfer (Task 1).
- `.tools/wirkung.mjs` — K15: Zählen, Rauschband, Speichern (nur Zahlen), CLI `brain wirkung` (Task 2–3).
- `.tools/arbeitsstand.mjs` — K12: Arbeitsstand sammeln, rendern, speichern, lesen (Task 4).
- `.tools/zuletzt.mjs` — K11: letzte Sitzungen, Commits, „Offen“ (Task 6).
- `.tools/projekt.mjs` — Git-Wurzel, Projekt-Schlüssel (Task 6); Projektseite, Steckbrief, Manifeste (Task 8).
- `.tools/laufend.mjs` — K13: Sitzungsregister `.logs/laufend/` (Task 7).
- `.tools/gezeigt.mjs` — je Sitzung: was schon eingespielt wurde (Task 8).
- `.tools/regeln.mjs` — K2: Lektionen mit `Gilt für` lesen, passende Regeln wählen (Task 9).
- (Ein Modul je Baustein; `projekt.mjs` übernimmt in Task 8 die Projektseiten-Funktionen aus `session-start.mjs`.)

**Neu (Hooks):** `.tools/adapters/claude-code/kompakt-sichern.mjs` (PreCompact, Task 5) · `sitzung-ende.mjs` (SessionEnd, Task 7) · `regeln-lesen.mjs` (PreToolUse `Read`, Task 9).

**Geändert:** `.tools/adapters/claude-code/session-start.mjs` (Task 5–8) · `brain-hint.mjs` (Task 7, 10) · `install.mjs` + `README.md` (Task 11) · `session-hintergrund.mjs` (Task 3) · `.tools/pflege.mjs` (Task 3) · `.tools/hint-core.mjs` (Task 10) · `.tools/brain-lint.mjs` (Task 8) · `.tools/brain.mjs` (Task 2) · `.tools/lektionen.mjs` + `.tools/skills/lektion/SKILL.md` (Task 9) · `.tools/adapters/claude-code/README.md` (Task 11) · `.tools/kit/AGENTS.md` (Task 5) · `.tools/kit/vorlage/wiki/_schema.md` + `09_wiki/_schema.md` (Task 8).

**Tests (neu):** `.tools/tests/verlauf-fixture.mjs` (Helfer, kein Test) · `test-verlauf.mjs` · `test-wirkung.mjs` · `test-arbeitsstand.mjs` · `test-arbeitsstand-hook.mjs` · `test-zuletzt.mjs` · `test-laufend.mjs` · `test-projekt.mjs` · `test-regeln.mjs` · `test-intent-gate.mjs` · `test-hook-laufzeit.sh` mit `laufzeit-hooks.mjs` (bewusst kein `test-*.mjs`, siehe Task 11). **Geändert:** `test-lektionen.mjs` (Task 9), `test-adapter-claude.mjs` (Task 11).

**App-Repo** (`~/source/brain-app`): `docs/messungen/2026-10-16-m2a-wirkung-ausgang.md` (Task 3), Nachtrag Live-Prüfung (Task 12).

---

### Task 1: Ausgangslage + gemeinsamer Verlaufs-Leser `verlauf.mjs`

**Files:**
- Create: `.tools/verlauf.mjs`
- Create: `.tools/tests/verlauf-fixture.mjs` (Test-Helfer, wird von späteren Tasks genutzt)
- Test: Create `.tools/tests/test-verlauf.mjs`

**Interfaces:**
- Consumes: `istSystemNachricht(prompt) → boolean` aus `.tools/hint-core.mjs` (bestehend).
- Produces (`.tools/verlauf.mjs`):
  - `KOPF_MAX = 262144`, `STUECK_MAX = 16777216`
  - `parseZeile(roh: string) → object|null`
  - `leseKopf(pfad, maxBytes = KOPF_MAX) → { eintraege: object[], groesse: number }`
  - `leseAb(pfad, ab = 0, maxBytes = STUECK_MAX) → { eintraege: object[], bis: number, abgeschnitten: boolean, groesse: number }`
  - `jeEintrag(pfad, fn: (o) => void, { fristMs = Infinity, uhr = Date.now } = {}) → Promise<{ vollstaendig: boolean }>`
  - `nutzerNachricht(o) → null | { text: string } | { befehl: string }`
  - `assistentText(o) → string`
  - `werkzeugAufrufe(o) → { id: string, name: string, input: object }[]`
  - `werkzeugErgebnisse(o) → { id: string, text: string, fehler: boolean }[]`
  - `titelAus(o) → null | { art: "eigen"|"ki", titel: string }`
  - `kompaktierung(o) → null | "auto" | "manuell"`
  - `hookAusgabe(o) → null | { ereignis: string, text: string }`
  - `zeitVon(o) → number|null`
  - `kuerze(text, max) → string` (Anhang „ (gekürzt)“, Ergebnis immer < max+1)
  - `ganzeZeilen(zeilen: string[], max) → { text: string, weggelassen: number }`
  - `datumZeit(ms) → "TT.MM. HH:MM"` · `uhrzeit(ms) → "HH:MM"`
- Produces (`.tools/tests/verlauf-fixture.mjs`): `ZEIT`, `nutzer(text, {zeit, ...felder})`, `assistent(text, {zeit})`, `aufruf(id, name, input, {zeit})`, `ergebnis(id, text, {fehler, zeit, alsListe})`, `hinweis(text, ereignis)`, `kompakt(trigger)`, `kiTitel(t)`, `eigenerTitel(t)`, `befehl(name)`, `schreibeVerlauf(pfad, eintraege, {halbeZeile})`, `tempOrdner(name)`, `tempVault(name)`, `KIT`, `TEMP_HOME`, `hook(name, eingabe, {vault, env})`.

- [ ] **Step 1: Worktree auf den aktuellen Stand bringen und Ausgangslage prüfen**

```bash
git -C ~/brain-kit-v0.6 status --short
git -C ~/brain-kit-v0.6 merge --ff-only main
cd ~/brain-kit-v0.6 && bash .tools/tests/run-all.sh 2>&1 | tail -5
```
Expected: `status` leer; Merge meldet Fast-forward (oder „Already up to date“); die Suite endet ohne `FAIL`, Exit 0. Ist `status` nicht leer, der Merge kein Fast-forward oder schon hier etwas rot: STOPP, dem Auftraggeber melden — nicht weiterbauen.

- [ ] **Step 2: Test-Helfer anlegen** — `.tools/tests/verlauf-fixture.mjs` (Write-Werkzeug):

```js
// Test-Helfer für Claude-Code-Verläufe (JSONL) und Hook-Aufrufe — KEIN Test (Name beginnt nicht mit test-).
// Baut Zeilen im Format, das Claude Code v2.1.30x schreibt (Stand 16.10.2026), plus Temp-Ordner mit Leerzeichen/Umlaut.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const ZEIT = "2026-10-16T10:00:00.000Z";
export const KIT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function nutzer(text, { zeit = ZEIT, ...felder } = {}) {
  return { type: "user", timestamp: zeit, message: { role: "user", content: text }, ...felder };
}
export function assistent(text, { zeit = ZEIT } = {}) {
  return { type: "assistant", timestamp: zeit, message: { role: "assistant", content: [{ type: "text", text }] } };
}
export function aufruf(id, name, input, { zeit = ZEIT } = {}) {
  return { type: "assistant", timestamp: zeit, message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } };
}
export function ergebnis(id, text, { fehler = false, zeit = ZEIT, alsListe = false } = {}) {
  const content = alsListe ? [{ type: "text", text }] : text;
  return { type: "user", timestamp: zeit, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: fehler, content }] } };
}
export function hinweis(text, ereignis = "UserPromptSubmit") {
  return { type: "attachment", attachment: { type: "hook_success", hookEvent: ereignis, hookName: ereignis, content: text } };
}
export function kompakt(trigger = "auto") {
  return { type: "system", subtype: "compact_boundary", content: "Conversation compacted", compactMetadata: { trigger } };
}
export const kiTitel = (t) => ({ type: "ai-title", aiTitle: t });
export const eigenerTitel = (t) => ({ type: "custom-title", customTitle: t });
export const befehl = (name) => nutzer(`<command-name>${name}</command-name>\n<command-message>${name.slice(1)}</command-message>`);

// eintraege: Objekte (→ JSON) oder rohe Zeilen (Strings, z. B. "{kaputt"). halbeZeile: unvollständige letzte Zeile.
export function schreibeVerlauf(pfad, eintraege, { halbeZeile = false } = {}) {
  mkdirSync(dirname(pfad), { recursive: true });
  const zeilen = eintraege.map((e) => (typeof e === "string" ? e : JSON.stringify(e)));
  writeFileSync(pfad, zeilen.join("\n") + "\n" + (halbeZeile ? '{"type":"user","message":{"content":"halb' : ""));
}

export function tempOrdner(name = "Mein Brän") {
  const basis = mkdtempSync(join(tmpdir(), "verlauf-"));
  const p = join(basis, name);
  mkdirSync(p, { recursive: true });
  process.on("exit", () => rmSync(basis, { recursive: true, force: true }));
  return p;
}
export function tempVault(name = "Mein Brän") {
  const v = tempOrdner(name);
  writeFileSync(join(v, "brain.config.json"), "{}");
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  return v;
}

// Eigenes Temp-HOME: das echte ~/.claude wird in Tests nie gelesen oder geschrieben.
export const TEMP_HOME = tempOrdner("home");
const OHNE_GIT = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

// Hook-Skript aus .tools/adapters/claude-code/ mit JSON auf stdin starten. → { status, stdout, stderr, ms }
export function hook(name, eingabe, { vault, env = {} } = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(KIT, "adapters", "claude-code", name)], {
    input: typeof eingabe === "string" ? eingabe : JSON.stringify(eingabe), encoding: "utf8", timeout: 30000,
    env: { ...OHNE_GIT, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME, ...(vault ? { BRAIN_VAULT: vault } : {}), ...env },
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", ms: Date.now() - t0 };
}
```

- [ ] **Step 3: Failing test schreiben** — `.tools/tests/test-verlauf.mjs`:

```js
// verlauf.mjs — einzige Stelle, die das JSONL-Format der Claude-Code-Verläufe kennt. Kernrisiken: Formatänderungen
// (unbekannte/halbe Zeilen), sehr große Dateien, Systemzeilen, die wie Nutzer-Nachrichten aussehen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseZeile, leseKopf, leseAb, jeEintrag, nutzerNachricht, assistentText, werkzeugAufrufe, werkzeugErgebnisse,
  titelAus, kompaktierung, hookAusgabe, zeitVon, kuerze, ganzeZeilen, datumZeit, uhrzeit,
} from "../verlauf.mjs";
import {
  tempOrdner, schreibeVerlauf, nutzer, assistent, aufruf, ergebnis, hinweis, kompakt, kiTitel, eigenerTitel, befehl,
} from "./verlauf-fixture.mjs";

test("parseZeile: leer, kaputt, Array → null; BOM und CR werden toleriert", () => {
  assert.equal(parseZeile(""), null);
  assert.equal(parseZeile("{kaputt"), null);
  assert.equal(parseZeile("[1,2]"), null);
  assert.equal(parseZeile(undefined), null);
  assert.deepEqual(parseZeile('\uFEFF{"a":1}\r'), { a: 1 });
});

test("leseKopf/leseAb: halbe letzte Zeile und unbekannte Arten werden übersprungen (Pfad mit Leerzeichen/Umlaut)", () => {
  const f = join(tempOrdner("Verläufe mit Leerzeichen"), "s.jsonl");
  schreibeVerlauf(f, [nutzer("erste Frage"), { type: "zukunft-neu", x: 1 }, "{kaputt", assistent("Antwort")], { halbeZeile: true });
  assert.equal(leseKopf(f).eintraege.length, 3, "unbekannte Art bleibt als Objekt, kaputte Zeile fällt weg");
  const a = leseAb(f, 0);
  assert.equal(a.eintraege.length, 3);
  assert.equal(a.abgeschnitten, false);
  assert.ok(a.bis < statSync(f).size, "die halbe Zeile zählt erst beim nächsten Lauf");
  const b = leseAb(f, a.bis);
  assert.equal(b.eintraege.length, 0);
  assert.equal(b.bis, a.bis);
});

test("leseAb: großes Stück → nur das Ende, erste halbe Zeile verworfen, abgeschnitten=true", () => {
  const f = join(tempOrdner(), "gross.jsonl");
  schreibeVerlauf(f, Array.from({ length: 2000 }, (_, i) => nutzer(`Nachricht ${i} ` + "x".repeat(200))));
  const r = leseAb(f, 0, 64 * 1024);
  assert.equal(r.abgeschnitten, true);
  assert.ok(r.eintraege.length > 10 && r.eintraege.length < 2000);
  assert.match(nutzerNachricht(r.eintraege.at(-1)).text, /^Nachricht 1999 /);
  assert.equal(r.bis, statSync(f).size);
});

test("leseAb: Marke hinter dem Dateiende (Datei ersetzt) → von vorn; fehlende Datei → leer, wirft nie", () => {
  const f = join(tempOrdner(), "neu.jsonl");
  schreibeVerlauf(f, [nutzer("a"), nutzer("b")]);
  assert.equal(leseAb(f, 10 ** 9).eintraege.length, 2);
  const weg = join(tempOrdner(), "gibt-es-nicht.jsonl");
  assert.deepEqual(leseAb(weg, 5), { eintraege: [], bis: 5, abgeschnitten: false, groesse: 0 });
  assert.deepEqual(leseKopf(weg), { eintraege: [], groesse: 0 });
});

test("jeEintrag: Strom über alle Zeilen; Frist 0 → unvollständig; fehlende Datei → unvollständig", async () => {
  const f = join(tempOrdner(), "strom.jsonl");
  schreibeVerlauf(f, [nutzer("a"), "{kaputt", nutzer("b")], { halbeZeile: true });
  const gesehen = [];
  assert.deepEqual(await jeEintrag(f, (o) => gesehen.push(o)), { vollstaendig: true });
  assert.equal(gesehen.length, 2);
  assert.deepEqual(await jeEintrag(f, () => {}, { fristMs: 0 }), { vollstaendig: false });
  assert.deepEqual(await jeEintrag(join(tempOrdner(), "fehlt.jsonl"), () => {}), { vollstaendig: false });
});

test("nutzerNachricht: echte Texte, Befehle, Systemzeilen, Werkzeug-Ergebnisse, Nebenzweige", () => {
  assert.deepEqual(nutzerNachricht(nutzer("Wie geht das?")), { text: "Wie geht das?" });
  assert.deepEqual(nutzerNachricht(nutzer([{ type: "text", text: "Teil A" }, { type: "text", text: "Teil B" }])), { text: "Teil A Teil B" });
  assert.deepEqual(nutzerNachricht(befehl("/compact")), { befehl: "/compact" });
  assert.deepEqual(nutzerNachricht(nutzer("/model opus")), { befehl: "/model" });
  assert.equal(nutzerNachricht(nutzer("<system-reminder>x</system-reminder>")), null);
  assert.deepEqual(nutzerNachricht(nutzer("<system-reminder>x</system-reminder>\nmach weiter")), { text: "mach weiter" });
  assert.equal(nutzerNachricht(nutzer("[Request interrupted by user]")), null);
  assert.equal(nutzerNachricht(nutzer("Caveat: The messages below were generated by the user")), null);
  assert.equal(nutzerNachricht(nutzer("Another Claude session sent a message: hallo")), null);
  assert.equal(nutzerNachricht(nutzer("frage", { isSidechain: true })), null);
  assert.equal(nutzerNachricht(nutzer("frage", { isMeta: true })), null);
  assert.equal(nutzerNachricht(nutzer("This session is being continued", { isCompactSummary: true })), null);
  assert.equal(nutzerNachricht(ergebnis("t1", "ausgabe")), null);
  assert.equal(nutzerNachricht(assistent("hallo")), null);
  assert.equal(nutzerNachricht(null), null);
});

test("werkzeugAufrufe/-Ergebnisse/assistentText: Text als String und als Liste, Fehlerkennung", () => {
  assert.deepEqual(werkzeugAufrufe(aufruf("t1", "Bash", { command: "ls" })), [{ id: "t1", name: "Bash", input: { command: "ls" } }]);
  assert.deepEqual(werkzeugAufrufe(nutzer("x")), []);
  assert.deepEqual(werkzeugErgebnisse(ergebnis("t1", "eins")), [{ id: "t1", text: "eins", fehler: false }]);
  assert.deepEqual(werkzeugErgebnisse(ergebnis("t2", "zwei", { alsListe: true, fehler: true })), [{ id: "t2", text: "zwei", fehler: true }]);
  assert.equal(assistentText(assistent("Antwort")), "Antwort");
  assert.equal(assistentText(nutzer("x")), "");
});

test("titelAus, kompaktierung, hookAusgabe, zeitVon", () => {
  assert.deepEqual(titelAus(kiTitel("Zweiter Account")), { art: "ki", titel: "Zweiter Account" });
  assert.deepEqual(titelAus(eigenerTitel(" Mein Titel ")), { art: "eigen", titel: "Mein Titel" });
  assert.equal(titelAus(kiTitel("  ")), null);
  assert.equal(kompaktierung(kompakt("manual")), "manuell");
  assert.equal(kompaktierung(kompakt("auto")), "auto");
  assert.equal(kompaktierung(nutzer("x")), null);
  assert.deepEqual(hookAusgabe(hinweis("Brain-Treffer (lokal …)")), { ereignis: "UserPromptSubmit", text: "Brain-Treffer (lokal …)" });
  assert.equal(hookAusgabe(nutzer("x")), null);
  assert.equal(zeitVon(nutzer("x")), Date.parse("2026-10-16T10:00:00.000Z"));
  assert.equal(zeitVon({}), null);
});

test("kuerze, ganzeZeilen, datumZeit, uhrzeit", () => {
  assert.equal(kuerze("kurz", 10), "kurz");
  const k = kuerze("x".repeat(100), 40);
  assert.ok(k.length <= 40 && k.endsWith(" (gekürzt)"), k);
  assert.deepEqual(ganzeZeilen(["aaaa", "bbbbbbbbbb", "cc"], 8), { text: "aaaa\ncc", weggelassen: 1 });
  assert.match(datumZeit(Date.now()), /^\d\d\.\d\d\. \d\d:\d\d$/);
  assert.match(uhrzeit(Date.now()), /^\d\d:\d\d$/);
  assert.equal(datumZeit(NaN), "?");
});
```

- [ ] **Step 4: Test laufen lassen — muss scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-verlauf.mjs`
Expected: FAIL — `Cannot find module '…/.tools/verlauf.mjs'`.

- [ ] **Step 5: `verlauf.mjs` schreiben** — `.tools/verlauf.mjs`:

```js
// .tools/verlauf.mjs — Claude-Code-Verläufe (JSONL unter ~/.claude*/projects/<projekt>/<sitzung>.jsonl) lesen.
// Einzige Stelle, die das Zeilenformat kennt (K11 zuletzt, K12 Arbeitsstand, K13 parallel, K15 Wirkung).
// Grundsätze: unbekannte Zeilenarten und kaputte/halbe Zeilen werden still übersprungen (das Format ändert sich mit
// Claude-Code-Versionen); große Dateien nur stückweise (Kopf, Ende ab Byte-Marke) oder als Strom mit Zeitlimit;
// lesende Funktionen werfen nie. Speichert und loggt nichts. Nur Node-Standardbibliothek.
import { openSync, readSync, fstatSync, closeSync, createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { istSystemNachricht } from "./hint-core.mjs";

export const KOPF_MAX = 256 * 1024;
export const STUECK_MAX = 16 * 1024 * 1024;
// Vom Werkzeug eingefügte Blöcke in Nutzer-Zeilen (wie in der Auswertung vom 16.10., ex.py)
const SYSTEM_BLOCK = /<(system-reminder|command-[a-z]+|local-command-[a-z]+)>[\s\S]*?<\/\1>/g;

const ohneBom = (s) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

// Eine JSONL-Zeile → Objekt, sonst null (leer, kaputt, halb, Array).
export function parseZeile(roh) {
  const z = ohneBom(String(roh ?? "")).replace(/\r$/, "");
  if (z.length < 2 || z[0] !== "{") return null;
  try {
    const o = JSON.parse(z);
    return o && typeof o === "object" && !Array.isArray(o) ? o : null;
  } catch { return null; }
}
const parseAlle = (text) => text.split("\n").map(parseZeile).filter(Boolean);

// Anfang der Datei (höchstens maxBytes), nur vollständige Zeilen.
export function leseKopf(pfad, maxBytes = KOPF_MAX) {
  let fd;
  try {
    fd = openSync(pfad, "r");
    const groesse = fstatSync(fd).size;
    const n = Math.min(groesse, maxBytes);
    const buf = Buffer.alloc(n);
    if (n) readSync(fd, buf, 0, n, 0);
    const ende = n < groesse ? buf.lastIndexOf(0x0a) + 1 : n;
    return { eintraege: parseAlle(buf.subarray(0, ende).toString("utf8")), groesse };
  } catch { return { eintraege: [], groesse: 0 }; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}

// Ab Byte `ab` (Zeilengrenze eines früheren Laufs; 0 = Anfang) bis zum Ende, höchstens die letzten maxBytes.
// → { eintraege, bis, abgeschnitten, groesse }: bis = Byte hinter der letzten vollständigen Zeile (eine halbe letzte
// Zeile, die gerade geschrieben wird, zählt erst beim nächsten Lauf); abgeschnitten = Anfang ausgelassen (zu groß).
// Ist die Datei kürzer als `ab` (ersetzt), gilt 0.
export function leseAb(pfad, ab = 0, maxBytes = STUECK_MAX) {
  let fd;
  try {
    fd = openSync(pfad, "r");
    const groesse = fstatSync(fd).size;
    if (!(ab >= 0) || ab > groesse) ab = 0;
    const start = Math.max(ab, groesse - maxBytes);
    const buf = Buffer.alloc(groesse - start);
    if (buf.length) readSync(fd, buf, 0, buf.length, start);
    let ende = buf.lastIndexOf(0x0a) + 1;
    // Rest ohne Zeilenende nur mitnehmen, wenn er schon vollständiges JSON ist (Datei ohne letztes \n).
    if (ende < buf.length && parseZeile(buf.subarray(ende).toString("utf8"))) ende = buf.length;
    const zeilen = buf.subarray(0, ende).toString("utf8").split("\n");
    const abgeschnitten = start > ab;
    if (abgeschnitten) zeilen.shift();                 // mitten in einer Zeile begonnen
    return { eintraege: zeilen.map(parseZeile).filter(Boolean), bis: start + ende, abgeschnitten, groesse };
  } catch { return { eintraege: [], bis: ab, abgeschnitten: false, groesse: 0 }; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}

// Ganze Datei als Strom (für K15, Dateien bis Hunderte MB) — fn je gültigem Eintrag. Nach fristMs: Abbruch,
// { vollstaendig: false }. Wirft nie.
export async function jeEintrag(pfad, fn, { fristMs = Infinity, uhr = Date.now } = {}) {
  const ende = uhr() + fristMs;
  let strom;
  try {
    strom = createReadStream(pfad, { encoding: "utf8" });
    const rl = createInterface({ input: strom, crlfDelay: Infinity });
    for await (const z of rl) {
      if (Number.isFinite(fristMs) && uhr() >= ende) { rl.close(); strom.destroy(); return { vollstaendig: false }; }
      const o = parseZeile(z);
      if (o) fn(o);
    }
    return { vollstaendig: true };
  } catch {
    try { strom?.destroy(); } catch {}
    return { vollstaendig: false };
  }
}

// Echte Nutzer-Nachricht → { text }, Slash-Befehl → { befehl }, alles andere (Werkzeug-Ergebnisse, Systemzeilen,
// Nebenzweige/Subagenten, Meta- und Kompaktierungs-Zeilen, Nachrichten anderer Sitzungen) → null.
export function nutzerNachricht(o) {
  if (!o || o.type !== "user" || o.isSidechain || o.isMeta || o.isCompactSummary) return null;
  const c = o.message?.content;
  let t;
  if (typeof c === "string") t = c;
  else if (Array.isArray(c)) {
    if (c.some((x) => x?.type === "tool_result")) return null;
    t = c.filter((x) => x?.type === "text" && typeof x.text === "string").map((x) => x.text).join(" ");
  } else return null;
  const roh = t.trim();
  const b = /^<command-name>\s*\/?([\w:.-]+)/.exec(roh);
  if (b) return { befehl: `/${b[1]}` };
  const ohne = roh.replace(SYSTEM_BLOCK, "").trim();
  if (!ohne || ohne.startsWith("<") || ohne.startsWith("Caveat") || ohne.startsWith("[Request interrupted")) return null;
  if (istSystemNachricht(ohne)) return null;
  if (ohne.startsWith("/")) return { befehl: ohne.split(/\s/)[0] };
  return { text: ohne };
}

export function assistentText(o) {
  if (o?.type !== "assistant" || o.isSidechain) return "";
  const c = o.message?.content;
  if (typeof c === "string") return c;
  if (!Array.isArray(c)) return "";
  return c.filter((x) => x?.type === "text" && typeof x.text === "string").map((x) => x.text).join("\n");
}

export function werkzeugAufrufe(o) {
  if (o?.type !== "assistant" || o.isSidechain) return [];
  const c = o.message?.content;
  if (!Array.isArray(c)) return [];
  return c.filter((x) => x?.type === "tool_use" && typeof x.name === "string")
    .map((x) => ({ id: String(x.id ?? ""), name: x.name, input: x.input && typeof x.input === "object" ? x.input : {} }));
}

export function werkzeugErgebnisse(o) {
  if (o?.type !== "user" || o.isSidechain) return [];
  const c = o.message?.content;
  if (!Array.isArray(c)) return [];
  const out = [];
  for (const x of c) {
    if (x?.type !== "tool_result") continue;
    const inhalt = x.content;
    const text = typeof inhalt === "string" ? inhalt
      : Array.isArray(inhalt) ? inhalt.filter((y) => y?.type === "text" && typeof y.text === "string").map((y) => y.text).join("\n") : "";
    out.push({ id: String(x.tool_use_id ?? ""), text, fehler: x.is_error === true });
  }
  return out;
}

// Titel einer Sitzung: selbst vergeben (/rename, --name) oder von Claude Code erzeugt.
export function titelAus(o) {
  if (o?.type === "custom-title" && typeof o.customTitle === "string" && o.customTitle.trim()) return { art: "eigen", titel: o.customTitle.trim() };
  if (o?.type === "ai-title" && typeof o.aiTitle === "string" && o.aiTitle.trim()) return { art: "ki", titel: o.aiTitle.trim() };
  return null;
}

export function kompaktierung(o) {
  if (o?.type !== "system" || o.subtype !== "compact_boundary") return null;
  return o.compactMetadata?.trigger === "manual" ? "manuell" : "auto";
}

// Ausgabe eines Hooks, wie Claude Code sie im Verlauf festhält (attachment.type "hook_success").
export function hookAusgabe(o) {
  const a = o?.type === "attachment" ? o.attachment : null;
  if (!a || a.type !== "hook_success") return null;
  const text = typeof a.content === "string" && a.content ? a.content : typeof a.stdout === "string" ? a.stdout : "";
  return { ereignis: String(a.hookEvent || ""), text };
}

export function zeitVon(o) {
  const ms = Date.parse(o?.timestamp ?? "");
  return Number.isFinite(ms) ? ms : null;
}

// ---------- kleine Text-Helfer (K11, K12, K14, K2) ----------

export function kuerze(text, max) {
  const t = String(text ?? "");
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 11)).trimEnd() + " (gekürzt)";
}

// Ganze Zeilen in Reihenfolge, solange sie ins Budget passen; was nicht passt, wird übersprungen (nie gekürzt).
export function ganzeZeilen(zeilen, max) {
  const out = [];
  let laenge = 0, weggelassen = 0;
  for (const z of zeilen) {
    const l = z.length + (out.length ? 1 : 0);
    if (laenge + l <= max) { out.push(z); laenge += l; } else weggelassen++;
  }
  return { text: out.join("\n"), weggelassen };
}

const zwei = (n) => String(n).padStart(2, "0");
export function datumZeit(ms) {
  if (!Number.isFinite(ms)) return "?";
  const d = new Date(ms);
  return `${zwei(d.getDate())}.${zwei(d.getMonth() + 1)}. ${zwei(d.getHours())}:${zwei(d.getMinutes())}`;
}
export function uhrzeit(ms) {
  if (!Number.isFinite(ms)) return "--:--";
  const d = new Date(ms);
  return `${zwei(d.getHours())}:${zwei(d.getMinutes())}`;
}
```

- [ ] **Step 6: Test laufen lassen — muss bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-verlauf.mjs`
Expected: alle PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/verlauf.mjs .tools/tests/verlauf-fixture.mjs .tools/tests/test-verlauf.mjs
git commit -m "kit: verlauf.mjs — Claude-Code-Verläufe robust und stückweise lesen (Basis für K11–K15)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: K15 — `wirkung.mjs` zählen, vergleichen, speichern + `brain wirkung`

**Files:**
- Create: `.tools/wirkung.mjs`
- Modify: `.tools/brain.mjs` (Kopfkommentar Zeile 3–4; Befehlstabelle nach dem Eintrag `antworten:`)
- Test: Create `.tools/tests/test-wirkung.mjs`

**Interfaces:**
- Consumes: aus `verlauf.mjs` (Task 1) `jeEintrag`, `nutzerNachricht`, `assistentText`, `werkzeugAufrufe`, `werkzeugErgebnisse`, `kompaktierung`, `hookAusgabe`; `haengeAn(datei, zeile, {max, behalte})`, `zeitstempel()` aus `.tools/logs.mjs`; `EIGENER_VAULT` aus `.tools/pfade.mjs`.
- Produces (`.tools/wirkung.mjs`):
  - Konstanten `MUSTER_VERSION = "v1"`, `GRUPPEN: { [id]: { name, re } }` (ids: `kontext, falsch, wiederholt, regelbruch, ungeprueft, stil, werkzeug, freigabe`), `RUECKBEZUG`, `HINWEIS_KORREKTUR`, `GROSS_BYTES = 5120`, `RAUSCHBAND = { absolutJe100: 1, relativ: 0.25, minNachrichten: 500 }`, `ANTEIL_HOCH = 0.3`, `WIRKUNG_LOG(vault) → <vault>/.logs/wirkung.jsonl`
  - `transkriptWurzeln({ home }) → string[]` · `transkripte(wurzeln, { tage, bisMs }) → string[]`
  - `leerZaehler() → Zaehler` · `zaehleTranskript(pfad, z, { fristMs }) → Promise<Zaehler>`
  - `messeWirkung({ wurzeln, tage = 30, bisMs, zeitlimitMs = 120000, kitVersion }) → Promise<Messung>` mit `Messung = { zeit, muster, kit, tage, von, bis, wurzeln, dateien, sitzungen, nachrichten, befehle, gruppen: {[id]: {n, s}}, rueckbezug: {n, s, start}, kompakt: {auto, manuell}, hinweise: {n, s, korrektur}, ausgaben: {gross, zeichenGross, zeichenAlle, anteil, jeWerkzeug: {bash, read, mcp, andere}}, unvollstaendig }`
  - `je100(m, id) → number` · `vergleiche(vorher, jetzt) → {[id]: "gesunken"|"gestiegen"|"rauschen"|"nichtVergleichbar"}`
  - `textWirkung(m, vorher) → string` · `kurzWirkung(m, vorher) → string` (eine Zeile, für den Pflegebericht)
  - `nurZahlen(m)` · `speichereMessung(vault, m)` · `leseMessungen(vault) → Messung[]` · `wirkungFuerBericht(vault) → { jetzt, vorher } | null` · `wirkungFaellig(vault, jetzt) → boolean`
  - CLI: `node .tools/wirkung.mjs <vault> [--tage=30] [--bis=JJJJ-MM-TT] [--wurzel=<ordner>]… [--zeitlimit=<s>] [--json] [--speichern]`; Exit 64 bei falscher Option. Über `brain wirkung …`.

- [ ] **Step 1: Failing test schreiben** — `.tools/tests/test-wirkung.mjs`:

```js
// K15 Alltags-Wirkung: Zählen gegen feste Musterlisten (v1 = Auswertung 16.10.2026), Rauschband, Speichern NUR von
// Zahlen. Kernrisiken: Text landet im Log, Subagenten/Systemzeilen werden mitgezählt, Zeitlimit wird ignoriert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, utimesSync, writeFileSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  MUSTER_VERSION, GRUPPEN, RAUSCHBAND, transkripte, transkriptWurzeln, messeWirkung, vergleiche, textWirkung,
  kurzWirkung, speichereMessung, leseMessungen, wirkungFaellig, WIRKUNG_LOG,
} from "../wirkung.mjs";
import {
  tempOrdner, tempVault, schreibeVerlauf, nutzer, assistent, aufruf, ergebnis, hinweis, kompakt, befehl, KIT,
} from "./verlauf-fixture.mjs";

function testWurzel() {
  const w = tempOrdner("projects mit Ümlaut");
  const p = join(w, "-Users-jo-Garten App");
  schreibeVerlauf(join(p, "a.jsonl"), [
    nutzer("Wo waren wir gestern stehen geblieben?"),
    assistent("Beim Beet."),
    aufruf("t1", "Bash", { command: "cat gross.log" }),
    ergebnis("t1", "x".repeat(6000)),
    hinweis("Brain-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):\n- ~/brain/09_wiki/x.md — x"),
    nutzer("nein, das stimmt nicht"),
    befehl("/compact"),
    kompakt("manual"),
    nutzer("This session is being continued from a previous conversation", { isCompactSummary: true }),
    aufruf("t2", "Read", { file_path: "/x/y.md" }),
    ergebnis("t2", "kurz"),
  ]);
  schreibeVerlauf(join(p, "b.jsonl"), [
    nutzer("mach nochmal die Tests"),
    nutzer("<system-reminder>nur System</system-reminder>"),
    nutzer("Subagent-Frage", { isSidechain: true }),
    "{kaputt",
  ], { halbeZeile: true });
  schreibeVerlauf(join(p, "alt.jsonl"), [nutzer("nein, uralt")]);
  const alt = (Date.now() - 40 * 86400000) / 1000;
  utimesSync(join(p, "alt.jsonl"), alt, alt);
  schreibeVerlauf(join(p, "a", "subagents", "agent-1.jsonl"), [nutzer("nein, Subagent")]);
  return w;
}

test("transkripte: nur <wurzel>/<projekt>/*.jsonl im Zeitfenster, keine Subagenten-Verläufe", () => {
  const namen = transkripte([testWurzel()], { tage: 30 }).map((x) => x.split(/[\\/]/).pop()).sort();
  assert.deepEqual(namen, ["a.jsonl", "b.jsonl"]);
});

test("transkriptWurzeln: findet <home>/.claude*/projects, ignoriert Dateien wie .claude.json", () => {
  const home = tempOrdner("home");
  mkdirSync(join(home, ".claude", "projects"), { recursive: true });
  mkdirSync(join(home, ".claude-<profil2>", "projects"), { recursive: true });
  writeFileSync(join(home, ".claude.json"), "{}");
  assert.deepEqual(transkriptWurzeln({ home }).map((p) => p.slice(home.length).split("\\").join("/")),
    ["/.claude/projects", "/.claude-<profil2>/projects"]);
});

test("messeWirkung: zählt Nachrichten, Gruppen, Rückbezüge, Kompaktierungen, Hinweise und große Ausgaben", async () => {
  const m = await messeWirkung({ wurzeln: [testWurzel()], tage: 30, kitVersion: "0.6.0" });
  assert.equal(m.muster, MUSTER_VERSION);
  assert.equal(m.dateien, 2);
  assert.equal(m.sitzungen, 2);
  assert.equal(m.nachrichten, 3, "System-, Subagenten- und Kompaktierungszeilen zählen nicht");
  assert.equal(m.befehle, 1);
  assert.deepEqual(m.gruppen.falsch, { n: 1, s: 1 });
  assert.deepEqual(m.gruppen.kontext, { n: 1, s: 1 });
  assert.deepEqual(m.gruppen.wiederholt, { n: 1, s: 1 });
  assert.deepEqual(m.gruppen.regelbruch, { n: 0, s: 0 });
  assert.deepEqual(m.rueckbezug, { n: 1, s: 1, start: 1 });
  assert.deepEqual(m.kompakt, { auto: 0, manuell: 1 });
  assert.deepEqual(m.hinweise, { n: 1, s: 1, korrektur: 1 });
  assert.equal(m.ausgaben.gross, 1);
  assert.equal(m.ausgaben.jeWerkzeug.bash, 6000);
  assert.equal(m.ausgaben.jeWerkzeug.read, 0);
  assert.ok(m.ausgaben.anteil > 0.9 && m.ausgaben.anteil < 1, String(m.ausgaben.anteil));
  assert.equal(m.unvollstaendig, false);
  assert.equal(m.kit, "0.6.0");
});

test("messeWirkung: Zeitlimit 0 → unvollständig, nichts gezählt", async () => {
  const m = await messeWirkung({ wurzeln: [testWurzel()], zeitlimitMs: 0 });
  assert.equal(m.unvollstaendig, true);
  assert.equal(m.dateien, 0);
});

test("vergleiche: Rauschband — zu wenig Nachrichten, andere Musterliste, Rauschen, echte Änderung", () => {
  const mess = (n, falsch, muster = MUSTER_VERSION) => ({
    muster, nachrichten: n,
    gruppen: Object.fromEntries(Object.keys(GRUPPEN).map((k) => [k, { n: k === "falsch" ? falsch : 0, s: 0 }])),
  });
  assert.equal(vergleiche(null, mess(1000, 10)).falsch, "nichtVergleichbar");
  assert.equal(vergleiche(mess(400, 40), mess(1000, 10)).falsch, "nichtVergleichbar");
  assert.equal(vergleiche(mess(1000, 40, "v0"), mess(1000, 10)).falsch, "nichtVergleichbar");
  assert.equal(vergleiche(mess(1000, 40), mess(1000, 35)).falsch, "rauschen");   // 4,0 → 3,5: < 1,0 je 100
  assert.equal(vergleiche(mess(1000, 100), mess(1000, 88)).falsch, "rauschen"); // 10 → 8,8: ≥ 1,0, aber < 25 %
  assert.equal(vergleiche(mess(1000, 40), mess(1000, 20)).falsch, "gesunken");
  assert.equal(vergleiche(mess(1000, 20), mess(1000, 40)).falsch, "gestiegen");
  assert.equal(RAUSCHBAND.minNachrichten, 500);
});

test("speichereMessung: speichert nur Zahlen und feste Kennungen, nie Nachrichtentext", async () => {
  const v = tempVault();
  speichereMessung(v, await messeWirkung({ wurzeln: [testWurzel()], kitVersion: "0.6.0" }));
  const roh = readFileSync(WIRKUNG_LOG(v), "utf8");
  for (const wort of ["stimmt", "nochmal", "gestern", "Beet", "xxxx", "Garten"]) assert.ok(!roh.includes(wort), wort);
  const gespeichert = leseMessungen(v);
  assert.equal(gespeichert.length, 1);
  const TEXT_ERLAUBT = new Set(["zeit", "muster", "kit", "von", "bis"]);
  const pruefe = (o, pfad = "") => {
    for (const [k, w] of Object.entries(o)) {
      if (w && typeof w === "object") pruefe(w, `${pfad}${k}.`);
      else if (typeof w === "string") assert.ok(TEXT_ERLAUBT.has(k), `Text in ${pfad}${k}`);
      else assert.ok(typeof w === "number" || typeof w === "boolean", `${pfad}${k}`);
    }
  };
  pruefe(gespeichert[0]);
});

test("wirkungFaellig: ohne Messung ja, frisch nein, nach 30 Tagen ja, laufender Lauf (Marke < 1 h) nein", () => {
  const v = tempVault();
  assert.equal(wirkungFaellig(v), true);
  speichereMessung(v, { zeit: "2026-10-16T10:00:00", muster: MUSTER_VERSION, nachrichten: 0 });
  const t = Date.parse("2026-10-16T10:00:00Z");
  assert.equal(wirkungFaellig(v, t + 86400000), false);
  assert.equal(wirkungFaellig(v, t + 31 * 86400000), true);
  writeFileSync(join(v, ".logs", "wirkung.laeuft"), "");
  assert.equal(wirkungFaellig(v, Date.now()), false);
});

test("textWirkung/kurzWirkung: Kennzahlen, Musterliste und Rauschband stehen im Text", async () => {
  const m = await messeWirkung({ wurzeln: [testWurzel()] });
  const t = textWirkung(m);
  assert.match(t, /Musterliste v1/);
  assert.match(t, /Kompaktierungen: 1 \(0 automatisch, 1 manuell\)/);
  assert.match(t, /falsch\/stimmt nicht: 33,3 · 1 · 1/);
  assert.match(t, /Rauschband/);
  assert.match(kurzWirkung(m), /^Alltags-Wirkung \(.*\): je 100 Nachrichten Gedächtnis 33,3/);
});

test("CLI brain wirkung: --wurzel, --json, --speichern (Vault mit Leerzeichen/Umlaut); falsche Option → Exit 64", () => {
  const v = tempVault("Mein Brän"), w = testWurzel();
  const lauf = (...a) => spawnSync(process.execPath, [join(KIT, "brain.mjs"), "wirkung", ...a],
    { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: v } });
  const r = lauf(`--wurzel=${w}`, "--json", "--speichern");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).nachrichten, 3);
  assert.equal(leseMessungen(v).length, 1);
  const t = lauf(`--wurzel=${w}`);
  assert.equal(t.status, 0);
  assert.match(t.stdout, /^Alltags-Wirkung/);
  assert.equal(lauf("--tage=0").status, 64);
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-wirkung.mjs`
Expected: FAIL — `Cannot find module '…/.tools/wirkung.mjs'`.

- [ ] **Step 3: `wirkung.mjs` schreiben** — `.tools/wirkung.mjs`:

```js
#!/usr/bin/env node
// .tools/wirkung.mjs — K15 „Alltags-Wirkung messen" (Spec §12.2, §13.2). Wertet lokal die Claude-Code-Verläufe der
// letzten N Tage aus: Nutzer-Nachrichten gegen feste Musterlisten, Rückbezüge, Kompaktierungen, Brain-Hinweise mit
// späterer Korrektur und den Anteil großer Werkzeug-Ausgaben (> 5 KB) am Verlaufstext. 0 Tokens.
// Gespeichert werden NUR Zahlen (.logs/wirkung.jsonl), nie Text. Musterlisten = 1:1 die Auswertung vom 16.10.2026
// (an.py/an2.py), Version MUSTER_VERSION. Ändert sich eine Liste, steigt die Version — Messungen verschiedener
// Versionen werden nie verglichen. Achtung: \b ist in JavaScript nur ASCII — die Node-Zahlen sind deshalb nur mit
// Node-Messungen vergleichbar (Messprotokoll docs/messungen/2026-10-16-m2a-wirkung-ausgang.md im App-Repo).
// CLI: node wirkung.mjs <vault> [--tage=30] [--bis=JJJJ-MM-TT] [--wurzel=<ordner>]… [--zeitlimit=<s>] [--json] [--speichern]
import { readdirSync, statSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  jeEintrag, nutzerNachricht, assistentText, werkzeugAufrufe, werkzeugErgebnisse, kompaktierung, hookAusgabe,
} from "./verlauf.mjs";
import { haengeAn, zeitstempel } from "./logs.mjs";
import { EIGENER_VAULT } from "./pfade.mjs";

export const MUSTER_VERSION = "v1";
export const GRUPPEN = {
  kontext: { name: "Kontext/Gedächtnis", re: /wie gestern|wo waren wir|wei(ß|ss)t du noch|hab ich (doch )?(schon )?(gesagt|erwähnt)|schon mal gesagt|vergessen|erinner|letzte[nr]? (session|sitzung)|wie besprochen|merk dir/iu },
  falsch: { name: "falsch/stimmt nicht", re: /\bfalsch\b|stimmt (so )?nicht|\bnein\b|nicht richtig|das ist (so )?nicht|quatsch|unsinn/iu },
  wiederholt: { name: "Wiederholung/nochmal", re: /schon wieder|nochmal|noch mal|immer wieder/iu },
  regelbruch: { name: "Regelbruch", re: /warum hast du|wieso hast du|hab ich (dir )?doch|nicht so\b|das sollst du nicht|sollte(st)? du nicht|ich hatte (doch )?gesagt|regel/iu },
  ungeprueft: { name: "ungeprüft/kaputt", re: /nicht (geprüft|getestet|fertig)|funktioniert nicht|geht nicht|klappt nicht|fehler|kaputt|prüf(e)? (das )?(nochmal|erst)|belege|beweis/iu },
  stil: { name: "Rückfragen/Stil", re: /frag nicht|nicht (so )?viel(e)? fragen|zu lang|kürzer|zu viel|nerv|einfach machen|mach einfach|hör auf/iu },
  werkzeug: { name: "Werkzeug/Modell/Tokens", re: /subagent|agent|modell|opus|sonnet|haiku|token|zu teuer|kosten/iu },
  freigabe: { name: "Freigabe/Sicherheit", re: /freigabe|ohne (frage|rückfrage)|nicht ohne|ohne mich|erlaubnis|prod\b|produktion|secret|passwort|api.?key/iu },
};
export const RUECKBEZUG = /wie besprochen|weiter mit|letzte[nr]? (session|sitzung)|handoff|session_|weitermachen|wo waren wir|stand der|zuletzt|vorhin|gestern/iu;
export const HINWEIS_KORREKTUR = /stimmt (so )?nicht|\bfalsch\b|brain-feedback|das war falsch/iu;
export const GROSS_BYTES = 5 * 1024;
export const MAX_ZEICHEN_MUSTER = 600;   // wie an.py: nur Nachrichten < 600 Zeichen gegen die Gruppen prüfen
export const RAUSCHBAND = Object.freeze({ absolutJe100: 1.0, relativ: 0.25, minNachrichten: 500 });
export const ANTEIL_HOCH = 0.3;
const TAG_MS = 86400000, MONAT_MS = 30 * TAG_MS;
export const WIRKUNG_LOG = (vault) => join(vault, ".logs", "wirkung.jsonl");
const LAUF_MARKE = (vault) => join(vault, ".logs", "wirkung.laeuft");
const runde = (x, stellen = 1) => { const f = 10 ** stellen; return Math.round(x * f) / f; };
const zahl = (x) => String(x).replace(".", ",");

// Alle <home>/.claude*/projects (Fabio hat ~/.claude und ~/.claude-<profil2>), jede echte Wurzel nur einmal.
export function transkriptWurzeln({ home = homedir() } = {}) {
  const out = [], gesehen = new Set();
  let namen = [];
  try { namen = readdirSync(home).filter((n) => n.startsWith(".claude")).sort(); } catch { return out; }
  for (const n of namen) {
    const p = join(home, n, "projects");
    try {
      if (!statSync(p).isDirectory()) continue;
      const echt = realpathSync(p);
      if (gesehen.has(echt)) continue;
      gesehen.add(echt);
      out.push(p);
    } catch {}
  }
  return out;
}

// <wurzel>/<projekt>/*.jsonl mit mtime im Fenster (Subagenten liegen tiefer und zählen nicht — wie ex.py).
export function transkripte(wurzeln, { tage = 30, bisMs = Date.now() } = {}) {
  const vonMs = bisMs - tage * TAG_MS, out = [];
  for (const w of wurzeln) {
    let projekte = [];
    try { projekte = readdirSync(w, { withFileTypes: true }).filter((e) => e.isDirectory()); } catch { continue; }
    for (const p of projekte) {
      let dateien = [];
      try { dateien = readdirSync(join(w, p.name)).filter((n) => n.endsWith(".jsonl")); } catch { continue; }
      for (const d of dateien) {
        const f = join(w, p.name, d);
        try { const m = statSync(f).mtimeMs; if (m >= vonMs && m <= bisMs) out.push(f); } catch {}
      }
    }
  }
  return out.sort();
}

export function leerZaehler() {
  return {
    dateien: 0, sitzungen: 0, nachrichten: 0, befehle: 0,
    gruppen: Object.fromEntries(Object.keys(GRUPPEN).map((k) => [k, { n: 0, s: 0 }])),
    rueckbezug: { n: 0, s: 0, start: 0 },
    kompakt: { auto: 0, manuell: 0 },
    hinweise: { n: 0, s: 0, korrektur: 0 },
    ausgaben: { gross: 0, zeichenGross: 0, zeichenAlle: 0, anteil: 0, jeWerkzeug: { bash: 0, read: 0, mcp: 0, andere: 0 } },
    unvollstaendig: false,
  };
}
const gruppeVon = (name) => (name === "Bash" ? "bash" : name === "Read" ? "read" : /^mcp__/.test(name) ? "mcp" : "andere");

// Zählt EINEN Verlauf in z hinein. Sitzungs-Zahlen (s) zählen je Verlauf höchstens einmal.
// „Hinweis mit späterer Korrektur" je Sitzung wie an2.py: ein Brain-Hinweis und danach eine Korrektur-Nachricht.
export async function zaehleTranskript(pfad, z = leerZaehler(), { fristMs = Infinity } = {}) {
  const namen = new Map();
  const s = { nachrichten: 0, gruppen: new Set(), rueck: false, hinweis: false, korrektur: false };
  const r = await jeEintrag(pfad, (o) => {
    const k = kompaktierung(o);
    if (k) { z.kompakt[k]++; return; }
    const h = hookAusgabe(o);
    if (h) {
      if (h.ereignis === "UserPromptSubmit" && h.text.startsWith("Brain-Treffer")) { z.hinweise.n++; s.hinweis = true; }
      return;
    }
    if (o.type === "assistant") {
      z.ausgaben.zeichenAlle += assistentText(o).length;
      for (const a of werkzeugAufrufe(o)) { namen.set(a.id, a.name); z.ausgaben.zeichenAlle += JSON.stringify(a.input).length; }
      return;
    }
    for (const e of werkzeugErgebnisse(o)) {
      z.ausgaben.zeichenAlle += e.text.length;
      if (Buffer.byteLength(e.text, "utf8") > GROSS_BYTES) {
        z.ausgaben.gross++;
        z.ausgaben.zeichenGross += e.text.length;
        z.ausgaben.jeWerkzeug[gruppeVon(namen.get(e.id) || "")] += e.text.length;
      }
    }
    const m = nutzerNachricht(o);
    if (!m) return;
    if (m.befehl) { z.befehle++; return; }
    const erste = s.nachrichten === 0;
    s.nachrichten++;
    z.nachrichten++;
    z.ausgaben.zeichenAlle += m.text.length;
    if (m.text.length < MAX_ZEICHEN_MUSTER) {
      for (const [id, g] of Object.entries(GRUPPEN)) if (g.re.test(m.text)) { z.gruppen[id].n++; s.gruppen.add(id); }
    }
    if (RUECKBEZUG.test(m.text)) { z.rueckbezug.n++; s.rueck = true; if (erste) z.rueckbezug.start++; }
    if (s.hinweis && HINWEIS_KORREKTUR.test(m.text)) s.korrektur = true;
  }, { fristMs });
  if (!r.vollstaendig) z.unvollstaendig = true;
  if (s.nachrichten) z.sitzungen++;
  for (const id of s.gruppen) z.gruppen[id].s++;
  if (s.rueck) z.rueckbezug.s++;
  if (s.hinweis) z.hinweise.s++;
  if (s.korrektur) z.hinweise.korrektur++;
  return z;
}

export async function messeWirkung({ wurzeln = transkriptWurzeln(), tage = 30, bisMs = Date.now(), zeitlimitMs = 120000, kitVersion = "?" } = {}) {
  const t0 = Date.now(), z = leerZaehler();
  for (const f of transkripte(wurzeln, { tage, bisMs })) {
    const rest = zeitlimitMs - (Date.now() - t0);
    if (rest <= 0) { z.unvollstaendig = true; break; }
    z.dateien++;
    await zaehleTranskript(f, z, { fristMs: rest });
  }
  z.ausgaben.anteil = z.ausgaben.zeichenAlle ? runde(z.ausgaben.zeichenGross / z.ausgaben.zeichenAlle, 3) : 0;
  const tag = (ms) => new Date(ms).toISOString().slice(0, 10);
  return {
    zeit: zeitstempel(), muster: MUSTER_VERSION, kit: String(kitVersion), tage,
    von: tag(bisMs - tage * TAG_MS), bis: tag(bisMs), wurzeln: wurzeln.length, ...z,
  };
}

export function je100(m, id) {
  return m?.nachrichten ? runde((100 * (m.gruppen?.[id]?.n || 0)) / m.nachrichten, 1) : 0;
}

// Rauschband (vorab festgelegt, Messprotokoll): echt erst ab ≥ 1,0 je 100 Nachrichten UND ≥ 25 % des Vorwerts,
// beide Zeiträume ≥ 500 Nachrichten, gleiche Musterliste. Sonst „rauschen" bzw. „nichtVergleichbar".
export function vergleiche(vorher, jetzt) {
  const out = {};
  const vergleichbar = !!vorher && !!jetzt && vorher.muster === jetzt.muster
    && vorher.nachrichten >= RAUSCHBAND.minNachrichten && jetzt.nachrichten >= RAUSCHBAND.minNachrichten;
  for (const id of Object.keys(GRUPPEN)) {
    if (!vergleichbar) { out[id] = "nichtVergleichbar"; continue; }
    const a = je100(vorher, id), d = je100(jetzt, id) - a;
    const echt = Math.abs(d) >= RAUSCHBAND.absolutJe100 && Math.abs(d) >= RAUSCHBAND.relativ * a;
    out[id] = !echt ? "rauschen" : d < 0 ? "gesunken" : "gestiegen";
  }
  return out;
}

const TREND = { gesunken: "gesunken", gestiegen: "gestiegen", rauschen: "im Rauschen", nichtVergleichbar: "" };
export function textWirkung(m, vorher = null) {
  const v = vergleiche(vorher, m);
  const z = [];
  z.push(`Alltags-Wirkung (${m.von} bis ${m.bis}, ${m.tage} Tage, Musterliste ${m.muster}): ${m.sitzungen} Sitzungen, `
    + `${m.nachrichten} Nutzer-Nachrichten, ${m.befehle} Befehle${m.unvollstaendig ? " — UNVOLLSTÄNDIG (Zeitlimit)" : ""}`);
  z.push("Nachrichten je Gruppe (je 100 Nachrichten · Anzahl · Sitzungen):");
  for (const [id, g] of Object.entries(GRUPPEN)) {
    const t = TREND[v[id]];
    z.push(`- ${g.name}: ${zahl(je100(m, id))} · ${m.gruppen[id].n} · ${m.gruppen[id].s}${t ? ` — ${t} gegenüber ${vorher.bis}` : ""}`);
  }
  z.push(`Rückbezüge („wo waren wir", „gestern" …): ${m.rueckbezug.n} in ${m.rueckbezug.s} Sitzungen, davon ${m.rueckbezug.start} als erste Nachricht`);
  z.push(`Kompaktierungen: ${m.kompakt.auto + m.kompakt.manuell} (${m.kompakt.auto} automatisch, ${m.kompakt.manuell} manuell)`);
  z.push(`Brain-Hinweise: ${m.hinweise.n} in ${m.hinweise.s} Sitzungen; Sitzungen mit Hinweis und späterer Korrektur: ${m.hinweise.korrektur}`);
  const a = m.ausgaben, pct = (x) => (a.zeichenGross ? Math.round((100 * x) / a.zeichenGross) : 0);
  z.push(`Große Werkzeug-Ausgaben (> 5 KB): ${a.gross}, ${zahl(runde(100 * a.anteil, 1))} % des Verlaufstexts `
    + `(Bash ${pct(a.jeWerkzeug.bash)} %, Read ${pct(a.jeWerkzeug.read)} %, MCP ${pct(a.jeWerkzeug.mcp)} %, andere ${pct(a.jeWerkzeug.andere)} %)`
    + `${a.anteil >= ANTEIL_HOCH ? " — HOCH: Auslagern großer Ausgaben als eigenen Baustein vorschlagen" : ""}`);
  z.push(`Rauschband: eine Änderung gilt erst ab ±${zahl(RAUSCHBAND.absolutJe100)} je 100 Nachrichten und ±${RAUSCHBAND.relativ * 100} %, `
    + `bei ≥ ${RAUSCHBAND.minNachrichten} Nachrichten je Zeitraum. Grobe Musterzählung — nur mit sich selbst vergleichen.`);
  return z.join("\n");
}

// Eine Zeile für den Pflegebericht: die Gruppen, bei denen K2/K11/K12 wirken sollen (Spec §13.2), Pfeil nur
// außerhalb des Rauschbands.
export function kurzWirkung(m, vorher = null) {
  const v = vergleiche(vorher, m);
  const pfeil = (id) => (v[id] === "gesunken" ? " ↓" : v[id] === "gestiegen" ? " ↑" : "");
  const teil = (id, name) => `${name} ${zahl(je100(m, id))}${pfeil(id)}`;
  return `Alltags-Wirkung (${m.von} bis ${m.bis}, ${m.sitzungen} Sitzungen, Musterliste ${m.muster}): je 100 Nachrichten `
    + `${teil("kontext", "Gedächtnis")} · ${teil("regelbruch", "Regelbruch")} · ${teil("wiederholt", "Wiederholungen")} · ${teil("falsch", "„falsch“")}; `
    + `Kompaktierungen ${m.kompakt.auto + m.kompakt.manuell}; große Werkzeug-Ausgaben ${zahl(runde(100 * m.ausgaben.anteil, 0))} % — Details: brain wirkung`;
}

// Nur diese Schlüssel werden gespeichert — alles Zahlen bzw. feste Kennungen (zeit, muster, kit, von, bis).
const SCHLUESSEL = ["zeit", "muster", "kit", "tage", "von", "bis", "wurzeln", "dateien", "sitzungen", "nachrichten", "befehle",
  "gruppen", "rueckbezug", "kompakt", "hinweise", "ausgaben", "unvollstaendig"];
export function nurZahlen(m) { return Object.fromEntries(SCHLUESSEL.map((k) => [k, m[k]])); }
export function speichereMessung(vault, m) {
  haengeAn(WIRKUNG_LOG(vault), JSON.stringify(nurZahlen(m)), { max: 500, behalte: 250 });
}
export function leseMessungen(vault) {
  let t = "";
  try { t = readFileSync(WIRKUNG_LOG(vault), "utf8"); } catch { return []; }
  return t.split("\n").map((z) => {
    try { const o = JSON.parse(z); return o && typeof o === "object" && o.muster ? o : null; } catch { return null; }
  }).filter(Boolean);
}
export function wirkungFuerBericht(vault) {
  const l = leseMessungen(vault);
  return l.length ? { jetzt: l.at(-1), vorher: l.length > 1 ? l.at(-2) : null } : null;
}
// Monatlich: keine Messung oder die letzte ≥ 30 Tage alt; nie, solange ein Lauf läuft (Marke < 1 h).
export function wirkungFaellig(vault, jetzt = Date.now()) {
  try { if (jetzt - statSync(LAUF_MARKE(vault)).mtimeMs < 3600000) return false; } catch {}
  const letzte = leseMessungen(vault).at(-1);
  if (!letzte) return true;
  const ms = Date.parse(`${letzte.zeit}Z`);
  return !Number.isFinite(ms) || jetzt - ms >= MONAT_MS;
}

// ---------- CLI ----------
const HIER = dirname(fileURLToPath(import.meta.url));
const selbst = fileURLToPath(import.meta.url);
let aufruf = "";
try { aufruf = realpathSync(process.argv[1] || ""); } catch {}
if (aufruf && aufruf === realpathSync(selbst)) {
  const args = process.argv.slice(2);
  const werte = (k) => args.filter((a) => a.startsWith(`--${k}=`)).map((a) => a.slice(k.length + 3));
  const vault = args.find((a) => !a.startsWith("--")) || process.env.BRAIN_VAULT || EIGENER_VAULT;
  const tage = Number(werte("tage")[0] || 30);
  const bis = werte("bis")[0];
  const bisMs = bis ? Date.parse(`${bis}T23:59:59`) : Date.now();
  const zeitlimitMs = Number(werte("zeitlimit")[0] || 120) * 1000;
  if (!(tage > 0) || !Number.isFinite(bisMs) || !(zeitlimitMs > 0)) {
    console.error("Nutzung: brain wirkung [--tage=30] [--bis=JJJJ-MM-TT] [--wurzel=<ordner>] [--zeitlimit=<sekunden>] [--json] [--speichern]");
    process.exit(64);
  }
  const speichern = args.includes("--speichern");
  const extra = werte("wurzel");
  let kitVersion = "?";
  try { kitVersion = readFileSync(join(HIER, "VERSION"), "utf8").trim(); } catch {}
  try {
    if (speichern) { mkdirSync(join(vault, ".logs"), { recursive: true }); writeFileSync(LAUF_MARKE(vault), ""); }
    const vorher = leseMessungen(vault).at(-1) || null;
    const m = await messeWirkung({ wurzeln: extra.length ? extra : transkriptWurzeln(), tage, bisMs, zeitlimitMs, kitVersion });
    if (speichern) speichereMessung(vault, m);
    console.log(args.includes("--json") ? JSON.stringify(nurZahlen(m)) : textWirkung(m, vorher));
  } catch {
    console.error(`Wirkungs-Messung nicht möglich — ist ${vault} wirklich ein Brain?`);
    process.exitCode = 1;
  } finally {
    if (speichern) try { unlinkSync(LAUF_MARKE(vault)); } catch {}
  }
}
```

- [ ] **Step 4: `brain wirkung` in `brain.mjs` eintragen** — Kopfkommentar: Zeile `//   | lernschleife | antworten` ersetzen durch

```js
//   | lernschleife | antworten | wirkung
```
und in der Befehlstabelle direkt nach der Zeile `antworten: (...a) => node("antwort-messlatte.mjs", vault, ...a),` einfügen:

```js
  // „brain wirkung [--tage=30] [--bis=JJJJ-MM-TT] [--json] [--speichern]" — K15 Alltags-Wirkung (0 Tokens, speichert nur Zahlen).
  wirkung: (...a) => node("wirkung.mjs", vault, ...a),
```

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-wirkung.mjs .tools/tests/test-verlauf.mjs && bash .tools/tests/test-cli.sh`
Expected: alle PASS, `test-cli.sh` Exit 0.

- [ ] **Step 6: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/wirkung.mjs .tools/brain.mjs .tools/tests/test-wirkung.mjs
git commit -m "kit: brain wirkung — Alltags-Wirkung lokal messen, nur Zahlen speichern (K15)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: K15 — Pflegebericht, monatliche Messung, Ausgangs-Messprotokoll

**Files:**
- Modify: `.tools/pflege.mjs` (Imports oben; `return { erstellt: …` am Ende von `pflegebericht`; `textBericht`)
- Modify: `.tools/adapters/claude-code/session-hintergrund.mjs` (nach der Zeile `if (AUTOMATIK.wochenbericht !== false) node("pflege.mjs", [V, "--cache"]);`)
- Modify: `.tools/kit/AGENTS.md` (Abschnitt mit den Alltagssätzen, nach „wie gut ist mein Brain“)
- Test: Modify `.tools/tests/test-wirkung.mjs` (Test anhängen)
- Create (App-Repo): `~/source/brain-app/docs/messungen/2026-10-16-m2a-wirkung-ausgang.md`

**Interfaces:**
- Consumes: `wirkungFuerBericht`, `kurzWirkung`, `wirkungFaellig` (Task 2); `pflegebericht(vault)`, `textBericht(b)` aus `.tools/pflege.mjs` (bestehend).
- Produces: `pflegebericht(vault).wirkung = { jetzt: Messung, vorher: Messung|null } | null` (neues Feld; `posten`, `zuTun`, `beauftragt` unverändert); `textBericht` hängt eine Zeile `Alltags-Wirkung (…)` an, wenn gemessen wurde.

- [ ] **Step 1: Failing test anhängen** — ans Ende von `.tools/tests/test-wirkung.mjs`:

```js
test("Pflegebericht: zeigt die letzte Messung als eine Zeile; ohne Messung kein Feld-Inhalt", async () => {
  const v = tempOrdner("Brain Kopie");
  cpSync(join(KIT, "tests", "fixture"), v, { recursive: true });
  const { pflegebericht, textBericht } = await import("../pflege.mjs");
  assert.equal(pflegebericht(v).wirkung, null);
  speichereMessung(v, await messeWirkung({ wurzeln: [testWurzel()] }));
  const b = pflegebericht(v);
  assert.equal(b.wirkung.jetzt.nachrichten, 3);
  assert.equal(b.wirkung.vorher, null);
  assert.ok(Array.isArray(b.posten), "Posten unverändert");
  assert.match(textBericht(b), /\nAlltags-Wirkung \(/);
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test --test-name-pattern="Pflegebericht" .tools/tests/test-wirkung.mjs`
Expected: FAIL — `b.wirkung` ist `undefined` (erste Prüfung `equal(undefined, null)` scheitert).

- [ ] **Step 3: `pflege.mjs` erweitern** — bei den übrigen Imports oben ergänzen:

```js
import { wirkungFuerBericht, kurzWirkung } from "./wirkung.mjs";
```
In `pflegebericht` die letzte Zeile

```js
  return { erstellt: new Date(jetztMs).toISOString().slice(0, 19) + "Z", posten: liste, zuTun, beauftragt };
```
ersetzen durch

```js
  // K15: letzte Alltags-Wirkungs-Messung (nur Zahlen) — eigenes Feld, die Posten bleiben unverändert.
  return { erstellt: new Date(jetztMs).toISOString().slice(0, 19) + "Z", posten: liste, zuTun, beauftragt, wirkung: wirkungFuerBericht(vault) };
```
In `textBericht` direkt vor `return z.join("\n");` einfügen:

```js
  if (b.wirkung?.jetzt) z.push(kurzWirkung(b.wirkung.jetzt, b.wirkung.vorher));
```

- [ ] **Step 4: Monatliche Messung im Hintergrund** — in `session-hintergrund.mjs` direkt nach der Zeile `if (AUTOMATIK.wochenbericht !== false) node("pflege.mjs", [V, "--cache"]);` einfügen:

```js
// K15: Alltags-Wirkung einmal im Monat messen (0 Tokens, liest nur lokale Verläufe, speichert nur Zahlen) — losgelöst,
// weil das Auswerten von 30 Tagen Verlauf eine Weile dauern kann. Die Marke .logs/wirkung.laeuft verhindert Doppelläufe.
try {
  const { wirkungFaellig } = await import("../../wirkung.mjs");
  if (wirkungFaellig(V)) {
    const kind = spawn(process.execPath, [join(TOOLS, "wirkung.mjs"), V, "--speichern"], { detached: true, stdio: "ignore", windowsHide: true });
    kind.unref();
  }
} catch (e) { log(`Hinweis: Wirkungs-Messung übersprungen (${e.message})`); }
```

- [ ] **Step 5: AGENTS.md-Vorlage** — in `.tools/kit/AGENTS.md` direkt nach der Zeile, die mit `- „wie gut ist mein Brain"` beginnt, einfügen:

```markdown
- „hilft mir das Brain im Alltag?" / „wie wirkt das Brain?" → `{{NODE}} "{{VAULT}}/.tools/brain.mjs" wirkung` (zählt lokal,
  0 Tokens, speichert nur Zahlen; Vergleich nur innerhalb des Rauschbands, das die Ausgabe nennt).
```

- [ ] **Step 6: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-wirkung.mjs .tools/tests/test-pflege-bericht.mjs .tools/tests/test-skills.mjs && bash .tools/tests/test-session-hintergrund.sh && bash .tools/tests/test-pflege.sh`
Expected: alle PASS, Shell-Tests Exit 0.

- [ ] **Step 7: Kit-Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/pflege.mjs .tools/adapters/claude-code/session-hintergrund.mjs .tools/kit/AGENTS.md .tools/tests/test-wirkung.mjs
git commit -m "kit: Alltags-Wirkung monatlich messen und im Pflegebericht zeigen (K15)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Ausgangsmessung (nur lesend auf den echten Verläufen)** — liest `~/.claude*/projects`, schreibt nur in die git-ignorierte `.logs/` des Worktrees:

```bash
cd ~/brain-kit-v0.6 && node .tools/wirkung.mjs "$HOME/brain-kit-v0.6" --bis=2026-10-16 --zeitlimit=900 --json > .logs/wirkung-ausgang.json
node .tools/wirkung.mjs "$HOME/brain-kit-v0.6" --bis=2026-10-16 --zeitlimit=900 | tail -20
git -C ~/brain-kit-v0.6 rev-parse --short HEAD
```
Expected: JSON-Zeile mit `"unvollstaendig":false` (sonst `--zeitlimit` erhöhen und wiederholen) und der Textbericht; die Kurz-SHA notieren.

- [ ] **Step 9: Messprotokoll schreiben** — `~/source/brain-app/docs/messungen/2026-10-16-m2a-wirkung-ausgang.md` (Write-Werkzeug). Teil A ist fest; in Teil B jede `‹…›`-Stelle mit dem genannten Feld aus `.logs/wirkung-ausgang.json` (bzw. der SHA aus Step 8) füllen — nur Zahlen, keine Zitate:

```markdown
# Messprotokoll: Alltags-Wirkung — Ausgangsmessung (K15)

- **Zweck:** Ausgangswert für K15 (Spec §12.2, §13.2). Spätere Messungen (`brain wirkung`, monatlich im
  Pflegebericht) werden **nur mit der Node-Ausgangsmessung (Teil B)** verglichen.
- **Rauschband (vorab festgelegt):** Eine Änderung je Gruppe gilt als echt ab **≥ 1,0 je 100 Nachrichten UND ≥ 25 %
  des Vorwerts**, wenn beide Zeiträume **≥ 500 Nutzer-Nachrichten** haben und dieselbe Musterliste gilt.
  Anteil großer Werkzeug-Ausgaben **≥ 30 %** = „hoch“ → Vorschlag eines eigenen Bausteins (Auslagern großer
  Ausgaben, Muster von context-mode) an Fabio; vorher wird nichts gebaut.
- **Datenschutz:** nur Zahlen — keine Zitate, keine Pfade, keine Projektnamen.

## A. Python-Auswertung vom 16.10.2026 (nur Einordnung, nicht vergleichbar)

Herkunft: Sitzung 8def260d (Skripte ex.py, an.py, an2.py), 30 Tage bis 16.10.2026, 193 Haupt-Verläufe
(190 in `~/.claude`, 3 in `~/.claude-<profil2>`), 174 mit Nutzertext, 2.600 Nutzer-Nachrichten, 70 Befehle.

| Gruppe | Nachrichten | Sitzungen |
|---|---|---|
| ungeprüft/kaputt | 55 | 28 |
| Werkzeug/Modell/Tokens | 55 | 27 |
| falsch/stimmt nicht | 39 | 24 |
| Wiederholung/nochmal | 37 | 17 |
| Freigabe/Sicherheit | 27 | 15 |
| Regelbruch | 20 | 14 |
| Kontext/Gedächtnis | 10 | 8 |
| Rückfragen/Stil | 9 | 8 |

Weitere: Kompaktierungen 43 (27 automatische Fortsetzungen, 16 × `/compact`) · Rückbezüge 62 in 35 Sitzungen,
8 Sitzungsstarts mit Rückbezug · Brain-Hinweise 495 in 134 Sitzungen, 5 dieser Sitzungen mit Korrektur.

Warum nicht vergleichbar: Python-`\b` ist Unicode, JavaScript-`\b` nur ASCII; Python zählte die
Kompaktierungs-Fortsetzungen als Nutzer-Nachricht, Node zählt Kompaktierungen über die Grenzzeile im Verlauf.

## B. Node-Ausgangsmessung (Vergleichsbasis, Musterliste ‹muster›)

Herkunft: `node .tools/wirkung.mjs … --bis=2026-10-16 --zeitlimit=900 --json`, Kit-Commit ‹SHA aus Step 8›,
gemessen am ‹zeit›, Zeitraum ‹von› bis ‹bis› (‹tage› Tage, Fenster nach Datei-Änderungszeit), Wurzeln ‹wurzeln›,
Verläufe ‹dateien›, Sitzungen mit Nutzertext ‹sitzungen›, Nutzer-Nachrichten ‹nachrichten›, Befehle ‹befehle›,
unvollständig: ‹unvollstaendig›.

| Gruppe | Nachrichten | Sitzungen | je 100 Nachrichten |
|---|---|---|---|
| Kontext/Gedächtnis | ‹gruppen.kontext.n› | ‹gruppen.kontext.s› | ‹100 × kontext.n / nachrichten, 1 Stelle› |
| falsch/stimmt nicht | ‹gruppen.falsch.n› | ‹gruppen.falsch.s› | ‹…› |
| Wiederholung/nochmal | ‹gruppen.wiederholt.n› | ‹gruppen.wiederholt.s› | ‹…› |
| Regelbruch | ‹gruppen.regelbruch.n› | ‹gruppen.regelbruch.s› | ‹…› |
| ungeprüft/kaputt | ‹gruppen.ungeprueft.n› | ‹gruppen.ungeprueft.s› | ‹…› |
| Rückfragen/Stil | ‹gruppen.stil.n› | ‹gruppen.stil.s› | ‹…› |
| Werkzeug/Modell/Tokens | ‹gruppen.werkzeug.n› | ‹gruppen.werkzeug.s› | ‹…› |
| Freigabe/Sicherheit | ‹gruppen.freigabe.n› | ‹gruppen.freigabe.s› | ‹…› |

Weitere: Rückbezüge ‹rueckbezug.n› in ‹rueckbezug.s› Sitzungen (‹rueckbezug.start› als erste Nachricht) ·
Kompaktierungen ‹kompakt.auto› automatisch + ‹kompakt.manuell› manuell · Brain-Hinweise ‹hinweise.n› in
‹hinweise.s› Sitzungen, ‹hinweise.korrektur› davon mit späterer Korrektur · große Werkzeug-Ausgaben
‹ausgaben.gross› Stück, Anteil ‹100 × ausgaben.anteil› % (Bash ‹…› %, Read ‹…› %, MCP ‹…› %, andere ‹…› %
jeweils `jeWerkzeug.x / zeichenGross`).

**Bewertung Anteil großer Ausgaben:** ‹„hoch (≥ 30 %) → Vorschlag an Fabio“ oder „nicht hoch (< 30 %) → kein
eigener Baustein“›.

## C. Bekannte Grenzen
- Regex statt Lesen: Treffer enthalten Rauschen; Gruppen überlappen. Deshalb nur Trends gegen Teil B, nie Absolutwerte.
- Zeitfenster über die Datei-Änderungszeit: Sitzungen, die nach dem Stichtag weiterliefen, fehlen in Teil B.
- Kausalität (Brain-Hinweis → Korrektur) ist nicht belegbar; die Zahl ist ein Signal für M2b (W7).
```

- [ ] **Step 10: App-Repo-Commit**

```bash
cd ~/source/brain-app
git add docs/messungen/2026-10-16-m2a-wirkung-ausgang.md
git commit -m "docs: Messprotokoll Alltags-Wirkung — Ausgangsmessung (K15)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: K12 — `arbeitsstand.mjs` sammeln, rendern, speichern

**Files:**
- Create: `.tools/arbeitsstand.mjs`
- Test: Create `.tools/tests/test-arbeitsstand.mjs`

**Interfaces:**
- Consumes: aus `verlauf.mjs` (Task 1) `leseKopf`, `leseAb`, `nutzerNachricht`, `werkzeugAufrufe`, `werkzeugErgebnisse`, `zeitVon`, `kuerze`, `ganzeZeilen`, `datumZeit`, `STUECK_MAX`; `hatSecretsImKontext`, `ohneSecrets` aus `.tools/secrets-muster.mjs`.
- Produces (`.tools/arbeitsstand.mjs`):
  - `MAX_EINSPIELEN = 8000`, `BUDGET = { ziel: 600, nachrichten: 4000, aufgaben: 1000, commits: 600, dateien: 800 }`, `NEUESTE_GANZ = 3`, `MAX_GANZ = 1500`, `MAX_AELTER = 200`, `GEHEIM` (Ersatztext), `COMMIT_ZEILE` (RegExp, g+m)
  - `saubereSid(roh) → string` (nur `[\w-]`, ≤ 64)
  - `sammle(transkript, { vorher = null, maxBytes = STUECK_MAX, fristMs = 3000, jetzt = Date.now() }) → Zustand` mit `Zustand = { version: 1, bis, ziel, nachrichten: {zeit, text}[], commits: {sha, zweig, text}[], dateien: string[], aufgaben: {quelle, liste: {text, status}[]}|null, tasks: {[id]: {text, status}}, luecke: boolean, stand: ISO }`
  - `render(zustand, { budget = MAX_EINSPIELEN, quelle = "" }) → string` (≤ budget)
  - `kuerzeAnZeile(text, max) → string` (an Zeilengrenze, Anhang „(… gekürzt)“, ≤ max)
  - `schreibe(vault, sid, zustand) → string|null` (Pfad der `.md`), `leseZustand(vault, sid) → Zustand|null`, `lies(vault, sid) → { text, zustand }|null`, `raeumeAuf(vault, jetzt, maxTage = 14)`
  - Dateien: `<vault>/.logs/sitzungen/<sid>.json` (Zustand) und `<sid>.md` (eingespielter Text).

- [ ] **Step 1: Failing test schreiben** — `.tools/tests/test-arbeitsstand.mjs`:

```js
// K12 Arbeitsstand: wörtliche Auszüge aus DIESER Sitzung, inkrementell ab der letzten Kompaktierung, mit Budget.
// Kernrisiken: Zugangsdaten landen in .logs, Budget wird gesprengt, unbekannte Zeilen bringen alles zum Absturz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { appendFileSync, existsSync, utimesSync } from "node:fs";
import {
  sammle, render, schreibe, lies, leseZustand, kuerzeAnZeile, raeumeAuf, saubereSid, MAX_EINSPIELEN, GEHEIM,
} from "../arbeitsstand.mjs";
import { tempOrdner, tempVault, schreibeVerlauf, nutzer, assistent, aufruf, ergebnis } from "./verlauf-fixture.mjs";

function verlauf() {
  const f = join(tempOrdner("Verlauf Ä"), "s1.jsonl");
  schreibeVerlauf(f, [
    nutzer("Ziel: Baue den Export für die Garten-App"),
    assistent("Mache ich."),
    aufruf("t1", "TodoWrite", { todos: [
      { content: "Export bauen", status: "in_progress" }, { content: "Tests", status: "pending" },
      { content: "Plan lesen", status: "completed" }] }),
    aufruf("t2", "Edit", { file_path: "/Users/jo/Mein Projekt/ä.mjs", old_string: "a", new_string: "b" }),
    aufruf("t3", "Bash", { command: "git commit -m x" }),
    ergebnis("t3", "[kit-v0.6 abc1234] kit: Export gebaut\n 1 file changed"),
    aufruf("t4", "Bash", { command: "echo" }),
    ergebnis("t4", "[main deadbeef] gescheitert", { fehler: true }),
    nutzer("Wichtig: nie direkt auf main pushen"),
    nutzer("hier der Zugang: passwort=geheim12345"),
    { type: "zukunft-neu", irgendwas: 1 },
    "{kaputt",
  ], { halbeZeile: true });
  return f;
}

test("sammle: Ziel, Nachrichten, Commits, Dateien, offene Aufgaben — unbekannte/kaputte/halbe Zeilen still übersprungen", () => {
  const z = sammle(verlauf());
  assert.equal(z.ziel, "Ziel: Baue den Export für die Garten-App");
  assert.deepEqual(z.nachrichten.map((n) => n.text),
    ["Ziel: Baue den Export für die Garten-App", "Wichtig: nie direkt auf main pushen", GEHEIM]);
  assert.deepEqual(z.commits, [{ sha: "abc1234", zweig: "kit-v0.6", text: "kit: Export gebaut" }], "Fehler-Ergebnisse zählen nicht");
  assert.deepEqual(z.dateien, ["/Users/jo/Mein Projekt/ä.mjs"]);
  assert.deepEqual(z.aufgaben.liste.map((a) => a.text), ["Export bauen", "Tests"]);
  assert.equal(z.luecke, false);
});

test("sammle/render: Zugangsdaten erscheinen nirgends — weder im Zustand noch im Text", () => {
  const z = sammle(verlauf());
  const t = render(z);
  assert.ok(!JSON.stringify(z).includes("geheim12345"));
  assert.ok(!t.includes("geheim12345"));
  assert.ok(t.includes(GEHEIM));
});

test("sammle: inkrementell ab der Marke — nur neue Nachrichten; Commits, Dateien und Aufgaben bleiben", () => {
  const f = verlauf();
  const z1 = sammle(f);
  appendFileSync(f, '"}}\n'
    + JSON.stringify(nutzer("Nach der ersten Kompaktierung: weiter mit Tests")) + "\n"
    + JSON.stringify(aufruf("t9", "Write", { file_path: "/tmp/neu.md", content: "x" })) + "\n"
    + JSON.stringify(aufruf("t10", "Bash", { command: "git commit" })) + "\n"
    + JSON.stringify(ergebnis("t10", "[kit-v0.6 1234567] kit: Tests")) + "\n");
  const z2 = sammle(f, { vorher: z1 });
  assert.equal(z2.ziel, z1.ziel);
  assert.deepEqual(z2.nachrichten.map((n) => n.text), ["halb", "Nach der ersten Kompaktierung: weiter mit Tests"],
    "die vorher halbe Zeile zählt jetzt — vollständig, einmal");
  assert.deepEqual(z2.commits.map((c) => c.sha), ["abc1234", "1234567"]);
  assert.deepEqual(z2.dateien, ["/Users/jo/Mein Projekt/ä.mjs", "/tmp/neu.md"]);
  assert.deepEqual(z2.aufgaben.liste.map((a) => a.text), ["Export bauen", "Tests"]);
});

test("sammle: TaskCreate/TaskUpdate — erledigte Aufgaben fallen weg", () => {
  const f = join(tempOrdner(), "tasks.jsonl");
  schreibeVerlauf(f, [
    nutzer("Los"),
    aufruf("c1", "TaskCreate", { subject: "Schema anpassen", description: "…" }), ergebnis("c1", "Task #1 created successfully: Schema anpassen"),
    aufruf("c2", "TaskCreate", { subject: "Doku" }), ergebnis("c2", "Task #2 created successfully: Doku"),
    aufruf("u1", "TaskUpdate", { taskId: "1", status: "completed" }), ergebnis("u1", "Updated task #1"),
    aufruf("u2", "TaskUpdate", { taskId: "2", status: "in_progress" }), ergebnis("u2", "Updated task #2"),
  ]);
  const z = sammle(f);
  assert.deepEqual(z.tasks, { 2: { text: "Doku", status: "in_progress" } });
  assert.match(render(z), /\[in_progress\] #2 Doku/);
});

test("sammle: zu großer neuer Teil → nur das Ende, Ziel trotzdem aus dem Kopf, Lücke wird gemeldet", () => {
  const f = join(tempOrdner(), "gross.jsonl");
  schreibeVerlauf(f, [nutzer("Ziel: großes Projekt"), ...Array.from({ length: 300 }, (_, i) => nutzer(`Schritt ${i} ` + "y".repeat(500)))]);
  const z = sammle(f, { maxBytes: 32 * 1024 });
  assert.equal(z.ziel, "Ziel: großes Projekt");
  assert.equal(z.luecke, true);
  assert.match(render(z), /nicht ausgewertet/);
});

test("render: Budget — neueste drei Nachrichten ganz, ältere gekürzt, Rest mit Hinweis; gesamt ≤ 8.000", () => {
  const z = {
    version: 1, bis: 0, ziel: "Ziel", stand: new Date().toISOString(), luecke: false, commits: [], dateien: [], aufgaben: null, tasks: {},
    nachrichten: Array.from({ length: 50 }, (_, i) => ({ zeit: Date.now(), text: `Nachricht ${i} ` + "z".repeat(900) })),
  };
  const t = render(z);
  assert.ok(t.length <= MAX_EINSPIELEN, String(t.length));
  assert.ok(t.includes(`Nachricht 49 ${"z".repeat(900)}`), "neueste ganz");
  assert.ok(t.includes(`Nachricht 47 ${"z".repeat(900)}`), "drittneueste ganz");
  assert.match(t, /Nachricht 46 z+ \(gekürzt\)/);
  assert.match(t, /\(\d+ ältere Nachricht\(en\) ausgelassen — Platzgrenze\)/);
  assert.match(t, /^Brain-Arbeitsstand vor der Kompaktierung/);
});

test("schreibe/lies: je session_id eigene Datei; fremde session_id bekommt nichts; ohne session_id nichts", () => {
  const v = tempVault("Mein Brän");
  schreibe(v, "sitzung-a", sammle(verlauf()));
  assert.match(lies(v, "sitzung-a").text, /Baue den Export/);
  assert.equal(lies(v, "sitzung-b"), null);
  assert.equal(leseZustand(v, "sitzung-a").version, 1);
  assert.ok(existsSync(join(v, ".logs", "sitzungen", "sitzung-a.json")));
  assert.equal(schreibe(v, "", sammle(verlauf())), null);
  assert.equal(saubereSid("a/../b c"), "abc");
});

test("kuerzeAnZeile und raeumeAuf (> 14 Tage alt)", () => {
  assert.equal(kuerzeAnZeile("kurz", 100), "kurz");
  const t = kuerzeAnZeile(Array.from({ length: 100 }, (_, i) => `Zeile ${i}`).join("\n"), 200);
  assert.ok(t.length <= 200 && t.endsWith("(… gekürzt)"), t);
  const v = tempVault();
  schreibe(v, "alt", sammle(verlauf()));
  const alt = (Date.now() - 20 * 86400000) / 1000;
  for (const e of ["json", "md"]) utimesSync(join(v, ".logs", "sitzungen", `alt.${e}`), alt, alt);
  schreibe(v, "neu", sammle(verlauf()));
  raeumeAuf(v);
  assert.equal(lies(v, "alt"), null);
  assert.ok(lies(v, "neu"));
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-arbeitsstand.mjs`
Expected: FAIL — `Cannot find module '…/.tools/arbeitsstand.mjs'`.

- [ ] **Step 3: `arbeitsstand.mjs` schreiben** — `.tools/arbeitsstand.mjs`:

```js
// .tools/arbeitsstand.mjs — K12 „Arbeitsstand über die Kompaktierung retten" (Spec §12.2). PreCompact sammelt aus dem
// Verlauf DIESER Sitzung wörtliche Auszüge — erste Nutzer-Nachricht (Ziel), Nutzer-Nachrichten seit der letzten
// Kompaktierung, Commits aus der Git-Ausgabe, geänderte Dateien aus Edit/Write, offene Aufgaben (TodoWrite bzw.
// TaskCreate/TaskUpdate) — und legt sie unter .logs/sitzungen/<session_id>.{json,md} ab. SessionStart (source
// "compact") spielt die .md DERSELBEN session_id ein. Nie eine KI-Zusammenfassung, nie Daten einer anderen Sitzung.
// Secret-Riegel: Nachrichten mit Zugangsdaten werden VOR dem Speichern ersetzt; der fertige Text läuft zusätzlich durch
// ohneSecrets. Inkrementell: die .json merkt sich, bis zu welchem Byte gelesen wurde (= Grenze der letzten Kompaktierung).
import { readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  leseKopf, leseAb, nutzerNachricht, werkzeugAufrufe, werkzeugErgebnisse, zeitVon, kuerze, ganzeZeilen, datumZeit, STUECK_MAX,
} from "./verlauf.mjs";
import { hatSecretsImKontext, ohneSecrets } from "./secrets-muster.mjs";

export const MAX_EINSPIELEN = 8000;
export const BUDGET = Object.freeze({ ziel: 600, nachrichten: 4000, aufgaben: 1000, commits: 600, dateien: 800 });
export const NEUESTE_GANZ = 3, MAX_GANZ = 1500, MAX_AELTER = 200;
const MAX_NACHRICHTEN = 60, MAX_COMMITS = 15, MAX_DATEIEN = 40;
const AENDERNDE = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
// Git-Ausgabe eines Commits: „[zweig abc1234] Nachricht" bzw. „[main (root-commit) abc1234] …"
export const COMMIT_ZEILE = /^\[([^\]\s]+)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/gm;
export const GEHEIM = "(Nachricht enthält vermutlich Zugangsdaten — ausgelassen)";
export const saubereSid = (roh) => String(roh || "").replace(/[^\w-]/g, "").slice(0, 64);
const ordnerVon = (vault) => join(vault, ".logs", "sitzungen");
const sicher = (t) => (hatSecretsImKontext(t) ? GEHEIM : t);
const zitat = (t) => String(t).split("\n").map((z) => `> ${z}`).join("\n");
const heim = homedir().split("\\").join("/");
const heimKurz = (p) => { const f = String(p).split("\\").join("/"); return heim && f.startsWith(heim + "/") ? `~${f.slice(heim.length)}` : f; };

export function sammle(transkript, { vorher = null, maxBytes = STUECK_MAX, fristMs = 3000, jetzt = Date.now() } = {}) {
  const t0 = Date.now();
  const z = {
    version: 1,
    bis: 0,
    ziel: typeof vorher?.ziel === "string" ? vorher.ziel : null,
    nachrichten: [],
    commits: Array.isArray(vorher?.commits) ? [...vorher.commits] : [],
    dateien: Array.isArray(vorher?.dateien) ? [...vorher.dateien] : [],
    aufgaben: vorher?.aufgaben && Array.isArray(vorher.aufgaben.liste) ? vorher.aufgaben : null,
    tasks: vorher?.tasks && typeof vorher.tasks === "object" ? { ...vorher.tasks } : {},
    luecke: false,
    stand: new Date(jetzt).toISOString(),
  };
  if (z.ziel == null) {
    for (const o of leseKopf(transkript).eintraege) {
      const m = nutzerNachricht(o);
      if (m?.text) { z.ziel = kuerze(sicher(m.text), BUDGET.ziel); break; }
    }
  }
  const { eintraege, bis, abgeschnitten } = leseAb(transkript, Number(vorher?.bis) || 0, maxBytes);
  z.bis = bis;
  z.luecke = abgeschnitten;
  const aufrufe = new Map();
  for (const o of eintraege) {
    if (Date.now() - t0 > fristMs) { z.luecke = true; break; }   // Rest dieses Stücks bleibt unausgewertet (gemeldet)
    for (const a of werkzeugAufrufe(o)) {
      aufrufe.set(a.id, a);
      if (AENDERNDE.has(a.name)) {
        const p = a.input.file_path ?? a.input.notebook_path;
        if (typeof p === "string" && p && !hatSecretsImKontext(p)) { z.dateien = z.dateien.filter((d) => d !== p); z.dateien.push(p); }
      }
      if (a.name === "TodoWrite" && Array.isArray(a.input.todos)) {
        z.aufgaben = {
          quelle: "TodoWrite",
          liste: a.input.todos.filter((t) => t && t.status !== "completed")
            .map((t) => ({ text: String(t.content ?? "").trim(), status: String(t.status ?? "") })).filter((t) => t.text),
        };
      }
      if (a.name === "TaskUpdate" && a.input.taskId != null) {
        const id = String(a.input.taskId);
        if (z.tasks[id]) {
          const s = String(a.input.status ?? z.tasks[id].status);
          if (s === "completed" || s === "deleted") delete z.tasks[id];
          else z.tasks[id] = { ...z.tasks[id], status: s };
        }
      }
    }
    for (const e of werkzeugErgebnisse(o)) {
      const a = aufrufe.get(e.id);
      if (!a || e.fehler) continue;
      if (a.name === "Bash") {
        for (const m of e.text.matchAll(COMMIT_ZEILE)) {
          const text = ohneSecrets(m[3]).trim();
          if (text && !z.commits.some((c) => c.sha === m[2])) z.commits.push({ sha: m[2], zweig: m[1], text });
        }
      }
      if (a.name === "TaskCreate") {
        const id = /#(\d+)/.exec(e.text)?.[1];
        const titel = String(a.input.subject ?? "").trim();
        if (id && titel) z.tasks[id] = { text: titel, status: "pending" };
      }
    }
    const m = nutzerNachricht(o);
    if (m?.text) z.nachrichten.push({ zeit: zeitVon(o), text: sicher(m.text) });
  }
  z.nachrichten = z.nachrichten.slice(-MAX_NACHRICHTEN);
  z.commits = z.commits.slice(-MAX_COMMITS);
  z.dateien = z.dateien.slice(-MAX_DATEIEN);
  return z;
}

// Neueste NEUESTE_GANZ Nachrichten ganz (≤ MAX_GANZ), ältere auf MAX_AELTER gekürzt; passt eine nicht mehr ins Budget,
// fallen sie und alle älteren weg (mit Zählhinweis) — Ausgabe älteste zuerst.
function nachrichtenBlock(liste, max) {
  const bloecke = [];
  let laenge = 0, ausgelassen = 0;
  for (let i = liste.length - 1; i >= 0; i--) {
    const n = liste[i], neu = liste.length - 1 - i < NEUESTE_GANZ;
    const b = `- ${datumZeit(n.zeit)}\n${zitat(kuerze(n.text, neu ? MAX_GANZ : MAX_AELTER))}`;
    if (ausgelassen || laenge + b.length + 1 > max) { ausgelassen++; continue; }
    bloecke.unshift(b);
    laenge += b.length + 1;
  }
  if (ausgelassen) bloecke.unshift(`(${ausgelassen} ältere Nachricht(en) ausgelassen — Platzgrenze)`);
  return bloecke.join("\n");
}
function aufgabenZeilen(z) {
  const zeilen = [];
  for (const a of z.aufgaben?.liste || []) zeilen.push(`- [${a.status || "offen"}] ${a.text}`);
  for (const [id, t] of Object.entries(z.tasks || {})) zeilen.push(`- [${t.status || "offen"}] #${id} ${t.text}`);
  return zeilen.map((l) => kuerze(sicher(l), 300));
}
function mitRest(zeilen, max) {
  const { text, weggelassen } = ganzeZeilen(zeilen, max - 30);
  return weggelassen ? `${text}\n- … (${weggelassen} weitere)` : text;
}

export function kuerzeAnZeile(text, max) {
  const t = String(text ?? "");
  if (t.length <= max) return t;
  if (max < 40) return "";
  let schnitt = t.lastIndexOf("\n", max - 30);
  if (schnitt <= 0) schnitt = max - 30;
  return `${t.slice(0, schnitt)}\n(… gekürzt)`;
}

export function render(z, { budget = MAX_EINSPIELEN, quelle = "" } = {}) {
  const teile = [`Brain-Arbeitsstand vor der Kompaktierung (Stand ${datumZeit(Date.parse(z.stand))}) — wörtliche Auszüge aus dem `
    + `Verlauf DIESER Sitzung, keine Zusammenfassung${quelle ? `; Datei ${quelle}` : ""}. Ältere Nachrichten können überholt `
    + "sein — im Zweifel nachfragen."];
  if (z.ziel) teile.push(`## Ziel der Sitzung (erste Nutzer-Nachricht)\n${zitat(z.ziel)}`);
  const n = nachrichtenBlock(z.nachrichten || [], BUDGET.nachrichten);
  if (n) teile.push(`## Nutzer-Nachrichten seit der letzten Kompaktierung (wörtlich, älteste zuerst)\n${n}`);
  const a = aufgabenZeilen(z);
  if (a.length) teile.push(`## Offene Aufgaben (Stand laut Aufgabenliste im Verlauf)\n${mitRest(a, BUDGET.aufgaben)}`);
  if (z.commits?.length) {
    teile.push(`## Commits dieser Sitzung (aus der Git-Ausgabe, neueste zuerst)\n${mitRest(z.commits.slice().reverse().map((c) => `- ${c.sha} ${c.text}`), BUDGET.commits)}`);
  }
  if (z.dateien?.length) {
    teile.push(`## Geänderte Dateien (Edit/Write, zuletzt geänderte zuerst)\n${mitRest(z.dateien.slice().reverse().map((p) => `- ${heimKurz(p)}`), BUDGET.dateien)}`);
  }
  if (z.luecke) teile.push("(Hinweis: Ein Teil des Verlaufs wurde aus Zeit- oder Größengründen nicht ausgewertet.)");
  return kuerzeAnZeile(ohneSecrets(teile.join("\n\n")), budget);
}

function schreibeAtomar(datei, inhalt) {
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, inhalt);
  renameSync(tmp, datei);
}
export function schreibe(vault, sid, z) {
  const s = saubereSid(sid);
  if (!s) return null;
  mkdirSync(ordnerVon(vault), { recursive: true });
  const md = join(ordnerVon(vault), `${s}.md`);
  schreibeAtomar(join(ordnerVon(vault), `${s}.json`), JSON.stringify(z) + "\n");
  schreibeAtomar(md, render(z, { quelle: `.logs/sitzungen/${s}.md` }) + "\n");
  return md;
}
export function leseZustand(vault, sid) {
  const s = saubereSid(sid);
  if (!s) return null;
  try {
    const o = JSON.parse(readFileSync(join(ordnerVon(vault), `${s}.json`), "utf8"));
    return o && o.version === 1 ? o : null;
  } catch { return null; }
}
export function lies(vault, sid) {
  const s = saubereSid(sid);
  if (!s) return null;
  try { return { text: readFileSync(join(ordnerVon(vault), `${s}.md`), "utf8").trimEnd(), zustand: leseZustand(vault, s) }; }
  catch { return null; }
}
export function raeumeAuf(vault, jetzt = Date.now(), maxTage = 14) {
  let namen = [];
  try { namen = readdirSync(ordnerVon(vault)); } catch { return; }
  for (const n of namen) {
    const p = join(ordnerVon(vault), n);
    try { if (jetzt - statSync(p).mtimeMs > maxTage * 86400000) unlinkSync(p); } catch {}
  }
}
```

- [ ] **Step 4: Test laufen lassen — muss bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-arbeitsstand.mjs`
Expected: alle PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/arbeitsstand.mjs .tools/tests/test-arbeitsstand.mjs
git commit -m "kit: arbeitsstand.mjs — wörtlicher Arbeitsstand je Sitzung mit Budget und Secret-Riegel (K12)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: K12 — PreCompact-Hook, Einspielen nach der Kompaktierung, Compact instructions

**Files:**
- Create: `.tools/adapters/claude-code/kompakt-sichern.mjs`
- Modify: `.tools/adapters/claude-code/session-start.mjs` (Kopfkommentar; nach `if (!existsSync(V)) process.exit(0);`; alle `console.log(`; Projektseiten-Block; letzte Zeile `process.exit(0);`)
- Modify: `.tools/kit/AGENTS.md` (Abschnitt `# Compact instructions` ans Ende)
- Test: Create `.tools/tests/test-arbeitsstand-hook.mjs`

**Interfaces:**
- Consumes: `sammle`, `schreibe`, `leseZustand`, `saubereSid`, `lies`, `kuerzeAnZeile`, `raeumeAuf`, `MAX_EINSPIELEN` (Task 4); `haengeAn`, `zeitstempel` (`logs.mjs`); `vaultPfad` (`pfade.mjs`).
- Produces:
  - Hook `kompakt-sichern.mjs` (PreCompact): liest `{ session_id, transcript_path }` von stdin, schreibt `.logs/sitzungen/<sid>.{json,md}`, eine Zeile `… kompakt-sichern sid=<8> nachrichten=<n> luecke=<0|1> ms=<n>` in `.logs/hooks.log`; gibt nie etwas aus, Exit immer 0.
  - In `session-start.mjs` neue Modul-Konstanten, die Task 6–8 nutzen: `EINGABE` (Hook-JSON), `QUELLE` (`startup|resume|clear|compact`), `SID` (bereinigt), `CWD` (absolut), `TRANSKRIPT` (Pfad oder ""), Sammelfunktion `aus(text)` (ersetzt `console.log`; leere Texte werden ignoriert), Gesamtgrenze `GESAMT_MAX = 9500`.

- [ ] **Step 1: Failing test schreiben** — `.tools/tests/test-arbeitsstand-hook.mjs`:

```js
// K12 über echte Hook-Aufrufe: PreCompact sichert, SessionStart(compact) spielt ein — strikt je session_id, mit
// Gesamtbudget, auch bei riesigen Verläufen schnell und still.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync, existsSync, readFileSync, openSync, writeSync, closeSync } from "node:fs";
import { tempOrdner, tempVault, schreibeVerlauf, nutzer, assistent, ergebnis, hook, KIT } from "./verlauf-fixture.mjs";

const NUR_STATUS = { BRAIN_SESSION_NUR_STATUS: "1" };
function sitzung(sid, ziel) {
  const f = join(tempOrdner("Verläufe"), `${sid}.jsonl`);
  schreibeVerlauf(f, [nutzer(ziel), assistent("ok"), nutzer(`Vorgabe für ${sid}: nur im Worktree arbeiten`)]);
  return f;
}
const sichern = (v, sid, f, env = {}) => hook("kompakt-sichern.mjs",
  { session_id: sid, transcript_path: f, cwd: v, hook_event_name: "PreCompact", trigger: "auto", custom_instructions: null }, { vault: v, env });
const start = (v, sid, source, extra = {}) => hook("session-start.mjs", { session_id: sid, source, cwd: v, ...extra }, { vault: v, env: NUR_STATUS });

test("kompakt-sichern → SessionStart(compact) spielt den Stand derselben Sitzung wörtlich ein", () => {
  const v = tempVault("Mein Brän");
  const pc = sichern(v, "sitzung-a", sitzung("sitzung-a", "Ziel A: Export bauen"));
  assert.equal(pc.status, 0);
  assert.equal(pc.stdout, "", "PreCompact gibt nie etwas aus");
  assert.ok(existsSync(join(v, ".logs", "sitzungen", "sitzung-a.md")));
  assert.match(readFileSync(join(v, ".logs", "hooks.log"), "utf8"), /kompakt-sichern sid=sitzung- nachrichten=2 luecke=0/);
  const ss = start(v, "sitzung-a", "compact");
  assert.equal(ss.status, 0);
  assert.match(ss.stdout, /^Brain-Arbeitsstand vor der Kompaktierung/);
  assert.match(ss.stdout, /> Ziel A: Export bauen/);
  assert.match(ss.stdout, /Vorgabe für sitzung-a: nur im Worktree arbeiten/);
});

test("zwei parallele Sitzungen bekommen nie den Stand der anderen (Zuordnung strikt über session_id)", () => {
  const v = tempVault();
  sichern(v, "sitzung-a", sitzung("sitzung-a", "Ziel A"));
  sichern(v, "sitzung-b", sitzung("sitzung-b", "Ziel B"));
  const b = start(v, "sitzung-b", "compact").stdout;
  assert.match(b, /Ziel B/);
  assert.doesNotMatch(b, /Ziel A|sitzung-a/);
  assert.doesNotMatch(start(v, "sitzung-c", "compact").stdout, /Brain-Arbeitsstand/);
});

test("SessionStart startup/resume/clear spielt keinen Arbeitsstand ein", () => {
  const v = tempVault();
  sichern(v, "sitzung-a", sitzung("sitzung-a", "Ziel A"));
  for (const q of ["startup", "resume", "clear"]) assert.doesNotMatch(start(v, "sitzung-a", q).stdout, /Brain-Arbeitsstand/, q);
});

test("SessionStart-Ausgabe bleibt mit Ich-Karte und großem Arbeitsstand ≤ 9.500 Zeichen; Arbeitsstand steht zuerst", () => {
  const v = tempVault();
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { ichKarte: true } }));
  writeFileSync(join(v, "09_wiki", "ich.md"), "---\nname: ich\n---\n" + "Ich-Karte ".repeat(200));
  const f = join(tempOrdner(), "gross.jsonl");
  schreibeVerlauf(f, Array.from({ length: 60 }, (_, i) => nutzer(`Nachricht ${i} ` + "w".repeat(1400))));
  sichern(v, "gross", f);
  const out = start(v, "gross", "compact").stdout;
  assert.ok(out.length <= 9500, String(out.length));
  assert.match(out, /^Brain-Arbeitsstand/);
  assert.match(out, /Ich-Karte/);
});

test("kompakt-sichern: 40-MB-Verlauf — Exit 0, Ziel und letzte Vorgabe da, Lücke vermerkt", () => {
  const v = tempVault();
  const f = join(tempOrdner(), "riesig.jsonl");
  const fd = openSync(f, "w");
  writeSync(fd, JSON.stringify(nutzer("Ziel: riesige Sitzung")) + "\n");
  const block = JSON.stringify(ergebnis("t", "r".repeat(100000))) + "\n";
  for (let i = 0; i < 400; i++) writeSync(fd, block);
  writeSync(fd, JSON.stringify(nutzer("letzte Vorgabe")) + "\n");
  closeSync(fd);
  const r = sichern(v, "riesig", f);
  assert.equal(r.status, 0);
  // Großzügige Grenze: diese Datei läuft auch in der Commit-Prüfung parallel zu allen Unit-Tests. Die strenge
  // Grenze (< 5 s) prüft laufzeit-hooks.mjs (Task 11) über test-hook-laufzeit.sh.
  assert.ok(r.ms < 15000, `${r.ms} ms`);
  const md = readFileSync(join(v, ".logs", "sitzungen", "riesig.md"), "utf8");
  assert.match(md, /Ziel: riesige Sitzung/);
  assert.match(md, /letzte Vorgabe/);
  assert.match(md, /nicht ausgewertet/);
});

test("kompakt-sichern: kaputtes stdin, fehlender Verlauf, BRAIN_ERNTE=1 → still, Exit 0, nichts geschrieben", () => {
  const v = tempVault();
  const laeufe = [
    hook("kompakt-sichern.mjs", "kaputt", { vault: v }),
    sichern(v, "x", join(v, "fehlt.jsonl")),
    sichern(v, "y", sitzung("y", "Ziel"), { BRAIN_ERNTE: "1" }),
  ];
  for (const r of laeufe) { assert.equal(r.status, 0); assert.equal(r.stdout, ""); assert.equal(r.stderr, ""); }
  assert.ok(!existsSync(join(v, ".logs", "sitzungen", "x.md")));
  assert.ok(!existsSync(join(v, ".logs", "sitzungen", "y.md")));
});

test("AGENTS.md-Vorlage enthält den Abschnitt „# Compact instructions“", () => {
  assert.match(readFileSync(join(KIT, "kit", "AGENTS.md"), "utf8"), /\n# Compact instructions\n/);
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-arbeitsstand-hook.mjs`
Expected: FAIL — `kompakt-sichern.mjs` fehlt (Exit-Code ≠ 0 bzw. keine Datei), kein „Brain-Arbeitsstand“ in der SessionStart-Ausgabe, kein Abschnitt in AGENTS.md.

- [ ] **Step 3: PreCompact-Hook schreiben** — `.tools/adapters/claude-code/kompakt-sichern.mjs`:

```js
#!/usr/bin/env node
// PreCompact-Hook (K12, Spec §12.2): sichert vor der Kompaktierung den Arbeitsstand DIESER Sitzung als wörtliche
// Auszüge nach .logs/sitzungen/<session_id>.{json,md} (arbeitsstand.mjs). Claude Code spielt die Ausgabe eines
// PreCompact-Hooks nicht ein — darum nur Seiteneffekt; eingespielt wird beim SessionStart mit source "compact".
// Gibt NIE etwas aus, Exit immer 0 (blockiert nie die Kompaktierung). Liest höchstens 16 MB ab der letzten Marke,
// Frist 3 s. BRAIN_ERNTE=1 (Selbstaufruf der Ernte) → nichts tun.
if (process.env.BRAIN_ERNTE === "1") process.exit(0);
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const t0 = Date.now();
try {
  const { vaultPfad } = await import("../../pfade.mjs");
  const { sammle, schreibe, leseZustand, saubereSid } = await import("../../arbeitsstand.mjs");
  const { haengeAn, zeitstempel } = await import("../../logs.mjs");
  const V = vaultPfad([]);
  let e = {};
  try { e = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
  const sid = saubereSid(e?.session_id);
  const transkript = typeof e?.transcript_path === "string" ? e.transcript_path : "";
  if (sid && transkript && existsSync(transkript)) {
    const z = sammle(transkript, { vorher: leseZustand(V, sid) });
    schreibe(V, sid, z);
    haengeAn(join(V, ".logs", "hooks.log"),
      `${zeitstempel()} kompakt-sichern sid=${sid.slice(0, 8)} nachrichten=${z.nachrichten.length} luecke=${z.luecke ? 1 : 0} ms=${Date.now() - t0}`);
  }
} catch { /* nie blockierend, nie Ausgabe */ }
process.exit(0);
```

- [ ] **Step 4: `session-start.mjs` — Kopfkommentar** — nach der Kommentarzeile, die mit `// warten"; Pflege-Lauf wöchentlich losgelöst anstoßen` beginnt, einfügen:

```js
// M2a: Hook-JSON wird EINMAL oben gelesen (EINGABE/QUELLE/SID/CWD/TRANSKRIPT); die Ausgabe wird gesammelt (aus) und am
// Ende mit Gesamtbudget GESAMT_MAX gedruckt. K12: Nach einer Kompaktierung (source "compact") kommt zuerst der wörtliche
// Arbeitsstand dieser Sitzung (.logs/sitzungen/<session_id>.md, geschrieben von kompakt-sichern.mjs).
```

- [ ] **Step 5: `session-start.mjs` — Eingabe einmal lesen, Ausgabe sammeln** — direkt nach der Zeile `if (!existsSync(V)) process.exit(0);` einfügen:

```js
// Hook-JSON einmal lesen (cwd, session_id, source, transcript_path, session_title) — K11/K12/K13 und die Projektseite
// brauchen es; stdin lässt sich nur einmal lesen. leseEingabe ist unten als Funktion deklariert (gehoben).
const EINGABE = await leseEingabe();
const QUELLE = typeof EINGABE?.source === "string" ? EINGABE.source : "startup";
const SID = String(EINGABE?.session_id || "").replace(/[^\w-]/g, "").slice(0, 64);
const CWD = resolve(typeof EINGABE?.cwd === "string" && EINGABE.cwd ? EINGABE.cwd : process.cwd());
const TRANSKRIPT = typeof EINGABE?.transcript_path === "string" ? EINGABE.transcript_path : "";
// Ausgabe sammeln statt sofort drucken: am Ende gilt ein Gesamtbudget (Claude Code übernimmt höchstens 10.000 Zeichen).
const AUSGABE = [];
const aus = (t) => { if (t) AUSGABE.push(String(t)); };
const GESAMT_MAX = 9500;
```
Danach in der ganzen Datei jedes `console.log(` durch `aus(` ersetzen (Edit-Werkzeug mit `replace_all: true`, alter Text `console.log(`, neuer Text `aus(`).

- [ ] **Step 6: `session-start.mjs` — Projektseite nutzt CWD** — im Block `if (automatik.projektAutomatik) {` die zwei Zeilen

```js
    const eingabe = await leseEingabe();
    const cwd = resolve(typeof eingabe?.cwd === "string" && eingabe.cwd ? eingabe.cwd : process.cwd());
```
ersetzen durch

```js
    const cwd = CWD;
```

- [ ] **Step 7: `session-start.mjs` — Ausgabe mit Budget, Arbeitsstand zuerst** — den Dateischluss

```js
    if (seite) aus(`Projektseite: ${anzeigePfad(V, seite)}`);
  } catch {}
}

process.exit(0);
```
ersetzen durch

```js
    if (seite) aus(`Projektseite: ${anzeigePfad(V, seite)}`);
  } catch {}
}

// ---------- Ausgabe (K12-Budget) ----------
// Claude Code übernimmt SessionStart-stdout bis 10.000 Zeichen (darüber: Datei + 2.000 Zeichen Vorschau, die Claude
// nicht von selbst liest). Gesamt ≤ GESAMT_MAX. Nach einer Kompaktierung steht der Arbeitsstand (≤ 8.000) ZUERST;
// die übrigen Zeilen bekommen den Rest. Gekürzt wird immer an einer Zeilengrenze.
let TEXT = AUSGABE.join("\n");
try {
  const { lies, kuerzeAnZeile, raeumeAuf, MAX_EINSPIELEN } = await import("../../arbeitsstand.mjs");
  const stand = QUELLE === "compact" && SID ? lies(V, SID)?.text || "" : "";
  if (stand) {
    const a = kuerzeAnZeile(stand, MAX_EINSPIELEN);
    const rest = kuerzeAnZeile(TEXT, Math.max(0, GESAMT_MAX - a.length - 2));
    TEXT = rest ? `${a}\n\n${rest}` : a;
  } else TEXT = kuerzeAnZeile(TEXT, GESAMT_MAX);
  if (QUELLE === "startup") raeumeAuf(V);
} catch {}
if (TEXT) process.stdout.write(TEXT + "\n", () => process.exit(0));
else process.exit(0);
```

- [ ] **Step 8: Compact instructions in der AGENTS.md-Vorlage** — ans Ende von `.tools/kit/AGENTS.md` anhängen (eine Leerzeile davor):

```markdown

# Compact instructions

Beim Zusammenfassen erhalten: Ziel der Sitzung, Vorgaben und Entscheidungen des Nutzers (möglichst wörtlich),
geänderte Dateien mit Pfad, Commits, offene Punkte und den nächsten Schritt. Der Brain-Arbeitsstand
(`.logs/sitzungen/<sitzung>.md`) wird nach der Kompaktierung wörtlich eingespielt — ihn nicht nacherzählen.
```

- [ ] **Step 9: Tests laufen lassen — müssen bestehen (neue + bestehende SessionStart-Tests)**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-arbeitsstand-hook.mjs .tools/tests/test-arbeitsstand.mjs .tools/tests/test-skills.mjs && bash .tools/tests/test-session-hintergrund.sh && bash .tools/tests/test-config-kaputt.sh && bash .tools/tests/test-pflege.sh && bash .tools/tests/test-ohne-brain-vault.sh`
Expected: alle PASS, Shell-Tests Exit 0 (die bestehenden Ausgaben von session-start sind unverändert, nur gesammelt).

- [ ] **Step 10: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/adapters/claude-code/kompakt-sichern.mjs .tools/adapters/claude-code/session-start.mjs .tools/kit/AGENTS.md .tools/tests/test-arbeitsstand-hook.mjs
git commit -m "kit: Arbeitsstand über die Kompaktierung — PreCompact sichert, SessionStart(compact) spielt ein (K12)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: K11 — „Was war zuletzt“ beim Sitzungsstart

**Files:**
- Create: `.tools/projekt.mjs` (erste Fassung: Git-Wurzel, Projekt-Schlüssel; Task 8 ersetzt die Datei durch die volle Fassung)
- Create: `.tools/zuletzt.mjs`
- Modify: `.tools/adapters/claude-code/session-start.mjs` (vor dem Kommentar `// ---------- Ausgabe (K12-Budget) ----------`)
- Test: Create `.tools/tests/test-zuletzt.mjs`

**Interfaces:**
- Consumes: aus `verlauf.mjs` `leseKopf`, `leseAb`, `nutzerNachricht`, `titelAus`, `zeitVon`, `kuerze`, `ganzeZeilen`, `datumZeit`; `hatSecretsImKontext`, `ohneSecrets` (`secrets-muster.mjs`); `hatPii` (`pii-muster.mjs`); in session-start `QUELLE`, `TRANSKRIPT`, `SID`, `CWD`, `aus`, `cfg`, `gitBefehl` (Task 5 bzw. bestehend).
- Produces:
  - `.tools/projekt.mjs`: `gitWurzel(start) → string|null` (kanonischer Pfad des nächsten Ordners mit `.git`, Ordner oder Datei; funktioniert auch für noch nicht existierende Pfade) · `projektSchluessel(vault, cwd) → string|null` (Git-Wurzel, sonst der Vault, wenn cwd darin liegt, sonst null)
  - `.tools/zuletzt.mjs`: `ZULETZT_MAX = 600` · `sitzungsInfo(pfad) → { datei, sid, startMs, endeMs, titel } | null` · `letzteSitzungen(transkriptPfad, { eigeneSid, anzahl = 3, maxPruefen = 15 }) → Info[]` · `offenAusSessionDatei(memoryOrdner) → { datei, zeilen: string[], mtimeMs } | null` · `commitsSeit(wurzel, seitMs, { git = "git", anzahl = 5 }) → string[]` · `wasWarZuletzt({ transkriptPfad, sid, cwd, git, max }) → string` ("" wenn nichts)

- [ ] **Step 1: Failing test schreiben** — `.tools/tests/test-zuletzt.mjs`:

```js
// K11 „Was war zuletzt": wörtlich aus Verläufen, Git und Handoff; ≤ 600 Zeichen; Titel nie mit Zugangsdaten;
// ohne Git/ohne Verlauf still. „Anbieten, nicht beanspruchen": nichts wird verändert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, writeFileSync, utimesSync, realpathSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gitWurzel, projektSchluessel } from "../projekt.mjs";
import { letzteSitzungen, offenAusSessionDatei, wasWarZuletzt, ZULETZT_MAX } from "../zuletzt.mjs";
import { tempOrdner, tempVault, schreibeVerlauf, nutzer, kiTitel, eigenerTitel, hook } from "./verlauf-fixture.mjs";

const OHNE_GIT = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const git = (cwd, args, env = {}) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args],
  { encoding: "utf8", env: { ...OHNE_GIT, ...env } });
const vor = (min) => new Date(Date.now() - min * 60000);

function projekt() {
  const basis = tempOrdner("Arbeit Ü");
  const repo = join(basis, "Garten App");
  mkdirSync(join(repo, "src"), { recursive: true });
  git(repo, ["init", "-q"]);
  writeFileSync(join(repo, "a.txt"), "a");
  git(repo, ["add", "a.txt"]);
  git(repo, ["commit", "-qm", "uralt"], { GIT_AUTHOR_DATE: "2020-01-01T00:00:00", GIT_COMMITTER_DATE: "2020-01-01T00:00:00" });
  writeFileSync(join(repo, "b.txt"), "b");
  git(repo, ["add", "b.txt"]);
  git(repo, ["commit", "-qm", "Export gebaut"]);
  const verlaeufe = join(basis, "projects", "-Arbeit-Garten-App");
  const sitzung = (name, eintraege, minVor) => {
    const f = join(verlaeufe, `${name}.jsonl`);
    schreibeVerlauf(f, eintraege);
    utimesSync(f, vor(minVor), vor(minVor));
    return f;
  };
  sitzung("alt1", [nutzer("Erste alte Sitzung", { zeit: vor(300).toISOString() })], 290);
  sitzung("mitTitel", [nutzer("Export planen", { zeit: vor(150).toISOString() }), kiTitel("Export für Garten-App planen")], 120);
  sitzung("eigen", [nutzer("x", { zeit: vor(90).toISOString() }), kiTitel("KI-Titel"), eigenerTitel("Mein Name für die Sitzung")], 60);
  sitzung("geheim", [nutzer("token=abcdefgh12345678 bitte einbauen", { zeit: vor(40).toISOString() })], 30);
  sitzung("leer", [{ type: "permission-mode", mode: "auto" }], 10);
  const eigene = sitzung("eigene", [nutzer("aktuelle Sitzung")], 0);
  mkdirSync(join(verlaeufe, "memory"), { recursive: true });
  writeFileSync(join(verlaeufe, "memory", "session_garten_2026-10-15.md"),
    "---\nname: s\n---\n\n**Was lief**\n- viel\n\n**🔴 Offen**\n- Export testen\n- Doku schreiben\n\n**⚠️ Fallen**\n- nie auf main\n");
  return { repo, verlaeufe, eigene };
}

test("gitWurzel/projektSchluessel: aus Unterordner und nicht existierendem Pfad; ohne Repo null; Vault ohne Git zählt", () => {
  const { repo } = projekt();
  assert.equal(gitWurzel(join(repo, "src")), realpathSync(repo));
  assert.equal(gitWurzel(join(repo, "gibt", "es", "nicht")), realpathSync(repo));
  const ohne = tempOrdner("ohne Repo");
  assert.equal(gitWurzel(ohne), null);
  const v = tempVault("Brain ohne Git");
  assert.equal(projektSchluessel(v, join(v, "09_wiki")), realpathSync(v));
  assert.equal(projektSchluessel(v, ohne), null);
  assert.equal(projektSchluessel(v, ""), null);
});

test("letzteSitzungen: neueste drei mit Inhalt, ohne die eigene; Titel eigen > KI > erste Nachricht; Zugangsdaten nie im Titel", () => {
  const { eigene } = projekt();
  const s = letzteSitzungen(eigene, { eigeneSid: "eigene" });
  assert.deepEqual(s.map((x) => x.sid), ["geheim", "eigen", "mitTitel"]);
  assert.deepEqual(s.map((x) => x.titel), ["(Titel ausgeblendet)", "Mein Name für die Sitzung", "Export für Garten-App planen"]);
});

test("offenAusSessionDatei: nur der Abschnitt „Offen“ der jüngsten session_*.md, wörtlich, Datei bleibt unverändert", () => {
  const { verlaeufe } = projekt();
  const datei = join(verlaeufe, "memory", "session_garten_2026-10-15.md");
  const vorher = readFileSync(datei, "utf8");
  const o = offenAusSessionDatei(join(verlaeufe, "memory"));
  assert.equal(o.datei, "session_garten_2026-10-15.md");
  assert.deepEqual(o.zeilen, ["- Export testen", "- Doku schreiben"]);
  assert.equal(readFileSync(datei, "utf8"), vorher, "anbieten, nicht beanspruchen");
  assert.equal(offenAusSessionDatei(join(verlaeufe, "gibt-es-nicht")), null);
});

test("wasWarZuletzt: Sitzungen, Commits seit der letzten Sitzung, Offen — ≤ 600 Zeichen", () => {
  const { repo, eigene } = projekt();
  const t = wasWarZuletzt({ transkriptPfad: eigene, sid: "eigene", cwd: join(repo, "src") });
  assert.ok(t.length <= ZULETZT_MAX, String(t.length));
  assert.match(t, /^Zuletzt in diesem Ordner/);
  assert.match(t, /„Mein Name für die Sitzung“/);
  assert.match(t, /Commits seit .*\n- [0-9a-f]{7,} Export gebaut/);
  assert.doesNotMatch(t, /uralt/);
  assert.match(t, /Offen laut session_garten_2026-10-15\.md/);
  assert.match(t, /- Export testen/);
  assert.doesNotMatch(t, /abcdefgh12345678/);
});

test("wasWarZuletzt: ohne Git keine Commit-Zeile; ohne Verlauf leer", () => {
  const { eigene } = projekt();
  const t = wasWarZuletzt({ transkriptPfad: eigene, sid: "eigene", cwd: tempOrdner("kein Repo") });
  assert.doesNotMatch(t, /Commits seit/);
  assert.match(t, /„Mein Name/);
  assert.equal(wasWarZuletzt({ transkriptPfad: "", sid: "x" }), "");
  assert.equal(wasWarZuletzt({ transkriptPfad: join(tempOrdner(), "nix", "a.jsonl"), sid: "a" }), "");
});

test("SessionStart: startup zeigt „Zuletzt“, compact nicht", () => {
  const { repo, eigene } = projekt();
  const v = tempVault();
  const env = { BRAIN_SESSION_NUR_STATUS: "1" };
  const s = hook("session-start.mjs", { session_id: "eigene", source: "startup", cwd: repo, transcript_path: eigene }, { vault: v, env });
  assert.equal(s.status, 0);
  assert.match(s.stdout, /Zuletzt in diesem Ordner/);
  const c = hook("session-start.mjs", { session_id: "eigene", source: "compact", cwd: repo, transcript_path: eigene }, { vault: v, env });
  assert.doesNotMatch(c.stdout, /Zuletzt in diesem Ordner/);
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-zuletzt.mjs`
Expected: FAIL — `Cannot find module '…/.tools/projekt.mjs'`.

- [ ] **Step 3: `projekt.mjs` (erste Fassung) schreiben** — `.tools/projekt.mjs`:

```js
// .tools/projekt.mjs — Projekt-Bezug einer Sitzung oder Datei (0 Tokens, nur Dateisystem, kein git-Aufruf):
// Git-Wurzel und Projekt-Schlüssel für K11/K13. (Task 8 ergänzt Projektseite, Steckbrief und Manifeste — K14.)
import { existsSync, realpathSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";

// Nächster Ordner aufwärts mit .git (Ordner oder Datei — Worktrees haben eine .git-Datei), kanonisch (Symlinks wie
// /var → /private/var aufgelöst). Ein nicht (mehr) existierender Pfad wird ab dem nächsten existierenden Vorfahren gesucht.
export function gitWurzel(start) {
  if (typeof start !== "string" || !start) return null;
  let dir = resolve(start);
  for (;;) {
    try { dir = realpathSync(dir); break; } catch {}
    const hoch = dirname(dir);
    if (hoch === dir) break;
    dir = hoch;
  }
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const hoch = dirname(dir);
    if (hoch === dir) return null;
    dir = hoch;
  }
}

// „Gleiches Projekt" (K13, Spec: nur gleiches Git-Repo bzw. gleicher Vault zählt): Git-Wurzel, sonst der Vault, wenn
// cwd darin liegt, sonst null (zählt nicht — z. B. Sitzungen direkt im Home-Ordner).
export function projektSchluessel(vault, cwd) {
  if (typeof cwd !== "string" || !cwd) return null;
  const w = gitWurzel(cwd);
  if (w) return w;
  const echt = (p) => { try { return realpathSync(resolve(p)); } catch { return resolve(p); } };
  const v = echt(vault), c = echt(cwd);
  return c === v || c.startsWith(v + sep) ? v : null;
}
```

- [ ] **Step 4: `zuletzt.mjs` schreiben** — `.tools/zuletzt.mjs`:

```js
// .tools/zuletzt.mjs — K11 „Was war zuletzt" (Spec §12.2): beim Sitzungsstart (startup/resume/clear) höchstens ~600
// Zeichen — die letzten drei Sitzungen in diesem Ordner (Datum + Titel aus dem Verlauf, sonst erste Nachricht gekürzt),
// Commits seit Beginn der jüngsten dieser Sitzungen (git log, höchstens 5) und der Abschnitt „Offen" der jüngsten
// session_*.md. Nur wörtliche Auszüge mit Quelle, nichts zusammengefasst. „Anbieten, nicht beanspruchen": nichts wird
// verändert oder als übernommen markiert. „Dieser Ordner" = Claude Codes Projektordner neben transcript_path (gleiches
// cwd). Titel laufen durch den Secret- und den Kundendaten-Riegel. Wirft nie.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { leseKopf, leseAb, nutzerNachricht, titelAus, zeitVon, kuerze, ganzeZeilen, datumZeit } from "./verlauf.mjs";
import { hatSecretsImKontext, ohneSecrets } from "./secrets-muster.mjs";
import { hatPii } from "./pii-muster.mjs";
import { gitWurzel } from "./projekt.mjs";

export const ZULETZT_MAX = 600;
const KOPF = 64 * 1024, ENDE = 64 * 1024;
const OFFEN_KOPF = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:🔴\s*)?Offen\b/u;
const ABSCHNITT_KOPF = /^\s*(?:#{1,6}\s+\S|\*\*[^*]+\*\*\s*$)/u;
const unsauber = (t) => hatSecretsImKontext(t) || hatPii(t);

// Eine frühere Sitzung: Titel (eigener > KI-Titel > erste Nachricht), Beginn, letzte Änderung. Ohne Nutzertext/Titel → null.
export function sitzungsInfo(pfad) {
  let st;
  try { st = statSync(pfad); } catch { return null; }
  const kopf = leseKopf(pfad, KOPF).eintraege;
  const ende = st.size > KOPF ? leseAb(pfad, Math.max(0, st.size - ENDE), ENDE).eintraege : [];
  let eigen = null, ki = null, startMs = null, erste = null;
  for (const o of [...kopf, ...ende]) {
    const t = titelAus(o);
    if (t?.art === "eigen") eigen = t.titel; else if (t?.art === "ki") ki = t.titel;
    if (startMs == null) startMs = zeitVon(o);
  }
  for (const o of kopf) { const m = nutzerNachricht(o); if (m?.text) { erste = m.text; break; } }
  if (!erste && !eigen && !ki) return null;
  let titel = eigen || ki || erste.replace(/\s+/g, " ");
  if (unsauber(titel)) titel = "(Titel ausgeblendet)";
  return { datei: pfad, sid: basename(pfad, ".jsonl"), startMs: startMs ?? st.mtimeMs, endeMs: st.mtimeMs, titel: kuerze(titel, 70) };
}

export function letzteSitzungen(transkriptPfad, { eigeneSid = "", anzahl = 3, maxPruefen = 15 } = {}) {
  const dir = dirname(transkriptPfad);
  let kandidaten = [];
  try {
    kandidaten = readdirSync(dir).filter((n) => n.endsWith(".jsonl") && n !== `${eigeneSid}.jsonl` && join(dir, n) !== transkriptPfad)
      .map((n) => { const p = join(dir, n); try { return { p, m: statSync(p).mtimeMs }; } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
  kandidaten.sort((a, b) => b.m - a.m);
  const out = [];
  for (const { p } of kandidaten.slice(0, maxPruefen)) {
    const i = sitzungsInfo(p);
    if (i) out.push(i);
    if (out.length >= anzahl) break;
  }
  return out;
}

// Abschnitt „Offen" (Überschrift oder fette Zeile, auch „🔴 Offen") der jüngsten session_*.md — bis zum nächsten Abschnitt.
export function offenAusSessionDatei(memoryOrdner) {
  let namen = [];
  try { namen = readdirSync(memoryOrdner).filter((n) => /^session_.*\.md$/i.test(n)); } catch { return null; }
  const mit = namen.map((n) => { try { return { n, m: statSync(join(memoryOrdner, n)).mtimeMs }; } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.m - a.m);
  if (!mit.length) return null;
  let text = "";
  try { text = readFileSync(join(memoryOrdner, mit[0].n), "utf8").replace(/\r\n/g, "\n"); } catch { return null; }
  const zeilen = text.split("\n");
  const start = zeilen.findIndex((z) => OFFEN_KOPF.test(z));
  const out = [];
  if (start >= 0) {
    for (const z of zeilen.slice(start + 1)) {
      if (ABSCHNITT_KOPF.test(z)) break;
      if (z.trim()) out.push(z.trimEnd());
    }
  }
  return { datei: mit[0].n, zeilen: out.filter((z) => !hatSecretsImKontext(z)), mtimeMs: mit[0].m };
}

export function commitsSeit(wurzel, seitMs, { git = "git", anzahl = 5 } = {}) {
  if (!wurzel || !Number.isFinite(seitMs)) return [];
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const r = spawnSync(git, ["-C", wurzel, "log", `--since=@${Math.floor(seitMs / 1000)}`, "-n", String(anzahl), "--format=%h %s"],
    { encoding: "utf8", timeout: 1500, windowsHide: true, env });
  if (r.status !== 0) return [];
  return String(r.stdout || "").split("\n").map((z) => ohneSecrets(z).trim()).filter(Boolean);
}

export function wasWarZuletzt({ transkriptPfad = "", sid = "", cwd = "", git = "git", max = ZULETZT_MAX } = {}) {
  if (!transkriptPfad) return "";
  const sitzungen = letzteSitzungen(transkriptPfad, { eigeneSid: sid });
  const offen = offenAusSessionDatei(join(dirname(transkriptPfad), "memory"));
  if (!sitzungen.length && !offen?.zeilen.length) return "";
  const kopf = "Zuletzt in diesem Ordner (wörtlich aus Verläufen, Git und Handoff — nur Angebot, nichts davon ist übernommen):";
  const teile = [kopf];
  let rest = max - kopf.length;
  const block = (titel, zeilen) => {
    if (!zeilen.length || rest < titel.length + 20) return;
    const { text } = ganzeZeilen(zeilen, rest - titel.length - 2);
    if (!text) return;
    const b = titel ? `${titel}\n${text}` : text;
    teile.push(b);
    rest -= b.length + 1;
  };
  block("", sitzungen.map((s) => `- ${datumZeit(s.endeMs)} „${s.titel}“`));
  const wurzel = cwd ? gitWurzel(cwd) : null;
  if (wurzel && sitzungen.length) {
    const seit = sitzungen[0].startMs;
    block(`Commits seit ${datumZeit(seit)} (git log):`, commitsSeit(wurzel, seit, { git }).map((c) => `- ${kuerze(c, 90)}`));
  }
  if (offen?.zeilen.length) block(`Offen laut ${offen.datei} (Stand ${datumZeit(offen.mtimeMs).slice(0, 6)}):`, offen.zeilen.map((z) => kuerze(z, 160)));
  return teile.length > 1 ? teile.join("\n") : "";
}
```

- [ ] **Step 5: In `session-start.mjs` einbinden** — die Zeile `// ---------- Ausgabe (K12-Budget) ----------` ersetzen durch:

```js
// ---------- K11: Was war zuletzt (nur beim Start, nicht nach einer Kompaktierung) ----------
if (QUELLE !== "compact" && TRANSKRIPT) {
  try {
    const { wasWarZuletzt } = await import("../../zuletzt.mjs");
    aus(wasWarZuletzt({ transkriptPfad: TRANSKRIPT, sid: SID, cwd: CWD, git: gitBefehl({ cfg }) }));
  } catch {}
}

// ---------- Ausgabe (K12-Budget) ----------
```

- [ ] **Step 6: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-zuletzt.mjs .tools/tests/test-arbeitsstand-hook.mjs && bash .tools/tests/test-session-hintergrund.sh`
Expected: alle PASS, Shell-Test Exit 0.

- [ ] **Step 7: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/projekt.mjs .tools/zuletzt.mjs .tools/adapters/claude-code/session-start.mjs .tools/tests/test-zuletzt.mjs
git commit -m "kit: Was war zuletzt — letzte Sitzungen, Commits und Offen beim Sitzungsstart (K11)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: K13 — parallele Sitzungen im selben Repo

**Files:**
- Create: `.tools/laufend.mjs`
- Create: `.tools/adapters/claude-code/sitzung-ende.mjs`
- Modify: `.tools/adapters/claude-code/session-start.mjs` (vor dem Kommentar `// ---------- K11: Was war zuletzt`)
- Modify: `.tools/adapters/claude-code/brain-hint.mjs` (Dateischluss)
- Test: Create `.tools/tests/test-laufend.mjs`

**Interfaces:**
- Consumes: `projektSchluessel` (Task 6); `hatSecretsImKontext` (`secrets-muster.mjs`), `hatPii` (`pii-muster.mjs`), `istSystemNachricht` (`hint-core.mjs`), `kuerze`, `uhrzeit` (`verlauf.mjs`); in session-start `SID`, `CWD`, `QUELLE`, `EINGABE`, `aus` (Task 5); in brain-hint `vault`, `sid`, `input` (bestehend).
- Produces (`.tools/laufend.mjs`): `LEBENSZEICHEN_MS = 7200000`, `ALTLAST_MS = 86400000` · `titelAusPrompt(prompt) → string|null` · `anmelden(vault, { sid, schluessel, titel = null, jetzt }) → { eintrag, andere: Eintrag[] } | null` · `parallele(vault, { sid, schluessel, jetzt }) → Eintrag[]` · `puls(vault, { sid, prompt, jetzt }) → Eintrag[]` (nur NEU gesehene) · `abmelden(vault, sid)` · `raeumeAuf(vault, jetzt)` · `hinweisZeile(andere) → string`. `Eintrag = { sid, schluessel, start, lebenszeichen, titel, gemeldet: string[] }`, Datei `.logs/laufend/<sid>.json`.
- Produces: Hook `sitzung-ende.mjs` (SessionEnd): trägt `<sid>` aus; nie Ausgabe, Exit 0.

- [ ] **Step 1: Failing test schreiben** — `.tools/tests/test-laufend.mjs`:

```js
// K13 „Was läuft parallel": je Sitzung eine Datei, atomar geschrieben; nur gleiches Repo/gleicher Vault zählt; ohne
// Lebenszeichen > 2 h zählt nicht, > 24 h wird aufgeräumt (Absturz ohne SessionEnd); jede andere Sitzung wird einmal
// gemeldet; Titel nie mit Zugangs- oder Kundendaten. Nur Hinweis — nichts wird gesperrt oder übernommen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { anmelden, parallele, puls, abmelden, raeumeAuf, hinweisZeile, titelAusPrompt } from "../laufend.mjs";
import { tempOrdner, tempVault, hook, KIT } from "./verlauf-fixture.mjs";

test("anmelden/parallele: gleiche Wurzel zählt, andere nicht, eigene nicht, ohne Lebenszeichen > 2 h nicht", () => {
  const v = tempVault(), t = Date.now();
  anmelden(v, { sid: "a", schluessel: "/repo/x", titel: "Export", jetzt: t - 3 * 3600000 });
  anmelden(v, { sid: "b", schluessel: "/repo/x", titel: "Doku", jetzt: t - 60000 });
  anmelden(v, { sid: "c", schluessel: "/repo/y", jetzt: t });
  const r = anmelden(v, { sid: "d", schluessel: "/repo/x", jetzt: t });
  assert.deepEqual(r.andere.map((e) => e.sid), ["b"]);
  assert.match(hinweisZeile(r.andere), /^Parallel im selben Repo: „Doku“ seit \d\d:\d\d — .*\/peers.*nichts wird gesperrt/);
  assert.equal(anmelden(v, { sid: "e", schluessel: null, jetzt: t }).andere.length, 0, "ohne Repo zählt nichts");
  assert.equal(hinweisZeile([]), "");
});

test("puls: Lebenszeichen, Titel aus dem ersten Prompt, neue Parallele nur einmal melden", () => {
  const v = tempVault(), t = Date.now();
  anmelden(v, { sid: "a", schluessel: "/r", jetzt: t });
  assert.deepEqual(puls(v, { sid: "a", prompt: "Baue den Export bitte", jetzt: t + 1000 }), []);
  anmelden(v, { sid: "b", schluessel: "/r", titel: "Andere Arbeit", jetzt: t + 2000 });
  assert.deepEqual(puls(v, { sid: "a", prompt: "weiter", jetzt: t + 3000 }).map((e) => e.sid), ["b"]);
  assert.deepEqual(puls(v, { sid: "a", prompt: "weiter", jetzt: t + 4000 }), [], "nur einmal melden");
  assert.equal(parallele(v, { sid: "b", schluessel: "/r", jetzt: t + 5000 })[0].titel, "Baue den Export bitte");
  assert.deepEqual(puls(v, { sid: "unbekannt", prompt: "x" }), [], "ohne Anmeldung nichts");
});

test("titelAusPrompt: Zugangs-/Kundendaten → ausgeblendet; Befehle und Systemzeilen → kein Titel", () => {
  assert.equal(titelAusPrompt("passwort=geheim123 einbauen"), "(Titel ausgeblendet)");
  assert.equal(titelAusPrompt("schick das an max@example.com"), "(Titel ausgeblendet)");
  assert.equal(titelAusPrompt("/compact"), null);
  assert.equal(titelAusPrompt("<task-notification>x"), null);
  assert.equal(titelAusPrompt("  Export   bauen  "), "Export bauen");
});

test("abmelden und Altlasten: SessionEnd trägt aus; ohne SessionEnd (Absturz) > 24 h wird aufgeräumt", () => {
  const v = tempVault(), t = Date.now();
  anmelden(v, { sid: "a", schluessel: "/r", jetzt: t });
  abmelden(v, "a");
  assert.equal(existsSync(join(v, ".logs", "laufend", "a.json")), false);
  anmelden(v, { sid: "tot", schluessel: "/r", jetzt: t - 25 * 3600000 });
  anmelden(v, { sid: "lebt", schluessel: "/r", jetzt: t });
  raeumeAuf(v, t);
  assert.equal(existsSync(join(v, ".logs", "laufend", "tot.json")), false);
  assert.equal(existsSync(join(v, ".logs", "laufend", "lebt.json")), true);
});

test("20 gleichzeitige Prozesse: jede Datei bleibt gültiges JSON, jede Sitzung genau einmal", async () => {
  const v = tempVault();
  const modul = pathToFileURL(join(KIT, "laufend.mjs")).href;
  const skript = `const m = await import(${JSON.stringify(modul)}); const sid = process.argv[1];`
    + "m.anmelden(process.env.BRAIN_VAULT, { sid, schluessel: '/repo' });"
    + "for (let i = 0; i < 20; i++) m.puls(process.env.BRAIN_VAULT, { sid, prompt: 'frage ' + i });";
  await Promise.all(Array.from({ length: 20 }, (_, i) => new Promise((ok, nein) => {
    const p = spawn(process.execPath, ["--input-type=module", "-e", skript, `s${i}`], { env: { ...process.env, BRAIN_VAULT: v }, stdio: "inherit" });
    p.on("exit", (c) => (c === 0 ? ok() : nein(new Error(`Exit ${c}`))));
  })));
  const dateien = readdirSync(join(v, ".logs", "laufend")).filter((n) => n.endsWith(".json"));
  assert.equal(dateien.length, 20);
  for (const n of dateien) JSON.parse(readFileSync(join(v, ".logs", "laufend", n), "utf8"));
  assert.equal(parallele(v, { sid: "s0", schluessel: "/repo" }).length, 19);
});

test("Hooks: zwei Sitzungen im selben Repo (Pfad mit Leerzeichen/Umlaut) — Start meldet die andere, Prompt meldet Neue einmal, SessionEnd trägt aus, cwd ohne Repo still", () => {
  const v = tempVault();
  const repo = tempOrdner("Gärten Repo");
  mkdirSync(join(repo, ".git"));
  const env = { BRAIN_SESSION_NUR_STATUS: "1" };
  assert.doesNotMatch(hook("session-start.mjs", { session_id: "sa", source: "startup", cwd: repo }, { vault: v, env }).stdout, /Parallel/);
  const b = hook("session-start.mjs", { session_id: "sb", source: "startup", cwd: join(repo), session_title: "Doku schreiben" }, { vault: v, env });
  assert.match(b.stdout, /Parallel im selben Repo: „ohne Titel“/);
  const p = hook("brain-hint.mjs", { session_id: "sa", prompt: "ok" }, { vault: v });
  assert.equal(p.status, 0);
  assert.match(p.stdout, /Parallel im selben Repo: „Doku schreiben“/);
  assert.doesNotMatch(hook("brain-hint.mjs", { session_id: "sa", prompt: "ok" }, { vault: v }).stdout, /Parallel/);
  const ende = hook("sitzung-ende.mjs", { session_id: "sb", reason: "prompt_input_exit" }, { vault: v });
  assert.equal(ende.status, 0);
  assert.equal(ende.stdout, "");
  assert.equal(existsSync(join(v, ".logs", "laufend", "sb.json")), false);
  const ohne = hook("session-start.mjs", { session_id: "sc", source: "startup", cwd: tempOrdner("kein Repo") }, { vault: v, env });
  assert.doesNotMatch(ohne.stdout, /Parallel/);
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-laufend.mjs`
Expected: FAIL — `Cannot find module '…/.tools/laufend.mjs'`.

- [ ] **Step 3: `laufend.mjs` schreiben** — `.tools/laufend.mjs`:

```js
// .tools/laufend.mjs — K13 „Was läuft parallel" (Spec §12.2): SessionStart trägt die Sitzung in .logs/laufend/<sid>.json
// ein (Projekt-Schlüssel = Git-Wurzel bzw. Vault, Titel, Start), jeder Prompt erneuert das Lebenszeichen, SessionEnd
// trägt aus. Einträge ohne Lebenszeichen > 2 h zählen nicht (SessionEnd läuft bei einem Absturz nicht), > 24 h werden
// aufgeräumt. Je Sitzung eine eigene Datei, atomar (tmp + rename) — mehrere Sitzungen schreiben nie dieselbe Datei.
// Nur Hinweis („anbieten, nicht beanspruchen"): nichts wird gesperrt. Titel aus Nutzertext laufen durch den Secret- und
// den Kundendaten-Riegel. 0 Tokens, nur Node-Standardbibliothek.
import { readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { hatSecretsImKontext } from "./secrets-muster.mjs";
import { hatPii } from "./pii-muster.mjs";
import { istSystemNachricht } from "./hint-core.mjs";
import { kuerze, uhrzeit } from "./verlauf.mjs";

export const LEBENSZEICHEN_MS = 2 * 3600 * 1000;
export const ALTLAST_MS = 24 * 3600 * 1000;
const ordnerVon = (vault) => join(vault, ".logs", "laufend");
const sauber = (sid) => String(sid || "").replace(/[^\w-]/g, "").slice(0, 64);
function lies(datei) {
  try { const o = JSON.parse(readFileSync(datei, "utf8")); return o && typeof o === "object" ? o : null; } catch { return null; }
}
function schreibeAtomar(datei, obj) {
  const tmp = `${datei}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj) + "\n");
  renameSync(tmp, datei);
}

export function titelAusPrompt(prompt) {
  const p = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!p || p.startsWith("/") || istSystemNachricht(p)) return null;
  if (hatSecretsImKontext(p) || hatPii(p)) return "(Titel ausgeblendet)";
  return kuerze(p, 60);
}

export function parallele(vault, { sid, schluessel, jetzt = Date.now() } = {}) {
  if (!schluessel) return [];
  let namen = [];
  try { namen = readdirSync(ordnerVon(vault)).filter((n) => n.endsWith(".json")); } catch { return []; }
  const eigene = sauber(sid), out = [];
  for (const n of namen) {
    const e = lies(join(ordnerVon(vault), n));
    if (!e || e.sid === eigene || e.schluessel !== schluessel) continue;
    if (!(jetzt - Number(e.lebenszeichen) <= LEBENSZEICHEN_MS)) continue;
    out.push(e);
  }
  return out.sort((a, b) => a.start - b.start);
}

export function anmelden(vault, { sid, schluessel = null, titel = null, jetzt = Date.now() } = {}) {
  const s = sauber(sid);
  if (!s) return null;
  mkdirSync(ordnerVon(vault), { recursive: true });
  const datei = join(ordnerVon(vault), `${s}.json`);
  const alt = lies(datei);
  const andere = parallele(vault, { sid: s, schluessel, jetzt });
  const eintrag = {
    sid: s, schluessel: schluessel || null, start: alt?.start ?? jetzt, lebenszeichen: jetzt,
    titel: titel ?? alt?.titel ?? null,
    gemeldet: [...new Set([...(Array.isArray(alt?.gemeldet) ? alt.gemeldet : []), ...andere.map((e) => e.sid)])],
  };
  schreibeAtomar(datei, eintrag);
  return { eintrag, andere };
}

// Lebenszeichen beim Prompt; → nur die parallelen Sitzungen, die dieser Sitzung noch nie gemeldet wurden.
export function puls(vault, { sid, prompt = "", jetzt = Date.now() } = {}) {
  const s = sauber(sid);
  if (!s) return [];
  const datei = join(ordnerVon(vault), `${s}.json`);
  const e = lies(datei);
  if (!e) return [];
  e.lebenszeichen = jetzt;
  if (!e.titel) e.titel = titelAusPrompt(prompt);
  const gemeldet = Array.isArray(e.gemeldet) ? e.gemeldet : [];
  const neu = parallele(vault, { sid: s, schluessel: e.schluessel, jetzt }).filter((x) => !gemeldet.includes(x.sid));
  e.gemeldet = [...new Set([...gemeldet, ...neu.map((x) => x.sid)])];
  try { schreibeAtomar(datei, e); } catch {}
  return neu;
}

export function abmelden(vault, sid) {
  const s = sauber(sid);
  if (!s) return;
  try { unlinkSync(join(ordnerVon(vault), `${s}.json`)); } catch {}
}

export function raeumeAuf(vault, jetzt = Date.now()) {
  let namen = [];
  try { namen = readdirSync(ordnerVon(vault)); } catch { return; }
  for (const n of namen) {
    const p = join(ordnerVon(vault), n);
    try {
      if (n.endsWith(".tmp")) { if (jetzt - statSync(p).mtimeMs > 3600000) unlinkSync(p); continue; }
      const zuletzt = Number(lies(p)?.lebenszeichen) || statSync(p).mtimeMs;
      if (jetzt - zuletzt > ALTLAST_MS) unlinkSync(p);
    } catch {}
  }
}

export function hinweisZeile(andere) {
  if (!Array.isArray(andere) || !andere.length) return "";
  const teile = andere.slice(0, 3).map((e) => `„${e.titel || "ohne Titel"}“ seit ${uhrzeit(Number(e.start))}`);
  return `Parallel im selben Repo${andere.length > 3 ? ` (${andere.length} Sitzungen)` : ""}: ${teile.join(", ")} — vor Commits `
    + "und Merges abstimmen, z. B. per /peers (Cross-Session-Messaging). Nur ein Hinweis, nichts wird gesperrt.";
}
```

- [ ] **Step 4: SessionEnd-Hook schreiben** — `.tools/adapters/claude-code/sitzung-ende.mjs`:

```js
#!/usr/bin/env node
// SessionEnd-Hook (K13): trägt die Sitzung aus .logs/laufend/ aus. Läuft im 1,5-s-Budget von Claude Code; bei einem
// Absturz läuft er gar nicht — dann räumt der nächste SessionStart nach 24 h auf (laufend.mjs#raeumeAuf).
// Gibt NIE etwas aus, Exit immer 0. BRAIN_ERNTE=1 (Selbstaufruf der Ernte) → nichts tun.
if (process.env.BRAIN_ERNTE === "1") process.exit(0);
import { readFileSync } from "node:fs";

try {
  const { vaultPfad } = await import("../../pfade.mjs");
  const { abmelden } = await import("../../laufend.mjs");
  let e = {};
  try { e = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
  abmelden(vaultPfad([]), e?.session_id);
} catch { /* nie blockierend, nie Ausgabe */ }
process.exit(0);
```

- [ ] **Step 5: In `session-start.mjs` eintragen und melden** — die Zeile `// ---------- K11: Was war zuletzt (nur beim Start, nicht nach einer Kompaktierung) ----------` ersetzen durch:

```js
// ---------- K13: Was läuft parallel (eintragen; beim Start andere Sitzungen im selben Repo nennen) ----------
// Altlasten (Absturz ohne SessionEnd) werden hier aufgeräumt. Nach einer Kompaktierung nur eintragen, nichts melden.
if (SID) {
  try {
    const { anmelden, raeumeAuf: laufendAufraeumen, hinweisZeile, titelAusPrompt } = await import("../../laufend.mjs");
    const { projektSchluessel } = await import("../../projekt.mjs");
    laufendAufraeumen(V);
    const titel = typeof EINGABE?.session_title === "string" ? titelAusPrompt(EINGABE.session_title) : null;
    const r = anmelden(V, { sid: SID, schluessel: projektSchluessel(V, CWD), titel });
    if (r && QUELLE !== "compact") aus(hinweisZeile(r.andere));
  } catch {}
}

// ---------- K11: Was war zuletzt (nur beim Start, nicht nach einer Kompaktierung) ----------
```

- [ ] **Step 6: In `brain-hint.mjs` Lebenszeichen + Meldung** — den Dateischluss

```js
try { if (input && automatik) pruefeStand(input, automatik.staendeIntervallStunden); } catch {}
process.exit(0);
```
ersetzen durch

```js
try { if (input && automatik) pruefeStand(input, automatik.staendeIntervallStunden); } catch {}
// K13: Lebenszeichen dieser Sitzung; neue parallele Sitzungen im selben Repo genau einmal melden (nur Dateien, 0 Tokens).
let PARALLEL = "";
try {
  if (input && sid !== "ohne" && !sid.startsWith("eval-")) {
    const { puls, hinweisZeile } = await import("../../laufend.mjs");
    PARALLEL = hinweisZeile(puls(vault, { sid, prompt: String(input.prompt || "") }));
  }
} catch {}
if (PARALLEL) process.stdout.write(PARALLEL + "\n", () => process.exit(0));
else process.exit(0);
```

- [ ] **Step 7: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-laufend.mjs .tools/tests/test-zuletzt.mjs .tools/tests/test-arbeitsstand-hook.mjs && bash .tools/tests/test-hint-hook.sh && bash .tools/tests/test-session-hintergrund.sh`
Expected: alle PASS, Shell-Tests Exit 0.

- [ ] **Step 8: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/laufend.mjs .tools/adapters/claude-code/sitzung-ende.mjs .tools/adapters/claude-code/session-start.mjs .tools/adapters/claude-code/brain-hint.mjs .tools/tests/test-laufend.mjs
git commit -m "kit: parallele Sitzungen im selben Repo melden — eintragen, Lebenszeichen, austragen (K13)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: K14 — Projekt-Steckbrief (Felder, Manifeste, Lint)

**Files:**
- Modify (ganz ersetzen): `.tools/projekt.mjs`
- Create: `.tools/gezeigt.mjs`
- Modify: `.tools/adapters/claude-code/session-start.mjs` (Imports; Hilfsfunktionen `fmWerte` … `findeProjektseite` entfernen; Projektseiten-Block)
- Modify: `.tools/brain-lint.mjs` (Import; im Seiten-Durchlauf nach der `FRAGEN`-Prüfung)
- Modify: `.tools/kit/vorlage/wiki/_schema.md` und `09_wiki/_schema.md` (neuer Abschnitt vor `## Beweisbindung`)
- Test: Create `.tools/tests/test-projekt.mjs`

**Interfaces:**
- Consumes: `entferneBom` (`pfade.mjs`), `hatSecretsImKontext` (`secrets-muster.mjs`), `kuerze`, `ganzeZeilen` (`verlauf.mjs`); in session-start `CWD`, `SID`, `QUELLE`, `aus`, `wikiName`, `anzeigePfad`, `automatik` (bestehend bzw. Task 5).
- Produces (`.tools/projekt.mjs`, zusätzlich zu `gitWurzel`, `projektSchluessel` aus Task 6): `fmWerte(text, schluessel[]) → string[]` (unverändert verschoben) · `fmListe(text, schluessel) → string[]` (JSON-Liste, sonst `fmWerte`) · `basisName(p)` · `dateiKopf(datei, max = 4096) → string` · `findeProjektseite(vault, wikiOrdner, namen) → string|null` (vault-relativ, unverändert verschoben) · `istProjektseite(relImWiki, fmText) → boolean` · `MANIFESTE` · `stackAusManifesten(wurzel) → { datei, angaben: string[] }[]` · `STECKBRIEF_MAX = 1200` · `steckbrief(vault, seiteRel, { wurzel, max }) → string` ("" wenn nichts).
- Produces (`.tools/gezeigt.mjs`): `gezeigtListe(vault, sid) → Set<string>` · `merkeGezeigt(vault, sid, ...schluessel)` · `raeumeGezeigtAuf(vault, jetzt, maxMs = 172800000)`; Datei `.logs/gezeigt/<sid>.txt`, Schlüssel `steckbrief:<seite>`, `repo:<wurzel>`, `regel:<id>`.

- [ ] **Step 1: Failing test schreiben** — `.tools/tests/test-projekt.mjs`:

```js
// K14 Projekt-Steckbrief: Felder pruefen/ziel/fallen wörtlich, Stack frisch aus den Manifesten, Budget in ganzen
// Zeilen, Lint STECKBRIEF; Repo ohne Projektseite bleibt still.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, writeFileSync, cpSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fmListe, stackAusManifesten, findeProjektseite, steckbrief, istProjektseite, STECKBRIEF_MAX } from "../projekt.mjs";
import { gezeigtListe, merkeGezeigt } from "../gezeigt.mjs";
import { tempOrdner, tempVault, hook, KIT, TEMP_HOME } from "./verlauf-fixture.mjs";

function vaultMitProjekt() {
  const v = tempVault("Mein Brän");
  mkdirSync(join(v, "09_wiki", "projekte"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "projekte", "entitaet_garten-app.md"),
    '---\nname: garten-app\ndescription: Garten-App\ntyp: entitaet\nrepo: jo/garten-app\n'
    + 'pruefen: ["node --test", "bash scripts/rauchtest.sh"]\nziel: "test — Prod nur nach Freigabe durch Jo"\n'
    + 'fallen: ["Port 4242 ist belegt", "nie direkt auf main"]\n---\n# Garten-App\n');
  const repo = join(tempOrdner("Arbeit Ü"), "garten-app");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "garten-app", version: "0.3.0" }));
  return { v, repo };
}

test("fmListe: JSON-Liste, YAML-Liste, Einzelwert, kaputtes JSON fällt auf Komma-Liste zurück", () => {
  const t = '---\nname: x\npruefen: ["node --test", "bash run-all.sh, mit Komma"]\nziel: "test — Prod nur nach Freigabe"\n'
    + "fallen:\n  - nie auf main\n  - Ports prüfen\nkaputt: [\"a\", b]\n---\n# x\n";
  assert.deepEqual(fmListe(t, "pruefen"), ["node --test", "bash run-all.sh, mit Komma"]);
  assert.deepEqual(fmListe(t, "ziel"), ["test — Prod nur nach Freigabe"]);
  assert.deepEqual(fmListe(t, "fallen"), ["nie auf main", "Ports prüfen"]);
  assert.deepEqual(fmListe(t, "kaputt"), ["a", "b"]);
  assert.deepEqual(fmListe(t, "fehlt"), []);
});

test("stackAusManifesten: package.json, Package.swift, go.mod, pyproject.toml, Cargo.toml wörtlich; kaputtes JSON → still", () => {
  const r = tempOrdner("Repo Ä");
  writeFileSync(join(r, "package.json"), JSON.stringify({ name: "garten", version: "1.2.3", engines: { node: ">=22" },
    dependencies: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`dep${i}`, `^${i}.0.0`])) }));
  writeFileSync(join(r, "Package.swift"), "// swift-tools-version:6.2\nimport PackageDescription\nlet p = Package(name: \"A\", platforms: [.macOS(.v26)], targets: [])\n");
  writeFileSync(join(r, "go.mod"), "module example.com/garten\n\ngo 1.23\n");
  writeFileSync(join(r, "pyproject.toml"), "[tool.x]\nname = \"falsch\"\n[project]\nname = \"garten-py\"\nversion = \"0.4\"\nrequires-python = \">=3.12\"\n");
  writeFileSync(join(r, "Cargo.toml"), "[package]\nname = \"garten-rs\"\nversion = \"0.1.0\"\nedition = \"2021\"\n");
  const s = Object.fromEntries(stackAusManifesten(r).map((x) => [x.datei, x.angaben]));
  assert.deepEqual(s["package.json"], ["garten 1.2.3", "engines.node >=22",
    "Abhängigkeiten: dep0 ^0.0.0, dep1 ^1.0.0, dep2 ^2.0.0, dep3 ^3.0.0, dep4 ^4.0.0, dep5 ^5.0.0, dep6 ^6.0.0, dep7 ^7.0.0 (+2)"]);
  assert.deepEqual(s["Package.swift"], ["swift-tools-version 6.2", "platforms .macOS(.v26)"]);
  assert.deepEqual(s["go.mod"], ["module example.com/garten", "go 1.23"]);
  assert.deepEqual(s["pyproject.toml"], ["name garten-py", "version 0.4", "requires-python >=3.12"]);
  assert.deepEqual(s["Cargo.toml"], ["name garten-rs", "version 0.1.0", "edition 2021"]);
  writeFileSync(join(r, "package.json"), "{kaputt");
  assert.equal(stackAusManifesten(r).some((x) => x.datei === "package.json"), false);
});

test("steckbrief: Felder + Stack wörtlich mit Quelle, ≤ 1.200 Zeichen; bei Überschreitung ganze Zeilen weg mit Hinweis", () => {
  const { v, repo } = vaultMitProjekt();
  const seite = findeProjektseite(v, "09_wiki", ["garten-app"]);
  assert.equal(seite, "09_wiki/projekte/entitaet_garten-app.md");
  const t = steckbrief(v, seite, { wurzel: repo });
  assert.match(t, /^Projekt-Steckbrief \(wörtlich aus 09_wiki\/projekte\/entitaet_garten-app\.md und den Manifesten im Repo\):/);
  assert.match(t, /- Prüfen: `node --test` · `bash scripts\/rauchtest\.sh`/);
  assert.match(t, /- Ziel: test — Prod nur nach Freigabe durch Jo/);
  assert.match(t, /- Falle: Port 4242 ist belegt/);
  assert.match(t, /- Stack laut package\.json: garten-app 0\.3\.0/);
  assert.ok(t.length <= STECKBRIEF_MAX);
  const knapp = steckbrief(v, seite, { wurzel: repo, max: 300 });
  assert.ok(knapp.length <= 300, String(knapp.length));
  assert.match(knapp, /- Prüfen:/);
  assert.match(knapp, /weitere Angaben in 09_wiki/);
  assert.doesNotMatch(knapp, /\(gekürzt\)/, "nie mitten in einer Zeile kürzen");
});

test("istProjektseite: repo/pfade oder entitaet unter projekte/", () => {
  assert.equal(istProjektseite("wissen/thema_x.md", "name: x\nrepo: a/b"), true);
  assert.equal(istProjektseite("projekte/entitaet_y.md", "name: y\ntyp: entitaet"), true);
  assert.equal(istProjektseite("projekte/thema_z.md", "name: z\ntyp: thema"), false);
  assert.equal(istProjektseite("wissen/entitaet_w.md", "name: w\ntyp: entitaet"), false);
});

test("gezeigt: je Sitzung eine Liste, andere Sitzung sieht nichts", () => {
  const v = tempVault();
  merkeGezeigt(v, "s1", "steckbrief:a.md", "repo:/r");
  assert.deepEqual([...gezeigtListe(v, "s1")], ["steckbrief:a.md", "repo:/r"]);
  assert.equal(gezeigtListe(v, "s2").size, 0);
  assert.equal(gezeigtListe(v, "").size, 0);
});

test("SessionStart: Projektseite + Steckbrief aus Unterordner des Repos; Steckbrief als gezeigt gemerkt; Repo ohne Projektseite still", () => {
  const { v, repo } = vaultMitProjekt();
  const env = { BRAIN_SESSION_NUR_STATUS: "1" };
  const s = hook("session-start.mjs", { session_id: "s1", source: "startup", cwd: join(repo, "src") }, { vault: v, env });
  assert.equal(s.status, 0);
  assert.match(s.stdout, /^Projektseite: .*entitaet_garten-app\.md$/m);
  assert.match(s.stdout, /Projekt-Steckbrief/);
  assert.match(s.stdout, /- Stack laut package\.json: garten-app 0\.3\.0/);
  assert.match(readFileSync(join(v, ".logs", "gezeigt", "s1.txt"), "utf8"), /^steckbrief:09_wiki\/projekte\/entitaet_garten-app\.md$/m);
  const anderes = join(tempOrdner("Fremd"), "anderes-repo");
  mkdirSync(join(anderes, ".git"), { recursive: true });
  const o = hook("session-start.mjs", { session_id: "s2", source: "startup", cwd: anderes }, { vault: v, env });
  assert.doesNotMatch(o.stdout, /Steckbrief|Projektseite/);
});

test("brain lint: STECKBRIEF für Projektseiten ohne pruefen, nicht für Seiten mit pruefen oder Nicht-Projektseiten", () => {
  const v = tempOrdner("Brain Lint");
  cpSync(join(KIT, "tests", "fixture"), v, { recursive: true });
  mkdirSync(join(v, "09_wiki", "projekte"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "projekte", "entitaet_ohne.md"), "---\nname: ohne\ndescription: x\ntyp: entitaet\n---\n# ohne\n");
  writeFileSync(join(v, "09_wiki", "projekte", "entitaet_mit.md"), '---\nname: mit\ndescription: x\ntyp: entitaet\npruefen: ["npm test"]\n---\n# mit\n');
  writeFileSync(join(v, "09_wiki", "thema_repo.md"), "---\nname: r\ndescription: x\ntyp: thema\nrepo: jo/r\n---\n# r\n");
  const r = spawnSync(process.execPath, [join(KIT, "brain-lint.mjs"), v], { encoding: "utf8", env: { ...process.env, HOME: TEMP_HOME, USERPROFILE: TEMP_HOME } });
  const steck = r.stdout.split("\n").filter((z) => z.includes("STECKBRIEF"));
  assert.equal(steck.length, 2, r.stdout);
  assert.ok(steck.some((z) => z.includes("projekte/entitaet_ohne.md")));
  assert.ok(steck.some((z) => z.includes("thema_repo.md")));
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-projekt.mjs`
Expected: FAIL — `fmListe`/`steckbrief` sind nicht exportiert bzw. `../gezeigt.mjs` fehlt.

- [ ] **Step 3: `projekt.mjs` ganz ersetzen** — `.tools/projekt.mjs` (Write-Werkzeug; enthält die Fassung aus Task 6 unverändert, dazu die aus session-start verschobenen Projektseiten-Funktionen und K14):

```js
// .tools/projekt.mjs — Projekt-Bezug einer Sitzung oder Datei (0 Tokens, nur Dateisystem, kein git-Aufruf): Git-Wurzel
// und Projekt-Schlüssel (K11/K13), die Projektseite im Wiki (bis M2a in session-start.mjs) und der Projekt-Steckbrief
// (K14, Spec §12.2): feste Felder pruefen/ziel/fallen der Projektseite + Stack/Versionen frisch aus den Manifesten im
// Repo (nie gepflegt, immer aktuell). Alles wörtlich mit Quelle; Zeilen mit Zugangsdaten fallen weg; gekürzt wird nur
// in ganzen Zeilen.
import { existsSync, realpathSync, readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { join, dirname, resolve, sep, basename, relative } from "node:path";
import { entferneBom } from "./pfade.mjs";
import { hatSecretsImKontext } from "./secrets-muster.mjs";
import { kuerze, ganzeZeilen } from "./verlauf.mjs";

// ---------- Git-Wurzel, Projekt-Schlüssel ----------

// Nächster Ordner aufwärts mit .git (Ordner oder Datei — Worktrees haben eine .git-Datei), kanonisch (Symlinks wie
// /var → /private/var aufgelöst). Ein nicht (mehr) existierender Pfad wird ab dem nächsten existierenden Vorfahren gesucht.
export function gitWurzel(start) {
  if (typeof start !== "string" || !start) return null;
  let dir = resolve(start);
  for (;;) {
    try { dir = realpathSync(dir); break; } catch {}
    const hoch = dirname(dir);
    if (hoch === dir) break;
    dir = hoch;
  }
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const hoch = dirname(dir);
    if (hoch === dir) return null;
    dir = hoch;
  }
}

// „Gleiches Projekt" (K13, Spec: nur gleiches Git-Repo bzw. gleicher Vault zählt): Git-Wurzel, sonst der Vault, wenn
// cwd darin liegt, sonst null (zählt nicht — z. B. Sitzungen direkt im Home-Ordner).
export function projektSchluessel(vault, cwd) {
  if (typeof cwd !== "string" || !cwd) return null;
  const w = gitWurzel(cwd);
  if (w) return w;
  const echt = (p) => { try { return realpathSync(resolve(p)); } catch { return resolve(p); } };
  const v = echt(vault), c = echt(cwd);
  return c === v || c.startsWith(v + sep) ? v : null;
}

// ---------- Projektseite (aus session-start.mjs hierher verschoben, Verhalten unverändert) ----------

const ohneQuotes = (s) => String(s).trim().replace(/^["']|["']$/g, "").trim();
// Werte eines Frontmatter-Schlüssels: „k: wert", „k: [a, b]" oder „k:" mit „- a"-Zeilen darunter.
export function fmWerte(text, schluessel) {
  const t = entferneBom(text);
  if (!/^---\r?\n/.test(t)) return [];
  const zeilen = t.split(/\r?\n/), out = [];
  let aktiv = false;
  for (let i = 1; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (z.trim() === "---") break;
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(z);
    if (m) {
      aktiv = schluessel.includes(m[1]);
      const w = m[2].trim();
      if (aktiv && w) out.push(...(w.startsWith("[") ? w.replace(/^\[|\]$/g, "").split(",") : [w]).map(ohneQuotes).filter(Boolean));
      continue;
    }
    const l = /^\s*-\s+(.*)$/.exec(z);
    if (aktiv && l) out.push(ohneQuotes(l[1]));
    else if (z.trim()) aktiv = false;
  }
  return out;
}
export const basisName = (p) => String(p).split("\\").join("/").replace(/\/+$/, "").split("/").pop().replace(/\.git$/i, "").toLowerCase();
const normSeite = (s) => String(s).toLowerCase().replace(/\.md$/, "").replace(/^(thema|entitaet|quelle)_/, "").replace(/[\s_]+/g, "-");
export function dateiKopf(datei, max = 4096) {
  const fd = openSync(datei, "r");
  try { const b = Buffer.alloc(max); const n = readSync(fd, b, 0, max, 0); return b.subarray(0, n).toString("utf8"); }
  finally { closeSync(fd); }
}
// Wiki-Seiten (ohne generierte/Schema-Dateien „_…" und ohne ich.md), absolute Pfade.
function wikiSeiten(vault, wikiOrdner) {
  const out = [];
  const lauf = (dir) => {
    let eintraege; try { eintraege = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of eintraege) {
      if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) lauf(full);
      else if (e.isFile() && e.name.endsWith(".md") && e.name !== "ich.md") out.push(full);
    }
  };
  lauf(join(vault, wikiOrdner));
  return out;
}
// Genau eine passende Wiki-Seite für die Namen (Ordnername/Repo-Name) — sonst null. Vault-relativ mit „/".
export function findeProjektseite(vault, wikiOrdner, namen) {
  const ziele = new Set([...namen].filter(Boolean).map(basisName));
  if (!ziele.size) return null;
  const seiten = wikiSeiten(vault, wikiOrdner);
  const perFm = [], perName = [];
  const zieleNorm = new Set([...ziele].map(normSeite));
  for (const f of seiten) {
    let werte = [];
    try { werte = fmWerte(dateiKopf(f), ["repo", "pfade"]); } catch {}
    if (werte.some((w) => ziele.has(basisName(w)))) perFm.push(f);
    else if (zieleNorm.has(normSeite(basename(f)))) perName.push(f);
  }
  const treffer = perFm.length ? perFm : perName;
  return treffer.length === 1 ? relative(vault, treffer[0]).split("\\").join("/") : null;
}

// ---------- K14: Steckbrief ----------

function fmBlock(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(entferneBom(String(text)));
  return m ? m[1] : "";
}
// Liste aus dem Frontmatter: bevorzugt JSON (`k: ["a", "b, mit Komma"]`, wie quellen/fragen), sonst fmWerte.
export function fmListe(text, schluessel) {
  const m = new RegExp(`^${schluessel}:\\s*(\\[.*\\])\\s*$`, "m").exec(fmBlock(text));
  if (m) {
    try {
      const a = JSON.parse(m[1]);
      if (Array.isArray(a)) return a.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim());
    } catch {}
  }
  return fmWerte(text, [schluessel]);
}
// Projektseite = repo:/pfade: im Frontmatter oder typ: entitaet im Bereich projekte/ (relImWiki relativ zum Wiki-Ordner).
export function istProjektseite(relImWiki, fm) {
  const rel = String(relImWiki).split("\\").join("/");
  return /^(repo|pfade):/m.test(fm) || (rel.startsWith("projekte/") && /^typ:\s*entitaet\s*$/m.test(fm));
}

export const MANIFESTE = ["package.json", "Package.swift", "go.mod", "pyproject.toml", "Cargo.toml"];
const MAX_MANIFEST = 64 * 1024;
function tomlAbschnitt(t, abschnitt, schluessel) {
  const out = [];
  let drin = false;
  for (const z of t.split(/\r?\n/)) {
    const k = /^\s*\[([^\]]+)\]\s*$/.exec(z);
    if (k) { drin = k[1].trim() === abschnitt; continue; }
    if (!drin) continue;
    const m = /^\s*([\w-]+)\s*=\s*"([^"]*)"/.exec(z);
    if (m && schluessel.includes(m[1])) out.push(`${m[1]} ${m[2]}`);
  }
  return out;
}
const LESER = {
  "package.json": (t) => {
    let j;
    try { j = JSON.parse(t); } catch { return []; }
    if (!j || typeof j !== "object") return [];
    const a = [];
    if (typeof j.name === "string") a.push(`${j.name}${typeof j.version === "string" ? ` ${j.version}` : ""}`);
    if (j.engines && typeof j.engines === "object") for (const [k, v] of Object.entries(j.engines)) a.push(`engines.${k} ${v}`);
    if (typeof j.packageManager === "string") a.push(`packageManager ${j.packageManager}`);
    const deps = { ...(j.dependencies || {}), ...(j.devDependencies || {}) };
    const namen = Object.keys(deps);
    if (namen.length) a.push(`Abhängigkeiten: ${namen.slice(0, 8).map((k) => `${k} ${deps[k]}`).join(", ")}${namen.length > 8 ? ` (+${namen.length - 8})` : ""}`);
    return a;
  },
  "Package.swift": (t) => {
    const a = [];
    const v = /^\/\/\s*swift-tools-version:\s*([\w.]+)/m.exec(t);
    if (v) a.push(`swift-tools-version ${v[1]}`);
    const p = /platforms:\s*\[([^\]]*)\]/m.exec(t);
    if (p) a.push(`platforms ${p[1].replace(/\s+/g, " ").trim()}`);
    return a;
  },
  "go.mod": (t) => {
    const a = [];
    const m = /^module\s+(\S+)/m.exec(t);
    if (m) a.push(`module ${m[1]}`);
    const g = /^go\s+(\S+)/m.exec(t);
    if (g) a.push(`go ${g[1]}`);
    return a;
  },
  "pyproject.toml": (t) => tomlAbschnitt(t, "project", ["name", "version", "requires-python"]),
  "Cargo.toml": (t) => tomlAbschnitt(t, "package", ["name", "version", "edition", "rust-version"]),
};
// Stack/Versionen wörtlich aus den Manifesten in der Repo-Wurzel (nur Wurzel, je Datei ≤ 64 KB). Kaputtes → still weg.
export function stackAusManifesten(wurzel) {
  const out = [];
  for (const datei of MANIFESTE) {
    let t;
    try {
      const p = join(wurzel, datei);
      if (statSync(p).size > MAX_MANIFEST) continue;
      t = entferneBom(readFileSync(p, "utf8"));
    } catch { continue; }
    const angaben = LESER[datei](t).filter(Boolean).map((a) => kuerze(a, 200));
    if (angaben.length) out.push({ datei, angaben });
  }
  return out;
}

export const STECKBRIEF_MAX = 1200;
// Rangfolge: Prüfen, Ziel, Fallen, Stack. Passt eine Zeile nicht mehr, fällt sie ganz weg (Hinweis mit Quelle).
export function steckbrief(vault, seiteRel, { wurzel = null, max = STECKBRIEF_MAX } = {}) {
  let text = "";
  try { text = dateiKopf(join(vault, seiteRel), 16384); } catch { return ""; }
  const zeilen = [];
  const pruefen = fmListe(text, "pruefen"), ziel = fmListe(text, "ziel"), fallen = fmListe(text, "fallen");
  if (pruefen.length) zeilen.push(`- Prüfen: ${pruefen.map((p) => `\`${p}\``).join(" · ")}`);
  if (ziel.length) zeilen.push(`- Ziel: ${ziel.join(" · ")}`);
  for (const f of fallen) zeilen.push(`- Falle: ${f}`);
  if (wurzel) for (const s of stackAusManifesten(wurzel)) zeilen.push(`- Stack laut ${s.datei}: ${s.angaben.join(" · ")}`);
  const sauber = zeilen.filter((z) => !hatSecretsImKontext(z));
  if (!sauber.length) return "";
  const kopfzeile = `Projekt-Steckbrief (wörtlich aus ${seiteRel}${wurzel ? " und den Manifesten im Repo" : ""}):`;
  const hinweis = (n) => `(${n} weitere Angaben in ${seiteRel})`;
  const { text: rumpf, weggelassen } = ganzeZeilen(sauber, max - kopfzeile.length - hinweis(99).length - 2);
  return [kopfzeile, rumpf, weggelassen ? hinweis(weggelassen) : ""].filter(Boolean).join("\n");
}
```

- [ ] **Step 4: `gezeigt.mjs` schreiben** — `.tools/gezeigt.mjs`:

```js
// .tools/gezeigt.mjs — je Sitzung gemerkt, was schon eingespielt wurde (Steckbrief, Regeln, geprüfte Repos), damit
// nichts doppelt in den Kontext kommt (K2/K14). Datei .logs/gezeigt/<sid>.txt, eine Zeile je Schlüssel; nur die eigene
// Sitzung schreibt ihre Datei. Wirft nie.
import { readFileSync, appendFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ordnerVon = (vault) => join(vault, ".logs", "gezeigt");
const sauber = (sid) => String(sid || "").replace(/[^\w-]/g, "").slice(0, 64);

export function gezeigtListe(vault, sid) {
  const s = sauber(sid);
  if (!s) return new Set();
  try { return new Set(readFileSync(join(ordnerVon(vault), `${s}.txt`), "utf8").split("\n").filter(Boolean)); }
  catch { return new Set(); }
}
export function merkeGezeigt(vault, sid, ...schluessel) {
  const s = sauber(sid);
  if (!s || !schluessel.length) return;
  try {
    mkdirSync(ordnerVon(vault), { recursive: true });
    appendFileSync(join(ordnerVon(vault), `${s}.txt`), schluessel.map((k) => String(k).replace(/[\r\n]+/g, " ")).join("\n") + "\n");
  } catch {}
}
export function raeumeGezeigtAuf(vault, jetzt = Date.now(), maxMs = 2 * 86400000) {
  let namen = [];
  try { namen = readdirSync(ordnerVon(vault)); } catch { return; }
  for (const n of namen) {
    const p = join(ordnerVon(vault), n);
    try { if (jetzt - statSync(p).mtimeMs > maxMs) unlinkSync(p); } catch {}
  }
}
```

- [ ] **Step 5: `session-start.mjs` umstellen** — (a) Imports anpassen: in der `node:fs`-Importzeile `openSync, readSync, closeSync` entfernen; in der `node:path`-Importzeile `relative` entfernen; `import { spawn, spawnSync } from "node:child_process";` ersetzen durch `import { spawn } from "node:child_process";`.
(b) Den ganzen Bereich von der Kommentarzeile `// Werte eines Frontmatter-Schlüssels: „k: wert", „k: [a, b]" oder „k:" mit „- a"-Zeilen darunter.` bis einschließlich der schließenden `}` von `function findeProjektseite(…)` löschen (`ohneQuotes`, `fmWerte`, `basisName`, `normSeite`, `kopf`, `wikiSeiten`, `findeProjektseite` — leben jetzt in `projekt.mjs`). `leseEingabe` bleibt.
(c) Den Block

```js
if (automatik.projektAutomatik) {
  try {
    const cwd = CWD;
    const namen = [basename(cwd)];
    // -C zielt auf cwd — geerbte GIT_DIR/GIT_WORK_TREE dürfen das nicht umlenken.
    const ohneGit = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
    const r = spawnSync(gitBefehl({ cfg }), ["-C", cwd, "rev-parse", "--show-toplevel"], { encoding: "utf8", windowsHide: true, timeout: 1500, env: ohneGit });
    const top = r.status === 0 ? String(r.stdout || "").trim() : "";
    if (top) namen.push(basename(top));
    const seite = findeProjektseite(V, wikiName, namen);
    if (seite) aus(`Projektseite: ${anzeigePfad(V, seite)}`);
  } catch {}
}
```
ersetzen durch

```js
// Gezeigt-Listen (K2/K14) älter als 2 Tage aufräumen — nur beim echten Start.
try { if (QUELLE === "startup") (await import("../../gezeigt.mjs")).raeumeGezeigtAuf(V); } catch {}
// Projektseite (projektAutomatik): genau eine Wiki-Seite zum Ordner-/Repo-Namen; dazu der Steckbrief (K14: Felder
// pruefen/ziel/fallen + Stack frisch aus den Manifesten im Repo, ≤ 1.200 Zeichen). Gemerkt in .logs/gezeigt/, damit
// regeln-lesen.mjs (K2) ihn in dieser Sitzung nicht noch einmal einspielt.
if (automatik.projektAutomatik) {
  try {
    const { gitWurzel, findeProjektseite, steckbrief } = await import("../../projekt.mjs");
    const top = gitWurzel(CWD);
    const namen = [basename(CWD), ...(top ? [basename(top)] : [])];
    const seite = findeProjektseite(V, wikiName, namen);
    if (seite) {
      aus(`Projektseite: ${anzeigePfad(V, seite)}`);
      aus(steckbrief(V, seite, { wurzel: top }));
      if (SID) (await import("../../gezeigt.mjs")).merkeGezeigt(V, SID, `steckbrief:${seite}`, ...(top ? [`repo:${top}`] : []));
    }
  } catch {}
}
```

- [ ] **Step 6: Lint `STECKBRIEF`** — in `.tools/brain-lint.mjs` bei den Imports ergänzen:

```js
import { istProjektseite } from "./projekt.mjs";
```
und direkt nach der Zeile `for (const f of pruefeFragen(fragenRoh(fm)).fehler) findings.push(\`FRAGEN: ${p} — ${f}\`);` einfügen:

```js
  // K14: Projektseiten brauchen das Feld pruefen (Steckbrief) — Hinweis, blockiert den Commit nicht.
  if (istProjektseite(p, fm) && !/^pruefen:/m.test(fm)) findings.push(`STECKBRIEF: ${p} — Feld pruefen fehlt (Test-/Lint-/Rauchtest-Befehle als JSON-Liste, ${wikiName}/_schema.md „Projekt-Steckbrief")`);
```

- [ ] **Step 7: Schema dokumentieren** — in **beiden** Dateien `.tools/kit/vorlage/wiki/_schema.md` und `09_wiki/_schema.md` (im Worktree; der Wiki-Riegel schützt nur `~/brain`) direkt vor der Zeile `## Beweisbindung` einfügen:

```markdown
## Projekt-Steckbrief (Projektseiten, optional)
Projektseite = Seite mit `repo:`/`pfade:` im Frontmatter oder `typ: entitaet` im Bereich `projekte/`. Feste Felder
(je eine Zeile, JSON wie `quellen`):
- `pruefen: ["<Befehl>", …]` — womit man prüft (Tests, Lint, Rauchtest). Fehlt es, meldet Lint `STECKBRIEF`.
- `ziel: "<test|prod> — <Freigaberegel>"`
- `fallen: ["<Stolperstein>", …]` — je ≤ 200 Zeichen, keine Zugangs- oder Kundendaten.
Stack und Versionen NICHT eintragen: Sie werden beim Sitzungsstart und beim ersten Lesen einer Datei im Repo frisch
aus `package.json`, `Package.swift`, `go.mod`, `pyproject.toml`, `Cargo.toml` gelesen. Der Steckbrief wird wörtlich
eingespielt (≤ 1.200 Zeichen). Firmen-Fachwissen bleibt im Knowledge Collective. Änderungen an diesen Feldern
brauchen kein rev+1.

```

- [ ] **Step 8: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-projekt.mjs .tools/tests/test-zuletzt.mjs .tools/tests/test-laufend.mjs .tools/tests/test-arbeitsstand-hook.mjs && bash .tools/tests/test-session-hintergrund.sh && bash .tools/tests/test-index.sh && bash .tools/tests/test-pre-commit.sh`
Expected: alle PASS, Shell-Tests Exit 0 (die bestehenden Projektseiten-Fälle in `test-session-hintergrund.sh` gelten unverändert).

- [ ] **Step 9: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/projekt.mjs .tools/gezeigt.mjs .tools/adapters/claude-code/session-start.mjs .tools/brain-lint.mjs .tools/kit/vorlage/wiki/_schema.md 09_wiki/_schema.md .tools/tests/test-projekt.mjs
git commit -m "kit: Projekt-Steckbrief — pruefen/ziel/fallen + Stack aus den Manifesten, Lint STECKBRIEF (K14)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Lehnt der pre-commit-Hook den Commit wegen `09_wiki/_schema.md` ab: STOPP, Meldung wörtlich an den Auftraggeber — nicht mit `--no-verify` umgehen.

---

### Task 9: K2 — Regeln beim Lesen einer Datei (`regeln.mjs`, Hook `regeln-lesen.mjs`)

**Files:**
- Create: `.tools/regeln.mjs`
- Create: `.tools/adapters/claude-code/regeln-lesen.mjs`
- Modify: `.tools/lektionen.mjs` (`lektionInsWiki`: Zeile „Gilt für“; CLI `--gilt-fuer`)
- Modify: `.tools/skills/lektion/SKILL.md` (Schritt „Regel für bestimmte Dateien“)
- Test: Create `.tools/tests/test-regeln.mjs`; Modify `.tools/tests/test-lektionen.mjs` (ein Test am Dateiende)

**Interfaces:**
- Consumes: `entferneBom`, `ordner`, `vaultPfad` (`pfade.mjs`); `hatSecretsImKontext` (`secrets-muster.mjs`); `leseAutomatik` (`einstellungen.mjs`); `gitWurzel`, `findeProjektseite`, `steckbrief` (`projekt.mjs`, Task 8); `gezeigtListe`, `merkeGezeigt` (`gezeigt.mjs`, Task 8).
- Produces (`.tools/regeln.mjs`): `REGEL_BUDGET = 1200` · `leseLektionen(vault, wikiOrdner?) → { id, text, muster: string[] }[]` (nur Einträge mit „Gilt für“; `id` = sha1 des Regeltexts, 12 Zeichen) · `musterZuRegex(muster, home = homedir()) → RegExp` · `spezifitaet(muster) → number` · `regelnFuer(vault, datei, { gezeigt = new Set(), max = REGEL_BUDGET, home, cwd }) → { text, ids }`.
- Produces: Hook `regeln-lesen.mjs` (PreToolUse, Matcher `Read`): stdout nur `{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"…"}}` oder nichts; merkt `regel:<id>`, `repo:<wurzel>`, `steckbrief:<seite>` in `.logs/gezeigt/<sid>.txt`.
- Produces (`lektionen.mjs`): `lektionInsWiki(vault, id, { …, giltFuer: string[] | "a, b" })`; CLI `ins-wiki <id> --gilt-fuer '<muster>, …'`.
- Format in `_lektionen.md` (eingerückte Folgezeile des Eintrags): `` `  Gilt für: `*.swift`, `~/source/brain-app/**` ``.

- [ ] **Step 1: Failing test schreiben** — `.tools/tests/test-regeln.mjs`:

```js
// K2 Regeln am Read: passende Lektionen („Gilt für") wörtlich als additionalContext (nur JSON), am besten passende
// zuerst, ganze Regeln im Budget, je Sitzung einmal; Steckbrief beim ersten Read je Repo; nie mit Zugangsdaten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { leseLektionen, musterZuRegex, regelnFuer, REGEL_BUDGET } from "../regeln.mjs";
import { merkeGezeigt } from "../gezeigt.mjs";
import { tempOrdner, tempVault, hook, TEMP_HOME } from "./verlauf-fixture.mjs";

const LEKTIONEN = "\uFEFF# Lektionen\r\n\r\nKurze Regeln.\r\n\r\n"
  + "- **Swift bauen** — Swift-Dateien nur mit `xcrun swift build` bauen.\r\n  Warum: zweimal falscher Compiler. · Wie: vor jedem Build.\r\n  Gilt für: `*.swift`\r\n\r\n"
  + "- **Brain-App** — In der Brain-App nie direkt auf main arbeiten.\r\n  Gilt für: `~/source/brain-app/**`, `**/Package.swift`\r\n\r\n"
  + "- **Ohne Muster** — Gilt nie beim Lesen.\r\n\r\n"
  + "- **Geheim** — Nutze token=abcdefgh12345678 beim Build.\r\n  Gilt für: `*.swift`\r\n\r\n"
  + "- **Kit-Tests** — Kit-Tests immer über run-all.sh.\r\n  Gilt für: `.tools/**/*.mjs`\r\n";
function vaultMitLektionen(name = "Mein Brän") {
  const v = tempVault(name);
  writeFileSync(join(v, "09_wiki", "_lektionen.md"), LEKTIONEN);
  return v;
}
const lesen = (v, sid, datei, extra = {}) => hook("regeln-lesen.mjs",
  { session_id: sid, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: datei }, cwd: v, ...extra }, { vault: v });
const kontext = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : "");

test("leseLektionen: nur Einträge mit „Gilt für“, Regeltext ohne die Muster-Zeile, BOM/CRLF egal", () => {
  const l = leseLektionen(vaultMitLektionen());
  assert.deepEqual(l.map((x) => x.muster), [["*.swift"], ["~/source/brain-app/**", "**/Package.swift"], ["*.swift"], [".tools/**/*.mjs"]]);
  assert.equal(l[0].text, "- **Swift bauen** — Swift-Dateien nur mit `xcrun swift build` bauen.\n  Warum: zweimal falscher Compiler. · Wie: vor jedem Build.");
  assert.match(l[0].id, /^[0-9a-f]{12}$/);
  assert.equal(new Set(l.map((x) => x.id)).size, 4);
  assert.deepEqual(leseLektionen(tempVault()), [], "ohne _lektionen.md leer");
});

test("musterZuRegex: *, **, ?, ~/ und Sonderzeichen", () => {
  const passt = (m, p) => musterZuRegex(m, "/h").test(p);
  assert.equal(passt("*.swift", "/a/b/App.swift"), true);
  assert.equal(passt("*.swift", "/a/b/App.swiftx"), false);
  assert.equal(passt("~/source/brain-app/**", "/h/source/brain-app/Sources/A.swift"), true);
  assert.equal(passt("~/source/brain-app/**", "/h/source/andere/A.swift"), false);
  assert.equal(passt("~/source/brain-app/**", "/x/h/source/brain-app/a"), false, "absolut = ab Wurzel");
  assert.equal(passt("src/**/test.js", "/r/src/test.js"), true);
  assert.equal(passt("src/**/test.js", "/r/src/a/b/test.js"), true);
  assert.equal(passt("src/**/test.js", "/r/src/xtest.js"), false);
  assert.equal(passt(".tools/**/*.mjs", "/v/.tools/tests/b.mjs"), true);
  assert.equal(passt(".tools/**/*.mjs", "/v/tools/a.mjs"), false);
  assert.equal(passt("Notiz (1)?.md", "/a/Notiz (1)a.md"), true);
});

test("regelnFuer: spezifischste zuerst, Zugangsdaten nie, gezeigte nicht noch einmal, Budget in ganzen Regeln", () => {
  const v = vaultMitLektionen();
  const datei = "/h/source/brain-app/Sources/App.swift";
  const r = regelnFuer(v, datei, { home: "/h" });
  assert.match(r.text, /^Brain-Regeln für diese Datei \(wörtlich aus 09_wiki\/_lektionen\.md\):\n- \*\*Brain-App\*\*.*\n- \*\*Swift bauen\*\*/);
  assert.doesNotMatch(r.text, /abcdefgh12345678|Ohne Muster|Kit-Tests/);
  assert.equal(r.ids.length, 2);
  assert.ok(r.text.length <= REGEL_BUDGET);
  const knapp = regelnFuer(v, datei, { home: "/h", max: 200 });
  assert.ok(knapp.text.length <= 200, String(knapp.text.length));
  assert.match(knapp.text, /Brain-App/);
  assert.doesNotMatch(knapp.text, /Swift bauen|\(gekürzt\)/);
  assert.match(knapp.text, /\(1 weitere passende Regel in 09_wiki\/_lektionen\.md\)$/);
  const ohneErste = regelnFuer(v, datei, { home: "/h", gezeigt: new Set([`regel:${r.ids[0]}`]) });
  assert.deepEqual(ohneErste.ids, [r.ids[1]]);
  assert.deepEqual(regelnFuer(v, "/h/notiz.txt", { home: "/h" }), { text: "", ids: [] });
});

test("regeln-lesen: nur JSON additionalContext, je Sitzung einmal, andere Sitzung bekommt die Regeln wieder", () => {
  const v = vaultMitLektionen();
  const datei = join(TEMP_HOME, "source", "brain-app", "Sources", "App.swift");
  const a = lesen(v, "s1", datei);
  assert.equal(a.status, 0);
  assert.equal(JSON.parse(a.stdout).hookSpecificOutput.hookEventName, "PreToolUse");
  assert.match(kontext(a), /^Brain-Regeln für diese Datei/);
  assert.match(kontext(a), /Brain-App[\s\S]*Swift bauen/);
  assert.doesNotMatch(a.stdout, /abcdefgh12345678/);
  assert.equal(lesen(v, "s1", datei).stdout, "", "Dedupe je Sitzung");
  assert.match(kontext(lesen(v, "s2", datei)), /Swift bauen/);
});

test("regeln-lesen: Datei außerhalb jeder Regel, anderes Werkzeug, ohne session_id, kaputtes stdin → still, Exit 0", () => {
  const v = vaultMitLektionen();
  for (const r of [
    lesen(v, "s1", "/irgendwo/notiz.txt"),
    lesen(v, "s1", join(TEMP_HOME, "a.swift"), { tool_name: "Edit" }),
    lesen(v, "", join(TEMP_HOME, "a.swift")),
    hook("regeln-lesen.mjs", "kaputt", { vault: v }),
    lesen(tempVault(), "s1", join(TEMP_HOME, "a.swift")),
  ]) {
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  }
});

test("regeln-lesen: Steckbrief beim ersten Read im Repo (projektAutomatik), nicht wenn der Start ihn schon zeigte, nicht bei Schalter aus", () => {
  const v = tempVault("Mein Brän");
  mkdirSync(join(v, "09_wiki", "projekte"), { recursive: true });
  const seite = "09_wiki/projekte/entitaet_garten-app.md";
  writeFileSync(join(v, seite), '---\nname: garten-app\ndescription: x\ntyp: entitaet\nrepo: jo/garten-app\npruefen: ["node --test"]\n---\n# Garten-App\n');
  const repo = join(tempOrdner("Arbeit Ü"), "garten-app");
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "garten-app", version: "0.3.0" }));
  const a = lesen(v, "s1", join(repo, "src", "a.js"));
  assert.match(kontext(a), /^Projekt-Steckbrief .*\n- Prüfen: `node --test`\n- Stack laut package\.json: garten-app 0\.3\.0/);
  assert.equal(lesen(v, "s1", join(repo, "src", "b.js")).stdout, "", "nur beim ersten Read je Repo");
  merkeGezeigt(v, "s2", `steckbrief:${seite}`);
  assert.equal(lesen(v, "s2", join(repo, "a.js")).stdout, "", "Sitzungsstart hat ihn schon gezeigt");
  writeFileSync(join(v, "brain.config.json"), JSON.stringify({ automatik: { projektAutomatik: false } }));
  assert.equal(lesen(v, "s3", join(repo, "a.js")).stdout, "");
  assert.doesNotMatch(readFileSync(join(v, ".logs", "gezeigt", "s1.txt"), "utf8"), /s2|s3/);
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-regeln.mjs`
Expected: FAIL — `Cannot find module '…/.tools/regeln.mjs'`.

- [ ] **Step 3: `regeln.mjs` schreiben** — `.tools/regeln.mjs`:

```js
// .tools/regeln.mjs — K2 „Regeln am Read" (Spec §12.2): Beim Lesen einer Datei die dafür passenden Lektionen aus
// <wiki>/_lektionen.md wörtlich einspielen. Eine Lektion gilt für eine Datei, wenn eines ihrer Muster aus der Folgezeile
// „  Gilt für: `muster`, …" passt (Glob: `*` innerhalb eines Ordners, `**` über Ordner, `?` ein Zeichen, `~/` = Home;
// ohne führendes `/` passt das Muster auf das Pfadende). Am besten passende zuerst (spezifischstes Muster = meiste feste
// Zeichen); passt das Budget nicht, fallen ganze Regeln weg, nie wird eine gekürzt. Regeln mit Zugangsdaten werden nie
// eingespielt. 0 Tokens, nur Dateisystem. Wirft nie.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { entferneBom, ordner } from "./pfade.mjs";
import { hatSecretsImKontext } from "./secrets-muster.mjs";

export const REGEL_BUDGET = 1200;
const GILT_FUER = /^\s+Gilt für:\s*(.*)$/u;
const fwd = (p) => String(p).split("\\").join("/");

export function leseLektionen(vault, wikiOrdner = ordner(vault).wiki) {
  let text = "";
  try { text = entferneBom(readFileSync(join(vault, wikiOrdner, "_lektionen.md"), "utf8")).replace(/\r\n/g, "\n"); } catch { return []; }
  const out = [];
  let akt = null;
  const abschliessen = () => {
    if (akt?.muster.length) {
      const t = akt.zeilen.join("\n");
      out.push({ id: createHash("sha1").update(t).digest("hex").slice(0, 12), text: t, muster: akt.muster });
    }
    akt = null;
  };
  for (const z of text.split("\n")) {
    if (z.startsWith("- **")) { abschliessen(); akt = { zeilen: [z.trimEnd()], muster: [] }; continue; }
    if (akt && /^\s+\S/.test(z)) {
      const g = GILT_FUER.exec(z);
      if (g) akt.muster.push(...[...g[1].matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter(Boolean));
      else akt.zeilen.push(z.trimEnd());
      continue;
    }
    abschliessen();
  }
  abschliessen();
  return out;
}

export function musterZuRegex(muster, home = homedir()) {
  let m = fwd(String(muster).trim());
  if (m === "~" || m.startsWith("~/")) m = fwd(home).replace(/\/+$/, "") + m.slice(1);
  const absolut = m.startsWith("/") || /^[A-Za-z]:\//.test(m);
  let re = "";
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === "*" && m[i + 1] === "*") {
      if (m[i + 2] === "/") { re += "(?:.*/)?"; i += 2; } else { re += ".*"; i += 1; }
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${absolut ? "^" : "(?:^|/)"}${re}$`, "u");
}
export const spezifitaet = (muster) => String(muster).replace(/[*?]/g, "").length + 1;

export function regelnFuer(vault, datei, { gezeigt = new Set(), max = REGEL_BUDGET, home = homedir(), cwd = "" } = {}) {
  const leer = { text: "", ids: [] };
  if (typeof datei !== "string" || !datei) return leer;
  const pfad = fwd(resolve(cwd || process.cwd(), datei));
  const wiki = ordner(vault).wiki;
  const passend = [];
  for (const r of leseLektionen(vault, wiki)) {
    if (gezeigt.has(`regel:${r.id}`) || hatSecretsImKontext(r.text)) continue;
    let best = 0;
    for (const m of r.muster) { try { if (musterZuRegex(m, home).test(pfad)) best = Math.max(best, spezifitaet(m)); } catch {} }
    if (best) passend.push({ ...r, best });
  }
  if (!passend.length) return leer;
  passend.sort((a, b) => b.best - a.best);
  const quelle = `${wiki}/_lektionen.md`;
  const kopf = `Brain-Regeln für diese Datei (wörtlich aus ${quelle}):`;
  const hinweis = (n) => `(${n} weitere passende ${n === 1 ? "Regel" : "Regeln"} in ${quelle})`;
  const rest = max - kopf.length - hinweis(99).length - 2;
  const gewaehlt = [];
  let laenge = 0;
  for (const r of passend) {
    const l = r.text.length + (gewaehlt.length ? 1 : 0);
    if (laenge + l <= rest) { gewaehlt.push(r); laenge += l; }
  }
  if (!gewaehlt.length) return leer;
  const weg = passend.length - gewaehlt.length;
  return { text: [kopf, ...gewaehlt.map((r) => r.text), ...(weg ? [hinweis(weg)] : [])].join("\n"), ids: gewaehlt.map((r) => r.id) };
}
```

- [ ] **Step 4: Hook schreiben** — `.tools/adapters/claude-code/regeln-lesen.mjs`:

```js
#!/usr/bin/env node
// PreToolUse-Hook (Matcher Read) — K2 „Regeln am Read" (Spec §12.2): Liest Claude eine Datei, kommen die dafür
// passenden Lektionen aus <wiki>/_lektionen.md wörtlich mit (≤ 1.200 Zeichen) und — beim ersten Read in einem Repo je
// Sitzung, Schalter projektAutomatik — der Projekt-Steckbrief (K14). PreToolUse-Kontext erreicht Claude nur als JSON
// hookSpecificOutput.additionalContext und zusammen mit dem Werkzeug-Ergebnis — deshalb am Read (vor jedem Edit liest
// Claude die Datei), nicht am Edit. Jede Regel und jeder Steckbrief kommt je Sitzung nur einmal (.logs/gezeigt/<sid>.txt);
// ohne session_id nichts. Blockiert nie: Fehler → eine Zeile in .logs/hooks.log, Exit 0. 0 Tokens.
// BRAIN_ERNTE=1 (Selbstaufruf der Ernte) → nichts tun.
if (process.env.BRAIN_ERNTE === "1") process.exit(0);
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname, basename, resolve } from "node:path";

let V = "", AUSGABE = "";
try {
  const { vaultPfad, ordner } = await import("../../pfade.mjs");
  V = vaultPfad([]);
  if (!existsSync(V)) process.exit(0);
  let e = {};
  try { e = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
  const sid = String(e?.session_id || "").replace(/[^\w-]/g, "").slice(0, 64);
  const roh = e?.tool_name === "Read" ? e?.tool_input?.file_path : null;
  if (sid && typeof roh === "string" && roh) {
    const datei = resolve(typeof e.cwd === "string" && e.cwd ? e.cwd : process.cwd(), roh);
    const { gezeigtListe, merkeGezeigt } = await import("../../gezeigt.mjs");
    const { regelnFuer } = await import("../../regeln.mjs");
    const gezeigt = gezeigtListe(V, sid);
    const teile = [], neu = [];
    const r = regelnFuer(V, datei, { gezeigt });
    if (r.text) { teile.push(r.text); neu.push(...r.ids.map((id) => `regel:${id}`)); }
    const { leseAutomatik } = await import("../../einstellungen.mjs");
    if (leseAutomatik(V).werte.projektAutomatik) {
      const { gitWurzel, findeProjektseite, steckbrief } = await import("../../projekt.mjs");
      const top = gitWurzel(dirname(datei));
      if (top && !gezeigt.has(`repo:${top}`)) {
        neu.push(`repo:${top}`);
        const seite = findeProjektseite(V, ordner(V).wiki, [basename(top)]);
        if (seite && !gezeigt.has(`steckbrief:${seite}`)) {
          const t = steckbrief(V, seite, { wurzel: top });
          if (t) { teile.push(t); neu.push(`steckbrief:${seite}`); }
        }
      }
    }
    if (neu.length) merkeGezeigt(V, sid, ...neu);
    if (teile.length) AUSGABE = JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: teile.join("\n\n") } });
  }
} catch (err) {
  try { if (V && existsSync(join(V, ".logs"))) appendFileSync(join(V, ".logs", "hooks.log"), `${new Date().toISOString().slice(0, 19)} regeln-lesen fehler=${err?.code || err?.name || "unbekannt"}\n`); } catch {}
}
if (AUSGABE) process.stdout.write(AUSGABE + "\n", () => process.exit(0));
else process.exit(0);
```

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-regeln.mjs`
Expected: alle PASS.

- [ ] **Step 6: Failing test für `--gilt-fuer`** — am Ende von `.tools/tests/test-lektionen.mjs` anhängen (nutzt die dort definierten `neuerVault`, `transkript`, `ZWEI_KORREKTUREN`, `opt`, `entscheide`, `CLI`):

```js
test("ins-wiki --gilt-fuer: Folgezeile „Gilt für“ (≤ 5 Muster), regeln.mjs liest sie; zu viele Muster → 400", async () => {
  const v = neuerVault();
  const ids = (await L.formuliereLektionen(v, L.findeLektionen(transkript(ZWEI_KORREKTUREN), opt()), { mitKi: false })).vorschlaege;
  entscheide(v, ids[0], "uebernehmen");
  assert.throws(() => L.lektionInsWiki(v, ids[0], { regel: "Tomaten nur abends gießen.", giltFuer: ["a", "b", "c", "d", "e", "f"] }), (e) => e.code === 400);
  assert.ok(!existsSync(join(v, "09_wiki", "_lektionen.md")));
  const cli = spawnSync(process.execPath, [CLI, "ins-wiki", ids[0], "--regel", "Tomaten nur abends gießen.", "--gilt-fuer", "*.swift, ~/garten/**", v], { encoding: "utf8", windowsHide: true, env: process.env });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(readFileSync(join(v, "09_wiki", "_lektionen.md"), "utf8"), /\n  Gilt für: `\*\.swift`, `~\/garten\/\*\*`\n$/);
  const { leseLektionen } = await import("../regeln.mjs");
  assert.deepEqual(leseLektionen(v).map((l) => l.muster), [["*.swift", "~/garten/**"]]);
});
```

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-lektionen.mjs`
Expected: FAIL — der neue Test (keine Zeile „Gilt für“, kein 400).

- [ ] **Step 7: `lektionen.mjs` erweitern** — in `lektionInsWiki` die Zeilen

```js
  const wie = einzeilig(ueber.wie || l.wie).slice(0, 300);
  if (!titel || !regel) throw fehlerMit(400, "Die Lektion hat noch keine Regel — erst formulieren (--regel).");
  if (hatZugangsdaten(`${titel}\n${regel}\n${warum}\n${wie}`)) throw fehlerMit(400, "Lektion enthält vermutlich Zugangsdaten — nicht geschrieben.");
```
ersetzen durch

```js
  const wie = einzeilig(ueber.wie || l.wie).slice(0, 300);
  // K2: Dateimuster, für die regeln-lesen.mjs die Regel beim Lesen einspielt — Liste oder Komma-Text (--gilt-fuer).
  const giltFuer = (Array.isArray(ueber.giltFuer) ? ueber.giltFuer : String(ueber.giltFuer ?? "").split(","))
    .map((m) => einzeilig(m).replace(/`/g, "")).filter(Boolean);
  if (giltFuer.length > 5 || giltFuer.some((m) => m.length > 200)) throw fehlerMit(400, "Gilt für: höchstens 5 Muster mit je höchstens 200 Zeichen.");
  if (!titel || !regel) throw fehlerMit(400, "Die Lektion hat noch keine Regel — erst formulieren (--regel).");
  if (hatZugangsdaten(`${titel}\n${regel}\n${warum}\n${wie}\n${giltFuer.join("\n")}`)) throw fehlerMit(400, "Lektion enthält vermutlich Zugangsdaten — nicht geschrieben.");
```
dann die Zeile

```js
  const eintrag = [`- **${titel}** — ${regel}`, ...(warum || wie ? [`  ${[warum && `Warum: ${warum}`, wie && `Wie: ${wie}`].filter(Boolean).join(" · ")}`] : [])].join("\n");
```
ersetzen durch

```js
  const eintrag = [`- **${titel}** — ${regel}`, ...(warum || wie ? [`  ${[warum && `Warum: ${warum}`, wie && `Wie: ${wie}`].filter(Boolean).join(" · ")}`] : []),
    ...(giltFuer.length ? [`  Gilt für: ${giltFuer.map((m) => `\`${m}\``).join(", ")}`] : [])].join("\n");
```
und in der CLI die Zeile

```js
      else r = lektionInsWiki(vault, id, { titel: flags.titel, regel: flags.regel, warum: flags.warum, wie: flags.wie });
```
ersetzen durch

```js
      else r = lektionInsWiki(vault, id, { titel: flags.titel, regel: flags.regel, warum: flags.warum, wie: flags.wie, giltFuer: flags["gilt-fuer"] });
```

- [ ] **Step 8: Skill-Doku** — in `.tools/skills/lektion/SKILL.md` die Zeile

```markdown
   - **Claude Code:** im eigenen Auto-Memory-Ordner dieses Projekts eine Datei `feedback_<kurzname>.md` anlegen
```
ersetzen durch

```markdown
   - **Regel für bestimmte Dateien (alle KIs, auch Claude Code):** Betrifft die Regel nur bestimmte Dateien, statt
     einer Feedback-Datei `{{NODE}} "{{VAULT}}/.tools/lektionen.mjs" ins-wiki <id> --gilt-fuer '<muster>, …'` nutzen
     (höchstens 5 Glob-Muster wie `*.swift`, `~/source/<repo>/**`, `**/Package.swift`; Formulierung wie unten). Dann
     spielt der Read-Hook die Regel genau beim Lesen solcher Dateien ein. `ins-wiki` archiviert selbst.
   - **Claude Code:** im eigenen Auto-Memory-Ordner dieses Projekts eine Datei `feedback_<kurzname>.md` anlegen
```

- [ ] **Step 9: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-regeln.mjs .tools/tests/test-lektionen.mjs .tools/tests/test-projekt.mjs && bash .tools/tests/test-export.sh`
Expected: alle PASS, Shell-Test Exit 0.

- [ ] **Step 10: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/regeln.mjs .tools/adapters/claude-code/regeln-lesen.mjs .tools/lektionen.mjs .tools/skills/lektion/SKILL.md .tools/tests/test-regeln.mjs .tools/tests/test-lektionen.mjs
git commit -m "kit: passende Lektionen und Steckbrief beim Lesen einer Datei einspielen (K2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: K3 — Intent-Gate und Hinweis-Budget

**Files:**
- Modify: `.tools/hint-core.mjs` (Dateiende: `ohneWissensbedarf`, `HINWEIS_MAX`, `imBudget`)
- Modify: `.tools/adapters/claude-code/brain-hint.mjs` (Import-Zeile `hint-core`; Gate vor `vorige`; Budget nach `importTreffer`)
- Test: Create `.tools/tests/test-intent-gate.mjs`

**Interfaces:**
- Consumes: `istSystemNachricht`, `format` (`hint-core.mjs`, bestehend); in brain-hint `logs`, `sid`, `prompt`, `automatik`, `hits`, `vault` (bestehend).
- Produces (`hint-core.mjs`): `ohneWissensbedarf(prompt) → boolean` · `HINWEIS_MAX = 600` · `imBudget(hits, formatiere, max = HINWEIS_MAX) → hits[]` (ganze Treffer in Rangfolge, nicht passende fallen weg).
- Produces: Zeile je Gate-Treffer in `.logs/intent-gate.log`: `<ISO-Zeit> sid=<8> len=<n> gate=ohne-wissensbedarf` (nie Prompt-Text).

- [ ] **Step 1: Failing test schreiben** — `.tools/tests/test-intent-gate.mjs`:

```js
// K3 Intent-Gate + Hinweis-Budget: Bestätigungen lösen keine Suche aus (die Suche wird nicht einmal aufgerufen),
// gezählt wird nur Länge + sid in .logs/intent-gate.log; der Hinweis bleibt ≤ 600 Zeichen in ganzen Treffern.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { cpSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { ohneWissensbedarf, imBudget, HINWEIS_MAX } from "../hint-core.mjs";
import { tempOrdner, hook, KIT } from "./verlauf-fixture.mjs";

test("ohneWissensbedarf: Bestätigungen/Fortsetzungen ja; Fragen, Aufträge mit Inhalt, Befehle, lange Texte nein", () => {
  for (const p of ["ok", "Ja", "weiter", "ok, mach weiter", "Ja passt, dann mach einfach weiter so!", "danke 👍", "LGTM", "nein"]) {
    assert.equal(ohneWissensbedarf(p), true, p);
  }
  for (const p of ["", "weiter?", "ok, aber prüf erst die Tests", "ja wie funktioniert das thema alpha", "/compact", "<task-notification>ok", "ok ".repeat(30)]) {
    assert.equal(ohneWissensbedarf(p), false, p);
  }
});

test("imBudget: ganze Treffer in Rangfolge, was nicht passt, fällt weg — nie gekürzt", () => {
  const h = (page, n) => ({ page, description: "x".repeat(n) });
  const f = (hs) => hs.map((x) => `${x.page}:${x.description}`).join("\n");
  assert.deepEqual(imBudget([h("a", 300), h("b", 400), h("c", 100)], f, 600).map((x) => x.page), ["a", "c"]);
  assert.deepEqual(imBudget([], f), []);
  assert.equal(HINWEIS_MAX, 600);
});

function hinweisVault() {
  const v = tempOrdner("Brain Hinweis Ü");
  cpSync(join(KIT, "tests", "fixture"), v, { recursive: true });
  const r = spawnSync(process.execPath, [join(KIT, "brain-index.mjs"), v], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const treffer = join(tempOrdner("Treffer"), "treffer.json");
  writeFileSync(treffer, JSON.stringify([{ file: "qmd://brain/10-projekte/alpha/notiz-a.md", score: 0.6 }]));
  return { v, env: { BRAIN_HINT_SEARCH_MODULE: join(KIT, "tests", "fake-search.mjs"), FAKE_JSON: treffer } };
}

test("brain-hint: Bestätigung → Suche wird nicht aufgerufen, keine Ausgabe, nur Länge + sid im Gate-Log; echte Frage sucht weiter", () => {
  const { v, env } = hinweisVault();
  const args = join(tempOrdner("Args"), "a.json");
  const P = "Ja passt, dann mach einfach weiter so";
  const g = hook("brain-hint.mjs", { session_id: "gate-1", prompt: P }, { vault: v, env: { ...env, FAKE_ARGS: args } });
  assert.equal(g.status, 0);
  assert.equal(g.stdout, "");
  assert.equal(existsSync(args), false, "Suche darf nicht laufen");
  const log = readFileSync(join(v, ".logs", "intent-gate.log"), "utf8");
  assert.match(log, new RegExp(`sid=gate-1 len=${P.length} gate=ohne-wissensbedarf`));
  assert.doesNotMatch(log, /passt|weiter/);
  const hintLog = join(v, ".logs", "hint.log");
  if (existsSync(hintLog)) assert.doesNotMatch(readFileSync(hintLog, "utf8"), /sid=gate-1 /, "hint.log/analyse unverändert");
  const f = hook("brain-hint.mjs", { session_id: "gate-2", prompt: "wie funktioniert das thema alpha genau" }, { vault: v, env: { ...env, FAKE_ARGS: args } });
  assert.equal(f.status, 0);
  assert.equal(existsSync(args), true);
  assert.match(f.stdout, /thema_alpha/);
  assert.ok(f.stdout.trim().length <= HINWEIS_MAX);
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-intent-gate.mjs`
Expected: FAIL — `ohneWissensbedarf` ist nicht exportiert.

- [ ] **Step 3: `hint-core.mjs` ergänzen** — am Dateiende anhängen:

```js
// K3 Intent-Gate (Spec §12.2): Prompts ohne Wissensbedarf — nur Bestätigungs-/Fortsetzungswörter, ≤ 80 Zeichen, ohne
// Fragezeichen („ok“, „ja passt, mach weiter“) — lösen keine Suche und keinen Folgefragen-Rückgriff aus. Unbekannte
// Wörter → false (dann sucht der Hinweis wie bisher; lieber einmal zu viel suchen als Wissen verschweigen).
const OHNE_BEDARF = new Set(("ok okay oki jo ja jap jep jup yes yep nein ne nö no nope danke dank merci thx thanks "
  + "super passt gut prima top perfekt klasse cool schön sauber klar genau stimmt richtig korrekt einverstanden gerne "
  + "bitte weiter weitermachen fortfahren fortsetzen mach machen mache los go continue proceed sure fine done lgtm "
  + "erledigt gemacht freigabe freigegeben alles dann so das es du einfach mal noch auch und sehr jetzt 👍 🙏 ✅")
  .split(/\s+/).filter(Boolean));
export function ohneWissensbedarf(prompt) {
  const p = String(prompt || "").trim();
  if (!p || p.length > 80 || p.includes("?") || p.startsWith("/") || istSystemNachricht(p)) return false;
  const woerter = p.toLowerCase().replace(/[.,!;:…()"'„“”‚‘’»«–—-]+/gu, " ").split(/\s+/).filter(Boolean);
  return woerter.length > 0 && woerter.every((w) => OHNE_BEDARF.has(w));
}

// Brain-Hinweis je Prompt ≤ 600 Zeichen: ganze Treffer in Rangfolge; was nicht passt, fällt weg (nie gekürzt).
export const HINWEIS_MAX = 600;
export function imBudget(hits, formatiere, max = HINWEIS_MAX) {
  const out = [];
  for (const h of hits) if (formatiere([...out, h]).length <= max) out.push(h);
  return out;
}
```

- [ ] **Step 4: `brain-hint.mjs` anpassen** — (a) die Import-Zeile

```js
const { shouldQuery, istWissensfrage, decide, format, countSuppressed, suchtext, istFolgefrage, qmdToRel } = await import("../../hint-core.mjs");
```
ersetzen durch

```js
const { shouldQuery, istWissensfrage, decide, format, countSuppressed, suchtext, istFolgefrage, qmdToRel, ohneWissensbedarf, imBudget } = await import("../../hint-core.mjs");
```
(b) die drei Zeilen

```js
  // Folgefrage („und beim zweiten?"): vorige echte User-Nachricht aus dem Transkript mitnehmen (nie geloggt/gespeichert)
  const vorige = automatik.hinweise !== "aus" && istFolgefrage(prompt) && input.transcript_path ? vorigeFrage(String(input.transcript_path), prompt) : null;
  if (automatik.hinweise !== "aus" && (shouldQuery(prompt) || vorige)) {
```
ersetzen durch

```js
  // K3 Intent-Gate: reine Bestätigungen/Fortsetzungen („ok, mach weiter") brauchen kein Wissen → keine Suche, kein
  // Folgefragen-Rückgriff. Gezählt in einem eigenen Log (.logs/intent-gate.log: nur Länge + 8er-sid, nie Text), damit
  // hint.log und brain analyse unverändert rechnen.
  const gate = automatik.hinweise !== "aus" && ohneWissensbedarf(prompt);
  if (gate) {
    try {
      mkdirSync(logs, { recursive: true });
      appendFileSync(join(logs, "intent-gate.log"), `${new Date().toISOString().slice(0, 19)} sid=${sid.slice(0, 8)} len=${prompt.length} gate=ohne-wissensbedarf\n`);
    } catch {}
  }
  // Folgefrage („und beim zweiten?"): vorige echte User-Nachricht aus dem Transkript mitnehmen (nie geloggt/gespeichert)
  const vorige = !gate && automatik.hinweise !== "aus" && istFolgefrage(prompt) && input.transcript_path ? vorigeFrage(String(input.transcript_path), prompt) : null;
  if (!gate && automatik.hinweise !== "aus" && (shouldQuery(prompt) || vorige)) {
```
(c) direkt nach der Zeile

```js
    hits = hits.concat(importTreffer(basis, map, seen, { schwelle: wegSchwelle, max, vorhanden: hits, praefix }));
```
einfügen:

```js
    // Budget (≤ 600 Zeichen): ganze Treffer in Rangfolge; nicht gezeigte gelten nicht als gesehen und können später kommen.
    hits = imBudget(hits, (h) => format(h, { vault }));
```

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-intent-gate.mjs .tools/tests/test-laufend.mjs && bash .tools/tests/test-hint-hook.sh && bash .tools/tests/run-all.sh 2>&1 | grep -E "^(FAIL|# fail)"`
Expected: alle neuen PASS, `test-hint-hook.sh` Exit 0 (der bestehende Fall „ok passt, weiter“ bleibt still), die letzte Zeile zeigt `# fail 0` und keine `FAIL`-Zeile.

- [ ] **Step 6: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/hint-core.mjs .tools/adapters/claude-code/brain-hint.mjs .tools/tests/test-intent-gate.mjs
git commit -m "kit: Intent-Gate — keine Suche bei Bestätigungen; Hinweis höchstens 600 Zeichen (K3)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Installer, Adapter-README, Laufzeit-Prüfung

**Files:**
- Modify: `.tools/adapters/claude-code/install.mjs` (Liste `soll`, Kommentar darüber; Entfernen des alten echo-Hinweises)
- Modify: `.tools/adapters/claude-code/README.md`
- Modify: `.tools/tests/test-adapter-claude.mjs` (vier Erwartungen angepasst, ein Test am Dateiende)
- Create: `.tools/tests/laufzeit-hooks.mjs` (bewusst **kein** `test-*.mjs`, siehe unten), `.tools/tests/test-hook-laufzeit.sh`

**Interfaces:**
- Consumes: alle neuen Hooks aus Task 5, 7, 9; `hook`, `tempVault`, `tempOrdner`, `schreibeVerlauf`, `nutzer`, `assistent`, `ergebnis`, `KIT`, `TEMP_HOME` (`verlauf-fixture.mjs`).
- Produces: registrierte Hooks je Profil — PreCompact `kompakt-sichern.mjs` (statt echo) + Ernte; PreToolUse zusätzlich `regeln-lesen.mjs` (Matcher `Read`, eigener Eintrag); SessionEnd zusätzlich `sitzung-ende.mjs`. Installer-Meldung beim Entfernen: `- Hook PreCompact entfernt (Hinweis „Skill handoff“ — ersetzt durch den Arbeitsstand)`.
- Warum `laufzeit-hooks.mjs` kein `test-*.mjs` ist: Die Commit-Prüfung (`commit-pruefung.mjs`) startet bei jedem Commit mit `.tools/*.mjs` **alle** `test-*.mjs` parallel mit 45-s-Grenze — Zeitgrenzen würden dort unter Last zufällig rot und Commits blockieren. `run-all.sh` führt `test-hook-laufzeit.sh` trotzdem bei jedem Gesamtlauf aus.

- [ ] **Step 1: Bestehende Erwartungen anpassen (Failing)** — in `.tools/tests/test-adapter-claude.mjs`:
(a) `  assert.equal(s.hooks.PreToolUse.length, 2, "wiki-guard ersetzt + eigener Eintrag für das Werkzeug-Protokoll");` → `  assert.equal(s.hooks.PreToolUse.length, 3, "wiki-guard ersetzt + eigene Einträge für Werkzeug-Protokoll und Regeln am Read");`
(b) `  for (const [e, n] of [["SessionStart", 1], ["UserPromptSubmit", 1], ["PreToolUse", 2], ["SessionEnd", 1], ["PreCompact", 1]]) {` → `  for (const [e, n] of [["SessionStart", 1], ["UserPromptSubmit", 1], ["PreToolUse", 3], ["SessionEnd", 2], ["PreCompact", 2]]) {`
(c) `  assert.equal(pc.filter(c => c.startsWith("echo ") && c.includes("handoff")).length, 1, JSON.stringify(pc));` ersetzen durch

```js
  assert.equal(pc.filter(c => c.startsWith("echo ") && c.includes("handoff")).length, 0, JSON.stringify(pc));
  assert.equal(pc.filter(c => c.includes("/claude-code/kompakt-sichern.mjs")).length, 1, JSON.stringify(pc));
```
(d) `  assert.equal(s.hooks.PreToolUse.length, 3);` → `  assert.equal(s.hooks.PreToolUse.length, 4);` und `  assert.equal(befehle(s, "SessionEnd").length, 2);` → `  assert.equal(befehle(s, "SessionEnd").length, 3);`
(e) am Dateiende anhängen:

```js
// ---------- v0.6 (M2a): Arbeitsstand statt echo-Hinweis, Sitzungsende, Regeln am Read ----------
test("M2a: alter echo-Hinweis „Skill handoff“ wird entfernt; kompakt-sichern, sitzung-ende und regeln-lesen (Read) je genau einmal", () => {
  const h = mkdtempSync(join(tmpdir(), "ch-")), v = mkdtempSync(join(tmpdir(), "v10 Ü ")); writeFileSync(join(v, "brain.config.json"), "{}");
  const echo = "echo 'Kontext-Kompression steht bevor: offenen Arbeitsstand sichern (Skill handoff).'";
  writeFileSync(join(h, "settings.json"), JSON.stringify({ hooks: { PreCompact: [{ hooks: [{ type: "command", command: echo }, { type: "command", command: "fremd-pc.sh" }] }] } }));
  const out = lauf(v, h);
  assert.match(out, /- Hook PreCompact entfernt \(Hinweis „Skill handoff“/, out);
  lauf(v, h);
  const s = lies(h);
  const pc = befehle(s, "PreCompact");
  assert.equal(pc.filter((c) => c.startsWith("echo ")).length, 0, JSON.stringify(pc));
  assert.ok(pc.includes("fremd-pc.sh"), "fremder PreCompact-Hook bleibt");
  assert.equal(pc.filter((c) => c.includes("/claude-code/kompakt-sichern.mjs")).length, 1);
  assert.equal(befehle(s, "SessionEnd").filter((c) => c.includes("/claude-code/sitzung-ende.mjs")).length, 1);
  const rl = s.hooks.PreToolUse.filter((x) => x.hooks.some((y) => y.command.includes("/claude-code/regeln-lesen.mjs")));
  assert.equal(rl.length, 1);
  assert.equal(rl[0].matcher, "Read");
  assert.equal(rl[0].hooks.length, 1, "eigener Eintrag");
  assert.match(lauf(v, h), /unverändert/);
});
```

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-adapter-claude.mjs`
Expected: FAIL — die geänderten Zählungen und der neue Test.

- [ ] **Step 2: Installer** — in `.tools/adapters/claude-code/install.mjs` die Kommentarzeilen

```js
// Ein Eintrag je Brain-Hook. PreToolUse hat ZWEI eigene Einträge (wiki-guard, werkzeug-protokoll), damit der
// wiki-guard-Matcher unverändert bleibt; PreCompact hat den echo-Hinweis UND den Ernte-Auslöser.
```
ersetzen durch

```js
// Ein Eintrag je Brain-Hook. PreToolUse hat DREI eigene Einträge (wiki-guard, werkzeug-protokoll, regeln-lesen), damit
// der wiki-guard-Matcher unverändert bleibt; PreCompact sichert den Arbeitsstand (kompakt-sichern, M2a) UND startet die
// Ernte; SessionEnd startet die Ernte UND trägt die Sitzung aus .logs/laufend/ aus (sitzung-ende, M2a).
```
und die Zeilen

```js
  { ev: "PreCompact", cmd: `echo 'Kontext-Kompression steht bevor: offenen Arbeitsstand sichern (Skill handoff).'` },
  { ev: "PreCompact", cmd: ERNTE_FAKT },
  { ev: "SessionEnd", cmd: ERNTE_FAKT },
];
```
ersetzen durch

```js
  { ev: "PreToolUse", cmd: `${NODE} ${pfad("regeln-lesen.mjs")}`, matcher: "Read" },
  { ev: "PreCompact", cmd: `${NODE} ${pfad("kompakt-sichern.mjs")}` },
  { ev: "PreCompact", cmd: ERNTE_FAKT },
  { ev: "SessionEnd", cmd: ERNTE_FAKT },
  { ev: "SessionEnd", cmd: `${NODE} ${pfad("sitzung-ende.mjs")}` },
];
// Bis v0.5 registrierter echo-Hinweis vor der Kompaktierung — ersetzt durch kompakt-sichern.mjs (K12) und entfernt.
const ALT_HANDOFF_ECHO = `echo 'Kontext-Kompression steht bevor: offenen Arbeitsstand sichern (Skill handoff).'`;
```
und direkt vor der Zeile `// Ist das Plugin brain-mods aktiv, zeigt dessen Brain-Band denselben Stand über dem Prompt — die Statusline wäre doppelt.` einfügen:

```js
{
  const liste = s.hooks.PreCompact || [];
  let entfernt = false;
  for (const eintrag of liste) {
    if (!Array.isArray(eintrag.hooks)) continue;
    for (let i = eintrag.hooks.length - 1; i >= 0; i--) {
      if (eintrag.hooks[i]?.command === ALT_HANDOFF_ECHO) { eintrag.hooks.splice(i, 1); entfernt = true; }
    }
  }
  for (let i = liste.length - 1; i >= 0; i--) if (Array.isArray(liste[i].hooks) && liste[i].hooks.length === 0) liste.splice(i, 1);
  if (entfernt) console.log("- Hook PreCompact entfernt (Hinweis „Skill handoff“ — ersetzt durch den Arbeitsstand)");
}
```

- [ ] **Step 3: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-adapter-claude.mjs && bash .tools/tests/test-install.sh && bash .tools/tests/test-install-safety.sh`
Expected: alle PASS, Shell-Tests Exit 0.

- [ ] **Step 4: Laufzeit-Prüfung schreiben** — `.tools/tests/laufzeit-hooks.mjs`:

```js
// Hook-Laufzeiten (Spec §13.2, Global Constraints M2a): Prompt mit Intent-Gate und Read < 300 ms, Sitzungsstart < 1 s,
// Sitzungsende < 500 ms, PreCompact mit 40-MB-Verlauf < 5 s. Bester von drei Läufen (kalter Plattencache zählt nicht).
// Läuft über test-hook-laufzeit.sh — bewusst NICHT als test-*.mjs, damit die Commit-Prüfung (alle Unit-Tests parallel,
// 45 s) nie an Zeitgrenzen scheitert.
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { cpSync, writeFileSync, openSync, writeSync, closeSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tempOrdner, tempVault, hook, schreibeVerlauf, nutzer, assistent, ergebnis, KIT, TEMP_HOME } from "./verlauf-fixture.mjs";

const bester = (n, f) => Math.min(...Array.from({ length: n }, () => { const r = f(); assert.equal(r.status, 0, r.stderr); return r.ms; }));

test("UserPromptSubmit mit Intent-Gate < 300 ms", () => {
  const v = tempOrdner("Brain Laufzeit");
  cpSync(join(KIT, "tests", "fixture"), v, { recursive: true });
  spawnSync(process.execPath, [join(KIT, "brain-index.mjs"), v]);
  let i = 0;
  const ms = bester(3, () => hook("brain-hint.mjs", { session_id: `lz-p${i++}`, prompt: "Ja passt, dann mach einfach weiter so" }, { vault: v }));
  assert.ok(ms < 300, `${ms} ms`);
});

test("PreToolUse Read mit 50 Regeln < 300 ms", () => {
  const v = tempVault("Brain Laufzeit");
  writeFileSync(join(v, "09_wiki", "_lektionen.md"), "# Lektionen\n\n"
    + Array.from({ length: 50 }, (_, i) => `- **Regel ${i}** — Text ${i}.\n  Gilt für: \`*.swift\`, \`src/**/r${i}.js\`\n`).join("\n"));
  const datei = join(TEMP_HOME, "app", "A.swift");
  let i = 0;
  const ms = bester(3, () => hook("regeln-lesen.mjs", { session_id: `lz-r${i++}`, tool_name: "Read", tool_input: { file_path: datei } }, { vault: v }));
  assert.ok(ms < 300, `${ms} ms`);
});

test("SessionStart (startup, 20 frühere Verläufe) < 1 s", () => {
  const v = tempVault("Brain Laufzeit");
  const ordner = tempOrdner("Verläufe");
  for (let i = 0; i < 20; i++) schreibeVerlauf(join(ordner, `alt${i}.jsonl`), [nutzer(`Sitzung ${i}`), assistent("ok")]);
  const eigene = join(ordner, "eigene.jsonl");
  schreibeVerlauf(eigene, [nutzer("los")]);
  const ms = bester(3, () => hook("session-start.mjs", { session_id: "eigene", source: "startup", cwd: v, transcript_path: eigene },
    { vault: v, env: { BRAIN_SESSION_NUR_STATUS: "1" } }));
  assert.ok(ms < 1000, `${ms} ms`);
});

test("SessionEnd (sitzung-ende) < 500 ms", () => {
  const v = tempVault();
  const ms = bester(3, () => hook("sitzung-ende.mjs", { session_id: "lz-e", reason: "other" }, { vault: v }));
  assert.ok(ms < 500, `${ms} ms`);
});

test("PreCompact mit 40-MB-Verlauf < 5 s", () => {
  const v = tempVault();
  const f = join(tempOrdner(), "riesig.jsonl");
  const fd = openSync(f, "w");
  writeSync(fd, JSON.stringify(nutzer("Ziel: riesige Sitzung")) + "\n");
  const block = JSON.stringify(ergebnis("t", "r".repeat(100000))) + "\n";
  for (let i = 0; i < 400; i++) writeSync(fd, block);
  writeSync(fd, JSON.stringify(nutzer("letzte Vorgabe")) + "\n");
  closeSync(fd);
  const r = hook("kompakt-sichern.mjs", { session_id: "lz-pc", transcript_path: f, cwd: v, hook_event_name: "PreCompact", trigger: "auto" }, { vault: v });
  assert.equal(r.status, 0);
  assert.ok(r.ms < 5000, `${r.ms} ms`);
});
```

und `.tools/tests/test-hook-laufzeit.sh`:

```bash
#!/bin/bash
# Hook-Laufzeiten (Spec §13.2) — als Shell-Test, damit die zeitkritischen Prüfungen nicht in der Commit-Prüfung
# (node --test .tools/tests/test-*.mjs, parallel, 45 s) laufen und dort unter Last zufällig Commits blockieren.
. "$(dirname "$0")/plattform.sh"
set -u; cd "$(dirname "$0")"
OUT=$(node --test laufzeit-hooks.mjs 2>&1) || { echo "$OUT" | tail -n 40; echo "FAIL: Hook-Laufzeiten"; exit 1; }
echo "OK test-hook-laufzeit"
```

Run: `cd ~/brain-kit-v0.6 && bash .tools/tests/test-hook-laufzeit.sh`
Expected: `OK test-hook-laufzeit`. Scheitert eine Grenze: Ursache suchen (z. B. ein Import, der beim Read-Hook unnötig lädt) — die Grenze nicht anheben ohne Rückfrage an den Auftraggeber.

- [ ] **Step 5: Adapter-README** — in `.tools/adapters/claude-code/README.md`:
(a) nach der Zeile `` Frontmatter `repo:`/`pfade:` auf den Ordner- bzw. Git-Repo-Namen zeigt, sonst gleicher Seitenname).`` (eingerückt, im Abschnitt `session-start.mjs`) einfügen:

```markdown
  Seit v0.6 (M2a) außerdem — alles wörtlich mit Quelle, gesamt ≤ 9.500 Zeichen: nach einer Kompaktierung zuerst
  der Arbeitsstand dieser Sitzung (`.logs/sitzungen/<sid>.md`, nur dieselbe `session_id`); beim Start „Zuletzt in
  diesem Ordner“ (letzte drei Sitzungen, Commits seither, „Offen“ aus der jüngsten `session_*.md`, ≤ 600), parallele
  Sitzungen im selben Repo (`.logs/laufend/`, nur Hinweis) und der Projekt-Steckbrief (`pruefen`/`ziel`/`fallen` +
  Stack aus den Manifesten, ≤ 1.200).
```
(b) die Zeile `` startet beim Stand-Intervall (`staendeIntervallStunden`) die Ernte `--art stand` losgelöst.`` (eingerückt) ersetzen durch

```markdown
  startet beim Stand-Intervall (`staendeIntervallStunden`) die Ernte `--art stand` losgelöst. Seit v0.6: Intent-Gate
  (reine Bestätigungen wie „ok, mach weiter“ suchen nicht; gezählt in `.logs/intent-gate.log`), Hinweis ≤ 600 Zeichen
  in ganzen Treffern, neue parallele Sitzungen im selben Repo werden einmal gemeldet.
```
(c) nach der Zeile `  (frisches Lock), generierte Dateien nie von Hand.` einfügen:

```markdown
- `kompakt-sichern.mjs` (PreCompact) — sichert den Arbeitsstand der Sitzung wörtlich aus dem Verlauf nach
  `.logs/sitzungen/<sid>.{json,md}` (Ziel, Vorgaben, Aufgaben, Dateien, Befehle, Nutzer-Nachrichten; Secret-Riegel).
  Ersetzt den früheren echo-Hinweis „Skill handoff“ — der Installer entfernt ihn.
- `sitzung-ende.mjs` (SessionEnd) — trägt die Sitzung aus `.logs/laufend/` aus; gibt nie etwas aus.
- `regeln-lesen.mjs` (PreToolUse: `Read`, eigener Eintrag) — spielt beim Lesen einer Datei die passenden Lektionen
  (`_lektionen.md`, Folgezeile „Gilt für“) und beim ersten Read in einem Repo den Projekt-Steckbrief als
  `additionalContext` ein (nur JSON, je Sitzung einmal, `.logs/gezeigt/`).
```
(d) im Block unter `## Tests` nach der Zeile `node --test .tools/tests/test-ernte-ausloeser.mjs` einfügen:

```
node --test .tools/tests/test-arbeitsstand-hook.mjs .tools/tests/test-zuletzt.mjs .tools/tests/test-laufend.mjs
node --test .tools/tests/test-projekt.mjs .tools/tests/test-regeln.mjs .tools/tests/test-intent-gate.mjs
bash .tools/tests/test-hook-laufzeit.sh
```

- [ ] **Step 6: Gesamtsuite**

Run: `cd ~/brain-kit-v0.6 && bash .tools/tests/run-all.sh 2>&1 | tail -n 60`
Expected: `# fail 0`, jede Shell-Zeile `OK …` (auch `OK test-hook-laufzeit.sh`), Exit 0.

- [ ] **Step 7: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/adapters/claude-code/install.mjs .tools/adapters/claude-code/README.md .tools/tests/test-adapter-claude.mjs .tools/tests/laufzeit-hooks.mjs .tools/tests/test-hook-laufzeit.sh
git commit -m "kit: neue Hooks registrieren, echo-Hinweis ersetzen, Laufzeit-Prüfung (M2a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Abschluss — Review, Freigabe, Zusammenführen, Live-Prüfung

**Files:**
- Modify (nur nach Freigabe): `~/brain` (Fast-Forward auf `kit-v0.6`)
- Modify: `~/source/brain-app/docs/messungen/2026-10-16-m2a-wirkung-ausgang.md` (Abschnitt D)
- Fabio selbst: `~/.claude/settings.json`, `~/.claude-<profil2>/settings.json` (über den Installer)

**Interfaces:**
- Consumes: alle Tasks 1–11; `brain wirkung` (Task 2), Messprotokoll (Task 3).
- Produces: zusammengeführter Kit-Stand in `~/brain`, registrierte Hooks in beiden Profilen, Live-Befund im Messprotokoll.

- [ ] **Step 1: Gesamtsuite im Worktree**

Run: `cd ~/brain-kit-v0.6 && bash .tools/tests/run-all.sh 2>&1 | tail -n 60 && git status --short && git log --oneline main..kit-v0.6`
Expected: `# fail 0`, alle Shell-Tests `OK`, Arbeitsbaum sauber, 11 M2a-Commits (Task 1–11; Task 3 zusätzlich ein Commit im App-Repo).

- [ ] **Step 2: EIN Opus-Abschlussreview** — einen Review-Subagenten (`model: opus`, frischer Kontext) mit dem ganzen Diff `git -C ~/brain-kit-v0.6 diff main..kit-v0.6`, dieser Plan-Datei und der Spec (§12.2, §13.2) starten. Prüfauftrag: die fünf Punkte aus „Review Focus“, die Global Constraints (0 Tokens, wörtlich mit Quelle, Secret-Riegel vor jedem Speichern/Einspielen, Budgets, nie blockierend, `session_id`-Zuordnung) und dass `brain zeig`, `brain status --json`, die Brücke und `einstellungen.mjs#SCHEMA` unverändert sind. Befunde selbst bewerten; berechtigte Funde von einem sonnet-Umsetzer nachbessern lassen (je Fund Test zuerst), danach Step 1 wiederholen. Kein zweites Opus-Review außer bei einem Critical-Fund.

- [ ] **Step 3: Zusammenfassung und STOPP** — Fabio in höchstens 15 Zeilen zeigen: was M2a kann (K11–K15, K2, K3 je eine Zeile), Testzahlen, Review-Ergebnis, offene Punkte. Dann **warten auf sein ausdrückliches Okay** für das Zusammenführen und die Hook-Registrierung. Ohne Okay endet der Plan hier.

- [ ] **Step 4: Zusammenführen (nur nach Okay)** — vorher die Sicherheitszeile ausgeben:
„schreibt `~/brain` (Branch `main`, Fast-Forward auf `kit-v0.6`) · Ziel: Prod (Fabios Live-Vault) · Rückweg: `git -C ~/brain reset --hard <HEAD vorher>` · Dry-Run: `merge-base --is-ancestor` prüft, ob ein Fast-Forward möglich ist“.

```bash
git -C ~/brain status --short
git -C ~/brain rev-parse HEAD
git -C ~/brain merge-base --is-ancestor main kit-v0.6 && echo "Fast-Forward möglich"
git -C ~/brain merge --ff-only kit-v0.6
```
Ist `git status` nicht leer: STOPP, Fabio fragen (fremde Änderungen im Live-Vault). Ist kein Fast-Forward möglich (main ist weitergelaufen): im Worktree `git -C ~/brain-kit-v0.6 merge main`, Konflikte lösen, Step 1 wiederholen, dann erneut versuchen.

- [ ] **Step 5: Live-Suite**

Run: `cd ~/brain && bash .tools/tests/run-all.sh 2>&1 | tail -n 40 && git -C ~/brain status --short`
Expected: `# fail 0`, alle `OK`, Status leer (die Tests schreiben nur in Temp-Ordner).

- [ ] **Step 6: Hook-Registrierung vorbereiten (Fabio führt aus)** — zuerst Probelauf auf Kopien (nur lesend auf die echten Profile):

```bash
P=/private/tmp/claude-502/m2a-install-probe && mkdir -p "$P/a" "$P/b"
cp ~/.claude/settings.json "$P/a/" && cp ~/.claude-<profil2>/settings.json "$P/b/"
/opt/homebrew/bin/node ~/brain/.tools/adapters/claude-code/install.mjs ~/brain --claude-home "$P/a"
/opt/homebrew/bin/node ~/brain/.tools/adapters/claude-code/install.mjs ~/brain --claude-home "$P/b"
diff <(node -p 'JSON.stringify(require(process.argv[1]).hooks,null,1)' ~/.claude/settings.json) <(node -p 'JSON.stringify(require(process.argv[1]).hooks,null,1)' "$P/a/settings.json")
git -C ~/brain status --short
```
Expected: Meldungen `+ Hook PreToolUse (Read)`, `+ Hook PreCompact`, `+ Hook SessionEnd`, `- Hook PreCompact entfernt (Hinweis „Skill handoff“ …)`; im Diff nur diese Hooks; fremde Hooks unverändert; `~/brain` sauber. Dann Fabio diesen fertigen Befehl geben (ohne `BRAIN_NODE`, damit die Hook-Befehle denselben Node-Pfad wie bisher tragen):

```
! /opt/homebrew/bin/node <home>/brain/.tools/adapters/claude-code/install.mjs <home>/brain --claude-home <home>/.claude && /opt/homebrew/bin/node <home>/brain/.tools/adapters/claude-code/install.mjs <home>/brain --claude-home <home>/.claude-<profil2>
```
Rückweg: der Installer legt je Profil `settings.json.bak-<Zeit>` an.

- [ ] **Step 7: Live-Prüfung (nach Fabios Installation, neue Sitzungen)**
1. K15: `/opt/homebrew/bin/node ~/brain/.tools/brain.mjs wirkung --speichern` → Zahlen plausibel zur Ausgangsmessung (Task 3), Zeile in `.logs/wirkung.jsonl`.
2. K12: in einer neuen Sitzung im Ordner `~/brain` drei Prompts, dann `/compact` → `~/brain/.logs/sitzungen/<sid>.md` existiert, enthält Ziel und Nutzer-Nachrichten wörtlich, keine Zugangsdaten; nach der Kompaktierung beginnt der eingespielte Kontext mit „Brain-Arbeitsstand vor der Kompaktierung“.
3. K11: neue Sitzung im selben Ordner → Block „Zuletzt in diesem Ordner“ mit der vorigen Sitzung.
4. K13: zwei Sitzungen in `~/source/brain-app` → die zweite meldet beim Start „Parallel im selben Repo“, die erste beim nächsten Prompt einmal.
5. K2/K14 (nur lesend prüfen): `grep -rl '^repo:' ~/brain/09_wiki` und `grep -c 'Gilt für' ~/brain/09_wiki/_lektionen.md`. Gibt es eine Projektseite zu einem Repo, dort eine Datei lesen lassen → Steckbrief erscheint einmal. Fehlen Projektseite und Lektionen mit Muster: als „live nicht prüfbar, keine Daten“ vermerken und Fabio vorschlagen, für brain-app eine Projektseite mit `pruefen`/`ziel`/`fallen` über `/ingest` anzulegen.
6. K3: Prompt „ok, mach weiter so“ → keine Brain-Treffer-Zeile, eine neue Zeile in `.logs/intent-gate.log`.
7. `git -C ~/brain status --short` → nur erwartete Änderungen (keine; `.logs/` ist git-ignoriert).

- [ ] **Step 8: Messprotokoll ergänzen und committen** — an `~/source/brain-app/docs/messungen/2026-10-16-m2a-wirkung-ausgang.md` anhängen:

```markdown
## D. Live-Prüfung nach dem Zusammenführen (<Datum>)

| Baustein | Ergebnis | Beleg |
|---|---|---|
| K15 Messung | <ok/Abweichung> | `.logs/wirkung.jsonl`, Zeile vom <Datum> |
| K12 /compact | <ok/Abweichung> | `.logs/sitzungen/<sid>.md` |
| K11 Zuletzt | <ok/Abweichung> | Sitzungsstart <Uhrzeit> |
| K13 Parallel | <ok/Abweichung> | zwei Sitzungen in brain-app |
| K2/K14 Read | <ok / nicht prüfbar, keine Daten> | <Datei> |
| K3 Gate | <ok/Abweichung> | `.logs/intent-gate.log` |

Nächste Vergleichsmessung: automatisch nach 30 Tagen (session-hintergrund) bzw. `brain wirkung --tage=30`;
Bewertung nur mit dem Rauschband aus Teil B.
```
Die `<…>`-Felder sind hier bewusst Ausfüll-Felder des Protokolls (Ergebnisse der Live-Prüfung), keine Plan-Lücken.

```bash
cd ~/source/brain-app
git add docs/messungen/2026-10-16-m2a-wirkung-ausgang.md
git commit -m "docs: M2a Live-Prüfung im Messprotokoll

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Abschluss melden** — Fabio: Ergebnis in wenigen Zeilen, `/ingest` für die Erkenntnisse anbieten, Handoff-Datei aktualisieren. Optional (seine Entscheidung, nicht selbst eintragen): Satz für die globale `CLAUDE.md`, damit die Compact instructions auch außerhalb des Brain-Ordners wirken:
„# Compact instructions — Beim Kompaktieren Ziel, offene Aufgaben, Nutzer-Vorgaben wörtlich und die zuletzt bearbeiteten Dateien erhalten; der Brain-Arbeitsstand wird danach automatisch eingespielt.“

