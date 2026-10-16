# M1 „App läuft“ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Menüleisten-App „Brain“ (Swift), die Fabios vorhandenes `~/brain` verbindet, den Zustand (✓/⚠/✕) anzeigt und die bestehende 3D-Ansicht in einem Fenster zeigt — ohne offenen Netzwerk-Port, mit eigener Node-Laufzeit, ohne von selbst Wissen zu schreiben.

**Architecture:** Das Kit (Node, im Brain-Ordner unter `.tools/`) bekommt einen transportunabhängigen Kern der Ansicht (`behandleIntern`, `erzeugeHandler`), eine stdin/stdout-Brücke (`ansicht/bruecke.mjs`), einen App-Modus in `ansicht/api.js` und den Befehl `brain status --json`. Die App (Swift-Paket `~/source/brain-app`) lädt die Oberfläche über das eigene URL-Schema `brain://app/…` (WKURLSchemeHandler → Brücke) und schickt API-Aufrufe über einen WKScriptMessageHandlerWithReply an dieselbe Brücke. Das Fenster ist ein AppKit-`NSWindow`; beim Schließen werden WebView und Brücke beendet.

**Tech Stack:** Swift 6.2 (Sprachmodus 5), SwiftUI `MenuBarExtra`, AppKit, WebKit, CryptoKit, Swift Testing; Node (offizielles darwin-arm64-Release, Version in `scripts/node-version.txt`); Kit: Node-ESM, `node --test`; Bash-Skripte.

**Spec:** `/Users/fbFirma/source/brain-app/docs/superpowers/specs/2026-10-16-brain-app-design.md` (Meilenstein M1 in §14; Bausteine §5.2; Sicherheit §11; Tests §13)

## Global Constraints

- Plattform: nur Apple Silicon (arm64), **macOS 26 oder neuer** (Spec §2).
- **Kein offener Netzwerk-Port** — `lsof -i` muss für App-Prozesse leer sein (Spec §13.3). Kein eigener Server, keine Telemetrie (§2, §11).
- **Das Terminal hängt nie von der App ab** (§4.2): `brain zeig` (HTTP-Dienst) muss unverändert funktionieren; alle bestehenden Kit-Tests bleiben grün.
- **Korrektheit vor allem** (§4.0): M1 schreibt von selbst nichts ins Brain. Schreibend ist nur, was der Nutzer in der Oberfläche ausdrücklich anklickt (wie heute bei `brain zeig`).
- Kit-Änderungen **nur im Worktree `~/brain-kit-v0.6`, Branch `kit-v0.6`** — nie direkt auf `main` von `~/brain`; das Zusammenführen ist Task 17 und braucht Fabios ausdrückliches Okay (§12).
- Fehlertexte in Alltagssprache, keine Stacktraces in der Oberfläche (§10). Signalzustände immer mit Symbol (✓ ⚠ ✕), nie nur Farbe.
- Node: offizielles Release, Version fest in `scripts/node-version.txt`, SHA-256 gegen `SHASUMS256.txt` geprüft; Kopie nach `~/Library/Application Support/Brain/node/<version>/`, Aufruf über `…/Brain/bin/node` (§5.2, §11).
- Bezeichner wie im Kit auf Deutsch ohne Umlaute (`ae/oe/ue`); Kommentare Deutsch.
- `git add` immer mit expliziten Dateien (kein `-A`, kein `.`). App-Repo-Commits mit der dort eingestellten noreply-Identität. Commit-Nachrichten enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Bundle-Kennung der App: `io.github.fbrogno.brain` (vor M5 änderbar).

## Review Focus

1. **Brain-Ordner mit Leerzeichen/Umlauten** (z. B. `~/Documents/Mein Brän`): Argumente, Umgebung und Brücke müssen damit funktionieren. → Tests in Task 2 (Brücke), Task 9 (Befehl), Task 15 (Rauchtest mit `Test Brain`).
2. **Brain-Ordner nach der Einrichtung verschoben oder gelöscht:** App stürzt nicht ab, zeigt ✕ „Brain-Ordner nicht gefunden“ und bietet „Ordner wählen“. → Test in Task 10, Verhalten in Task 14.
3. **Links in Wiki-Seiten auf fremde Webseiten:** Das Fenster darf nie von `brain://app` weg navigieren; https-Links öffnen im Standardbrowser, alles andere wird abgebrochen. → Tests in Task 12.
4. **Brücke stürzt ab / Node fehlt mitten im Betrieb:** Keine hängende Anfrage, kein App-Absturz (auch kein SIGPIPE); die nächste Anfrage startet die Brücke neu. → Tests in Task 11.
5. **`brain status` hängt oder ist langsam (großes Brain):** Menüleiste friert nicht ein; nach Zeitlimit Zustand „unbekannt“ (?). → Tests in Task 9.

## Abweichungen von der Spec (bewusst)

- **Nachrichtenkanal statt `brain://api/…`:** api.js spricht die Brücke über `WKScriptMessageHandlerWithReply` an; über das Schema `brain://app` werden nur Seiten und Dateien ausgeliefert (`/api/` ist dort gesperrt).
- **Swift Testing statt XCTest** für die Tests in BrainCore.
- **Shell-Rauchtest statt XCUITest/Playwright** (`scripts/rauchtest.sh`).
- **`--json` in M1 nur für `brain status`**; feste Pfade (Homebrew u. ä.) werden nur über `BRAIN_NODE` gelöst.
- **BRAIN_NODE-Rückfall auf das App-Node (M6) ist offen** und wird in M4/M5 geklärt.

## Dateistruktur

**Kit** (Worktree `~/brain-kit-v0.6`, Pfade relativ dazu):
- Modify `.tools/ansicht/dienst-lib.mjs` — `behandle` = Transport-Prüfungen + neues `behandleIntern` (Routing).
- Create `.tools/ansicht/handler.mjs` — `erzeugeHandler()`: die Daten-Handler (bisher in `dienst.mjs`).
- Modify `.tools/ansicht/dienst.mjs` — nutzt `erzeugeHandler()`.
- Create `.tools/ansicht/bruecke.mjs` — stdin/stdout-Brücke für die App.
- Modify `.tools/ansicht/api.js` — App-Modus (`brain:` + `webkit.messageHandlers.brain`).
- Create `.tools/status.mjs` — `brainStatus()`, `bewerte()`, `statusText()`.
- Modify `.tools/brain.mjs` — Befehl `status [--json]`.
- Modify `.tools/pfade.mjs` — `nodePfad()` beachtet `BRAIN_NODE`.
- Tests: Create `.tools/tests/test-ansicht-bruecke.mjs`, `.tools/tests/test-status.mjs`; Modify `.tools/tests/test-ansicht-steuer.mjs`, `.tools/tests/test-pfade.mjs`.

**App** (`~/source/brain-app`):
- `Package.swift`, `.gitignore`, `Ressourcen/Info.plist`
- `Sources/BrainCore/` (testbare Logik): `AppPfade.swift`, `AppLog.swift`, `NodeLaufzeit.swift`, `ProzessLauf.swift`, `BrainBefehl.swift`, `BrainStatus.swift`, `TerminalNode.swift`, `AppEinstellungen.swift`, `VaultAuswahl.swift`, `StartArgumente.swift`, `BrueckenVerbindung.swift`, `NavigationsRegel.swift`, `SchemaAntwort.swift`
- `Sources/BrainApp/` (dünne Oberfläche): `BrainApp.swift`, `AppZustand.swift`, `MenueInhalt.swift`, `EinrichtungsAnsicht.swift`, `FensterSteuerung.swift`
- `Tests/BrainCoreTests/` — je Datei ein Test
- `scripts/node-version.txt`, `scripts/hole-node.sh`, `scripts/test-hole-node.sh`, `scripts/baue-app.sh`, `scripts/rauchtest.sh`, `scripts/messe-speicher.sh`
- `docs/messungen/` — Messprotokolle

---

### Task 1: Kit — transportunabhängiger Kern der Ansicht

**Files:**
- Modify: `.tools/ansicht/dienst-lib.mjs` (Funktion `behandle`, ab `export async function behandle`)
- Create: `.tools/ansicht/handler.mjs`
- Modify: `.tools/ansicht/dienst.mjs` (Zeilen von `// ---- Handler:` bis zum Ende des `const handler = { … };`-Blocks)
- Test: Create `.tools/tests/test-ansicht-bruecke.mjs`

**Interfaces:**
- Produces: `behandleIntern(anfrage, kontext) → Promise<{ status, headers, body: Buffer, stopp? }>` mit `anfrage = { methode, pfad, query, headers, body }` und `kontext = { vault, handler, ansichtDir, vaultId?, version? }` — gleiches Routing wie `behandle`, aber **ohne** Host-/Herkunft-/Token-Prüfung.
- Produces: `erzeugeHandler() → { daten, einstellungenLesen, einstellungenSchreiben, analyse, vorschlaegeListe, vorschlagEntscheiden, gelesen, pflege, konfliktEntscheiden, pflegeLauf }` — jede Instanz mit eigenem Daten- und Modul-Cache.

- [ ] **Step 1: Worktree anlegen und Ausgangslage prüfen**

```bash
git -C ~/brain worktree add ~/brain-kit-v0.6 -b kit-v0.6
cd ~/brain-kit-v0.6 && bash .tools/tests/run-all.sh 2>&1 | tail -5
```
Expected: alle Tests grün (letzte Zeilen ohne `FAIL`, Exit 0). Ist schon hier etwas rot: STOPP, dem Auftraggeber melden — nicht weiterbauen.

- [ ] **Step 2: Failing test schreiben** — `.tools/tests/test-ansicht-bruecke.mjs`

```js
// Ansicht für die Brain-App: transportunabhängiger Kern (behandleIntern, erzeugeHandler) und die
// stdin/stdout-Brücke (bruecke.mjs). Kernrisiko: dieselben Routen wie der HTTP-Dienst, aber kein Port.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { behandle, behandleIntern } from "../ansicht/dienst-lib.mjs";
import { erzeugeHandler } from "../ansicht/handler.mjs";

const VAULT = mkdtempSync(join(tmpdir(), "bruecke-kern-"));
const ANSICHT = join(VAULT, "ansicht");
mkdirSync(ANSICHT, { recursive: true });
writeFileSync(join(ANSICHT, "index.html"), "<!doctype html><title>Brain</title>");
writeFileSync(join(ANSICHT, "data.js"), "window.BRAIN_DATA = {\"geheim\":1};");
process.on("exit", () => rmSync(VAULT, { recursive: true, force: true }));

const kontext = (handler = {}) => ({ vault: VAULT, handler, ansichtDir: ANSICHT, vaultId: "abc", version: "9.9.9" });

test("behandleIntern: liefert die Startseite ohne Host und ohne Token", async () => {
  const r = await behandleIntern({ methode: "GET", pfad: "/", headers: {} }, kontext());
  assert.equal(r.status, 200);
  assert.match(r.body.toString("utf8"), /<title>Brain<\/title>/);
});

test("behandleIntern: data.js bleibt gesperrt", async () => {
  const r = await behandleIntern({ methode: "GET", pfad: "/data.js", headers: {} }, kontext());
  assert.equal(r.status, 404);
});

test("behandleIntern: /api/ping ohne Token", async () => {
  const r = await behandleIntern({ methode: "GET", pfad: "/api/ping", headers: {} }, kontext());
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body.toString("utf8")), { vaultId: "abc", version: "9.9.9" });
});

test("behandleIntern: zu großer Körper → 413", async () => {
  const r = await behandleIntern({ methode: "PUT", pfad: "/api/einstellungen", headers: {}, body: Buffer.alloc(64 * 1024 + 1) }, kontext());
  assert.equal(r.status, 413);
});

test("behandle (HTTP): ohne passenden Host weiterhin 403", async () => {
  const r = await behandle({ methode: "GET", pfad: "/", headers: {} }, { ...kontext(), port: 4242, token: "x".repeat(32) });
  assert.equal(r.status, 403);
});

test("erzeugeHandler: liefert alle Handler, die das Routing braucht", () => {
  const h = erzeugeHandler();
  for (const k of ["daten", "einstellungenLesen", "einstellungenSchreiben", "analyse", "vorschlaegeListe",
    "vorschlagEntscheiden", "gelesen", "pflege", "konfliktEntscheiden", "pflegeLauf"]) {
    assert.equal(typeof h[k], "function", k);
  }
});

test("erzeugeHandler: zwei Instanzen sind unabhängig", () => {
  assert.notEqual(erzeugeHandler(), erzeugeHandler());
});
```

- [ ] **Step 3: Test laufen lassen — muss scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-ansicht-bruecke.mjs`
Expected: FAIL — `behandleIntern` bzw. `../ansicht/handler.mjs` existiert nicht.

- [ ] **Step 4: `behandle` aufteilen** — in `.tools/ansicht/dienst-lib.mjs` die bisherige Funktion `behandle` durch diese zwei Funktionen ersetzen. `behandleIntern` beginnt mit den vier Konstanten und enthält danach **unverändert** alle bisherigen Zeilen von `if (anfrage.body && anfrage.body.length > MAX_KOERPER) …` bis zum abschließenden `return antwort(404, { fehler: "nicht gefunden" });`:

```js
// anfrage = { methode, pfad, query, headers, body }, kontext = { vault, token, port, handler, ansichtDir?, version?, vaultId? }
// → { status, headers, body, stopp? }  (stopp: true → der Aufrufer beendet den Dienst nach dem Senden)
export async function behandle(anfrage, kontext) {
  const headers = anfrage.headers || {};
  const pfad = String(anfrage.pfad || "");
  const istApi = pfad.startsWith("/api/");
  const methode = String(anfrage.methode || "GET").toUpperCase();

  const host = `127.0.0.1:${kontext.port}`;
  if (headers.host !== host) return antwort(403, { fehler: "falscher Host" }, istApi);
  const sfs = headers["sec-fetch-site"];
  if (sfs && sfs !== "same-origin" && sfs !== "none") return antwort(403, { fehler: "fremde Herkunft" }, istApi);
  if (istApi) {
    if (!tokenOk(headers["x-brain-token"], kontext.token)) return antwort(403, { fehler: "Token fehlt" });
    if (methode !== "GET" && headers.origin !== `http://${host}`) return antwort(403, { fehler: "fremde Herkunft" });
  }
  return behandleIntern(anfrage, kontext);
}

// Routing OHNE Transport-Prüfungen (Host, Herkunft, Token). Nur für Transporte, die selbst garantieren, dass
// ausschließlich die eigene Oberfläche anfragen kann: die Ansicht-Brücke der App (stdin/stdout, kein Port).
// Nie hinter einen Socket hängen — dafür gibt es behandle().
export async function behandleIntern(anfrage, kontext) {
  const headers = anfrage.headers || {};
  const pfad = String(anfrage.pfad || "");
  const istApi = pfad.startsWith("/api/");
  const methode = String(anfrage.methode || "GET").toUpperCase();
  if (anfrage.body && anfrage.body.length > MAX_KOERPER) return antwort(413, { fehler: "Anfrage zu groß" }, istApi);
  // … ab hier unverändert die bisherigen Zeilen aus behandle (if (!istApi) { … } bis return antwort(404, …)) …
}
```

- [ ] **Step 5: `handler.mjs` anlegen** — `.tools/ansicht/handler.mjs`. Inhalt: Kopfzeilen unten, danach **verschoben (nicht kopiert)** aus `dienst.mjs` die Blöcke `modulCache`/`nichtVerfuegbar`/`ladeModul`/`exportVon`, `datenCache`/`daten`/`ausDataJs`, `claudeGefunden` und `const handler = { … };` — alles eingerückt in die Fabrik:

```js
// .tools/ansicht/handler.mjs — die Daten-Handler der Ansicht, transportunabhängig. dienst.mjs (HTTP) und
// bruecke.mjs (Brain-App, stdin/stdout) erzeugen sich je eine eigene Instanz mit eigenem Daten-/Modul-Cache.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HIER = dirname(fileURLToPath(import.meta.url));
const DATEN_TTL_MS = 10 * 1000;

export function erzeugeHandler() {
  // ---- hierher verschoben aus dienst.mjs: modulCache, nichtVerfuegbar, ladeModul, exportVon,
  //      datenCache, daten, ausDataJs, claudeGefunden und das Objekt `handler` (unverändert) ----
  return handler;
}
```
In `dienst.mjs` danach: die verschobenen Blöcke und die Konstante `DATEN_TTL_MS` entfernen, oben `import { erzeugeHandler } from "./handler.mjs";` ergänzen und an der Stelle des alten Objekts `const handler = erzeugeHandler();` schreiben. `readFileSync` und `pathToFileURL` bleiben in `dienst.mjs` importiert (werden von `beende`/`andererLaeuft` weiter gebraucht).

- [ ] **Step 6: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-ansicht-bruecke.mjs .tools/tests/test-dienst-lib.mjs && bash .tools/tests/test-dienst.sh`
Expected: alle PASS, `test-dienst.sh` endet mit Exit 0.

- [ ] **Step 7: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/ansicht/dienst-lib.mjs .tools/ansicht/handler.mjs .tools/ansicht/dienst.mjs .tools/tests/test-ansicht-bruecke.mjs
git commit -m "kit: Ansicht-Kern transportunabhängig (behandleIntern, erzeugeHandler)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Kit — Ansicht-Brücke über stdin/stdout

**Files:**
- Create: `.tools/ansicht/bruecke.mjs`
- Test: Modify `.tools/tests/test-ansicht-bruecke.mjs` (Tests anhängen)

**Interfaces:**
- Consumes: `behandleIntern`, `vaultIdVon`, `MAX_KOERPER` (dienst-lib.mjs), `erzeugeHandler` (Task 1).
- Produces: Prozess `node .tools/ansicht/bruecke.mjs <vault>`; Protokoll je Zeile ein JSON-Objekt (UTF-8, `\n`):
  - Start (einmal, zuerst): `{"bereit":true,"version":"<kit-version>","vaultId":"<16 hex>"}`
  - Anfrage (App → Brücke): `{"id":<int>,"methode":"GET","pfad":"/api/gelesen?seit=1","query":null,"body":"<base64>"|null}` — `pfad` darf eine Query enthalten; sie wird abgetrennt, falls `query` fehlt.
  - Antwort (Brücke → App): `{"id":<int>|null,"status":<int>,"headers":{"Content-Type":"…",…},"body":"<base64>"}` — `id: null` nur bei unlesbaren Zeilen.
  - Ende: stdin geschlossen, SIGTERM/SIGINT oder `POST /api/stopp`; ausstehende Ausgaben werden vorher geschrieben, Exit-Code 0.

- [ ] **Step 1: Failing tests anhängen** — ans Ende von `.tools/tests/test-ansicht-bruecke.mjs`:

