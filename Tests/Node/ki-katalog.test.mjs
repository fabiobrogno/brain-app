// KI-Katalog (gemeinsam/ki-katalog.json): Schema, Logos (vorhanden, sauber, belegt), Studio-Datei passt, Erkennung aller Katalog-Einträge.
// Nur gefälschte Programme und Apps in Wegwerf-Ordnern, nie ein echtes claude.
import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, chmodSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmp, pfad } from "./hilfe.mjs";
process.env.HOME = tmp("brain-home-"); // os.homedir() liest $HOME: nichts aus dem echten Home

const { ladeKatalog, pruefeKatalog, logoVon, KATALOG_DATEI, LOGO_ORDNER } = await import(pfad("gemeinsam", "ki-katalog.mjs"));
const { erkenneKatalog } = await import(pfad("gemeinsam", "ki.mjs"));
const { baueStudioKatalog, pruefeSvg, ZIEL } = await import(new URL("../../scripts/erzeuge-ki-katalog.mjs", import.meta.url).href);
const { ADAPTER } = await import(pfad("werkstatt", "ki-programme", "index.mjs"));

const katalog = ladeKatalog();
const herkunft = readFileSync(join(LOGO_ORDNER, "HERKUNFT.md"), "utf8");

test("Katalog: Schema in Ordnung, Reihenfolge und beliebte KIs wie vorgesehen", () => {
  assert.deepEqual(pruefeKatalog(JSON.parse(readFileSync(KATALOG_DATEI, "utf8"))), []);
  assert.ok(katalog.length >= 40, `Terminal-KIs von Orca plus Editoren und Apps (${katalog.length})`);
  assert.deepEqual(katalog.slice(0, 6).map((e) => e.id), ["claude", "codex", "cursor", "gemini", "copilot", "opencode"], "Claude Code zuerst, dann Codex, Cursor, Gemini CLI, Copilot, OpenCode");
  assert.deepEqual(katalog.filter((e) => e.beliebt).map((e) => e.id), ["claude", "codex", "cursor", "gemini", "copilot", "opencode"]);
  assert.equal(new Set(katalog.map((e) => e.name)).size, katalog.length, "Anzeigenamen eindeutig");
  const befehle = katalog.flatMap((e) => e.befehle);
  assert.equal(new Set(befehle).size, befehle.length, "kein Befehl gehört zu zwei Einträgen");
  for (const art of ["terminal", "app", "editor"]) assert.ok(katalog.some((e) => e.art === art), `Art ${art} kommt vor`);
});

test("Katalog: verbindbar ist genau, was Kortex wirklich eintragen kann", () => {
  const verbindbar = katalog.filter((e) => e.verbindbar).map((e) => e.id).sort();
  assert.deepEqual(verbindbar, ["claude", "codex", ...Object.keys(ADAPTER)].sort());
});

test("Katalog: Prüfung erkennt kaputte Einträge", () => {
  const gut = JSON.parse(readFileSync(KATALOG_DATEI, "utf8"));
  const mit = (aendere) => { const k = structuredClone(gut); aendere(k); return pruefeKatalog(k); };
  assert.ok(mit((k) => { k.eintraege[1].id = k.eintraege[0].id; }).some((f) => /doppelt/.test(f)));
  assert.ok(mit((k) => { k.eintraege[0].art = "kuehlschrank"; }).some((f) => /art/.test(f)));
  assert.ok(mit((k) => { k.eintraege[0].befehle = ["rm -rf"]; }).some((f) => /befehle/.test(f)));
  assert.ok(mit((k) => { k.eintraege[0].befehle = []; k.eintraege[0].apps = []; }).some((f) => /weder Befehl noch App/.test(f)));
  assert.ok(mit((k) => { k.eintraege[0].website = "http://unsicher.example"; }).some((f) => /website/.test(f)));
  assert.ok(mit((k) => { k.eintraege[0].name = "Ein sehr, sehr langer Name, der in keine Karte passt"; }).some((f) => /name/.test(f)));
  assert.ok(mit((k) => { k.eintraege[0].logo = { datei: "../x.svg", modus: "einfarbig", farbe: null, ansicht: "0 0 1 1" }; }).some((f) => /datei/.test(f)));
  assert.ok(mit((k) => { k.eintraege[0].logo = { datei: "x.svg", modus: "marke", farbe: null, ansicht: "0 0 1 1" }; }).some((f) => /farbe/.test(f)));
  assert.ok(mit((k) => { k.eintraege[0].logo = { datei: "x.svg", modus: "einfarbig", farbe: null, ansicht: null }; }).some((f) => /ansicht/.test(f)));
  assert.ok(mit((k) => { const e = k.eintraege.find((x) => x.teilt_logo); e.teilt_logo = "gibt-es-nicht"; }).some((f) => /teilt_logo/.test(f)));
});

