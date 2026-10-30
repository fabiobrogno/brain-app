#!/usr/bin/env node
// Messung für große Vaults: Suche (brain_suchen / minisuche) und Nachladen im Studio nach einer Änderung — vorher/nachher.
//   node scripts/messe-grosse-vaults.mjs [Anzahl …]      Standard: 5000 20000
//   --ohne-repo                                              Vault ohne Git-Repository (Standard: mit Repository, wie bei echten Vaults)
//   --json                                                  Ergebnis als JSON statt Markdown-Tabelle
// Alles in Temp-Ordnern (synthetischer Vault, eigenes HOME/Support, gesäuberte Git-Umgebung); nichts davon berührt echte Nutzerorte.
// „Vorher“ = Suche ohne Cache (Tests/Node/minisuche-referenz.mjs) bzw. Studio-Nachladen wie bisher: GET /api/baum + notizen + typen + ansichten.
// „Nachher“ = Index-Cache bzw. POST /api/teilindex (nur die geänderte Datei). Zeiten in ms (Median), ein Prozess, Betriebssystem-Cache warm.
import { mkdtempSync, rmSync, realpathSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const hier = dirname(fileURLToPath(import.meta.url));
const wurzel = join(hier, "..");
const args = process.argv.slice(2);
const ohneGit = args.includes("--ohne-repo"), alsJson = args.includes("--json");
const anzahlen = args.filter((a) => /^\d+$/.test(a)).map(Number);
if (!anzahlen.length) anzahlen.push(5000, 20000);

// Hermetisch: eigenes HOME und Support-Ordner, keine Git-Konfiguration des Nutzers, kein Vertrauensprüfstand der echten App.
const sandkasten = realpathSync(mkdtempSync(join(tmpdir(), "brain-messung-")));
process.env.HOME = sandkasten; process.env.USERPROFILE = sandkasten;
process.env.BRAIN_APP_SUPPORT = join(sandkasten, "support");
process.env.BRAIN_TESTMODUS = "1"; process.env.KORTEX_VAULT_VERTRAUT = "alle"; process.env.BRAIN_NUTZUNG = "aus";
for (const k of ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL", "BRAIN_VAULT"]) delete process.env[k];
for (const k of Object.keys(process.env)) if (k.startsWith("GIT_")) delete process.env[k];
process.env.GIT_CONFIG_GLOBAL = "/dev/null"; process.env.GIT_CONFIG_NOSYSTEM = "1";
process.on("exit", () => { try { rmSync(sandkasten, { recursive: true, force: true }); } catch { /* egal */ } });

const { baueGrossVault } = await import(pathToFileURL(join(wurzel, "Tests", "Node", "gross-vault.mjs")).href);
const { minisucheReferenz } = await import(pathToFileURL(join(wurzel, "Tests", "Node", "minisuche-referenz.mjs")).href);
const { minisuche, leereMinisucheCache, minisucheStand } = await import(pathToFileURL(join(wurzel, "Ressourcen", "kern", "minisuche.mjs")).href);
const { oeffneVault } = await import(pathToFileURL(join(wurzel, "Ressourcen", "gemeinsam", "vault.mjs")).href);

const ms = (f) => { const t = process.hrtime.bigint(); const r = f(); return [Number(process.hrtime.bigint() - t) / 1e6, r]; };
const msA = async (f) => { const t = process.hrtime.bigint(); const r = await f(); return [Number(process.hrtime.bigint() - t) / 1e6, r]; };
const median = (l) => { const s = [...l].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const runde = (x) => (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10);
const git = (cwd, ...a) => execFileSync("git", a, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "Messung", GIT_AUTHOR_EMAIL: "m@example.org", GIT_COMMITTER_NAME: "Messung", GIT_COMMITTER_EMAIL: "m@example.org" }, stdio: "ignore" });

const ergebnisse = [];
for (const n of anzahlen) {
  process.stderr.write(`\n== ${n} Dateien: Vault erzeugen …\n`);
  const g = baueGrossVault(n, { start: 42 });
  const bytes = g.dateien.reduce((s, r) => s + 1, 0) && 0;
  if (!ohneGit) {
    process.stderr.write("   Git-Repository anlegen und committen …\n");
    git(g.vault, "init", "-q", "-b", "main"); git(g.vault, "add", "--", "."); git(g.vault, "commit", "-q", "-m", "Start");
  }
  const fragen = Array.from({ length: 6 }, () => `${g.wort()} ${g.wort()} ${g.wort()}`);
  const r = { n };

  // ---------- Suche: Kern (minisuche) ----------
  process.stderr.write("   Suche …\n");
  leereMinisucheCache();
  const altErst = ms(() => minisucheReferenz(g.vault, fragen[0], 15))[0];
  const altFolge = median(fragen.slice(1).map((f) => ms(() => minisucheReferenz(g.vault, f, 15))[0]));
  const neuErst = ms(() => minisuche(g.vault, fragen[0], 15))[0];
  const neuFolge = median(fragen.slice(1).map((f) => ms(() => minisuche(g.vault, f, 15))[0]));
  // Nach einer Änderung: eine Datei neu schreiben, dann suchen
  const ziel = g.dateien[Math.floor(n / 2)];
  g.aendere(ziel); const t0 = new Date(Date.now() - 3600 * 1000); utimesSync(join(g.vault, ziel), t0, t0);
  const altNachAenderung = ms(() => minisucheReferenz(g.vault, fragen[1], 15))[0];
  const neuNachAenderung = ms(() => minisuche(g.vault, fragen[1], 15))[0];
  // Gleichheit der Treffer (Pfade und Punktzahlen)
  const gleich = fragen.every((f) => JSON.stringify(minisuche(g.vault, f, 15)) === JSON.stringify(minisucheReferenz(g.vault, f, 15)));
  r.suche = { altErst, altFolge, neuErst, neuFolge, altNachAenderung, neuNachAenderung, gleich, speicherMB: Math.round(process.memoryUsage().heapUsed / 1e6), stand: minisucheStand() };

  // ---------- Suche: brain_suchen (Vault-Objekt wie im MCP-Prozess; Cache schon warm → „folgende“) ----------
  const v = oeffneVault(g.vault, { ohneUnterVaults: true });
  leereMinisucheCache();
  const [mcpErst] = await msA(() => v.suchenFuerKi(fragen[0], 5));
  const mcpFolge = median(await Promise.all([]).then(async () => { const l = []; for (const f of fragen.slice(1)) l.push((await msA(() => v.suchenFuerKi(f, 5)))[0]); return l; }));
  r.mcp = { erst: mcpErst, folge: mcpFolge };

  // ---------- Studio: Nachladen nach einer Änderung ----------
  process.stderr.write("   Studio-Nachladen …\n");
  const alle = async () => { const [b, i] = await Promise.all([Promise.resolve().then(() => v.baum()), Promise.all([v.notizen(), v.typen(), v.ansichten()])]); return { baum: b, n: i[0], t: i[1], a: i[2] }; };
  const [erstLaden, erst] = await msA(alle);                         // kaltes Laden (liest alle Dateien einmal)
  const jsonBytes = (o) => Buffer.byteLength(JSON.stringify(o));
  const antwortBytes = jsonBytes(erst.baum) + jsonBytes(erst.n) + jsonBytes(erst.t) + jsonBytes(erst.a);
  const rohText = JSON.stringify(erst.baum) + JSON.stringify(erst.n) + JSON.stringify(erst.t) + JSON.stringify(erst.a);
  const [parseMs] = ms(() => { JSON.parse(JSON.stringify(erst.baum)); JSON.parse(JSON.stringify(erst.n)); });
  // Client-Aufbau nach dem Laden: Karte pfad→Eintrag und Signatur über alle Notizen (wie ladeBaum/zeichneNachIndex in studio/app.js)
  const [clientVoll] = ms(() => {
    const m = new Map(erst.baum.eintraege.map((e) => [e.pfad, e]));
    const nm = new Map(erst.n.notizen.map((x) => [x.pfad, x]));
    return erst.n.notizen.length + ":" + erst.n.notizen.map((x) => `${x.pfad}|${x.geaendert}|${x.titel}|${x.stufe}|${x.typ}|${x.felder?.spaeter_bis || ""}`).join(";") + "#" + m.size + nm.size;
  });
  const wiederholt = async (f, k = 5) => { const l = []; for (let i = 0; i < k; i++) { g.aendere(ziel, `${g.wort()} ${g.wort()}\n\n${"Zeile mit Inhalt. ".repeat(10 + i)}\n`); const [t] = await msA(f); l.push(t); await new Promise((ok) => setTimeout(ok, 20)); } return l; };
  const vorherL = await wiederholt(alle);
  const alles2 = async () => { const [b, i] = await Promise.all([Promise.resolve().then(() => v.baum()), v.indexAlles()]); return { b, i }; };
  const nachherVollL = await wiederholt(alles2);
  const teilBytes = [];
  const nachherTeilL = await wiederholt(async () => { const x = await v.teilIndex([ziel]); teilBytes.push(jsonBytes(x)); if (x.voll) throw new Error("Teil-Index lieferte voll"); return x; });
  r.studio = {
    erstLaden, vorher: median(vorherL), nachherVoll: median(nachherVollL), nachherTeil: median(nachherTeilL),
    antwortKB: Math.round(antwortBytes / 1024), teilKB: Math.round(median(teilBytes) / 1024 * 10) / 10,
    clientVoll: parseMs + clientVoll, clientTeil: 0.1,
  };
  ergebnisse.push(r);
  rmSync(g.vault, { recursive: true, force: true });
}

if (alsJson) console.log(JSON.stringify(ergebnisse, null, 2));
else {
  const f = (x) => String(runde(x));
  console.log(`Messung (${process.platform}/${process.arch}, Node ${process.version}, ${ohneGit ? "ohne" : "mit"} Git-Repository im Vault; Median, ms)\n`);
  console.log("| Dateien | Suche (Kern) | vorher | nachher |\n|---:|---|---:|---:|");
  for (const r of ergebnisse) {
    const s = r.suche;
    console.log(`| ${r.n} | erste Suche | ${f(s.altErst)} | ${f(s.neuErst)} |`);
    console.log(`| ${r.n} | folgende Suche | ${f(s.altFolge)} | ${f(s.neuFolge)} |`);
    console.log(`| ${r.n} | Suche nach 1 Änderung | ${f(s.altNachAenderung)} | ${f(s.neuNachAenderung)} |`);
  }
  console.log("\n| Dateien | brain_suchen (Vault-Objekt, MCP) | nachher |\n|---:|---|---:|");
  for (const r of ergebnisse) { console.log(`| ${r.n} | erster Aufruf | ${f(r.mcp.erst)} |`); console.log(`| ${r.n} | folgende Aufrufe | ${f(r.mcp.folge)} |`); }
  console.log("\n| Dateien | Studio: Nachladen nach 1 Änderung (Werkstatt-Zeit) | vorher | nachher |\n|---:|---|---:|---:|");
  for (const r of ergebnisse) {
    const s = r.studio;
    console.log(`| ${r.n} | alles neu laden (baum + notizen + typen + ansichten → baum + index) | ${f(s.vorher)} | ${f(s.nachherVoll)} |`);
    console.log(`| ${r.n} | Teil-Index (/api/teilindex, 1 Datei) | ${f(s.vorher)} | ${f(s.nachherTeil)} |`);
    console.log(`| ${r.n} | Antwortgröße (KB) | ${s.antwortKB} | ${s.teilKB} |`);
    console.log(`| ${r.n} | Client: JSON lesen + Signatur über alle Notizen (Node, ungefähr) | ${f(s.clientVoll)} | ≈ 0 (nur betroffene Zeilen) |`);
  }
  console.log("\nTreffer gleich (Pfade und Punktzahlen, alle Fragen): " + ergebnisse.map((r) => `${r.n}: ${r.suche.gleich ? "ja" : "NEIN"}`).join(", "));
  console.log("Kaltes Laden im Studio (alle Dateien einmal lesen): " + ergebnisse.map((r) => `${r.n}: ${f(r.studio.erstLaden)} ms`).join(", "));
}