```js
// ------------------------------------------------------------------------------- bruecke.mjs (Prozess)
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { cpSync, statSync } from "node:fs";
import { dirname as dn } from "node:path";
import { fileURLToPath } from "node:url";

const KIT_ANSICHT = join(dn(fileURLToPath(import.meta.url)), "..", "ansicht");
const FIXTURE = join(dn(fileURLToPath(import.meta.url)), "fixture");

function testVault(name = "Test Brän") {
  const basis = mkdtempSync(join(tmpdir(), "bruecke-"));
  const v = join(basis, name);
  cpSync(FIXTURE, v, { recursive: true });
  process.on("exit", () => rmSync(basis, { recursive: true, force: true }));
  return v;
}

function starte(vault) {
  const p = spawn(process.execPath, [join(KIT_ANSICHT, "bruecke.mjs"), vault], { stdio: ["pipe", "pipe", "inherit"] });
  const rl = createInterface({ input: p.stdout });
  const warten = new Map();
  const ohneId = [];
  let bereitOk;
  const bereit = new Promise((ok) => { bereitOk = ok; });
  rl.on("line", (zeile) => {
    const o = JSON.parse(zeile);
    if (o.bereit) return bereitOk(o);
    if (o.id === null) { const w = ohneId.shift(); if (w) w(o); return; }
    const w = warten.get(o.id); if (w) { warten.delete(o.id); w(o); }
  });
  let n = 0;
  const frage = (a) => new Promise((ok) => { const id = ++n; warten.set(id, ok); p.stdin.write(JSON.stringify({ id, ...a }) + "\n"); });
  const roh = (zeile) => new Promise((ok) => { ohneId.push(ok); p.stdin.write(zeile + "\n"); });
  const ende = new Promise((ok) => p.on("exit", (code) => ok(code)));
  return { p, bereit, frage, roh, ende };
}
const text = (a) => Buffer.from(a.body, "base64").toString("utf8");

test("brücke: meldet sich mit version und vaultId (Pfad mit Leerzeichen und Umlaut)", async () => {
  const b = starte(testVault("Mein Brän"));
  const o = await b.bereit;
  assert.match(o.version, /^\d+\.\d+\.\d+/);
  assert.match(o.vaultId, /^[0-9a-f]{16}$/);
  const ping = await b.frage({ methode: "GET", pfad: "/api/ping" });
  assert.equal(ping.status, 200);
  assert.equal(JSON.parse(text(ping)).vaultId, o.vaultId);
  b.p.stdin.end();
  assert.equal(await b.ende, 0);
});

test("brücke: Startseite, data.js gesperrt, Daten als JSON, Query im Pfad", async () => {
  const b = starte(testVault());
  await b.bereit;
  const start = await b.frage({ methode: "GET", pfad: "/" });
  assert.equal(start.status, 200);
  assert.match(text(start), /<script src="api\.js"><\/script>/);
  assert.equal((await b.frage({ methode: "GET", pfad: "/data.js" })).status, 404);
  const daten = await b.frage({ methode: "GET", pfad: "/api/daten" });
  assert.equal(daten.status, 200);
  assert.ok(Array.isArray(JSON.parse(text(daten)).nodes));
  const gelesen = await b.frage({ methode: "GET", pfad: "/api/gelesen?seit=1" });
  assert.notEqual(gelesen.status, 404);
  b.p.stdin.end();
  assert.equal(await b.ende, 0);
});

test("brücke: große Datei kommt vollständig an", async () => {
  const b = starte(testVault());
  await b.bereit;
  const r = await b.frage({ methode: "GET", pfad: "/vendor/three.bundle.js" });
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(r.body, "base64").length, statSync(join(KIT_ANSICHT, "vendor", "three.bundle.js")).size);
  b.p.stdin.end();
  await b.ende;
});

test("brücke: viele gleichzeitige Anfragen werden über die id richtig zugeordnet", async () => {
  const b = starte(testVault());
  await b.bereit;
  const antworten = await Promise.all(Array.from({ length: 20 }, () => b.frage({ methode: "GET", pfad: "/api/ping" })));
  assert.ok(antworten.every((a) => a.status === 200));
  b.p.stdin.end();
  await b.ende;
});

test("brücke: unlesbare Zeile → 400 mit id null, Brücke läuft weiter", async () => {
  const b = starte(testVault());
  await b.bereit;
  const f = await b.roh("das ist kein json");
  assert.equal(f.status, 400);
  assert.equal((await b.frage({ methode: "GET", pfad: "/api/ping" })).status, 200);
  b.p.stdin.end();
  await b.ende;
});

test("brücke: POST /api/stopp beendet nach der Antwort mit Exit 0", async () => {
  const b = starte(testVault());
  await b.bereit;
  const r = await b.frage({ methode: "POST", pfad: "/api/stopp", body: Buffer.from("{}").toString("base64") });
  assert.equal(r.status, 200);
  assert.equal(await b.ende, 0);
});
```

- [ ] **Step 2: Tests laufen lassen — müssen scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-ansicht-bruecke.mjs`
Expected: die neuen „brücke:“-Tests FAIL (Datei `bruecke.mjs` fehlt), die Task-1-Tests PASS.

- [ ] **Step 3: `bruecke.mjs` schreiben** — `.tools/ansicht/bruecke.mjs`:

```js
#!/usr/bin/env node
// .tools/ansicht/bruecke.mjs — Ansicht-Brücke für die Brain-App (App-Spec §5.2, Baustein 4): dieselben Routen wie
// der HTTP-Dienst (dienst-lib.mjs#behandleIntern), aber über stdin/stdout statt über einen Port. Nur die App, die
// diesen Prozess startet, kann mit ihm reden — darum entfallen hier Host-, Herkunfts- und Token-Prüfung.
// Protokoll: je Zeile ein JSON-Objekt (UTF-8).
//   Start:   → {"bereit":true,"version":"<kit-version>","vaultId":"<id>"}
//   Anfrage: ← {"id":<zahl>,"methode":"GET","pfad":"/api/daten","query":"seit=1"|null,"body":"<base64>"|null}
//   Antwort: → {"id":<zahl>|null,"status":200,"headers":{…},"body":"<base64>"}
// Ende: stdin geschlossen, SIGTERM/SIGINT oder POST /api/stopp — immer erst nach dem Schreiben aller Antworten.
import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { behandleIntern, vaultIdVon, MAX_KOERPER } from "./dienst-lib.mjs";
import { erzeugeHandler } from "./handler.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
const vault = process.argv[2] || process.env.BRAIN_VAULT || join(HIER, "..", "..");
// base64 (×4/3) + JSON-Hülle: größere Anfragezeilen sind nie gültig und werden mit 413 abgewiesen
const MAX_ZEILE = 2 * MAX_KOERPER + 4096;
const handler = erzeugeHandler();
const vaultId = vaultIdVon(vault);
const version = (() => { try { return readFileSync(join(HIER, "..", "VERSION"), "utf8").trim(); } catch { return "?"; } })();
const JSON_TYP = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

process.stdout.on("error", () => process.exit(0)); // App weg → still beenden

const sende = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
const fehlerAntwort = (id, status, meldung) =>
  ({ id, status, headers: JSON_TYP, body: Buffer.from(JSON.stringify({ fehler: meldung })).toString("base64") });

let offen = 0, stdinZu = false, beendet = false;
function beende() {
  if (beendet) return;
  beendet = true;
  process.stdout.write("", () => process.exit(0)); // Callback erst, wenn alles Vorherige geschrieben ist
}
const vielleichtEnde = () => { if (stdinZu && offen === 0) beende(); };

async function bearbeite(zeile) {
  if (zeile.length > MAX_ZEILE) return void sende(fehlerAntwort(null, 413, "Anfrage zu groß"));
  let a;
  try { a = JSON.parse(zeile); } catch { return void sende(fehlerAntwort(null, 400, "ungültige Anfrage")); }
  const id = Number.isInteger(a?.id) ? a.id : null;
  if (id === null || typeof a.pfad !== "string" || !a.pfad.startsWith("/")) return void sende(fehlerAntwort(id, 400, "ungültige Anfrage"));
  let pfad = a.pfad;
  let query = typeof a.query === "string" ? a.query : "";
  const q = pfad.indexOf("?");
  if (q >= 0) { if (!query) query = pfad.slice(q + 1); pfad = pfad.slice(0, q); }
  const body = typeof a.body === "string" && a.body.length ? Buffer.from(a.body, "base64") : undefined;
  let r;
  try {
    r = await behandleIntern({ methode: a.methode || "GET", pfad, query: new URLSearchParams(query), headers: {}, body },
      { vault, handler, ansichtDir: HIER, vaultId, version });
  } catch {
    r = { status: 500, headers: JSON_TYP, body: Buffer.from('{"fehler":"Interner Fehler"}') };
  }
  sende({ id, status: r.status, headers: r.headers || {}, body: (r.body || Buffer.alloc(0)).toString("base64") });
  if (r.stopp) beende();
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (zeile) => {
  if (beendet || !zeile.trim()) return;
  offen++;
  bearbeite(zeile).finally(() => { offen--; vielleichtEnde(); });
});
rl.on("close", () => { stdinZu = true; vielleichtEnde(); });
process.on("SIGTERM", beende);
process.on("SIGINT", beende);
sende({ bereit: true, version, vaultId });
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-ansicht-bruecke.mjs`
Expected: alle PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/ansicht/bruecke.mjs .tools/tests/test-ansicht-bruecke.mjs
git commit -m "kit: Ansicht-Brücke über stdin/stdout für die Brain-App (kein Port)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Kit — App-Modus in `ansicht/api.js`

**Files:**
- Modify: `.tools/ansicht/api.js` (nach der Zeile `const verfuegbar = …`, in `holeJson` und `sende`)
- Test: Modify `.tools/tests/test-ansicht-steuer.mjs` (Tests im Abschnitt `api.js` anhängen)

**Interfaces:**
- Consumes: im App-Fenster `window.location.protocol === "brain:"` und `window.webkit.messageHandlers.brain.postMessage(nachricht) → Promise<{ status: number, body: string }>` (Task 13 liefert das).
- Produces: Nachricht an die App: `{ methode: "GET"|"POST"|"PUT", pfad: "/api/…[?query]", daten: <Objekt>|null }`. `window.BrainApi` behält seine Form `{ verfuegbar, holeJson, sende, token }`; im App-Modus ist `verfuegbar === true` ohne Zugangsschlüssel. `app.js` bleibt unverändert.

- [ ] **Step 1: Failing tests anhängen** — in `.tools/tests/test-ansicht-steuer.mjs` direkt nach den bestehenden `api:`-Tests:

```js
// App-Modus (brain://, WKWebView): kein fetch, kein Zugang — alles über den Nachrichtenkanal der App.
function brueckenFenster({ antworten = [], mitKanal = true } = {}) {
  const nachrichten = [];
  const win = {
    location: { protocol: "brain:", hash: "", pathname: "/index.html", search: "" },
    history: { replaceState() {} },
    sessionStorage: speicher(),
    document: { dispatchEvent() {} },
    CustomEvent: class { constructor(t) { this.type = t; } },
    fetch: async () => { throw new Error("fetch darf im App-Modus nicht benutzt werden"); },
  };
  if (mitKanal) {
    win.webkit = { messageHandlers: { brain: { postMessage: async (m) => {
      nachrichten.push(m);
      const a = antworten.shift();
      if (a instanceof Error) throw a;
      return a || { status: 200, body: "{\"ok\":true}" };
    } } } };
  }
  return { win, nachrichten };
}

test("api: App-Modus → verfügbar ohne Zugang, GET geht über den Kanal", async () => {
  const f = brueckenFenster({ antworten: [{ status: 200, body: "{\"nodes\":[]}" }] });
  const { BrainApi } = ladeIn(f.win, "api.js");
  assert.equal(BrainApi.verfuegbar, true);
  assert.deepEqual(await BrainApi.holeJson("/api/daten"), { nodes: [] });
  assert.deepEqual(f.nachrichten, [{ methode: "GET", pfad: "/api/daten", daten: null }]);
});

test("api: App-Modus → sende schickt Methode und Daten", async () => {
  const f = brueckenFenster();
  const { BrainApi } = ladeIn(f.win, "api.js");
  await BrainApi.sende("put", "/api/einstellungen", { werte: { ichKarte: true } });
  assert.deepEqual(f.nachrichten, [{ methode: "PUT", pfad: "/api/einstellungen", daten: { werte: { ichKarte: true } } }]);
});

test("api: App-Modus → Fehlerstatus wirft mit der Meldung der Brücke", async () => {
  const f = brueckenFenster({ antworten: [{ status: 409, body: "{\"fehler\":\"läuft schon\"}" }] });
  const { BrainApi } = ladeIn(f.win, "api.js");
  await assert.rejects(BrainApi.sende("POST", "/api/pflege/lauf"), (e) => e.message === "läuft schon" && e.status === 409);
});

test("api: App-Modus → Kanal kaputt → „Dienst nicht erreichbar“", async () => {
  const f = brueckenFenster({ antworten: [new Error("weg")] });
  const { BrainApi } = ladeIn(f.win, "api.js");
  await assert.rejects(BrainApi.holeJson("/api/ping"), (e) => e.message === "Dienst nicht erreichbar" && e.status === 0);
});

test("api: brain: ohne Nachrichtenkanal → nicht verfügbar", () => {
  const f = brueckenFenster({ mitKanal: false });
  const { BrainApi } = ladeIn(f.win, "api.js");
  assert.equal(BrainApi.verfuegbar, false);
});
```

- [ ] **Step 2: Tests laufen lassen — müssen scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-ansicht-steuer.mjs`
Expected: die fünf neuen „App-Modus“-Tests FAIL (z. B. `verfuegbar` ist `false`), alle bisherigen PASS.

- [ ] **Step 3: App-Modus einbauen** — in `.tools/ansicht/api.js`:

(a) Die Zeile `const verfuegbar = !!(root.location && root.location.protocol === "http:" && zugang);` ersetzen durch:

```js
  // App-Modus (Brain-App, WKWebView unter brain://): Anfragen gehen über den Nachrichtenkanal der App an die
  // Ansicht-Brücke — kein Port, kein Zugangsschlüssel. Nur aktiv, wenn beides da ist: Schema und Kanal.
  const kanal = root.location && root.location.protocol === "brain:" && root.webkit && root.webkit.messageHandlers
    && root.webkit.messageHandlers.brain && typeof root.webkit.messageHandlers.brain.postMessage === "function"
    ? root.webkit.messageHandlers.brain : null;
  const verfuegbar = !!kanal || !!(root.location && root.location.protocol === "http:" && zugang);
```

(b) Direkt vor `async function holeJson(pfad) {` einfügen:

```js
  // Antwort der App: { status, body } mit body = JSON-Text (wie die HTTP-Antwort des Dienstes).
  async function ueberKanal(methode, pfad, daten) {
    let r;
    try { r = await kanal.postMessage({ methode: methode, pfad: pfad, daten: daten === undefined ? null : daten }); }
    catch (e) { throw fehler("Dienst nicht erreichbar", 0); }
    const status = r && typeof r.status === "number" ? r.status : 0;
    let wert = null;
    try { wert = r && typeof r.body === "string" ? JSON.parse(r.body) : null; } catch (e) { wert = null; }
    if (status < 200 || status >= 300) {
      const meldung = wert && typeof wert.fehler === "string" ? wert.fehler : (status ? "HTTP " + status : "Dienst nicht erreichbar");
      throw fehler(meldung, status, wert);
    }
    if (wert === null) throw fehler("Antwort ist kein JSON", status);
    return wert;
  }
```

(c) Erste Zeile in `holeJson` (vor `if (!verfuegbar) …`): `if (kanal) return ueberKanal("GET", pfad);`

(d) Erste Zeile in `sende` (vor `if (!verfuegbar) …`): `if (kanal) return ueberKanal(String(methode || "POST").toUpperCase(), pfad, daten === undefined ? {} : daten);`

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-ansicht-steuer.mjs .tools/tests/test-ansicht-app.mjs`
Expected: alle PASS (auch die bisherigen http-/file-Tests).

- [ ] **Step 5: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/ansicht/api.js .tools/tests/test-ansicht-steuer.mjs
git commit -m "kit: api.js mit App-Modus (brain:// + Nachrichtenkanal statt fetch)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Kit — `brain status [--json]`

**Files:**
- Create: `.tools/status.mjs`
- Modify: `.tools/brain.mjs` (Kopfkommentar „Befehle:“ und das Objekt `befehle`)
- Test: Create `.tools/tests/test-status.mjs`

**Interfaces:**
- Consumes: `configFehler`, `istQuellVault` (pfade.mjs), `aktuellerBericht` (pflege.mjs → `{ posten: [{ schluessel, anzahl }], zuTun }`), `anzahlVorschlaege` (vorschlaege.mjs).
- Produces: `brainStatus(vault) → Promise<{ version: string, quellVault: boolean, zustand: "ok"|"hinweis"|"problem", meldungen: string[], zahlen: { vorschlaege, konflikte, abgelaufen, zuTun } }>`; `bewerte({ fehler: boolean, berichtFehlt: boolean, zuTun: number, vorschlaege: number }) → "ok"|"hinweis"|"problem"`; `statusText(s) → string`. CLI: `brain status --json` schreibt genau **eine** JSON-Zeile auf stdout, Exit 0.

- [ ] **Step 1: Failing test schreiben** — `.tools/tests/test-status.mjs`:

```js
// brain status: Gesamtzustand für die Menüleiste der App — rein lesend, 0 Tokens.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { brainStatus, bewerte, statusText } from "../status.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
function vault({ mitWerkzeug = true } = {}) {
  const v = mkdtempSync(join(tmpdir(), "status-"));
  cpSync(join(HIER, "fixture"), v, { recursive: true });
  if (mitWerkzeug) { mkdirSync(join(v, ".tools"), { recursive: true }); writeFileSync(join(v, ".tools", "brain.mjs"), "// stub\n"); }
  process.on("exit", () => rmSync(v, { recursive: true, force: true }));
  return v;
}

test("bewerte: Fehler schlägt alles, Arbeit ergibt Hinweis, sonst ok", () => {
  assert.equal(bewerte({ fehler: true, berichtFehlt: false, zuTun: 0, vorschlaege: 0 }), "problem");
  assert.equal(bewerte({ fehler: false, berichtFehlt: false, zuTun: 2, vorschlaege: 0 }), "hinweis");
  assert.equal(bewerte({ fehler: false, berichtFehlt: false, zuTun: 0, vorschlaege: 1 }), "hinweis");
  assert.equal(bewerte({ fehler: false, berichtFehlt: true, zuTun: 0, vorschlaege: 0 }), "hinweis");
  assert.equal(bewerte({ fehler: false, berichtFehlt: false, zuTun: 0, vorschlaege: 0 }), "ok");
});

test("brainStatus: Form stimmt für ein normales Brain", async () => {
  const s = await brainStatus(vault());
  assert.match(s.version, /^\d+\.\d+\.\d+/);
  assert.equal(s.quellVault, false);
  assert.ok(["ok", "hinweis"].includes(s.zustand), s.zustand);
  for (const k of ["vorschlaege", "konflikte", "abgelaufen", "zuTun"]) assert.equal(typeof s.zahlen[k], "number", k);
  assert.ok(Array.isArray(s.meldungen));
});