test("Logos: jede Datei da, sauber, mit Quelle, Datum und Lizenz in HERKUNFT.md; keine unbelegten Dateien im Ordner", () => {
  const dateien = new Set();
  for (const e of katalog) {
    const l = logoVon(e, katalog);
    if (!l) continue;
    dateien.add(l.datei);
    const p = join(LOGO_ORDNER, l.datei);
    const groesse = statSync(p).size;
    if (l.datei.endsWith(".svg")) {
      const text = readFileSync(p, "utf8");
      assert.deepEqual(pruefeSvg(text), [], `${l.datei} ist sauber`);
      assert.ok(groesse <= 12 * 1024, `${l.datei}: ${groesse} Byte`);
    } else {
      const b = readFileSync(p);
      assert.equal(b.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${l.datei} ist ein PNG`);
      const [w, h] = [b.readUInt32BE(16), b.readUInt32BE(20)];
      assert.ok(w >= 64 && h >= 64 && w === h, `${l.datei}: ${w}×${h} (quadratisch, mindestens 64 px)`);
      assert.ok(groesse <= 24 * 1024, `${l.datei}: ${groesse} Byte`);
    }
    // eine Zeile der Tabelle in HERKUNFT.md: Datei, Quelle (https), Datum und Lizenz bzw. Markenhinweis
    const zeile = herkunft.split("\n").find((z) => z.startsWith("|") && z.includes("`" + l.datei + "`"));
    assert.ok(zeile, `${l.datei}: Zeile in HERKUNFT.md fehlt`);
    assert.match(zeile, /https:\/\//, `${l.datei}: Quelle-URL`);
    assert.match(zeile, /20\d\d-\d\d-\d\d/, `${l.datei}: Abrufdatum`);
    assert.match(zeile, /CC0|Marke des Inhabers/, `${l.datei}: Lizenz bzw. Markenhinweis`);
  }
  // github.svg gehört zu keinem Katalog-Eintrag (Marke für marken.js), ist aber genauso belegt
  const gh = herkunft.split("\n").find((z) => z.startsWith("|") && z.includes("`github.svg`"));
  assert.ok(gh, "github.svg: Zeile in HERKUNFT.md fehlt");
  assert.match(gh, /https:\/\/.*20\d\d-\d\d-\d\d.*CC0/, "github.svg: Quelle, Abrufdatum und Lizenz");
  const ordner = readdirSync(LOGO_ORDNER).filter((f) => /\.(svg|png)$/.test(f));
  for (const f of ordner) assert.ok(dateien.has(f) || f === "github.svg", `${f} liegt im Logo-Ordner, gehört aber zu keinem Katalog-Eintrag`);
});

test("Logos: Markenfarbe nur bei mindestens 3:1 Kontrast auf Weiß UND auf dem dunklen Fenster", () => {
  const lum = (hex) => { const w = parseInt(hex.slice(1), 16); const k = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * k((w >> 16) & 255) + 0.7152 * k((w >> 8) & 255) + 0.0722 * k(w & 255); };
  const kontrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const marken = katalog.filter((e) => e.logo?.modus === "marke");
  assert.ok(marken.length >= 2);
  for (const e of marken) {
    assert.ok(kontrast(e.logo.farbe, "#FFFFFF") >= 3 && kontrast(e.logo.farbe, "#1E1E1E") >= 3, `${e.name}: ${e.logo.farbe}`);
  }
});

test("Studio: ki-katalog.js ist genau das, was der Erzeuger aus Katalog und Logos baut", () => {
  assert.equal(readFileSync(ZIEL, "utf8"), baueStudioKatalog(), "node scripts/erzeuge-ki-katalog.mjs ausführen");
  const js = readFileSync(ZIEL, "utf8");
  assert.ok(js.length < 700 * 1024, `Studio-Katalog ${(js.length / 1024).toFixed(0)} KB`);
  assert.ok(!/<script|<foreignObject|javascript:|https?:\/\/(?!www\.w3\.org)/.test(js.replace(/"website":"[^"]*"/g, "")), "kein Verweis nach außen außer den Webseiten");
});

test("Erkennung: Befehle und Apps des Katalogs werden gefunden, die Version kommt aus --version bzw. Info.plist", async () => {
  const bin = tmp("brain-kat-bin-"), apps = tmp("brain-kat-apps-"), home = tmp("brain-kat-home-");
  const skript = (name, ausgabe) => { const p = join(bin, name); writeFileSync(p, `#!/bin/sh\necho "${ausgabe}"\n`); chmodSync(p, 0o755); };
  skript("aider", "aider 0.86.1"); skript("claude", "2.1.310 (Claude Code)"); skript("qodercli", "qoder 1.2.3");
  mkdirSync(join(apps, "Windsurf.app", "Contents"), { recursive: true });
  writeFileSync(join(apps, "Windsurf.app", "Contents", "Info.plist"), "<plist><dict><key>CFBundleShortVersionString</key><string>1.9.0</string></dict></plist>");
  const env = { ...process.env, PATH: bin, BRAIN_TESTMODUS: "1", BRAIN_CLAUDE_EXTRA: "" };
  const erg = await erkenneKatalog({ env, home, appOrdner: apps, neu: true, limit: 20_000 });
  assert.deepEqual(erg.map((e) => e.id), katalog.map((e) => e.id), "alle Einträge in Katalog-Reihenfolge");
  const nach = Object.fromEntries(erg.map((e) => [e.id, e]));
  assert.deepEqual(nach.aider, { id: "aider", gefunden: true, version: "0.86.1", quelle: "cli" });
  assert.deepEqual(nach.claude, { id: "claude", gefunden: true, version: "2.1.310", quelle: "cli" });
  assert.deepEqual(nach.qoder, { id: "qoder", gefunden: true, version: "1.2.3", quelle: "cli" }, "Programmname weicht von der id ab");
  assert.deepEqual(nach.windsurf, { id: "windsurf", gefunden: true, version: "1.9.0", quelle: "app" });
  for (const id of ["codex", "gemini", "goose", "zed", "warp", "vscode"]) assert.deepEqual(nach[id], { id, gefunden: false, version: null, quelle: null }, id);
  assert.equal(Object.keys(nach.aider).sort().join(), "gefunden,id,quelle,version");
  // Änderungen am Ergebnis berühren den Zwischenspeicher nicht
  erg[0].gefunden = false;
  assert.equal((await erkenneKatalog({ env, home, appOrdner: apps, limit: 20_000 }))[0].gefunden, true);
});