test("brainStatus: beschädigte brain.config.json → problem mit Alltags-Meldung", async () => {
  const v = vault();
  writeFileSync(join(v, "brain.config.json"), "{ kaputt");
  const s = await brainStatus(v);
  assert.equal(s.zustand, "problem");
  assert.ok(s.meldungen.some((m) => m.includes("beschädigt")));
});

test("brainStatus: Ordner ohne Werkzeuge → problem", async () => {
  const s = await brainStatus(vault({ mitWerkzeug: false }));
  assert.equal(s.zustand, "problem");
  assert.ok(s.meldungen.some((m) => m.includes("kein Brain-Ordner")));
});

test("brainStatus: Quell-Vault wird erkannt", async () => {
  const v = vault();
  mkdirSync(join(v, ".tools", "kit"), { recursive: true });
  writeFileSync(join(v, ".tools", "kit", "export.mjs"), "// stub\n");
  assert.equal((await brainStatus(v)).quellVault, true);
});

test("statusText: Symbol und Zahlen", () => {
  const t = statusText({ version: "0.6.0", quellVault: true, zustand: "hinweis", meldungen: ["X"], zahlen: { vorschlaege: 2, konflikte: 1, abgelaufen: 0, zuTun: 3 } });
  assert.match(t, /^⚠ Brain 0\.6\.0 \(Entwickler-Brain\)/);
  assert.match(t, /Vorschläge: 2 · Konflikte: 1 · abgelaufen: 0 · zu tun: 3/);
});

test("CLI: brain status --json → genau eine JSON-Zeile, Exit 0", () => {
  const v = vault();
  const r = spawnSync(process.execPath, [join(HIER, "..", "brain.mjs"), "status", "--json"], { encoding: "utf8", env: { ...process.env, BRAIN_VAULT: v } });
  assert.equal(r.status, 0, r.stderr);
  const zeilen = r.stdout.trim().split("\n");
  assert.equal(zeilen.length, 1);
  assert.ok(["ok", "hinweis", "problem"].includes(JSON.parse(zeilen[0]).zustand));
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-status.mjs`
Expected: FAIL — `../status.mjs` nicht gefunden.

- [ ] **Step 3: `status.mjs` schreiben** — `.tools/status.mjs`:

```js
// .tools/status.mjs — „brain status [--json]“: Gesamtzustand in einem Blick, für die Menüleiste der Brain-App
// (App-Spec §5.3/§10) und für Menschen. Rein lesend, 0 Tokens. Zustand: problem (✕) > hinweis (⚠) > ok (✓).
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { configFehler, istQuellVault } from "./pfade.mjs";
import { aktuellerBericht } from "./pflege.mjs";
import { anzahlVorschlaege } from "./vorschlaege.mjs";

const T = dirname(fileURLToPath(import.meta.url));
const SYMBOL = { ok: "✓", hinweis: "⚠", problem: "✕" };

export function bewerte({ fehler, berichtFehlt, zuTun, vorschlaege }) {
  if (fehler) return "problem";
  if (berichtFehlt || zuTun > 0 || vorschlaege > 0) return "hinweis";
  return "ok";
}

export async function brainStatus(vault, { jetzt = Date.now() } = {}) {
  const meldungen = [];
  let fehler = false, berichtFehlt = false;
  const version = (() => { try { return readFileSync(join(T, "VERSION"), "utf8").trim(); } catch { return "?"; } })();
  if (!existsSync(join(vault, ".tools", "brain.mjs"))) {
    fehler = true;
    meldungen.push("Das ist kein Brain-Ordner — die Brain-Werkzeuge fehlen.");
  }
  if (configFehler(vault)) {
    fehler = true;
    meldungen.push("Die Einstellungsdatei brain.config.json ist beschädigt — sag „repariere meine Brain-Einstellungen“.");
  }
  let vorschlaege = 0, konflikte = 0, abgelaufen = 0, zuTun = 0;
  try { vorschlaege = anzahlVorschlaege(vault); } catch { /* ohne Vorschlagsordner: 0 */ }
  try {
    const b = await aktuellerBericht(vault, { jetzt });
    const zahl = (s) => b.posten.find((p) => p.schluessel === s)?.anzahl ?? 0;
    konflikte = zahl("konflikte");
    abgelaufen = zahl("abgelaufen");
    zuTun = b.zuTun ?? 0;
  } catch {
    berichtFehlt = true;
    meldungen.push("Der Pflegebericht konnte gerade nicht erstellt werden.");
  }
  return {
    version, quellVault: istQuellVault(vault),
    zustand: bewerte({ fehler, berichtFehlt, zuTun, vorschlaege }),
    meldungen, zahlen: { vorschlaege, konflikte, abgelaufen, zuTun },
  };
}

export function statusText(s) {
  const z = s.zahlen;
  return [
    `${SYMBOL[s.zustand] || "?"} Brain ${s.version}${s.quellVault ? " (Entwickler-Brain)" : ""}`,
    `Vorschläge: ${z.vorschlaege} · Konflikte: ${z.konflikte} · abgelaufen: ${z.abgelaufen} · zu tun: ${z.zuTun}`,
    ...s.meldungen,
  ].join("\n");
}
```

- [ ] **Step 4: Befehl registrieren** — in `.tools/brain.mjs`:
  - Kopfkommentar: in der Zeile `// Befehle: index | search … | messlatte` am Ende ` | status [--json]` ergänzen.
  - Im Objekt `befehle` direkt nach dem Eintrag `doctor: () => node("doctor.mjs", vault),` einfügen:

```js
  // Gesamtzustand (✓/⚠/✕) — für Menschen als Text, für die Brain-App als genau eine JSON-Zeile (--json).
  status: async (...a) => {
    const { brainStatus, statusText } = await import("./status.mjs");
    const s = await brainStatus(vault);
    console.log(a.includes("--json") ? JSON.stringify(s) : statusText(s));
    return 0;
  },
```

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-status.mjs && bash .tools/tests/test-cli.sh`
Expected: alle PASS, `test-cli.sh` Exit 0.

- [ ] **Step 6: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/status.mjs .tools/brain.mjs .tools/tests/test-status.mjs
git commit -m "kit: brain status [--json] — Gesamtzustand für Menschen und die Brain-App

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Kit — `BRAIN_NODE` für gerenderte Node-Pfade

Zweck: Läuft Kit-Code mit dem Node der App (z. B. die Brücke rendert `AGENTS.md` neu, wenn die Ich-Karte umgeschaltet wird), darf dort nicht plötzlich der versionierte App-Pfad landen. Die App gibt über `BRAIN_NODE` vor, welches Node das Terminal benutzt.

**Files:**
- Modify: `.tools/pfade.mjs` (Funktion `nodePfad`)
- Test: Modify `.tools/tests/test-pfade.mjs` (Tests anhängen)

**Interfaces:**
- Produces: `nodePfad({ env = process.env } = {}) → string` — liefert `env.BRAIN_NODE`, wenn es ein absoluter, existierender Pfad ist; sonst unverändert die bisherige Logik. `nodeBefehl()` bleibt gleich (nutzt `nodePfad()` mit Standard-Umgebung).

- [ ] **Step 1: Failing tests anhängen** — ans Ende von `.tools/tests/test-pfade.mjs` (die Datei importiert `nodePfad` schon; falls `isAbsolute`/`realpathSync` dort fehlen, ergänzen):

```js
test("nodePfad: BRAIN_NODE (absolut, vorhanden) gewinnt", () => {
  assert.equal(nodePfad({ env: { BRAIN_NODE: process.execPath, PATH: "" } }), process.execPath);
});

test("nodePfad: BRAIN_NODE relativ oder nicht vorhanden → wird ignoriert", () => {
  for (const vorgabe of ["node", "/gibt/es/nicht/node"]) {
    const p = nodePfad({ env: { BRAIN_NODE: vorgabe, PATH: process.env.PATH } });
    assert.notEqual(p, vorgabe);
    assert.equal(realpathSync(p), realpathSync(process.execPath));
  }
});
```

- [ ] **Step 2: Test laufen lassen — muss scheitern**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-pfade.mjs`
Expected: „BRAIN_NODE … gewinnt“ FAIL (Funktion ignoriert das Argument).

- [ ] **Step 3: `nodePfad` erweitern** — in `.tools/pfade.mjs` die Funktion ersetzen:

```js
export function nodePfad({ env = process.env } = {}) {
  // Von außen vorgegeben (Brain-App: das Node, mit dem das Terminal die Hooks startet) — nur absolut und vorhanden.
  const vorgabe = env.BRAIN_NODE;
  if (typeof vorgabe === "string" && isAbsolute(vorgabe) && existsSync(vorgabe)) return vorgabe;
  const echt = (p) => { try { return realpathSync(p); } catch { return null; } };
  const ziel = echt(process.execPath);
  const namen = process.platform === "win32" ? ["node.exe"] : ["node"];
  for (const dir of String(env.PATH || "").split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    for (const n of namen) { const p = join(dir, n); if (ziel && existsSync(p) && echt(p) === ziel) return p; }
  }
  return process.execPath;
}
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `cd ~/brain-kit-v0.6 && node --test .tools/tests/test-pfade.mjs .tools/tests/test-skills.mjs .tools/tests/test-adapter-claude.mjs`
Expected: alle PASS.

- [ ] **Step 5: Gesamtsuite des Kits**

Run: `cd ~/brain-kit-v0.6 && bash .tools/tests/run-all.sh 2>&1 | tail -5`
Expected: Exit 0, kein `FAIL`.

- [ ] **Step 6: Commit**

```bash
cd ~/brain-kit-v0.6
git add .tools/pfade.mjs .tools/tests/test-pfade.mjs
git commit -m "kit: nodePfad beachtet BRAIN_NODE (gerenderte Pfade bleiben beim Terminal-Node)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: App — Paket-Gerüst, `AppPfade`, `AppLog`, Test-Hilfen

**Files:**
- Create: `Package.swift`, `.gitignore`, `Sources/BrainCore/AppPfade.swift`, `Sources/BrainCore/AppLog.swift`, `Sources/BrainApp/BrainApp.swift` (vorläufig), `Tests/BrainCoreTests/TestHilfe.swift`, `Tests/BrainCoreTests/AppPfadeTests.swift`, `Tests/BrainCoreTests/AppLogTests.swift`

**Interfaces:**
- Produces: `AppPfade(basis:)`, `AppPfade.standard(umgebung:)` (Umgebungsvariable `BRAIN_APP_SUPPORT` lenkt für Tests um), Eigenschaften `basis, konfiguration, nodeOrdner, binOrdner, node, logs`, Methode `legeAn() throws`.
- Produces: `AppLog(pfade:maxBytes:maxDateien:)`, `schreibe(_ zeile: String, zeit: Date = Date())` (wirft nie), Datei `<logs>/app.log`, rotiert nach `app.log.1 … app.log.<maxDateien-1>`.
- Produces (Tests): `tempOrdner(_ name: String? = nil) -> URL`, `skript(_ inhalt: String, name: String = "skript", in ordner: URL) -> URL` (schreibt Datei, `chmod 755`).

- [ ] **Step 1: Paket anlegen**

`Package.swift`:
```swift
// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "BrainApp",
    platforms: [.macOS("26.0")],
    targets: [
        .target(name: "BrainCore"),
        .executableTarget(name: "BrainApp", dependencies: ["BrainCore"]),
        .testTarget(name: "BrainCoreTests", dependencies: ["BrainCore"]),
    ],
    swiftLanguageModes: [.v5]
)
```

`.gitignore`:
```
.build/
build/
.swiftpm/
*.xcodeproj/
```

`Sources/BrainApp/BrainApp.swift` (wird in Task 14 ersetzt):
```swift
import SwiftUI

@main
struct BrainApp: App {
    var body: some Scene {
        MenuBarExtra("Brain", systemImage: "brain") {
            Button("Beenden") { NSApplication.shared.terminate(nil) }
        }
    }
}
```

`Tests/BrainCoreTests/TestHilfe.swift`:
```swift
import Foundation

/// Frischer, leerer Ordner unter dem temporären Verzeichnis (Name darf Leerzeichen/Umlaute enthalten).
func tempOrdner(_ name: String? = nil) -> URL {
    let basis = FileManager.default.temporaryDirectory.appendingPathComponent("braintest-\(UUID().uuidString)", isDirectory: true)
    let ordner = name.map { basis.appendingPathComponent($0, isDirectory: true) } ?? basis
    try! FileManager.default.createDirectory(at: ordner, withIntermediateDirectories: true)
    return ordner
}

/// Ausführbares Skript (z. B. ein falsches „node“) mit Inhalt anlegen.
@discardableResult
func skript(_ inhalt: String, name: String = "skript", in ordner: URL) -> URL {
    let url = ordner.appendingPathComponent(name)
    try! inhalt.write(to: url, atomically: true, encoding: .utf8)
    try! FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
    return url
}
```

- [ ] **Step 2: Failing tests schreiben**

`Tests/BrainCoreTests/AppPfadeTests.swift`:
```swift
import Testing
import Foundation
@testable import BrainCore

@Test func pfadeLiegenUnterDerBasisUndWerdenAngelegt() throws {
    let basis = tempOrdner("Application Support")
    let p = AppPfade(basis: basis)
    try p.legeAn()
    #expect(FileManager.default.fileExists(atPath: p.binOrdner.path))
    #expect(FileManager.default.fileExists(atPath: p.logs.path))
    #expect(p.node.path == basis.appendingPathComponent("bin/node").path)
    #expect(p.konfiguration.lastPathComponent == "config.json")
}

@Test func standardIstApplicationSupportBrain() {
    #expect(AppPfade.standard(umgebung: [:]).basis.path.hasSuffix("Library/Application Support/Brain"))
}

@Test func testUmgebungLenktUm() {
    #expect(AppPfade.standard(umgebung: ["BRAIN_APP_SUPPORT": "/tmp/x y"]).basis.path == "/tmp/x y")
    #expect(AppPfade.standard(umgebung: ["BRAIN_APP_SUPPORT": "relativ"]).basis.path.hasSuffix("Application Support/Brain"))
}
```

`Tests/BrainCoreTests/AppLogTests.swift`:
```swift
import Testing
import Foundation
@testable import BrainCore

@Test func schreibtZeilenMitZeitstempelUndOhneZeilenumbruch() throws {
    let p = AppPfade(basis: tempOrdner())
    let log = AppLog(pfade: p)
    log.schreibe("fenster-bereit\nzweite")
    let text = try String(contentsOf: p.logs.appendingPathComponent("app.log"), encoding: .utf8)
    #expect(text.hasSuffix("fenster-bereit zweite\n"))
    #expect(text.split(separator: "\n").count == 1)
}

@Test func rotiertUndBehaeltHoechstensMaxDateien() throws {
    let p = AppPfade(basis: tempOrdner())
    let log = AppLog(pfade: p, maxBytes: 100, maxDateien: 3)
    for i in 0..<40 { log.schreibe("zeile \(i) mit etwas Text") }
    let namen = try FileManager.default.contentsOfDirectory(atPath: p.logs.path).filter { $0.hasPrefix("app.log") }
    #expect(Set(namen).isSubset(of: ["app.log", "app.log.1", "app.log.2"]))
    #expect(namen.contains("app.log.1"))
}
```

- [ ] **Step 3: Tests laufen lassen — müssen scheitern**

Run: `cd ~/source/brain-app && swift test 2>&1 | tail -15`
Expected: Kompilierfehler „cannot find 'AppPfade' in scope“ bzw. „'AppLog'“.

- [ ] **Step 4: Implementieren**

`Sources/BrainCore/AppPfade.swift`:
```swift
import Foundation

/// Alle Orte der App unter ~/Library/Application Support/Brain (App-Spec §5.2/§5.3). Basis injizierbar für Tests.
public struct AppPfade: Sendable, Equatable {
    public let basis: URL

    public init(basis: URL) { self.basis = basis }

    /// `BRAIN_APP_SUPPORT` (nur absolute Pfade) lenkt für Tests und Rauchtests auf einen eigenen Ordner um.
    public static func standard(umgebung: [String: String] = ProcessInfo.processInfo.environment) -> AppPfade {
        if let test = umgebung["BRAIN_APP_SUPPORT"], test.hasPrefix("/") {
            return AppPfade(basis: URL(fileURLWithPath: test, isDirectory: true))
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return AppPfade(basis: support.appendingPathComponent("Brain", isDirectory: true))
    }

    public var konfiguration: URL { basis.appendingPathComponent("config.json") }
    public var nodeOrdner: URL { basis.appendingPathComponent("node", isDirectory: true) }
    public var binOrdner: URL { basis.appendingPathComponent("bin", isDirectory: true) }
    public var node: URL { binOrdner.appendingPathComponent("node") }
    public var logs: URL { basis.appendingPathComponent("logs", isDirectory: true) }

    public func legeAn() throws {
        for ordner in [basis, nodeOrdner, binOrdner, logs] {
            try FileManager.default.createDirectory(at: ordner, withIntermediateDirectories: true)
        }
    }
}
```

`Sources/BrainCore/AppLog.swift`:
```swift
import Foundation

/// Zeilen-Log unter <basis>/logs/app.log, rotierend (App-Spec §5.3: höchstens 5 × 1 MB). Wirft nie.
public final class AppLog: @unchecked Sendable {
    private let datei: URL
    private let maxBytes: Int
    private let maxDateien: Int
    private let sperre = NSLock()

    public init(pfade: AppPfade, maxBytes: Int = 1_000_000, maxDateien: Int = 5) {
        self.datei = pfade.logs.appendingPathComponent("app.log")
        self.maxBytes = maxBytes
        self.maxDateien = max(2, maxDateien)
    }

    public func schreibe(_ zeile: String, zeit: Date = Date()) {
        sperre.lock(); defer { sperre.unlock() }
        let fm = FileManager.default
        try? fm.createDirectory(at: datei.deletingLastPathComponent(), withIntermediateDirectories: true)
        rotiereFallsNoetig()
        let einzeilig = zeile.replacingOccurrences(of: "\n", with: " ")
        let daten = Data("\(ISO8601DateFormatter().string(from: zeit)) \(einzeilig)\n".utf8)
        if let h = try? FileHandle(forWritingTo: datei) {
            defer { try? h.close() }
            _ = try? h.seekToEnd()
            try? h.write(contentsOf: daten)
        } else {
            try? daten.write(to: datei)
        }
    }

    private func rotiereFallsNoetig() {
        let fm = FileManager.default
        guard let groesse = (try? fm.attributesOfItem(atPath: datei.path))?[.size] as? Int, groesse >= maxBytes else { return }
        let letzte = maxDateien - 1
        try? fm.removeItem(atPath: datei.path + ".\(letzte)")
        if letzte >= 2 {
            for i in stride(from: letzte - 1, through: 1, by: -1) {
                try? fm.moveItem(atPath: datei.path + ".\(i)", toPath: datei.path + ".\(i + 1)")
            }
        }
        try? fm.moveItem(atPath: datei.path, toPath: datei.path + ".1")
    }
}
```

- [ ] **Step 5: Tests laufen lassen — müssen bestehen**

Run: `cd ~/source/brain-app && swift build && swift test 2>&1 | tail -5`
Expected: Build ok, alle Tests PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/source/brain-app
git add Package.swift .gitignore Sources/BrainCore/AppPfade.swift Sources/BrainCore/AppLog.swift Sources/BrainApp/BrainApp.swift Tests/BrainCoreTests/TestHilfe.swift Tests/BrainCoreTests/AppPfadeTests.swift Tests/BrainCoreTests/AppLogTests.swift
git commit -m "app: Paket-Gerüst, AppPfade, AppLog

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: App — offizielle Node-Laufzeit holen und prüfen (`hole-node.sh`)

**Files:**
- Create: `scripts/node-version.txt`, `scripts/hole-node.sh`, `scripts/test-hole-node.sh`

**Interfaces:**
- Produces: `build/node-runtime/bin/node` (offizielles darwin-arm64-Node), `build/node-runtime/LICENSE`, `build/node-runtime/manifest.json` = `{"version":"vX.Y.Z","sha256":"<64 hex von bin/node>"}`. Task 8 liest genau dieses Format, Task 15 kopiert den Ordner ins App-Paket.

- [ ] **Step 1: Version festlegen** — aktuelle Node-24-LTS ermitteln und eintragen (einmalig, danach fest):

```bash
cd ~/source/brain-app && mkdir -p scripts
curl -fsS https://nodejs.org/dist/index.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s).find(r=>r.version.startsWith("v24.")&&r.lts);console.log(v.version)})' > scripts/node-version.txt
cat scripts/node-version.txt
```
Expected: eine Zeile wie `v24.<minor>.<patch>`.

- [ ] **Step 2: Failing test schreiben** — `scripts/test-hole-node.sh`:

```bash
#!/bin/bash
# Prüft hole-node.sh: richtige Version, Prüfsumme im Manifest stimmt, arm64, und ein manipuliertes Archiv wird abgewiesen.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
bash "$W/scripts/hole-node.sh" >/dev/null
SOLL="$(tr -d '[:space:]' < "$W/scripts/node-version.txt")"
IST="$("$W/build/node-runtime/bin/node" --version)"
[ "$IST" = "$SOLL" ] || { echo "FAIL Version: $IST statt $SOLL"; exit 1; }
SHA="$(shasum -a 256 "$W/build/node-runtime/bin/node" | cut -d' ' -f1)"
grep -q "\"sha256\":\"$SHA\"" "$W/build/node-runtime/manifest.json" || { echo "FAIL Manifest-Prüfsumme"; exit 1; }
grep -q "\"version\":\"$SOLL\"" "$W/build/node-runtime/manifest.json" || { echo "FAIL Manifest-Version"; exit 1; }
file "$W/build/node-runtime/bin/node" | grep -q arm64 || { echo "FAIL nicht arm64"; exit 1; }
# Manipulation: ein Byte im zwischengespeicherten Archiv ändern → Skript muss scheitern und das Archiv verwerfen
TAR="$W/build/cache/node-$SOLL-darwin-arm64.tar.gz"
printf 'X' | dd of="$TAR" bs=1 seek=100 conv=notrunc 2>/dev/null
if bash "$W/scripts/hole-node.sh" >/dev/null 2>&1; then echo "FAIL manipuliertes Archiv akzeptiert"; exit 1; fi
[ ! -f "$TAR" ] || { echo "FAIL manipuliertes Archiv nicht verworfen"; exit 1; }
bash "$W/scripts/hole-node.sh" >/dev/null   # sauberen Stand wieder herstellen
echo "OK hole-node"
```

- [ ] **Step 3: Test laufen lassen — muss scheitern**

Run: `cd ~/source/brain-app && bash scripts/test-hole-node.sh`
Expected: FAIL — `scripts/hole-node.sh` fehlt.

- [ ] **Step 4: `scripts/hole-node.sh` schreiben**

```bash
#!/bin/bash
# Holt das offizielle Node (darwin-arm64) in der Version aus scripts/node-version.txt, prüft die SHA-256 gegen
# SHASUMS256.txt von nodejs.org und legt bin/node + LICENSE + manifest.json unter build/node-runtime/ ab.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "$W/scripts/node-version.txt")"
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "node-version.txt ungültig: $VERSION" >&2; exit 1; }
NAME="node-$VERSION-darwin-arm64"
ZIEL="$W/build/node-runtime"
CACHE="$W/build/cache"
mkdir -p "$CACHE"
TAR="$CACHE/$NAME.tar.gz"
SUMS="$CACHE/SHASUMS256-$VERSION.txt"
[ -f "$SUMS" ] || curl -fsSL -o "$SUMS" "https://nodejs.org/dist/$VERSION/SHASUMS256.txt"
[ -f "$TAR" ] || curl -fsSL -o "$TAR" "https://nodejs.org/dist/$VERSION/$NAME.tar.gz"
SOLL="$(grep " $NAME.tar.gz\$" "$SUMS" | cut -d' ' -f1)"
IST="$(shasum -a 256 "$TAR" | cut -d' ' -f1)"
if [ -z "$SOLL" ] || [ "$SOLL" != "$IST" ]; then
  echo "Prüfsumme stimmt nicht für $NAME — Download verworfen." >&2
  rm -f "$TAR"
  exit 1
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
tar -xzf "$TAR" -C "$TMP" "$NAME/bin/node" "$NAME/LICENSE"
rm -rf "$ZIEL"
mkdir -p "$ZIEL/bin"
cp "$TMP/$NAME/bin/node" "$ZIEL/bin/node"
cp "$TMP/$NAME/LICENSE" "$ZIEL/LICENSE"
chmod 755 "$ZIEL/bin/node"
BIN_SHA="$(shasum -a 256 "$ZIEL/bin/node" | cut -d' ' -f1)"
printf '{"version":"%s","sha256":"%s"}\n' "$VERSION" "$BIN_SHA" > "$ZIEL/manifest.json"
echo "Node $VERSION bereit: $ZIEL"
```

- [ ] **Step 5: Test laufen lassen — muss bestehen**

Run: `cd ~/source/brain-app && bash scripts/test-hole-node.sh`
Expected: letzte Zeile `OK hole-node`.

- [ ] **Step 6: Commit**

```bash
cd ~/source/brain-app
git add scripts/node-version.txt scripts/hole-node.sh scripts/test-hole-node.sh
git commit -m "app: offizielle Node-Laufzeit holen und per SHA-256 prüfen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: App — Node-Laufzeit installieren (`NodeLaufzeit`)

**Files:**
- Create: `Sources/BrainCore/NodeLaufzeit.swift`
- Test: `Tests/BrainCoreTests/NodeLaufzeitTests.swift`

**Interfaces:**
- Consumes: `AppPfade` (Task 6); Ordnerformat aus Task 7 (`bin/node`, `LICENSE`, `manifest.json`).
- Produces: `NodeManifest { version: String, sha256: String }`; `LaufzeitFehler { manifestFehlt, pruefsummeFalsch(erwartet:ist:), symlinkFehlgeschlagen }`; `NodeLaufzeit(quelle: URL, pfade: AppPfade)` mit `manifest() throws -> NodeManifest` und `installiere() throws -> URL` (liefert `pfade.node`, idempotent). Im App-Paket ist `quelle = Bundle.main.resourceURL!.appendingPathComponent("node-runtime")`.

- [ ] **Step 1: Failing tests schreiben** — `Tests/BrainCoreTests/NodeLaufzeitTests.swift`:

```swift
import Testing
import Foundation
import CryptoKit
@testable import BrainCore

private func quelle(version: String, inhalt: String, falscheSumme: Bool = false) -> URL {
    let q = tempOrdner("node-runtime")
    try! FileManager.default.createDirectory(at: q.appendingPathComponent("bin"), withIntermediateDirectories: true)
    skript(inhalt, name: "bin/node", in: q)
    let sha = falscheSumme
        ? String(repeating: "0", count: 64)
        : SHA256.hash(data: Data(inhalt.utf8)).map { String(format: "%02x", $0) }.joined()
    try! #"{"version":"\#(version)","sha256":"\#(sha)"}"#
        .write(to: q.appendingPathComponent("manifest.json"), atomically: true, encoding: .utf8)
    return q
}

@Test func installiertUndSetztDenStabilenPfad() throws {
    let p = AppPfade(basis: tempOrdner("Application Support"))
    let node = try NodeLaufzeit(quelle: quelle(version: "v24.0.0", inhalt: "#!/bin/sh\necho v24.0.0\n"), pfade: p).installiere()
    #expect(node == p.node)
    #expect(try FileManager.default.destinationOfSymbolicLink(atPath: p.node.path).hasSuffix("node/v24.0.0/bin/node"))
    #expect(FileManager.default.isExecutableFile(atPath: p.node.path))
}

@Test func zweimalInstallierenIstHarmlos() throws {
    let p = AppPfade(basis: tempOrdner())
    let q = quelle(version: "v24.0.0", inhalt: "#!/bin/sh\necho a\n")
    try NodeLaufzeit(quelle: q, pfade: p).installiere()
    try NodeLaufzeit(quelle: q, pfade: p).installiere()
    #expect(FileManager.default.isExecutableFile(atPath: p.node.path))
}

@Test func neueVersionBiegtDenPfadUm() throws {
    let p = AppPfade(basis: tempOrdner())
    try NodeLaufzeit(quelle: quelle(version: "v24.0.0", inhalt: "#!/bin/sh\necho alt\n"), pfade: p).installiere()
    try NodeLaufzeit(quelle: quelle(version: "v24.1.0", inhalt: "#!/bin/sh\necho neu\n"), pfade: p).installiere()
    #expect(try FileManager.default.destinationOfSymbolicLink(atPath: p.node.path).hasSuffix("node/v24.1.0/bin/node"))
}

@Test func falschePruefsummeWirdAbgewiesen() {
    let p = AppPfade(basis: tempOrdner())
    let q = quelle(version: "v24.0.0", inhalt: "#!/bin/sh\necho x\n", falscheSumme: true)
    #expect(throws: LaufzeitFehler.self) { try NodeLaufzeit(quelle: q, pfade: p).installiere() }
    #expect(!FileManager.default.fileExists(atPath: p.node.path))
}

@Test func fehlendesManifestWirdGemeldet() {
    let p = AppPfade(basis: tempOrdner())
    #expect(throws: LaufzeitFehler.manifestFehlt) { try NodeLaufzeit(quelle: tempOrdner(), pfade: p).installiere() }
}
```

- [ ] **Step 2: Tests laufen lassen — müssen scheitern**

Run: `cd ~/source/brain-app && swift test 2>&1 | tail -10`
Expected: Kompilierfehler „cannot find 'NodeLaufzeit' in scope“.

- [ ] **Step 3: Implementieren** — `Sources/BrainCore/NodeLaufzeit.swift`:

```swift
import Foundation
import CryptoKit

public struct NodeManifest: Codable, Equatable, Sendable {
    public let version: String
    public let sha256: String
}

public enum LaufzeitFehler: Error, Equatable {
    case manifestFehlt
    case pruefsummeFalsch(erwartet: String, ist: String)
    case symlinkFehlgeschlagen
}

/// Kopiert das mitgelieferte Node aus dem App-Paket nach Application Support/Brain/node/<version>/ und setzt
/// bin/node als stabilen Symlink darauf (App-Spec §5.2 Baustein 2, §11). Idempotent; prüft die SHA-256 vor und
/// nach dem Kopieren; entfernt ein Quarantäne-Kennzeichen, damit Terminal-Hooks das Node ohne Rückfrage starten.
public struct NodeLaufzeit: Sendable {
    public let quelle: URL
    public let pfade: AppPfade

    public init(quelle: URL, pfade: AppPfade) {
        self.quelle = quelle
        self.pfade = pfade
    }

    public func manifest() throws -> NodeManifest {
        guard let daten = try? Data(contentsOf: quelle.appendingPathComponent("manifest.json")) else {
            throw LaufzeitFehler.manifestFehlt
        }
        return try JSONDecoder().decode(NodeManifest.self, from: daten)
    }

    @discardableResult
    public func installiere() throws -> URL {
        let m = try manifest()
        try pfade.legeAn()
        let fm = FileManager.default
        let zielOrdner = pfade.nodeOrdner.appendingPathComponent(m.version, isDirectory: true)
        let zielNode = zielOrdner.appendingPathComponent("bin/node")
        if !(fm.fileExists(atPath: zielNode.path) && (try? Self.sha256(zielNode)) == m.sha256) {
            let quellNode = quelle.appendingPathComponent("bin/node")
            let ist = try Self.sha256(quellNode)
            guard ist == m.sha256 else { throw LaufzeitFehler.pruefsummeFalsch(erwartet: m.sha256, ist: ist) }
            let tmp = pfade.nodeOrdner.appendingPathComponent(".\(m.version).\(UUID().uuidString)", isDirectory: true)
            try fm.createDirectory(at: tmp.appendingPathComponent("bin"), withIntermediateDirectories: true)
            try fm.copyItem(at: quellNode, to: tmp.appendingPathComponent("bin/node"))
            let lizenz = quelle.appendingPathComponent("LICENSE")
            if fm.fileExists(atPath: lizenz.path) { try fm.copyItem(at: lizenz, to: tmp.appendingPathComponent("LICENSE")) }
            removexattr(tmp.appendingPathComponent("bin/node").path, "com.apple.quarantine", 0)
            if fm.fileExists(atPath: zielOrdner.path) { try fm.removeItem(at: zielOrdner) }
            try fm.moveItem(at: tmp, to: zielOrdner)
            let kopiert = try Self.sha256(zielNode)
            guard kopiert == m.sha256 else { throw LaufzeitFehler.pruefsummeFalsch(erwartet: m.sha256, ist: kopiert) }
        }
        // bin/node atomar umbiegen: neuen Symlink daneben anlegen, dann per rename(2) ersetzen
        let neu = pfade.binOrdner.appendingPathComponent(".node.\(UUID().uuidString)")
        try fm.createSymbolicLink(atPath: neu.path, withDestinationPath: zielNode.path)
        guard rename(neu.path, pfade.node.path) == 0 else {
            try? fm.removeItem(at: neu)
            throw LaufzeitFehler.symlinkFehlgeschlagen
        }
        return pfade.node
    }

    static func sha256(_ url: URL) throws -> String {
        let daten = try Data(contentsOf: url, options: .mappedIfSafe)
        return SHA256.hash(data: daten).map { String(format: "%02x", $0) }.joined()
    }
}
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `cd ~/source/brain-app && swift test 2>&1 | tail -5`
Expected: alle PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/source/brain-app
git add Sources/BrainCore/NodeLaufzeit.swift Tests/BrainCoreTests/NodeLaufzeitTests.swift
git commit -m "app: mitgelieferte Node-Laufzeit geprüft nach Application Support installieren

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: App — Kit-Befehle ausführen, Status lesen, Terminal-Node finden

**Files:**
- Create: `Sources/BrainCore/ProzessLauf.swift`, `Sources/BrainCore/BrainBefehl.swift`, `Sources/BrainCore/BrainStatus.swift`, `Sources/BrainCore/TerminalNode.swift`
- Test: `Tests/BrainCoreTests/BrainBefehlTests.swift`

**Interfaces:**
- Consumes: Kit-CLI `brain status --json` (Task 4: genau eine JSON-Zeile), `BRAIN_VAULT`/`BRAIN_NODE` (Task 5).
- Produces:
  - `BefehlErgebnis { code: Int32, ausgabe: String, fehler: String }`, `BefehlFehler { zeitUeberschritten, startFehlgeschlagen(String) }`
  - `ProzessLauf.starte(_ programm: URL, _ argumente: [String], umgebung: [String: String]? = nil, ordner: URL? = nil, zeitlimit: Duration = .seconds(20)) async throws -> BefehlErgebnis`
  - `BrainBefehl(node: URL, vault: URL, umgebung: [String: String] = [:])` mit `fuehreAus(_:zeitlimit:)` und `status(zeitlimit:) async throws -> BrainStatus`
  - `BrainStatus { version, quellVault, zustand: .ok/.hinweis/.problem, meldungen, zahlen { vorschlaege, konflikte, abgelaufen, zuTun } }`, `BrainStatus.aus(ausgabe:) throws`, `StatusFehler.leereAusgabe`
  - `StatusAnzeige { symbol, zeichen, titel }` mit `fuer(_ status: BrainStatus?, fehler: String? = nil)` und `problem(_ text: String)`
  - `TerminalNode.finde(shell: URL = /bin/zsh, zeitlimit: Duration = .seconds(3)) async -> URL?`

- [ ] **Step 1: Failing tests schreiben** — `Tests/BrainCoreTests/BrainBefehlTests.swift`:

```swift
import Testing
import Foundation
@testable import BrainCore

private let statusJSON = #"{"version":"0.5.1","quellVault":true,"zustand":"hinweis","meldungen":[],"zahlen":{"vorschlaege":2,"konflikte":0,"abgelaufen":1,"zuTun":3}}"#

@Test func statusWirdAusDerLetztenZeileGelesen() async throws {
    let node = skript("#!/bin/bash\necho 'Hinweis vorab'\necho '\(statusJSON)'\n", name: "node", in: tempOrdner())
    let s = try await BrainBefehl(node: node, vault: tempOrdner("Mein Brän")).status()
    #expect(s.zustand == .hinweis)
    #expect(s.quellVault)
    #expect(s.zahlen.zuTun == 3)
}

@Test func vaultMitLeerzeichenKommtAlsArgumentUndUmgebungAn() async throws {
    let node = skript("#!/bin/bash\nprintf '%s|%s|%s' \"$BRAIN_VAULT\" \"$1\" \"$BRAIN_NODE\"\n", name: "node", in: tempOrdner())
    let vault = tempOrdner("Mein Brän")
    let r = try await BrainBefehl(node: node, vault: vault, umgebung: ["BRAIN_NODE": "/opt/x/node"]).fuehreAus(["status"])
    #expect(r.ausgabe == "\(vault.path)|\(vault.appendingPathComponent(".tools/brain.mjs").path)|/opt/x/node")
}

@Test func zeitlimitBrichtAbOhneZuHaengen() async {
    let node = skript("#!/bin/bash\nsleep 5\n", name: "node", in: tempOrdner())
    let start = ContinuousClock.now
    await #expect(throws: BefehlFehler.zeitUeberschritten) {
        _ = try await BrainBefehl(node: node, vault: tempOrdner()).fuehreAus(["status"], zeitlimit: .milliseconds(300))
    }
    #expect(ContinuousClock.now - start < .seconds(3))
}

@Test func exitCodeUndFehlerausgabeWerdenWeitergegeben() async throws {
    let node = skript("#!/bin/bash\necho kaputt >&2\nexit 3\n", name: "node", in: tempOrdner())
    let r = try await BrainBefehl(node: node, vault: tempOrdner()).fuehreAus([])
    #expect(r.code == 3)
    #expect(r.fehler == "kaputt\n")
}

@Test func grosseAusgabeStautNicht() async throws {
    let node = skript("#!/bin/bash\nhead -c 3000000 /dev/zero | tr '\\0' 'a'\n", name: "node", in: tempOrdner())
    let r = try await BrainBefehl(node: node, vault: tempOrdner()).fuehreAus([])
    #expect(r.ausgabe.count == 3_000_000)
}

@Test func fehlendesProgrammWirdGemeldet() async {
    await #expect(throws: BefehlFehler.self) {
        _ = try await ProzessLauf.starte(URL(fileURLWithPath: "/gibt/es/nicht"), [])
    }
}

@Test func leereAusgabeIstKeinStatus() {
    #expect(throws: StatusFehler.leereAusgabe) { try BrainStatus.aus(ausgabe: "\n \n") }
}

@Test func anzeigeHatImmerEinSymbol() throws {
    let ok = try BrainStatus.aus(ausgabe: statusJSON.replacingOccurrences(of: "\"hinweis\"", with: "\"ok\""))
    #expect(StatusAnzeige.fuer(ok) == StatusAnzeige(symbol: "checkmark.circle", zeichen: "✓", titel: "Alles in Ordnung"))
    let hinweis = try BrainStatus.aus(ausgabe: statusJSON)
    #expect(StatusAnzeige.fuer(hinweis) == StatusAnzeige(symbol: "exclamationmark.triangle", zeichen: "⚠", titel: "5 Sachen warten"))
    let problem = try BrainStatus.aus(ausgabe: statusJSON
        .replacingOccurrences(of: "\"hinweis\"", with: "\"problem\"")
        .replacingOccurrences(of: "\"meldungen\":[]", with: "\"meldungen\":[\"Einstellungen beschädigt\"]"))
    #expect(StatusAnzeige.fuer(problem) == StatusAnzeige(symbol: "xmark.octagon", zeichen: "✕", titel: "Einstellungen beschädigt"))
    #expect(StatusAnzeige.fuer(nil).zeichen == "?")
    #expect(StatusAnzeige.problem("Brain-Ordner nicht gefunden").zeichen == "✕")
}

@Test func terminalNodeNimmtDieLetzteAbsolutePfadZeile() async {
    let shell = skript("#!/bin/bash\necho 'Willkommen'\necho /bin/ls\n", name: "zsh", in: tempOrdner())
    #expect(await TerminalNode.finde(shell: shell) == URL(fileURLWithPath: "/bin/ls"))
}

@Test func terminalNodeOhneTrefferIstNil() async {
    let o = tempOrdner()
    #expect(await TerminalNode.finde(shell: skript("#!/bin/bash\necho relativ/node\n", name: "a", in: o)) == nil)
    #expect(await TerminalNode.finde(shell: skript("#!/bin/bash\nexit 1\n", name: "b", in: o)) == nil)
}
```

- [ ] **Step 2: Tests laufen lassen — müssen scheitern**

Run: `cd ~/source/brain-app && swift test 2>&1 | tail -10`
Expected: Kompilierfehler (`BrainBefehl`, `ProzessLauf`, `BrainStatus`, `StatusAnzeige`, `TerminalNode` fehlen).

- [ ] **Step 3: `ProzessLauf.swift`**

```swift
import Foundation

public struct BefehlErgebnis: Sendable, Equatable {
    public let code: Int32
    public let ausgabe: String
    public let fehler: String
}

public enum BefehlFehler: Error, Equatable {
    case zeitUeberschritten
    case startFehlgeschlagen(String)
}

/// Sammelt eine Pipe ohne blockierendes Lesen (readabilityHandler) — kein Pipe-Stau, kein Hängen, wenn
/// Enkelprozesse die Pipe noch offen halten.
final class PipeSammler: @unchecked Sendable {
    private var daten = Data()
    private var ende = false
    private let sperre = NSLock()
    private let handle: FileHandle

    init(_ handle: FileHandle) {
        self.handle = handle
        handle.readabilityHandler = { [weak self] h in
            let d = h.availableData
            guard let self else { return }
            self.sperre.lock(); defer { self.sperre.unlock() }
            if d.isEmpty { self.ende = true; h.readabilityHandler = nil } else { self.daten.append(d) }
        }
    }
    var fertig: Bool { sperre.lock(); defer { sperre.unlock() }; return ende }
    var wert: Data { sperre.lock(); defer { sperre.unlock() }; return daten }
    func stopp() { handle.readabilityHandler = nil }
}

/// Startet ein Programm, sammelt stdout/stderr und bricht nach dem Zeitlimit ab (App-Spec Review-Fokus 5).
public enum ProzessLauf {
    public static func starte(_ programm: URL, _ argumente: [String], umgebung: [String: String]? = nil,
                              ordner: URL? = nil, zeitlimit: Duration = .seconds(20)) async throws -> BefehlErgebnis {
        let p = Process()
        p.executableURL = programm
        p.arguments = argumente
        if let umgebung { p.environment = umgebung }
        if let ordner { p.currentDirectoryURL = ordner }
        let aus = Pipe(), err = Pipe()
        p.standardOutput = aus
        p.standardError = err
        p.standardInput = FileHandle.nullDevice
        let ausS = PipeSammler(aus.fileHandleForReading)
        let errS = PipeSammler(err.fileHandleForReading)
        do { try p.run() } catch {
            ausS.stopp(); errS.stopp()
            throw BefehlFehler.startFehlgeschlagen(error.localizedDescription)
        }
        let ende = ContinuousClock.now + zeitlimit
        while p.isRunning {
            if ContinuousClock.now >= ende {
                p.terminate()
                ausS.stopp(); errS.stopp()
                throw BefehlFehler.zeitUeberschritten
            }
            try? await Task.sleep(for: .milliseconds(20))
        }
        // Prozess ist fertig: Rest der Pipes bis zum Ende lesen, höchstens 1 s (Enkelprozesse).
        let nachlauf = ContinuousClock.now + .seconds(1)
        while !(ausS.fertig && errS.fertig) && ContinuousClock.now < nachlauf {
            try? await Task.sleep(for: .milliseconds(10))
        }
        ausS.stopp(); errS.stopp()
        return BefehlErgebnis(code: p.terminationStatus,
                              ausgabe: String(decoding: ausS.wert, as: UTF8.self),
                              fehler: String(decoding: errS.wert, as: UTF8.self))
    }
}
```

- [ ] **Step 4: `BrainStatus.swift`**

```swift
import Foundation

public enum StatusFehler: Error, Equatable { case leereAusgabe }

/// Ergebnis von `brain status --json` (Kit, status.mjs).
public struct BrainStatus: Codable, Equatable, Sendable {
    public enum Zustand: String, Codable, Sendable { case ok, hinweis, problem }
    public struct Zahlen: Codable, Equatable, Sendable {
        public let vorschlaege: Int
        public let konflikte: Int
        public let abgelaufen: Int
        public let zuTun: Int
    }
    public let version: String
    public let quellVault: Bool
    public let zustand: Zustand
    public let meldungen: [String]
    public let zahlen: Zahlen

    /// Liest die letzte nicht-leere Zeile (frühere Zeilen könnten Hinweise anderer Module sein).
    public static func aus(ausgabe: String) throws -> BrainStatus {
        guard let zeile = ausgabe.split(separator: "\n")
            .last(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) else { throw StatusFehler.leereAusgabe }
        return try JSONDecoder().decode(BrainStatus.self, from: Data(zeile.utf8))
    }
}

/// Was die Menüleiste zeigt — immer Symbol + Text, nie nur Farbe (App-Spec §10).
public struct StatusAnzeige: Equatable, Sendable {
    public let symbol: String
    public let zeichen: String
    public let titel: String

    public init(symbol: String, zeichen: String, titel: String) {
        self.symbol = symbol
        self.zeichen = zeichen
        self.titel = titel
    }

    public static func problem(_ text: String) -> StatusAnzeige {
        StatusAnzeige(symbol: "xmark.octagon", zeichen: "✕", titel: text)
    }

    public static func fuer(_ status: BrainStatus?, fehler: String? = nil) -> StatusAnzeige {
        guard let s = status else {
            return StatusAnzeige(symbol: "questionmark.circle", zeichen: "?", titel: fehler ?? "Status unbekannt")
        }
        switch s.zustand {
        case .ok:
            return StatusAnzeige(symbol: "checkmark.circle", zeichen: "✓", titel: "Alles in Ordnung")
        case .hinweis:
            let n = s.zahlen.zuTun + s.zahlen.vorschlaege
            let titel = n == 0 ? (s.meldungen.first ?? "Bitte kurz ansehen") : (n == 1 ? "1 Sache wartet" : "\(n) Sachen warten")
            return StatusAnzeige(symbol: "exclamationmark.triangle", zeichen: "⚠", titel: titel)
        case .problem:
            return problem(s.meldungen.first ?? "Es gibt ein Problem")
        }
    }
}
```

- [ ] **Step 5: `BrainBefehl.swift` und `TerminalNode.swift`**

`Sources/BrainCore/BrainBefehl.swift`:
```swift
import Foundation

/// Führt `<node> <vault>/.tools/brain.mjs <argumente>` aus (App-Spec §5.2: die App ruft nur brain.mjs-Befehle).
public struct BrainBefehl: Sendable {
    public let node: URL
    public let vault: URL
    public let umgebung: [String: String]

    public init(node: URL, vault: URL, umgebung: [String: String] = [:]) {
        self.node = node
        self.vault = vault
        self.umgebung = umgebung
    }

    public func fuehreAus(_ argumente: [String], zeitlimit: Duration = .seconds(20)) async throws -> BefehlErgebnis {
        var env = ProcessInfo.processInfo.environment
        env["BRAIN_VAULT"] = vault.path
        for (k, v) in umgebung { env[k] = v }
        return try await ProzessLauf.starte(node, [vault.appendingPathComponent(".tools/brain.mjs").path] + argumente,
                                            umgebung: env, ordner: vault, zeitlimit: zeitlimit)
    }

    public func status(zeitlimit: Duration = .seconds(20)) async throws -> BrainStatus {
        try BrainStatus.aus(ausgabe: try await fuehreAus(["status", "--json"], zeitlimit: zeitlimit).ausgabe)
    }
}
```

`Sources/BrainCore/TerminalNode.swift`:
```swift
import Foundation

/// Das Node, mit dem das Terminal (Login-Shell) die Brain-Hooks startet — die App gibt es als BRAIN_NODE an das
/// Kit weiter, damit gerenderte Pfade (AGENTS.md) nicht auf das App-Node umspringen.
public enum TerminalNode {
    public static func finde(shell: URL = URL(fileURLWithPath: "/bin/zsh"), zeitlimit: Duration = .seconds(3)) async -> URL? {
        guard let r = try? await ProzessLauf.starte(shell, ["-lc", "command -v node"], zeitlimit: zeitlimit), r.code == 0 else { return nil }
        let pfad = r.ausgabe.split(separator: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .last(where: { $0.hasPrefix("/") })
        guard let pfad, FileManager.default.isExecutableFile(atPath: pfad) else { return nil }
        return URL(fileURLWithPath: pfad)
    }
}
```

- [ ] **Step 6: Tests laufen lassen — müssen bestehen**

Run: `cd ~/source/brain-app && swift test 2>&1 | tail -5`
Expected: alle PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/source/brain-app
git add Sources/BrainCore/ProzessLauf.swift Sources/BrainCore/BrainBefehl.swift Sources/BrainCore/BrainStatus.swift Sources/BrainCore/TerminalNode.swift Tests/BrainCoreTests/BrainBefehlTests.swift
git commit -m "app: Kit-Befehle mit Zeitlimit, Status lesen, Terminal-Node finden

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: App — Einstellungen, Brain-Ordner prüfen, Start-Argumente

**Files:**
- Create: `Sources/BrainCore/AppEinstellungen.swift`, `Sources/BrainCore/VaultAuswahl.swift`, `Sources/BrainCore/StartArgumente.swift`
- Test: `Tests/BrainCoreTests/VaultAuswahlTests.swift`

**Interfaces:**
- Consumes: `AppPfade` (Task 6).
- Produces:
  - `AppEinstellungen { var vault: String? }` mit `static lade(_ pfade: AppPfade) -> AppEinstellungen` (fehlend/kaputt → leer) und `speichere(_ pfade: AppPfade) throws` (atomar).
  - `VaultPruefung { ok, fehlt, keinBrain }`; `VaultAuswahl.pruefe(_ ordner: URL) -> VaultPruefung`, `VaultAuswahl.vorschlag(home: URL) -> URL?` (prüft `~/brain`, dann `~/Documents/Brain`), `VaultAuswahl.meldung(_:) -> String?`.
  - `StartArgumente { vault: URL?, fensterOeffnen: Bool, schliessenNach: Duration?, beendenNach: Duration? }`, `StartArgumente.lies(_ argumente: [String])` — versteht `--vault <pfad>`, `--test-fenster`, `--test-fenster-schliessen-nach <sek>`, `--test-beenden-nach <sek>`; Unbekanntes wird ignoriert.

- [ ] **Step 1: Failing tests schreiben** — `Tests/BrainCoreTests/VaultAuswahlTests.swift`:

```swift
import Testing
import Foundation
@testable import BrainCore

private func brain(_ name: String = "brain", in home: URL) -> URL {
    let v = home.appendingPathComponent(name)
    try! FileManager.default.createDirectory(at: v.appendingPathComponent(".tools"), withIntermediateDirectories: true)
    try! "// stub".write(to: v.appendingPathComponent(".tools/brain.mjs"), atomically: true, encoding: .utf8)
    return v
}

@Test func pruefungErkenntBrainFehlendUndFremd() {
    let home = tempOrdner()
    #expect(VaultAuswahl.pruefe(brain("Mein Brän", in: home)) == .ok)
    #expect(VaultAuswahl.pruefe(home.appendingPathComponent("weg")) == .fehlt)
    #expect(VaultAuswahl.pruefe(home) == .keinBrain)
}

@Test func verschobenerOrdnerGiltAlsFehlend() throws {
    let home = tempOrdner()
    let v = brain(in: home)
    try FileManager.default.moveItem(at: v, to: home.appendingPathComponent("anderswo"))
    #expect(VaultAuswahl.pruefe(v) == .fehlt)
    #expect(VaultAuswahl.meldung(.fehlt) == "Brain-Ordner nicht gefunden")
}

@Test func vorschlagNimmtZuerstTildeBrain() {
    let home = tempOrdner()
    #expect(VaultAuswahl.vorschlag(home: home) == nil)
    let docs = brain("Documents/Brain", in: home)
    #expect(VaultAuswahl.vorschlag(home: home) == docs)
    let tilde = brain("brain", in: home)
    #expect(VaultAuswahl.vorschlag(home: home) == tilde)
}

@Test func einstellungenUeberlebenNeustartUndKaputteDatei() throws {
    let p = AppPfade(basis: tempOrdner())
    #expect(AppEinstellungen.lade(p) == AppEinstellungen())
    try AppEinstellungen(vault: "/Users/x/Mein Brain").speichere(p)
    #expect(AppEinstellungen.lade(p).vault == "/Users/x/Mein Brain")
    try "{ kaputt".write(to: p.konfiguration, atomically: true, encoding: .utf8)
    #expect(AppEinstellungen.lade(p) == AppEinstellungen())
}

@Test func startArgumenteWerdenGelesen() {
    let a = StartArgumente.lies(["BrainApp", "--vault", "/tmp/Test Brain", "--test-fenster",
                                 "--test-fenster-schliessen-nach", "10", "--test-beenden-nach", "40", "-NSIrgendwas", "YES"])
    #expect(a.vault == URL(fileURLWithPath: "/tmp/Test Brain"))
    #expect(a.fensterOeffnen)
    #expect(a.schliessenNach == .seconds(10))
    #expect(a.beendenNach == .seconds(40))
}

@Test func startArgumenteOhneWertOderMitUnsinn() {
    let a = StartArgumente.lies(["BrainApp", "--test-beenden-nach", "abc", "--vault"])
    #expect(a == StartArgumente())
}
```

- [ ] **Step 2: Tests laufen lassen — müssen scheitern**

Run: `cd ~/source/brain-app && swift test 2>&1 | tail -10`
Expected: Kompilierfehler (Typen fehlen).

- [ ] **Step 3: Implementieren**

`Sources/BrainCore/AppEinstellungen.swift`:
```swift
import Foundation

/// Was die App sich merkt (App-Spec §9.1) — in M1 nur der verbundene Brain-Ordner.
public struct AppEinstellungen: Codable, Equatable, Sendable {
    public var vault: String?

    public init(vault: String? = nil) { self.vault = vault }

    /// Fehlt die Datei oder ist sie kaputt → leere Einstellungen (die App zeigt dann die Einrichtung).
    public static func lade(_ pfade: AppPfade) -> AppEinstellungen {
        guard let daten = try? Data(contentsOf: pfade.konfiguration),
              let e = try? JSONDecoder().decode(AppEinstellungen.self, from: daten) else { return AppEinstellungen() }
        return e
    }

    public func speichere(_ pfade: AppPfade) throws {
        try pfade.legeAn()
        let kodierer = JSONEncoder()
        kodierer.outputFormatting = [.prettyPrinted, .sortedKeys]
        try kodierer.encode(self).write(to: pfade.konfiguration, options: .atomic)
    }
}
```

`Sources/BrainCore/VaultAuswahl.swift`:
```swift
import Foundation

public enum VaultPruefung: Equatable, Sendable { case ok, fehlt, keinBrain }

/// Ist ein Ordner ein Brain? (App-Spec §9.1, „Vorhandenes Brain verbinden“) — rein lesend.
public enum VaultAuswahl {
    public static func pruefe(_ ordner: URL) -> VaultPruefung {
        var istOrdner: ObjCBool = false
        guard FileManager.default.fileExists(atPath: ordner.path, isDirectory: &istOrdner), istOrdner.boolValue else { return .fehlt }
        let werkzeug = ordner.appendingPathComponent(".tools/brain.mjs").path
        return FileManager.default.fileExists(atPath: werkzeug) ? .ok : .keinBrain
    }

    public static func vorschlag(home: URL = FileManager.default.homeDirectoryForCurrentUser) -> URL? {
        [home.appendingPathComponent("brain"), home.appendingPathComponent("Documents/Brain")]
            .first { pruefe($0) == .ok }
    }

    public static func meldung(_ p: VaultPruefung) -> String? {
        switch p {
        case .ok: return nil
        case .fehlt: return "Brain-Ordner nicht gefunden"
        case .keinBrain: return "Dieser Ordner ist kein Brain — darin fehlt .tools/brain.mjs"
        }
    }
}
```

`Sources/BrainCore/StartArgumente.swift`:
```swift
import Foundation

/// Start-Argumente für Entwicklung, Rauchtest und Speichermessung (Task 15/16). Unbekanntes wird ignoriert.
public struct StartArgumente: Equatable, Sendable {
    public var vault: URL?
    public var fensterOeffnen = false
    public var schliessenNach: Duration?
    public var beendenNach: Duration?

    public init() {}

    public static func lies(_ argumente: [String]) -> StartArgumente {
        var a = StartArgumente()
        var i = 1
        func wert() -> String? { i + 1 < argumente.count ? argumente[i + 1] : nil }
        func sekunden() -> Duration? { wert().flatMap(Int.init).map { .seconds($0) } }
        while i < argumente.count {
            switch argumente[i] {
            case "--vault":
                if let v = wert(), v.hasPrefix("/") { a.vault = URL(fileURLWithPath: v); i += 1 }
            case "--test-fenster":
                a.fensterOeffnen = true
            case "--test-fenster-schliessen-nach":
                if let s = sekunden() { a.schliessenNach = s; i += 1 }
            case "--test-beenden-nach":
                if let s = sekunden() { a.beendenNach = s; i += 1 }
            default:
                break
            }
            i += 1
        }
        return a
    }
}
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `cd ~/source/brain-app && swift test 2>&1 | tail -5`
Expected: alle PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/source/brain-app
git add Sources/BrainCore/AppEinstellungen.swift Sources/BrainCore/VaultAuswahl.swift Sources/BrainCore/StartArgumente.swift Tests/BrainCoreTests/VaultAuswahlTests.swift
git commit -m "app: Einstellungen, Brain-Ordner prüfen, Start-Argumente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: App — Verbindung zur Ansicht-Brücke (`BrueckenVerbindung`)

**Files:**
- Create: `Sources/BrainCore/BrueckenVerbindung.swift`
- Test: `Tests/BrainCoreTests/BrueckenVerbindungTests.swift`

**Interfaces:**
- Consumes: Brücken-Protokoll aus Task 2; Kit-Worktree `~/brain-kit-v0.6` und ein Node für die Tests (`BRAIN_TEST_KIT`, `BRAIN_TEST_NODE`, sonst `/opt/homebrew/bin/node`).
- Produces:
  - `BrueckenAntwort { status: Int, headers: [String: String], body: Data }`
  - `BrueckenFehler { startFehlgeschlagen(String), beendet, zeitUeberschritten }`
  - `actor BrueckenVerbindung(node: URL, vault: URL, umgebung: [String: String] = [:])` mit `starte(zeitlimit:) async throws`, `anfrage(methode: String, pfad: String, body: Data? = nil, zeitlimit: Duration = .seconds(30)) async throws -> BrueckenAntwort` (startet bei Bedarf selbst, auch nach einem Absturz), `beende()`, `version: String?`, `pid: Int32?`, `laeuft: Bool`.

- [ ] **Step 1: Failing tests schreiben** — `Tests/BrainCoreTests/BrueckenVerbindungTests.swift`:

```swift
import Testing
import Foundation
@testable import BrainCore

/// Echte Brücke aus dem Kit-Worktree; ohne Node oder Kit werden die Tests übersprungen.
enum BrueckenUmgebung {
    static let kit = URL(fileURLWithPath: ProcessInfo.processInfo.environment["BRAIN_TEST_KIT"] ?? NSHomeDirectory() + "/brain-kit-v0.6")
    static let node: URL? = {
        let kandidaten = [ProcessInfo.processInfo.environment["BRAIN_TEST_NODE"], "/opt/homebrew/bin/node", "/usr/local/bin/node"]
        for p in kandidaten.compactMap({ $0 }) where FileManager.default.isExecutableFile(atPath: p) { return URL(fileURLWithPath: p) }
        return nil
    }()
    static var verfuegbar: Bool {
        node != nil && FileManager.default.fileExists(atPath: kit.appendingPathComponent(".tools/ansicht/bruecke.mjs").path)
    }

    /// Test-Brain: Kopie der Kit-Fixture, `.tools` als Symlink auf das Kit; Name mit Leerzeichen und Umlaut.
    static func vault() throws -> URL {
        let v = tempOrdner("Test Brän")
        let fixture = kit.appendingPathComponent(".tools/tests/fixture")
        for name in try FileManager.default.contentsOfDirectory(atPath: fixture.path) {
            try FileManager.default.copyItem(at: fixture.appendingPathComponent(name), to: v.appendingPathComponent(name))
        }
        try FileManager.default.createSymbolicLink(at: v.appendingPathComponent(".tools"),
                                                   withDestinationURL: kit.appendingPathComponent(".tools"))
        return v
    }

    static func verbindung() throws -> BrueckenVerbindung {
        BrueckenVerbindung(node: node!, vault: try vault())
    }
}

@Suite(.enabled(if: BrueckenUmgebung.verfuegbar, "braucht Node und den Kit-Worktree ~/brain-kit-v0.6"))
struct BrueckenVerbindungTests {
    @Test func startetUndLiefertStartseiteUndPing() async throws {
        let b = try BrueckenUmgebung.verbindung()
        try await b.starte()
        #expect(await b.version != nil)
        let start = try await b.anfrage(methode: "GET", pfad: "/")
        #expect(start.status == 200)
        #expect(String(decoding: start.body, as: UTF8.self).contains("api.js"))
        #expect(try await b.anfrage(methode: "GET", pfad: "/api/ping").status == 200)
        await b.beende()
    }

    @Test func parallelAnfragenKommenRichtigZurueck() async throws {
        let b = try BrueckenUmgebung.verbindung()
        try await b.starte()
        try await withThrowingTaskGroup(of: Int.self) { gruppe in
            for _ in 0..<20 { gruppe.addTask { try await b.anfrage(methode: "GET", pfad: "/api/ping").status } }
            for try await status in gruppe { #expect(status == 200) }
        }
        await b.beende()
    }

    @Test func grosseDateiKommtVollstaendigUndBrueckeStartetVonSelbst() async throws {
        let b = try BrueckenUmgebung.verbindung()
        let r = try await b.anfrage(methode: "GET", pfad: "/vendor/three.bundle.js")
        let datei = BrueckenUmgebung.kit.appendingPathComponent(".tools/ansicht/vendor/three.bundle.js").path
        let soll = try #require(try FileManager.default.attributesOfItem(atPath: datei)[.size] as? Int)
        #expect(r.status == 200)
        #expect(r.body.count == soll)
        await b.beende()
    }

    @Test func nachAbsturzStartetDieNaechsteAnfrageNeu() async throws {
        let b = try BrueckenUmgebung.verbindung()
        try await b.starte()
        let alt = try #require(await b.pid)
        kill(alt, SIGKILL)
        try await Task.sleep(for: .milliseconds(300))
        #expect(try await b.anfrage(methode: "GET", pfad: "/api/ping").status == 200)
        #expect(await b.pid != alt)
        await b.beende()
    }

    @Test func fehlendesNodeMeldetSichSauber() async throws {
        let b = BrueckenVerbindung(node: URL(fileURLWithPath: "/gibt/es/nicht"), vault: try BrueckenUmgebung.vault())
        await #expect(throws: BrueckenFehler.self) { _ = try await b.anfrage(methode: "GET", pfad: "/") }
    }

    @Test func beendenSchliesstDenProzess() async throws {
        let b = try BrueckenUmgebung.verbindung()
        try await b.starte()
        let pid = try #require(await b.pid)
        await b.beende()
        try await Task.sleep(for: .seconds(1))
        #expect(kill(pid, 0) != 0)
    }
}
```

- [ ] **Step 2: Tests laufen lassen — müssen scheitern**

Run: `cd ~/source/brain-app && swift test 2>&1 | tail -10`
Expected: Kompilierfehler „cannot find 'BrueckenVerbindung' in scope“. (Fehlt Node/Kit, würden die Tests später übersprungen — dann zuerst Tasks 1–2 erledigen.)

- [ ] **Step 3: Implementieren** — `Sources/BrainCore/BrueckenVerbindung.swift`:

```swift
import Foundation

public struct BrueckenAntwort: Sendable, Equatable {
    public let status: Int
    public let headers: [String: String]
    public let body: Data
}

public enum BrueckenFehler: Error, Equatable {
    case startFehlgeschlagen(String)
    case beendet
    case zeitUeberschritten
}

/// Hält den Node-Prozess der Ansicht-Brücke (Kit: .tools/ansicht/bruecke.mjs) und ordnet Antworten über die id zu
/// (App-Spec §5.2 Baustein 4). Stirbt die Brücke, scheitern offene Anfragen mit `.beendet`; die nächste Anfrage
/// startet sie neu (Review-Fokus 4). Schreiben in eine tote Brücke darf die App nie beenden (SIGPIPE aus).
public actor BrueckenVerbindung {
    private struct Roh: Decodable {
        let id: Int?
        let status: Int?
        let headers: [String: String]?
        let body: String?
        let bereit: Bool?
        let version: String?
    }

    private let node: URL
    private let vault: URL
    private let umgebung: [String: String]
    private var prozess: Process?
    private var eingang: FileHandle?
    private var leser: Task<Void, Never>?
    private var naechsteId = 0
    private var wartend: [Int: CheckedContinuation<BrueckenAntwort, Error>] = [:]
    public private(set) var version: String?

    public init(node: URL, vault: URL, umgebung: [String: String] = [:]) {
        self.node = node
        self.vault = vault
        self.umgebung = umgebung
    }

    public var laeuft: Bool { prozess?.isRunning ?? false }
    public var pid: Int32? { laeuft ? prozess?.processIdentifier : nil }

    public func starte(zeitlimit: Duration = .seconds(15)) async throws {
        if laeuft { return }
        signal(SIGPIPE, SIG_IGN)
        version = nil
        let p = Process()
        p.executableURL = node
        p.arguments = [vault.appendingPathComponent(".tools/ansicht/bruecke.mjs").path, vault.path]
        var env = ProcessInfo.processInfo.environment
        env["BRAIN_VAULT"] = vault.path
        for (k, v) in umgebung { env[k] = v }
        p.environment = env
        p.currentDirectoryURL = vault
        let ein = Pipe(), aus = Pipe()
        p.standardInput = ein
        p.standardOutput = aus
        p.standardError = FileHandle.nullDevice
        let (strom, fortsetzung) = AsyncStream.makeStream(of: Data.self)
        aus.fileHandleForReading.readabilityHandler = { h in
            let d = h.availableData
            if d.isEmpty { h.readabilityHandler = nil; fortsetzung.finish() } else { fortsetzung.yield(d) }
        }
        let kennung = ObjectIdentifier(p)
        p.terminationHandler = { [weak self] _ in Task { await self?.prozessEnde(kennung) } }
        do { try p.run() } catch {
            aus.fileHandleForReading.readabilityHandler = nil
            fortsetzung.finish()
            throw BrueckenFehler.startFehlgeschlagen("Die Ansicht konnte nicht gestartet werden.")
        }
        prozess = p
        eingang = ein.fileHandleForWriting
        leser = Task { [weak self] in
            var puffer = Data()
            for await stueck in strom {
                puffer.append(stueck)
                while let nl = puffer.firstIndex(of: 0x0A) {
                    let zeile = Data(puffer[puffer.startIndex..<nl])
                    puffer.removeSubrange(puffer.startIndex...nl)
                    await self?.verarbeite(zeile)
                }
            }
        }
        let frist = ContinuousClock.now + zeitlimit
        while version == nil {
            guard laeuft, ContinuousClock.now < frist else {
                beende()
                throw BrueckenFehler.startFehlgeschlagen("Die Ansicht startet nicht.")
            }
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    public func anfrage(methode: String, pfad: String, body: Data? = nil, zeitlimit: Duration = .seconds(30)) async throws -> BrueckenAntwort {
        if !laeuft { try await starte() }
        guard let eingang else { throw BrueckenFehler.beendet }
        naechsteId += 1
        let id = naechsteId
        let objekt: [String: Any] = ["id": id, "methode": methode, "pfad": pfad,
                                     "body": body.map { $0.base64EncodedString() } ?? NSNull()]
        let zeile = try JSONSerialization.data(withJSONObject: objekt) + Data([0x0A])
        return try await withCheckedThrowingContinuation { (fortsetzung: CheckedContinuation<BrueckenAntwort, Error>) in
            wartend[id] = fortsetzung
            do { try eingang.write(contentsOf: zeile) } catch {
                wartend.removeValue(forKey: id)?.resume(throwing: BrueckenFehler.beendet)
                return
            }
            Task { [weak self] in
                try? await Task.sleep(for: zeitlimit)
                await self?.abgelaufen(id)
            }
        }
    }

    public func beende() {
        try? eingang?.close() // stdin zu → die Brücke beendet sich selbst, nachdem alles geschrieben ist
        eingang = nil
        if let p = prozess {
            Task {
                try? await Task.sleep(for: .seconds(2))
                if p.isRunning { p.terminate() }
            }
        }
    }

    private func verarbeite(_ zeile: Data) {
        guard let r = try? JSONDecoder().decode(Roh.self, from: zeile) else { return }
        if r.bereit == true { version = r.version ?? "?"; return }
        guard let id = r.id, let fortsetzung = wartend.removeValue(forKey: id) else { return }
        fortsetzung.resume(returning: BrueckenAntwort(status: r.status ?? 500, headers: r.headers ?? [:],
                                                     body: Data(base64Encoded: r.body ?? "") ?? Data()))
    }

    private func abgelaufen(_ id: Int) {
        wartend.removeValue(forKey: id)?.resume(throwing: BrueckenFehler.zeitUeberschritten)
    }

    /// Ende eines Brücken-Prozesses. Erst alle noch gelesenen Antworten zustellen, dann den Rest scheitern lassen.
    /// Gehört das Ende zu einem älteren Prozess (schon neu gestartet), wird es ignoriert.
    private func prozessEnde(_ kennung: ObjectIdentifier) async {
        guard let p = prozess, ObjectIdentifier(p) == kennung else { return }
        await leser?.value
        guard let jetzt = prozess, ObjectIdentifier(jetzt) == kennung else { return }
        prozess = nil
        eingang = nil
        let offen = wartend
        wartend.removeAll()
        for (_, fortsetzung) in offen { fortsetzung.resume(throwing: BrueckenFehler.beendet) }
    }
}
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `cd ~/source/brain-app && swift test 2>&1 | tail -8`
Expected: alle PASS; die Suite `BrueckenVerbindungTests` läuft (nicht „skipped“). Wird sie übersprungen: `ls ~/brain-kit-v0.6/.tools/ansicht/bruecke.mjs` und Node prüfen.

- [ ] **Step 5: Commit**

```bash
cd ~/source/brain-app
git add Sources/BrainCore/BrueckenVerbindung.swift Tests/BrainCoreTests/BrueckenVerbindungTests.swift
git commit -m "app: Verbindung zur Ansicht-Brücke mit id-Zuordnung, Zeitlimit und Neustart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: App — Navigationsregel und Übersetzung Schema ↔ Brücke

**Files:**
- Create: `Sources/BrainCore/NavigationsRegel.swift`, `Sources/BrainCore/SchemaAntwort.swift`
- Test: `Tests/BrainCoreTests/NavigationsRegelTests.swift`

**Interfaces:**
- Consumes: `BrueckenAntwort` (Task 11).
- Produces:
  - `NavigationsEntscheidung { erlauben, extern(URL), abbrechen }`; `NavigationsRegel.entscheide(_ url: URL?, hauptrahmen: Bool, vomNutzer: Bool)`; `NavigationsRegel.schema = "brain"`, `.host = "app"`, `.startURL = brain://app/index.html`.
  - `SchemaAntwort.pfad(von: URL) -> String` (Pfad + Query, Kodierung bleibt erhalten), `SchemaAntwort.antwort(url:aus:) -> HTTPURLResponse`, `SchemaAntwort.kanalAntwort(_:) -> [String: Any]` (`["status": Int, "body": String]` für api.js), `SchemaAntwort.anfrage(ausNachricht: Any) -> (methode: String, pfad: String, body: Data?)?` (nur `/api/…`, nur GET/POST/PUT).

- [ ] **Step 1: Failing tests schreiben** — `Tests/BrainCoreTests/NavigationsRegelTests.swift`:

```swift
import Testing
import Foundation
@testable import BrainCore

private func url(_ s: String) -> URL { URL(string: s)! }

@Test func eigeneOberflaecheIstErlaubt() {
    #expect(NavigationsRegel.entscheide(url("brain://app/index.html"), hauptrahmen: true, vomNutzer: false) == .erlauben)
    #expect(NavigationsRegel.entscheide(url("brain://anders/x"), hauptrahmen: true, vomNutzer: true) == .abbrechen)
}

@Test func fremdeLinksOeffnenNurAufKlickImBrowser() {
    let u = url("https://example.com/seite")
    #expect(NavigationsRegel.entscheide(u, hauptrahmen: true, vomNutzer: true) == .extern(u))
    #expect(NavigationsRegel.entscheide(u, hauptrahmen: true, vomNutzer: false) == .abbrechen)
    #expect(NavigationsRegel.entscheide(u, hauptrahmen: false, vomNutzer: true) == .abbrechen)
}

@Test func allesAndereWirdAbgebrochen() {
    for s in ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "ftp://x/y"] {
        #expect(NavigationsRegel.entscheide(URL(string: s), hauptrahmen: true, vomNutzer: true) == .abbrechen, "\(s)")
    }
    #expect(NavigationsRegel.entscheide(nil, hauptrahmen: true, vomNutzer: true) == .abbrechen)
}

@Test func pfadBehaeltQueryUndKodierung() {
    #expect(SchemaAntwort.pfad(von: url("brain://app/index.html")) == "/index.html")
    #expect(SchemaAntwort.pfad(von: url("brain://app/")) == "/")
    #expect(SchemaAntwort.pfad(von: url("brain://app")) == "/")
    #expect(SchemaAntwort.pfad(von: url("brain://app/api/gelesen?seit=1")) == "/api/gelesen?seit=1")
    #expect(SchemaAntwort.pfad(von: url("brain://app/%2e%2e/x")) == "/%2e%2e/x")
}

@Test func antwortTraegtStatusKopfUndLaenge() {
    let a = BrueckenAntwort(status: 404, headers: ["Content-Type": "text/plain"], body: Data("weg".utf8))
    let r = SchemaAntwort.antwort(url: url("brain://app/x"), aus: a)
    #expect(r.statusCode == 404)
    #expect(r.value(forHTTPHeaderField: "Content-Type") == "text/plain")
    #expect(r.value(forHTTPHeaderField: "Content-Length") == "3")
    let k = SchemaAntwort.kanalAntwort(a)
    #expect(k["status"] as? Int == 404)
    #expect(k["body"] as? String == "weg")
}

@Test func kanalNachrichtenWerdenStrengGeprueft() throws {
    let get = try #require(SchemaAntwort.anfrage(ausNachricht: ["methode": "get", "pfad": "/api/daten", "daten": NSNull()]))
    #expect(get.methode == "GET")
    #expect(get.body == nil)
    let put = try #require(SchemaAntwort.anfrage(ausNachricht: ["methode": "PUT", "pfad": "/api/einstellungen", "daten": ["werte": ["a": 1]]]))
    #expect(String(decoding: try #require(put.body), as: UTF8.self) == #"{"werte":{"a":1}}"#)
    #expect(SchemaAntwort.anfrage(ausNachricht: ["methode": "GET", "pfad": "/index.html"]) == nil)
    #expect(SchemaAntwort.anfrage(ausNachricht: ["methode": "DELETE", "pfad": "/api/daten"]) == nil)
    #expect(SchemaAntwort.anfrage(ausNachricht: "kein objekt") == nil)
}
```

- [ ] **Step 2: Tests laufen lassen — müssen scheitern**

Run: `cd ~/source/brain-app && swift test 2>&1 | tail -10`
Expected: Kompilierfehler (Typen fehlen).

- [ ] **Step 3: Implementieren**

`Sources/BrainCore/NavigationsRegel.swift`:
```swift
import Foundation

public enum NavigationsEntscheidung: Equatable, Sendable {
    case erlauben
    case extern(URL)
    case abbrechen
}

/// Das Fenster zeigt nur die eigene Oberfläche (brain://app). Fremde Links öffnen — nur auf Klick, nur im
/// Hauptrahmen — im Standardbrowser; alles andere wird abgebrochen (Review-Fokus 3).
public enum NavigationsRegel {
    public static let schema = "brain"
    public static let host = "app"
    public static let startURL = URL(string: "brain://app/index.html")!

    public static func entscheide(_ url: URL?, hauptrahmen: Bool, vomNutzer: Bool) -> NavigationsEntscheidung {
        guard let url, let s = url.scheme?.lowercased() else { return .abbrechen }
        if s == schema { return url.host == host ? .erlauben : .abbrechen }
        if ["https", "http", "mailto"].contains(s) { return hauptrahmen && vomNutzer ? .extern(url) : .abbrechen }
        return .abbrechen
    }
}
```

`Sources/BrainCore/SchemaAntwort.swift`:
```swift
import Foundation

/// Übersetzt zwischen WebKit (brain://-Anfragen, Nachrichten von api.js) und der Ansicht-Brücke.
public enum SchemaAntwort {
    /// Pfad + Query so, wie sie in der URL kodiert sind — die Brücke prüft Punkt-/Schrägstrich-Kodierungen selbst.
    public static func pfad(von url: URL) -> String {
        guard let k = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return "/" }
        let p = k.percentEncodedPath.isEmpty ? "/" : k.percentEncodedPath
        if let q = k.percentEncodedQuery, !q.isEmpty { return p + "?" + q }
        return p
    }

    public static func antwort(url: URL, aus a: BrueckenAntwort) -> HTTPURLResponse {
        var kopf = a.headers
        kopf["Content-Length"] = String(a.body.count)
        return HTTPURLResponse(url: url, statusCode: a.status, httpVersion: "HTTP/1.1", headerFields: kopf)!
    }

    /// Antwort für den Nachrichtenkanal von api.js: { status, body } mit body als Text (JSON).
    public static func kanalAntwort(_ a: BrueckenAntwort) -> [String: Any] {
        ["status": a.status, "body": String(decoding: a.body, as: UTF8.self)]
    }

    /// Nachricht von api.js → Anfrage an die Brücke. Nur /api/…, nur GET/POST/PUT, Daten als JSON-Objekt.
    public static func anfrage(ausNachricht nachricht: Any) -> (methode: String, pfad: String, body: Data?)? {
        guard let d = nachricht as? [String: Any], let pfad = d["pfad"] as? String, pfad.hasPrefix("/api/") else { return nil }
        let methode = ((d["methode"] as? String) ?? "GET").uppercased()
        guard ["GET", "POST", "PUT"].contains(methode) else { return nil }
        var body: Data?
        if let daten = d["daten"], !(daten is NSNull) {
            guard JSONSerialization.isValidJSONObject(daten),
                  let kodiert = try? JSONSerialization.data(withJSONObject: daten, options: [.sortedKeys]) else { return nil }
            body = kodiert
        }
        return (methode, pfad, body)
    }
}
```

- [ ] **Step 4: Tests laufen lassen — müssen bestehen**

Run: `cd ~/source/brain-app && swift test 2>&1 | tail -5`
Expected: alle PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/source/brain-app
git add Sources/BrainCore/NavigationsRegel.swift Sources/BrainCore/SchemaAntwort.swift Tests/BrainCoreTests/NavigationsRegelTests.swift
git commit -m "app: Navigationsregel und Übersetzung brain:// ↔ Brücke

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: App — das Brain-Fenster (`FensterSteuerung`)

Reine Verdrahtung von AppKit/WebKit mit den getesteten Bausteinen aus Task 11/12; geprüft wird sie durch den Rauchtest in Task 15.

**Files:**
- Create: `Sources/BrainApp/FensterSteuerung.swift`

**Interfaces:**
- Consumes: `BrueckenVerbindung` (Task 11), `NavigationsRegel`, `SchemaAntwort` (Task 12), `AppLog` (Task 6); im Fenster `api.js` mit App-Modus (Task 3) und `window.__brain.ladezeit` (bestehendes `app.js`, gesetzt sobald die Daten geladen sind).
- Produces: `@MainActor final class FensterSteuerung(log: AppLog)` mit `oeffne(node: URL, vault: URL, umgebung: [String: String])`, `schliesse()`, `istOffen: Bool`. Log-Zeilen: `fenster-auf`, `fenster-bereit ladezeit=<ms>`, `fenster-nicht-bereit`, `fenster-zu`.

- [ ] **Step 1: `FensterSteuerung.swift` schreiben**

```swift
import AppKit
import WebKit
import BrainCore

/// Liefert brain://app/… über die Ansicht-Brücke aus (nur GET/HEAD). Gestoppte Aufgaben werden nie mehr bedient.
@MainActor
final class SchemaHandler: NSObject, WKURLSchemeHandler {
    private let bruecke: BrueckenVerbindung
    private var gestoppt = Set<ObjectIdentifier>()

    init(bruecke: BrueckenVerbindung) { self.bruecke = bruecke }

    func webView(_ webView: WKWebView, start aufgabe: any WKURLSchemeTask) {
        let kennung = ObjectIdentifier(aufgabe)
        let methode = aufgabe.request.httpMethod ?? "GET"
        guard let url = aufgabe.request.url, url.host == NavigationsRegel.host, methode == "GET" || methode == "HEAD" else {
            aufgabe.didFailWithError(URLError(.badURL))
            return
        }
        Task { @MainActor in
            defer { gestoppt.remove(kennung) }
            do {
                let a = try await bruecke.anfrage(methode: "GET", pfad: SchemaAntwort.pfad(von: url))
                guard !gestoppt.contains(kennung) else { return }
                aufgabe.didReceive(SchemaAntwort.antwort(url: url, aus: a))
                aufgabe.didReceive(a.body)
                aufgabe.didFinish()
            } catch {
                guard !gestoppt.contains(kennung) else { return }
                aufgabe.didFailWithError(error)
            }
        }
    }

    func webView(_ webView: WKWebView, stop aufgabe: any WKURLSchemeTask) {
        gestoppt.insert(ObjectIdentifier(aufgabe))
    }
}

/// Nachrichtenkanal für api.js (window.webkit.messageHandlers.brain): nur aus dem Hauptrahmen der eigenen
/// Oberfläche, nur /api/…; Antwort { status, body } oder Fehlertext (→ „Dienst nicht erreichbar“ in api.js).
@MainActor
final class Kanal: NSObject, WKScriptMessageHandlerWithReply {
    private let bruecke: BrueckenVerbindung

    init(bruecke: BrueckenVerbindung) { self.bruecke = bruecke }

    func userContentController(_ controller: WKUserContentController, didReceive nachricht: WKScriptMessage) async -> (Any?, String?) {
        guard nachricht.frameInfo.isMainFrame,
              nachricht.frameInfo.request.url?.scheme == NavigationsRegel.schema,
              let a = SchemaAntwort.anfrage(ausNachricht: nachricht.body) else { return (nil, "ungültige Anfrage") }
        do {
            let r = try await bruecke.anfrage(methode: a.methode, pfad: a.pfad, body: a.body)
            return (SchemaAntwort.kanalAntwort(r), nil)
        } catch {
            return (nil, "Dienst nicht erreichbar")
        }
    }
}

/// Hält das Fenster auf brain://app; fremde Links nur auf Klick in den Standardbrowser (Review-Fokus 3).
@MainActor
final class Navigation: NSObject, WKNavigationDelegate {
    var beiGeladen: (() -> Void)?

    func webView(_ webView: WKWebView, decidePolicyFor aktion: WKNavigationAction) async -> WKNavigationActionPolicy {
        let hauptrahmen = aktion.targetFrame?.isMainFrame ?? true
        switch NavigationsRegel.entscheide(aktion.request.url, hauptrahmen: hauptrahmen, vomNutzer: aktion.navigationType == .linkActivated) {
        case .erlauben: return .allow
        case .extern(let url): NSWorkspace.shared.open(url); return .cancel
        case .abbrechen: return .cancel
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { beiGeladen?() }
}

/// Das Brain-Fenster (App-Spec §5.2, §7.2): beim Schließen werden WebView, Kanal und Brücke beendet.
@MainActor
final class FensterSteuerung: NSObject, NSWindowDelegate {
    private let log: AppLog
    private var fenster: NSWindow?
    private var webView: WKWebView?
    private var navigation: Navigation?
    private var bruecke: BrueckenVerbindung?
    private var bereitAufgabe: Task<Void, Never>?

    var istOffen: Bool { fenster != nil }

    init(log: AppLog) { self.log = log }

    func oeffne(node: URL, vault: URL, umgebung: [String: String]) {
        if let fenster {
            fenster.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let bruecke = BrueckenVerbindung(node: node, vault: vault, umgebung: umgebung)
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(SchemaHandler(bruecke: bruecke), forURLScheme: NavigationsRegel.schema)
        config.userContentController.addScriptMessageHandler(Kanal(bruecke: bruecke), contentWorld: .page, name: "brain")
        let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800), configuration: config)
        let navigation = Navigation()
        navigation.beiGeladen = { [weak self] in self?.warteAufBereit() }
        web.navigationDelegate = navigation

        let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 800),
                         styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        w.title = "Brain"
        w.isReleasedWhenClosed = false
        w.contentView = web
        w.setFrameAutosaveName("BrainFenster")
        if w.frame.origin == .zero { w.center() }
        w.delegate = self

        self.bruecke = bruecke
        self.webView = web
        self.navigation = navigation
        self.fenster = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
        web.load(URLRequest(url: NavigationsRegel.startURL))
        log.schreibe("fenster-auf")
    }

    func schliesse() { fenster?.close() }

    func windowWillClose(_ notification: Notification) { aufraeumen() }

    /// Bereit = app.js hat die Daten geladen (window.__brain.ladezeit gesetzt). Höchstens 30 s warten.
    private func warteAufBereit() {
        bereitAufgabe?.cancel()
        bereitAufgabe = Task { @MainActor [weak self] in
            for _ in 0..<120 {
                guard let self, let web = self.webView, !Task.isCancelled else { return }
                let wert = try? await web.evaluateJavaScript("window.__brain && window.__brain.ladezeit ? Math.round(window.__brain.ladezeit) : null")
                if let ms = wert as? NSNumber {
                    self.log.schreibe("fenster-bereit ladezeit=\(ms.intValue)")
                    return
                }
                try? await Task.sleep(for: .milliseconds(250))
            }
            self?.log.schreibe("fenster-nicht-bereit")
        }
    }

    private func aufraeumen() {
        bereitAufgabe?.cancel()
        bereitAufgabe = nil
        if let web = webView {
            web.stopLoading()
            web.navigationDelegate = nil
            web.configuration.userContentController.removeAllScriptMessageHandlers()
            web.removeFromSuperview()
        }
        webView = nil
        navigation = nil
        fenster?.delegate = nil
        fenster = nil
        if let b = bruecke { Task { await b.beende() } }
        bruecke = nil
        log.schreibe("fenster-zu")
    }
}
```

- [ ] **Step 2: Bauen**

Run: `cd ~/source/brain-app && swift build 2>&1 | tail -5`
Expected: `Build complete!` ohne Fehler. (Warnungen zu Sendable im Sprachmodus 5 sind erlaubt; Fehler nicht.)

- [ ] **Step 3: Commit**

```bash
cd ~/source/brain-app
git add Sources/BrainApp/FensterSteuerung.swift
git commit -m "app: Brain-Fenster mit brain://-Schema, Nachrichtenkanal und sauberem Aufräumen

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: App — Menüleiste, Einrichtung, Ablauf beim Start (`AppZustand`)

**Files:**
- Create: `Sources/BrainApp/AppZustand.swift`, `Sources/BrainApp/MenueInhalt.swift`, `Sources/BrainApp/EinrichtungsAnsicht.swift`
- Modify (ersetzen): `Sources/BrainApp/BrainApp.swift`

**Interfaces:**
- Consumes: alles aus BrainCore (Tasks 6–12) und `FensterSteuerung` (Task 13).
- Produces: Menüleisten-App. Log-Zeilen zusätzlich: `start`, `verbunden <pfad>`, `status <ok|hinweis|problem>`, `status-fehler …`, `laufzeit-fehler …`. Entwicklung ohne App-Paket: Umgebungsvariable `BRAIN_APP_NODE=<absoluter Pfad zu node>` ersetzt die mitgelieferte Laufzeit.

- [ ] **Step 1: `AppZustand.swift`**

```swift
import AppKit
import SwiftUI
import BrainCore

/// Zustand und Abläufe der App (App-Spec §9.1/§10): Laufzeit installieren, Brain verbinden, Status zeigen,
/// Fenster öffnen. Schreibt nie selbst ins Brain — nur `config.json` der App unter Application Support.
@MainActor
final class AppZustand: ObservableObject {
    @Published private(set) var anzeige = StatusAnzeige.fuer(nil, fehler: "Wird gestartet …")
    @Published private(set) var status: BrainStatus?
    @Published private(set) var vault: URL?
    @Published private(set) var brauchtEinrichtung = false

    let pfade: AppPfade
    let log: AppLog
    private let argumente = StartArgumente.lies(CommandLine.arguments)
    private let fenster: FensterSteuerung
    private var node: URL?
    private var brainNode = ""
    private var einrichtung: NSWindow?
    private var taktgeber: Task<Void, Never>?

    init() {
        let p = AppPfade.standard()
        let l = AppLog(pfade: p)
        pfade = p
        log = l
        fenster = FensterSteuerung(log: l)
    }

    private var umgebung: [String: String] { ["BRAIN_NODE": brainNode] }

    func starte() async {
        signal(SIGPIPE, SIG_IGN)
        log.schreibe("start")
        do {
            node = try laufzeit()
        } catch {
            anzeige = .problem("Die mitgelieferte Laufzeit fehlt oder ist beschädigt — bitte die App neu installieren.")
            log.schreibe("laufzeit-fehler \(error)")
            return
        }
        brainNode = (await TerminalNode.finde())?.path ?? pfade.node.path
        let gemerkt = AppEinstellungen.lade(pfade).vault.map { URL(fileURLWithPath: $0) }
        if let gewaehlt = argumente.vault ?? gemerkt {
            await verbinde(gewaehlt, merken: argumente.vault == nil)
        } else {
            zeigeEinrichtung()
        }
        taktgeber = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(15 * 60))
                await self?.aktualisiere()
            }
        }
        if argumente.fensterOeffnen { oeffneFenster() }
        if let s = argumente.schliessenNach { Task { try? await Task.sleep(for: s); fenster.schliesse() } }
        if let s = argumente.beendenNach { Task { try? await Task.sleep(for: s); NSApp.terminate(nil) } }
    }

    private func laufzeit() throws -> URL {
        if let dev = ProcessInfo.processInfo.environment["BRAIN_APP_NODE"], dev.hasPrefix("/") {
            return URL(fileURLWithPath: dev)
        }
        guard let ressourcen = Bundle.main.resourceURL else { throw LaufzeitFehler.manifestFehlt }
        return try NodeLaufzeit(quelle: ressourcen.appendingPathComponent("node-runtime"), pfade: pfade).installiere()
    }

    func verbinde(_ ordner: URL, merken: Bool = true) async {
        let pruefung = VaultAuswahl.pruefe(ordner)
        guard pruefung == .ok else {
            vault = nil
            status = nil
            anzeige = .problem(VaultAuswahl.meldung(pruefung) ?? "Brain-Ordner nicht gefunden")
            zeigeEinrichtung()
            return
        }
        vault = ordner
        brauchtEinrichtung = false
        if merken { try? AppEinstellungen(vault: ordner.path).speichere(pfade) }
        log.schreibe("verbunden \(ordner.path)")
        einrichtung?.close()
        einrichtung = nil
        await aktualisiere()
    }

    func aktualisiere() async {
        guard let vault, let node else { return }
        guard VaultAuswahl.pruefe(vault) == .ok else {
            status = nil
            anzeige = .problem("Brain-Ordner nicht gefunden")
            return
        }
        do {
            let s = try await BrainBefehl(node: node, vault: vault, umgebung: umgebung).status()
            status = s
            anzeige = .fuer(s)
            log.schreibe("status \(s.zustand.rawValue)")
        } catch {
            status = nil
            anzeige = .fuer(nil, fehler: "Status gerade nicht abrufbar")
            log.schreibe("status-fehler \(error)")
        }
    }

    func oeffneFenster() {
        guard let vault, let node, VaultAuswahl.pruefe(vault) == .ok else { zeigeEinrichtung(); return }
        fenster.oeffne(node: node, vault: vault, umgebung: umgebung)
    }

    func zeigeOrdner() {
        if let vault { NSWorkspace.shared.activateFileViewerSelecting([vault]) }
    }

    func zeigeEinrichtung() {
        brauchtEinrichtung = true
        if let einrichtung {
            einrichtung.makeKeyAndOrderFront(nil)
            NSApp.activate()
            return
        }
        let w = NSWindow(contentViewController: NSHostingController(rootView: EinrichtungsAnsicht(zustand: self)))
        w.title = "Brain verbinden"
        w.styleMask = [.titled, .closable]
        w.isReleasedWhenClosed = false
        w.center()
        einrichtung = w
        w.makeKeyAndOrderFront(nil)
        NSApp.activate()
    }

    func waehleOrdner() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "Verbinden"
        panel.directoryURL = vault ?? VaultAuswahl.vorschlag() ?? FileManager.default.homeDirectoryForCurrentUser
        if panel.runModal() == .OK, let url = panel.url { Task { await verbinde(url) } }
    }

    func beende() {
        taktgeber?.cancel()
        fenster.schliesse()
    }
}
```

- [ ] **Step 2: `MenueInhalt.swift` und `EinrichtungsAnsicht.swift`**

`Sources/BrainApp/MenueInhalt.swift`:
```swift
import SwiftUI
import BrainCore

/// Menü der Menüleiste: Zustand immer als Symbol + Text (✓ ⚠ ✕ ?), dann Aktionen.
struct MenueInhalt: View {
    @ObservedObject var zustand: AppZustand

    var body: some View {
        Label("\(zustand.anzeige.zeichen) \(zustand.anzeige.titel)", systemImage: zustand.anzeige.symbol)
        if let z = zustand.status?.zahlen {
            Text("Vorschläge \(z.vorschlaege) · Konflikte \(z.konflikte) · abgelaufen \(z.abgelaufen)")
        }
        if zustand.status?.quellVault == true {
            Text("Entwickler-Brain — keine Kit-Updates")
        }
        Divider()
        Button("Brain öffnen") { zustand.oeffneFenster() }.keyboardShortcut("o")
        Button("Ordner im Finder zeigen") { zustand.zeigeOrdner() }.disabled(zustand.vault == nil)
        Button("Status aktualisieren") { Task { await zustand.aktualisiere() } }.keyboardShortcut("r")
        Button("Anderen Brain-Ordner wählen …") { zustand.waehleOrdner() }
        Divider()
        Button("Beenden") { NSApp.terminate(nil) }.keyboardShortcut("q")
    }
}

/// Symbol in der Menüleiste — Form unterscheidet die Zustände, nicht die Farbe.
struct MenueSymbol: View {
    @ObservedObject var zustand: AppZustand

    var body: some View {
        Image(systemName: zustand.anzeige.symbol)
            .accessibilityLabel("Brain: \(zustand.anzeige.titel)")
    }
}
```

`Sources/BrainApp/EinrichtungsAnsicht.swift`:
```swift
import SwiftUI
import BrainCore

/// Einrichtung M1 (App-Spec §9.1): nur „Vorhandenes Brain verbinden“.
struct EinrichtungsAnsicht: View {
    @ObservedObject var zustand: AppZustand
    private let vorschlag = VaultAuswahl.vorschlag()

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Wo liegt dein Brain?").font(.title2.bold())
            Text("Die App verbindet sich mit deinem vorhandenen Brain-Ordner. Sie zeigt ihn an und verändert von selbst nichts darin.")
                .fixedSize(horizontal: false, vertical: true)
            if let vorschlag {
                Label(vorschlag.path, systemImage: "folder")
                Button("Diesen Ordner verbinden") { Task { await zustand.verbinde(vorschlag) } }
                    .keyboardShortcut(.defaultAction)
            }
            Button("Anderen Ordner wählen …") { zustand.waehleOrdner() }
            if zustand.anzeige.zeichen == "✕" {
                Label(zustand.anzeige.titel, systemImage: zustand.anzeige.symbol)
                    .foregroundStyle(.red)
            }
        }
        .padding(24)
        .frame(width: 460)
    }
}
```

- [ ] **Step 3: `BrainApp.swift` ersetzen**

```swift
import AppKit
import SwiftUI
import BrainCore

@MainActor
final class AppDelegat: NSObject, NSApplicationDelegate {
    let zustand = AppZustand()

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { await zustand.starte() }
    }

    func applicationWillTerminate(_ notification: Notification) {
        zustand.beende()
    }
}

@main
struct BrainApp: App {
    @NSApplicationDelegateAdaptor(AppDelegat.self) private var delegat

    var body: some Scene {
        MenuBarExtra {
            MenueInhalt(zustand: delegat.zustand)
        } label: {
            MenueSymbol(zustand: delegat.zustand)
        }
    }
}
```

- [ ] **Step 4: Bauen und kurz von Hand starten (ohne App-Paket)**

```bash
cd ~/source/brain-app && swift build 2>&1 | tail -3
BRAIN_APP_SUPPORT="$(mktemp -d)" BRAIN_APP_NODE=/opt/homebrew/bin/node \
  .build/debug/BrainApp --vault "$HOME/brain-kit-v0.6" --test-fenster --test-beenden-nach 25
```
Expected: Build ok; ein Menüleisten-Symbol erscheint, das Fenster zeigt das 3D-Gehirn des Worktree-Brains, nach 25 s beendet sich die App. (Der Worktree ist ein vollständiges Brain; es wird nur gelesen.)

- [ ] **Step 5: Commit**

```bash
cd ~/source/brain-app
git add Sources/BrainApp/AppZustand.swift Sources/BrainApp/MenueInhalt.swift Sources/BrainApp/EinrichtungsAnsicht.swift Sources/BrainApp/BrainApp.swift
git commit -m "app: Menüleiste mit Status, Einrichtung „vorhandenes Brain verbinden“, Startablauf

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: App — Paket bauen und Rauchtest

**Files:**
- Create: `Ressourcen/Info.plist`, `scripts/baue-app.sh`, `scripts/rauchtest.sh`

**Interfaces:**
- Consumes: `build/node-runtime/` (Task 7), App aus Task 14, Log-Zeilen aus Task 13/14, Start-Argumente (Task 10), Kit-Worktree.
- Produces: `build/Brain.app` (arm64, ad-hoc signiert, `LSUIElement`), Laufzeit unter `Contents/Resources/node-runtime/`. Der Rauchtest ist die Abnahmeprüfung von M1 für „kein Port“, „Fenster bereit“ und „Fenster zu = Brücke weg“.

- [ ] **Step 1: Rauchtest zuerst schreiben** — `scripts/rauchtest.sh`:

```bash
#!/bin/bash
# Rauchtest M1 (App-Spec §13.1/§13.3): startet build/Brain.app gegen ein Test-Brain mit Leerzeichen im Namen,
# öffnet das Fenster und prüft: Status gelesen, Fenster bereit, KEIN Netzwerk-Port, Fenster zu → Brücke beendet.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
APP="$W/build/Brain.app"
KIT="${BRAIN_TEST_KIT:-$HOME/brain-kit-v0.6}"
[ -x "$APP/Contents/MacOS/BrainApp" ] || { echo "FAIL: zuerst bash scripts/baue-app.sh"; exit 1; }
[ -f "$KIT/.tools/ansicht/bruecke.mjs" ] || { echo "FAIL: Kit-Worktree fehlt: $KIT"; exit 1; }
BASIS="$(mktemp -d)"
VAULT="$BASIS/Test Brain"
mkdir -p "$VAULT"
cp -R "$KIT/.tools/tests/fixture/." "$VAULT/"
ln -s "$KIT/.tools" "$VAULT/.tools"
export BRAIN_APP_SUPPORT="$BASIS/support"
LOG="$BRAIN_APP_SUPPORT/logs/app.log"
"$APP/Contents/MacOS/BrainApp" --vault "$VAULT" --test-fenster --test-fenster-schliessen-nach 20 --test-beenden-nach 35 &
PID=$!
warte() { for _ in $(seq 1 "$2"); do grep -Eq "$1" "$LOG" 2>/dev/null && return 0; sleep 0.25; done; return 1; }
fehl() { echo "FAIL: $1"; tail -20 "$LOG" 2>/dev/null || true; kill "$PID" 2>/dev/null || true; exit 1; }
warte "status (ok|hinweis|problem)" 80 || fehl "Status wurde nicht gelesen"
warte "fenster-bereit" 120 || fehl "Fenster wurde nicht bereit"
KINDER="$(pgrep -P "$PID" | paste -sd, - || true)"
if lsof -nP -a -i -p "$PID${KINDER:+,$KINDER}" 2>/dev/null | grep -q .; then fehl "App-Prozess hat eine Netzwerkverbindung oder einen Port offen"; fi
pgrep -P "$PID" -f "bruecke.mjs" >/dev/null || fehl "Brücke läuft nicht, obwohl das Fenster offen ist"
warte "fenster-zu" 100 || fehl "Fenster wurde nicht geschlossen"
sleep 3
if pgrep -P "$PID" -f "bruecke.mjs" >/dev/null; then fehl "Brücke läuft nach dem Schließen weiter"; fi
wait "$PID" || true
echo "OK Rauchtest"
```

- [ ] **Step 2: Rauchtest laufen lassen — muss scheitern**

Run: `cd ~/source/brain-app && bash scripts/rauchtest.sh`
Expected: `FAIL: zuerst bash scripts/baue-app.sh`.

- [ ] **Step 3: `Ressourcen/Info.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key><string>io.github.fbrogno.brain</string>
    <key>CFBundleName</key><string>Brain</string>
    <key>CFBundleDisplayName</key><string>Brain</string>
    <key>CFBundleExecutable</key><string>BrainApp</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleShortVersionString</key><string>0.1.0</string>
    <key>CFBundleVersion</key><string>1</string>
    <key>LSMinimumSystemVersion</key><string>26.0</string>
    <key>LSUIElement</key><true/>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
```

- [ ] **Step 4: `scripts/baue-app.sh`**

```bash
#!/bin/bash
# Baut build/Brain.app (nur arm64): Release-Build, Paket-Struktur, mitgelieferte Node-Laufzeit, Ad-hoc-Signatur.
# Das Node behält seine Original-Signatur (Prüfsumme im Manifest bleibt gültig); Developer-ID-Signatur und
# Notarisierung kommen in M5.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
cd "$W"
[ -f build/node-runtime/manifest.json ] || bash scripts/hole-node.sh
swift build -c release --arch arm64
BIN="$(swift build -c release --arch arm64 --show-bin-path)/BrainApp"
APP="$W/build/Brain.app"
NEU="$W/build/Brain.app.neu"
rm -rf "$NEU"
mkdir -p "$NEU/Contents/MacOS" "$NEU/Contents/Resources"
cp "$BIN" "$NEU/Contents/MacOS/BrainApp"
cp Ressourcen/Info.plist "$NEU/Contents/Info.plist"
cp -R build/node-runtime "$NEU/Contents/Resources/node-runtime"
codesign --force --sign - "$NEU"
codesign --verify --strict "$NEU"
rm -rf "$APP"
mv "$NEU" "$APP"
echo "Gebaut: $APP"
```

- [ ] **Step 5: Bauen und Rauchtest — muss bestehen**

Run: `cd ~/source/brain-app && bash scripts/baue-app.sh && bash scripts/rauchtest.sh`
Expected: `Gebaut: …/build/Brain.app`, danach `OK Rauchtest`.

- [ ] **Step 6: Commit**

```bash
cd ~/source/brain-app
git add Ressourcen/Info.plist scripts/baue-app.sh scripts/rauchtest.sh
git commit -m "app: Brain.app bauen (arm64, Laufzeit im Paket) und Rauchtest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: App — erste Speichermessung

**Files:**
- Create: `scripts/messe-speicher.sh`, `docs/messungen/<JJJJ-MM-TT>-m1-speicher.md` (vom Skript erzeugt)

**Interfaces:**
- Consumes: `build/Brain.app`, Start-Argumente, Log-Zeilen `status …`, `fenster-bereit`, `fenster-zu`.
- Produces: Messprotokoll mit den Zielwerten aus App-Spec §7.1 („nur Menüleiste ≤ 60 MB“, „Fenster offen mit 3D ≤ 600 MB“). Die Messung bewertet, sie bricht nicht ab — Überschreitungen werden im Protokoll markiert und dem Auftraggeber gemeldet.

- [ ] **Step 1: `scripts/messe-speicher.sh` schreiben**

```bash
#!/bin/bash
# Speichermessung M1 (App-Spec §7.1, §13.2): physischer Speicher (Spalte MEM von top = phys_footprint, wie die
# Aktivitätsanzeige „Speicher“) von App, Brücke und den neuen WebKit-Prozessen des Fensters.
set -euo pipefail
W="$(cd "$(dirname "$0")/.." && pwd)"
APP="$W/build/Brain.app/Contents/MacOS/BrainApp"
KIT="${BRAIN_TEST_KIT:-$HOME/brain-kit-v0.6}"
VAULT_ECHT="${1:-$KIT}"   # gemessen wird mit einem vollständigen Brain (Standard: der Kit-Worktree)
[ -x "$APP" ] || { echo "zuerst bash scripts/baue-app.sh"; exit 1; }

mem_mb() {   # Summe in MB über alle übergebenen PIDs
  local s=0 p v
  for p in "$@"; do
    v="$(top -l 1 -stats pid,mem -pid "$p" 2>/dev/null | awk -v p="$p" '$1==p {v=$2; sub(/[+-]$/,"",v); u=substr(v,length(v)); n=substr(v,1,length(v)-1)+0; if(u=="K") n/=1024; else if(u=="G") n*=1024; else if(u=="B") n/=1048576; printf "%.0f", n}')"
    s=$((s + ${v:-0}))
  done
  echo "$s"
}
webkit() { pgrep -f "com.apple.WebKit" | sort || true; }
warte() { for _ in $(seq 1 "$3"); do grep -Eq "$2" "$1" 2>/dev/null && return 0; sleep 0.25; done; return 1; }

# 1) nur Menüleiste (Fenster nie geöffnet)
S1="$(mktemp -d)"
BRAIN_APP_SUPPORT="$S1" "$APP" --vault "$VAULT_ECHT" --test-beenden-nach 30 &
P1=$!
warte "$S1/logs/app.log" "status (ok|hinweis|problem)" 80
sleep 5
MENUE="$(mem_mb "$P1" $(pgrep -P "$P1" || true))"
wait "$P1" || true

# 2) Fenster offen (mit 3D), 3) Fenster wieder zu
S2="$(mktemp -d)"
VORHER="$(webkit)"
BRAIN_APP_SUPPORT="$S2" "$APP" --vault "$VAULT_ECHT" --test-fenster --test-fenster-schliessen-nach 25 --test-beenden-nach 60 &
P2=$!
warte "$S2/logs/app.log" "fenster-bereit" 120
sleep 5
NEU="$(comm -13 <(echo "$VORHER") <(webkit) | tr '\n' ' ')"
OFFEN="$(mem_mb "$P2" $(pgrep -P "$P2" || true) $NEU)"
warte "$S2/logs/app.log" "fenster-zu" 120
sleep 10
REST="$(for p in $NEU; do kill -0 "$p" 2>/dev/null && echo "$p"; done | tr '\n' ' ')"
ZU="$(mem_mb "$P2" $(pgrep -P "$P2" || true) $REST)"
wait "$P2" || true

bewerte() { [ "$1" -le "$2" ] && echo "✓ ja" || echo "✕ nein"; }
DATUM="$(date +%Y-%m-%d)"
mkdir -p "$W/docs/messungen"
DATEI="$W/docs/messungen/$DATUM-m1-speicher.md"
cat > "$DATEI" <<PROTOKOLL
# Speichermessung M1 — $DATUM

Gerät: $(sysctl -n machdep.cpu.brand_string), $(( $(sysctl -n hw.memsize) / 1073741824 )) GB, macOS $(sw_vers -productVersion).
Brain: \`$VAULT_ECHT\`. Messgröße: physischer Speicher (top MEM), App + Kindprozesse + neue WebKit-Prozesse.

| Zustand | gemessen | Ziel (Spec §7.1) | erfüllt |
|---|---|---|---|
| Nur Menüleiste, Fenster nie geöffnet | $MENUE MB | ≤ 60 MB | $(bewerte "$MENUE" 60) |
| Fenster offen, 3D sichtbar | $OFFEN MB | ≤ 600 MB | $(bewerte "$OFFEN" 600) |
| Fenster wieder zu | $ZU MB | ≤ 60 MB | $(bewerte "$ZU" 60) |
PROTOKOLL
cat "$DATEI"
```

- [ ] **Step 2: Messung laufen lassen**

Run: `cd ~/source/brain-app && bash scripts/messe-speicher.sh`
Expected: Tabelle mit drei Zeilen und Zahlen > 0. Ist ein Wert 0, hat `top` den Prozess nicht gefunden — dann einmal `top -l 1 -stats pid,mem -pid <pid>` von Hand ansehen und das awk-Muster an die Ausgabe anpassen. Überschreitungen **nicht** wegoptimieren, sondern im Bericht an den Auftraggeber nennen.

- [ ] **Step 3: Commit**

```bash
cd ~/source/brain-app
git add scripts/messe-speicher.sh docs/messungen/
git commit -m "app: erste Speichermessung M1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Abschluss — Prüfen, Review, Kit zusammenführen, App in den Alltag

**Files:**
- Keine neuen Dateien; ändert `~/brain` (Merge von `kit-v0.6`) und legt `~/Applications/Brain.app` ab.

**Interfaces:**
- Consumes: alles aus Tasks 1–16.
- Produces: Kit-Änderungen auf `main` von `~/brain`; Fabio nutzt `~/Applications/Brain.app` mit seinem echten Brain.

- [ ] **Step 1: Alles grün — auch mit dem Node der App**

```bash
cd ~/brain-kit-v0.6 && bash .tools/tests/run-all.sh 2>&1 | tail -3
PATH="$HOME/source/brain-app/build/node-runtime/bin:$PATH" bash .tools/tests/run-all.sh 2>&1 | tail -3
cd ~/source/brain-app && swift test 2>&1 | tail -3 && bash scripts/test-hole-node.sh && bash scripts/baue-app.sh && bash scripts/rauchtest.sh
```
Expected: beide Kit-Läufe Exit 0 (mit Homebrew-Node und mit dem App-Node), Swift-Tests grün, `OK hole-node`, `OK Rauchtest`.

- [ ] **Step 2: Abschluss-Review (genau einer, Opus, frischer Kontext)** — ein Review-Subagent bekommt: diese Plan-Datei, die Spec, `git -C ~/brain-kit-v0.6 diff main...kit-v0.6` und `git -C ~/source/brain-app log -p` seit dem Spec-Commit. Prüfauftrag: Korrektheit, Sicherheit der Brücke (kein Weg von fremden Seiten/Prozessen an Brain-Inhalte), Review-Fokus 1–5, Global Constraints. Befunde bewerten, berechtigte beheben (eigener Commit je Befund), danach Step 1 wiederholen.

- [ ] **Step 3: Fabio fragen, bevor das Live-Brain geändert wird** — eine Zeile: *schreibt: Merge `kit-v0.6` → `main` in `~/brain` (nur `.tools/`) · Ziel: Live-Brain · Rückweg: `git -C ~/brain revert -m 1 <merge-commit>` · Dry-Run: `git -C ~/brain merge --no-commit --no-ff kit-v0.6` und danach `git -C ~/brain merge --abort`.* Erst nach seinem ausdrücklichen Okay weiter.

- [ ] **Step 4: Zusammenführen und im Live-Brain prüfen**

```bash
git -C ~/brain merge --no-ff kit-v0.6 -m "kit: Ansicht-Brücke, App-Modus, brain status, BRAIN_NODE (M1 Brain-App)"
cd ~/brain && bash .tools/tests/run-all.sh 2>&1 | tail -3
node .tools/brain.mjs status
```
Expected: Merge ohne Konflikt (nur `.tools/`), Suite grün, `brain status` zeigt eine Zeile mit ✓/⚠/✕ und „(Entwickler-Brain)“. `brain zeig` öffnet die Ansicht im Browser wie bisher.

- [ ] **Step 5: App in den Alltag**

```bash
ditto ~/source/brain-app/build/Brain.app ~/Applications/Brain.app
open ~/Applications/Brain.app
```
Expected: Einrichtungsfenster schlägt `~/brain` vor → „Diesen Ordner verbinden“ → Menüleiste zeigt den Zustand und „Entwickler-Brain — keine Kit-Updates“; „Brain öffnen“ zeigt das 3D-Gehirn. Danach `git -C ~/brain status --short` — es dürfen keine von der App verursachten Änderungen auftauchen (nur, was Fabio selbst angeklickt hat).

- [ ] **Step 6: Abschluss melden** — Fabio in Alltagssprache berichten: was läuft, die Messwerte aus `docs/messungen/`, offene Punkte für M2 (u. a. `werkzeuge.node` in der Config, Wahrheits-Regeln, Kern v2).
