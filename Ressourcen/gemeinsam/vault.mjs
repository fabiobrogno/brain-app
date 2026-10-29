// gemeinsam/vault.mjs — Kern von Brain Studio (Spec §3/§5): Pfad-Schutz, Baum, Lesen/Schreiben (atomar, Hash),
// Neu, Merken, Suche, Prüf-Signale, Git, Kit-Gesundheit. Wird von der Werkstatt und vom MCP-Server importiert.
import {
  realpathSync, statSync, lstatSync, readdirSync, readFileSync, writeFileSync, openSync, readSync, closeSync,
  mkdirSync, renameSync, linkSync, unlinkSync, existsSync,
} from "node:fs";
import { join, basename, relative, sep } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { HttpFehler, MAX_DATEI, loese, imVault, falte, kindUmgebung, supportOrdner, kernOrdner, BEARBEITBAR, generiertName, wikiGeneriert, gesperrterName } from "./basis.mjs";
import { pruefeText, berlinHeute, leseKopf } from "./pruefung.mjs";
import * as gitFn from "./git.mjs";
import * as vertrauenFn from "./vertrauen.mjs";
import { erzeugeNotizIndex, titelAus } from "./notizen.mjs";
import { leseVaults } from "./vaults.mjs";
import { wertAus } from "./nutzung.mjs";
import { erzeugePosteingang } from "./posteingang.mjs";

export { HttpFehler, pruefeText, berlinHeute, supportOrdner };
export const STUFE_TEXT = { gruen: "grün", gelb: "gelb", rot: "rot", grau: "grau", ohne: "ohne Befund" };

const HASH = (buf) => createHash("sha256").update(buf).digest("hex");

export function slug(s, max = 50) {
  const t = String(s).toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
  return t || "notiz";
}

function kopfBytes(abs, n = 400) {
  let fd;
  try { fd = openSync(abs, "r"); const b = Buffer.alloc(n); const len = readSync(fd, b, 0, n, 0); return b.subarray(0, len).toString("utf8"); }
  catch { return ""; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* egal */ } }
}

export function oeffneVault(vaultPfad, opts = {}) {
  let wurzel;
  try { wurzel = realpathSync(vaultPfad); if (!statSync(wurzel).isDirectory()) throw 0; }
  catch { throw new HttpFehler(400, "Der Vault-Ordner existiert nicht."); }
  const jetzt = opts.jetzt || (() => new Date());
  // Kern-Werkzeuge (Gesundheit, Rückfragen) laufen aus dem gebündelten Kern (opts.kern = Test), nie aus dem Vault.
  const kern = opts.kern || kernOrdner();
  const kitPfad = join(kern, "brain.mjs");

  // „generiert — nicht editieren“ in den ersten 3 Zeilen, bekannte generierte Namen, _*.md unter 09_wiki
  function istGeneriert(rel, abs) {
    const name = rel.split("/").pop();
    if (generiertName(name)) return true;
    if (wikiGeneriert(rel, name)) return true;
    if (!abs || !BEARBEITBAR.test(name)) return false;
    const kopf = kopfBytes(abs).split(/\r?\n/).slice(0, 3).join("\n");
    return /generiert\s+—\s+nicht\s+editieren/i.test(kopf);
  }
  const mehrfachVerknuepft = (st) => st.isFile() && st.nlink > 1;
  const schreibgeschuetzt = (rel, abs, st) => !BEARBEITBAR.test(rel) || istGeneriert(rel, abs) || (st ? mehrfachVerknuepft(st) : false);

  // ---------- Baum ----------
  // Titel je Datei (H1, sonst Frontmatter title/titel/name) für die Befehlspalette; Cache je Pfad+Änderungszeit+Größe.
  const titelCache = new Map();
  function titelFuerBaum(rel, abs, st) {
    if (!BEARBEITBAR.test(rel) || st.size > 1024 * 1024) return "";
    const schluessel = `${st.mtimeMs}:${st.size}`;
    const c = titelCache.get(rel);
    if (c && c.k === schluessel) return c.t;
    const t = titelAus(rel, kopfBytes(abs, 8192));
    titelCache.set(rel, { k: schluessel, t });
    return t;
  }
  function baum() {
    const eintraege = [];
    const geh = (relOrdner) => {
      const abs = relOrdner ? join(wurzel, relOrdner) : wurzel;
      let liste;
      try { liste = readdirSync(abs, { withFileTypes: true }); } catch { return; }
      const ordner = [], dateien = [];
      for (const d of liste) {
        if (gesperrterName(d.name)) continue;
        const rel = relOrdner ? `${relOrdner}/${d.name}` : d.name;
        let istOrdner = d.isDirectory(), istDatei = d.isFile();
        if (d.isSymbolicLink()) { // nur Dateien, die im Vault bleiben; Ordner-Symlinks nie (Schleifen)
          try { const echt = realpathSync(join(abs, d.name)); if (!imVault(echt, wurzel) || !statSync(echt).isFile()) continue; istDatei = true; istOrdner = false; } catch { continue; }
        }
        if (istOrdner) ordner.push({ name: d.name, rel });
        else if (istDatei) dateien.push({ name: d.name, rel });
      }
      const nach = (a, b) => a.name.localeCompare(b.name, "de", { numeric: true, sensitivity: "base" });
      ordner.sort(nach); dateien.sort(nach);
      for (const o of ordner) {
        let st; try { st = statSync(join(wurzel, o.rel)); } catch { continue; }
        eintraege.push({ pfad: o.rel, art: "ordner", geaendert: st.mtime.toISOString(), groesse: 0, schreibschutz: false });
        geh(o.rel);
      }
      for (const f of dateien) {
        const a = join(wurzel, f.rel);
        let st; try { st = statSync(a); } catch { continue; }
        eintraege.push({ pfad: f.rel, art: "datei", geaendert: st.mtime.toISOString(), groesse: st.size, schreibschutz: schreibgeschuetzt(f.rel, a, st), titel: titelFuerBaum(f.rel, a, st) });
      }
    };
    geh("");
    return { eintraege };
  }

  // ---------- Lesen / Schreiben ----------
  function lies(rel) {
    const { abs, rel: sauber } = loese(wurzel, rel);
    if (!BEARBEITBAR.test(sauber)) throw new HttpFehler(415, "Nur Markdown- und Textdateien lassen sich öffnen.");
    let st, buf;
    try { st = statSync(abs); if (!st.isFile()) throw 0; if (st.size > MAX_DATEI) throw new HttpFehler(413, "Die Datei ist zu groß."); buf = readFileSync(abs); }
    catch (e) { if (e instanceof HttpFehler) throw e; throw new HttpFehler(404, "Diese Datei gibt es nicht."); }
    const inhalt = buf.toString("utf8");
    if (Buffer.compare(Buffer.from(inhalt, "utf8"), buf) !== 0) throw new HttpFehler(415, "Diese Datei ist kein gültiger UTF-8-Text und wird nicht geöffnet.");
    return { pfad: sauber, inhalt, hash: HASH(buf), geaendert: st.mtime.toISOString(), schreibschutz: schreibgeschuetzt(sauber, abs, st) };
  }

  function tmpName(abs) { return join(abs, "..", `.brain-tmp-${process.pid}-${randomBytes(4).toString("hex")}`); }

  function schreibe({ pfad, inhalt, basisHash }) {
    if (typeof inhalt !== "string") throw new HttpFehler(400, "Der Inhalt fehlt.");
    if (basisHash !== null && typeof basisHash !== "string") throw new HttpFehler(400, "basisHash fehlt (null = neu anlegen).");
    let { abs, rel } = loese(wurzel, pfad);
    if (!BEARBEITBAR.test(rel)) throw new HttpFehler(403, "Nur Markdown- und Textdateien lassen sich bearbeiten.");
    const buf = Buffer.from(inhalt, "utf8");
    if (buf.length > MAX_DATEI) throw new HttpFehler(413, "Die Datei ist zu groß.");
    // Symlink im Vault: geschrieben wird atomar auf das (per realpath aufgelöste) Ziel, das im Vault liegen muss —
    // der Link selbst bleibt ein Link; Schutz und Hash gelten für das Ziel.
    try {
      if (lstatSync(abs).isSymbolicLink()) {
        let echt;
        try { echt = realpathSync(abs); } catch { throw new HttpFehler(403, "Dieser Verweis führt ins Leere."); }
        if (!imVault(echt, wurzel)) throw new HttpFehler(403, "Dieser Pfad liegt außerhalb des Vaults.");
        const zielRel = relative(wurzel, echt).split(sep);
        if (zielRel.some(gesperrterName)) throw new HttpFehler(403, "Dieser Ort ist gesperrt.");
        if (!BEARBEITBAR.test(echt)) throw new HttpFehler(403, "Nur Markdown- und Textdateien lassen sich bearbeiten.");
        abs = echt; rel = zielRel.join("/");
      }
    } catch (e) { if (e instanceof HttpFehler) throw e; /* gibt es noch nicht */ }
    let alt = null;
    try { const st = lstatSync(abs); if (!st.isFile()) throw new HttpFehler(400, "Das ist ein Ordner, keine Datei."); if (mehrfachVerknuepft(st)) throw new HttpFehler(423, "Diese Datei ist mehrfach verknüpft (derselbe Inhalt liegt unter einem zweiten Namen). Beim Speichern würden die Namen auseinanderlaufen — bitte nicht hier bearbeiten.");
      alt = readFileSync(abs); } catch (e) { if (e instanceof HttpFehler) throw e; }
    if (alt && istGeneriert(rel, abs)) throw new HttpFehler(403, "Diese Datei wird automatisch erzeugt und ist schreibgeschützt.");
    if (!alt && istGeneriert(rel, null)) throw new HttpFehler(403, "Diese Datei wird automatisch erzeugt und ist schreibgeschützt.");
    if (basisHash === null) {
      if (alt) throw new HttpFehler(409, "Diese Datei gibt es schon.", { aktuellerHash: HASH(alt) });
    } else {
      if (!alt) throw new HttpFehler(404, "Diese Datei gibt es nicht mehr.");
      if (HASH(alt) !== basisHash) throw new HttpFehler(409, "Die Datei wurde inzwischen geändert (zum Beispiel von einem anderen Programm).", { aktuellerHash: HASH(alt) });
    }
    mkdirSync(join(abs, ".."), { recursive: true });
    const tmp = tmpName(abs);
    try {
      writeFileSync(tmp, buf, { flag: "wx", mode: alt ? statSync(abs).mode & 0o777 : 0o644 });
      if (alt) renameSync(tmp, abs); // atomar ersetzen
      else { try { linkSync(tmp, abs); } catch (e) { if (e.code === "EEXIST") throw new HttpFehler(409, "Diese Datei gibt es schon."); throw e; } unlinkSync(tmp); }
    } catch (e) { try { unlinkSync(tmp); } catch { /* schon weg */ } throw e; }
    return { hash: HASH(buf), geaendert: statSync(abs).mtime.toISOString() };
  }

  // Freien Dateinamen reservieren (exklusiv anlegen): name.md, name-2.md, name-3.md …
  function legeFreiAn(relOrdner, stamm, inhalt) {
    const ordnerAbs = relOrdner ? loese(wurzel, relOrdner).abs : wurzel;
    mkdirSync(ordnerAbs, { recursive: true });
    for (let i = 1; i < 1000; i++) {
      const name = `${stamm}${i === 1 ? "" : "-" + i}.md`;
      try { writeFileSync(join(ordnerAbs, name), inhalt, { flag: "wx" }); return relOrdner ? `${relOrdner}/${name}` : name; }
      catch (e) { if (e.code !== "EEXIST") throw e; }
    }
    throw new HttpFehler(409, "Es gibt schon zu viele Dateien mit diesem Namen.");
  }

  function neu({ ordner, titel }) {
    if (typeof titel !== "string" || !titel.trim()) throw new HttpFehler(400, "Bitte einen Titel eingeben.");
    if (ordner !== undefined && ordner !== null && typeof ordner !== "string") throw new HttpFehler(400, "Ungültiger Ordner.");
    const o = (ordner || "").replace(/^\/+|\/+$/g, "");
    const t = titel.trim().replace(/\s+/g, " ").slice(0, 200);
    return { pfad: legeFreiAn(o ? loese(wurzel, o).rel : "", slug(t, 60), `# ${t}\n`) };
  }

  function merken({ text, titel }) {
    if (typeof text !== "string" || !text.trim()) throw new HttpFehler(400, "Bitte einen Text eingeben.");
    if (Buffer.byteLength(text) > 1024 * 1024) throw new HttpFehler(413, "Der Text ist zu lang.");
    if (titel !== undefined && titel !== null && typeof titel !== "string") throw new HttpFehler(400, "Ungültiger Titel.");
    const koerper = text.replace(/\s+$/, "");
    let t = (titel || "").trim().replace(/\s+/g, " ");
    let inhalt;
    if (!t && /^#\s+\S/.test(koerper)) { // Text bringt schon eine Überschrift mit
      t = koerper.split(/\r?\n/)[0].replace(/^#\s+/, "").trim();
      inhalt = koerper + "\n";
    } else {
      if (!t) t = koerper.split(/\r?\n/).find((z) => z.trim()).trim().replace(/\s+/g, " ").slice(0, 80);
      inhalt = `# ${t}\n\n${koerper}\n`;
    }
    const datum = berlinHeute(jetzt());
    return { pfad: legeFreiAn("00_inbox", `${datum}_${slug(t)}`, inhalt) };
  }

  // ---------- Suche ----------
  function alleTexte() {
    const aus = [];
    const geh = (relOrdner) => {
      let liste; try { liste = readdirSync(relOrdner ? join(wurzel, relOrdner) : wurzel, { withFileTypes: true }); } catch { return; }
      for (const d of liste) {
        if (gesperrterName(d.name)) continue;
        const rel = relOrdner ? `${relOrdner}/${d.name}` : d.name;
        if (d.isDirectory()) geh(rel);
        else if (d.isFile() && BEARBEITBAR.test(d.name) && !generiertName(d.name) && !wikiGeneriert(rel, d.name)) aus.push(rel);
      }
    };
    geh("");
    return aus;
  }
  const norm = (s) => s.normalize("NFC").toLowerCase();


  function suche(q) {
    const woerter = norm(String(q || "")).split(/\s+/).filter(Boolean);
    if (!woerter.length) return { treffer: [] };
    const titelTreffer = [], inhaltTreffer = [];
    for (const rel of alleTexte()) {
      let buf; try { const a = join(wurzel, rel); const st = statSync(a); if (st.size > 1024 * 1024) continue; buf = readFileSync(a); } catch { continue; }
      const text = buf.toString("utf8");
      const titel = titelAus(rel, text);
      const kopf = norm(titel + " " + rel);
      const klein = norm(text);
      if (woerter.every((w) => kopf.includes(w))) { titelTreffer.push({ rel, text, titel, klein, score: 0 }); continue; }
      if (!woerter.every((w) => klein.includes(w))) continue;
      let score = 0; for (const w of woerter) { let i = -1; while ((i = klein.indexOf(w, i + 1)) >= 0) score++; }
      inhaltTreffer.push({ rel, text, titel, klein, score });
    }
    titelTreffer.sort((a, b) => (a.rel < b.rel ? -1 : 1));
    inhaltTreffer.sort((a, b) => b.score - a.score || (a.rel < b.rel ? -1 : 1));
    const treffer = [...titelTreffer, ...inhaltTreffer].slice(0, 30).map((t) => {
      const zeilen = t.text.split(/\r?\n/);
      let z = zeilen.findIndex((l) => { const k = norm(l); return woerter.some((w) => k.includes(w)); });
      if (z < 0) z = Math.max(0, zeilen.findIndex((l, i) => i >= leseKopf(t.text).bis && l.trim() && !l.startsWith("#")));
      const zeile = zeilen[z] ?? "";
      const k = norm(zeile), pos = woerter.map((w) => k.indexOf(w)).filter((i) => i >= 0), start = Math.max(0, (pos.length ? Math.min(...pos) : 0) - 40);
      const auszug = (start > 0 ? "… " : "") + zeile.trim().slice(start, start + 160).trim();
      return { pfad: t.rel, titel: t.titel, auszug, zeile: z + 1 };
    });
    return { treffer };
  }

  function pruefung(rel) {
    const d = lies(rel);
    return pruefeText(d.pfad, d.inhalt, { heute: opts.heute || berlinHeute(jetzt()) });
  }

  // ---------- Kern und Workspace-Trust (Kern-Umzug P4/P5) ----------
  // Der gebündelte Kern läuft aus dem App-Paket (per Manifest geprüft, der Vault liefert nur Daten). Ob an einem Vault etwas bewirkt werden darf
  // (git, Hintergrunddienst, Hooks, KI-Pflege), entscheidet das Vertrauen: angelegt/geklont von Kortex oder vom Nutzer im Studio bestätigt. Der
  // Merker liegt außerhalb des Vaults (<support>/vertrauen.json, siehe vertrauen.mjs); er wirkt auch für den MCP-Server und den Kern.
  const imListe = (echt) => leseVaults({ support: opts.support }).vaults.some((v) => { try { return realpathSync(v.pfad) === echt; } catch { return false; } });
  const stuetze = () => ({ support: opts.support, imListe });
  const stand = () => vertrauenFn.pruefeVertrauen(wurzel, stuetze());
  const rueckfragenPfad = join(kern, "rueckfragen.mjs");
  // „Kit vorhanden“ heißt jetzt: der Vault ist ein Brain im Sinne des Kerns (brain.config.json) UND der Kern ist da.
  const istBrain = () => existsSync(join(wurzel, "brain.config.json"));
  const kitVorhanden = () => istBrain() && (existsSync(kitPfad) || existsSync(rueckfragenPfad));
  const kit = () => ({ vorhanden: kitVorhanden() });
  function vertrauen(erlauben) {
    if (typeof erlauben !== "boolean") throw new HttpFehler(400, "„erlauben“ muss true oder false sein.");
    if (erlauben) vertrauenFn.erlaube(wurzel, { support: opts.support, quelle: "bestaetigt" }); else vertrauenFn.widerrufe(wurzel, { support: opts.support });
    gesCache = null; rfCache = null;
    return { kit: kit(), vertrauen: stand() };
  }
  // Version des gebündelten Kerns (= App-Version), nicht die eines Ordners im Vault.
  const kitVersion = () => { if (!istBrain()) return null; try { return readFileSync(join(kern, "VERSION"), "utf8").trim() || null; } catch { return null; } };
  let gesCache = null;
  function gesundheit() {
    if (!istBrain() || !existsSync(kitPfad)) return Promise.resolve({ verfuegbar: false });
    if (gesCache && Date.now() - gesCache.t < 120_000) return Promise.resolve(gesCache.wert);
    return new Promise((ok) => {
      // --vault UND BRAIN_VAULT = dieser Vault: eine vom Start geerbte Variable (anderer Vault nach einem Wechsel in der Oberfläche) ließe
      // den Kern sonst auf dem Startvault arbeiten.
      execFile(process.execPath, [kitPfad, "--vault", wurzel, "gesundheit", "--json"], { cwd: wurzel, timeout: 20_000, maxBuffer: 8 * 1024 * 1024, env: kindUmgebung({ NO_COLOR: "1", BRAIN_VAULT: wurzel }) },
        (err, stdout) => {
          let wert = { verfuegbar: false };
          try { const j = JSON.parse(String(stdout)); if (j && typeof j === "object") wert = j; } catch { /* Kit fehlt/defekt/Zeitlimit */ }
          if (wert.verfuegbar !== false) gesCache = { t: Date.now(), wert };
          ok(wert);
        });
    });
  }

  // Offene Rückfragen: rein lesend über die Kit-Funktion sichtbare() (nicht über `brain rueckfragen liste` — das
  // schreibt `gezeigt` in die Rückfragen und würde die Verfallsfrist auslösen). Zahl = so viele, wie der Skill zeigt.
  // Läuft als eigener Kindprozess (nie im eigenen Prozess importiert): Fehler des Kerns bleiben draußen.
  const RF_SKRIPT = `import(process.argv[1]).then((m) => { const s = typeof m.sichtbare === "function" ? m.sichtbare(process.argv[2]) : null;
    process.stdout.write(JSON.stringify(s && Array.isArray(s.fragen) && Number.isFinite(s.wartend) ? { f: s.fragen.length, w: s.wartend } : null)); }).catch(() => process.stdout.write("null"));`;
  let rfCache = null;
  async function rueckfragen() {
    if (!istBrain() || !existsSync(rueckfragenPfad)) return { verfuegbar: false };
    if (rfCache && Date.now() - rfCache.t < 120_000) return rfCache.wert;
    const wert = await new Promise((ok) => {
      execFile(process.execPath, ["--input-type=module", "-e", RF_SKRIPT, pathToFileURL(rueckfragenPfad).href, wurzel],
        { cwd: wurzel, timeout: 20_000, maxBuffer: 1024 * 1024, env: kindUmgebung({ BRAIN_VAULT: wurzel }) }, (err, stdout) => {
          try { const j = JSON.parse(String(stdout)); if (j && Number.isFinite(j.f) && Number.isFinite(j.w)) return ok({ verfuegbar: true, offen: j.f + j.w }); } catch { /* keine Zahl statt einer falschen */ }
          ok({ verfuegbar: false });
        });
    });
    if (wert.verfuegbar) rfCache = { t: Date.now(), wert };
    return wert;
  }

  // ---------- Git unter Workspace-Trust (P5) ----------
  // Jeder Git-Aufruf läuft gehärtet (git.mjs). Ist dem Vault nicht vertraut, ist Git GANZ gesperrt: status meldet es, alle anderen Git-Routen
  // antworten 409 { gitGesperrt: true }, der Notiz-Index fragt Git gar nicht. Mit Vertrauen laufen Hooks und Repo-Konfiguration wie gewohnt.
  const gitSicht = () => vertrauenFn.gitSicht(wurzel, stuetze());
  const gesperrtFehler = (s) => new HttpFehler(409, `Git ist für diesen Vault gesperrt. ${s.grund}`, { gitGesperrt: true, grund: s.grund });
  // Kontext eines Git-Aufrufs: vertraut/sshEigen und, was der Nutzer selbst eingestellt hat (sshGlobal, gpgGlobal) — ohne Vertrauen ersetzen wir
  // nur die Einstellungen des Vaults, nie seine eigenen.
  const ctxVon = (s) => ({ vertraut: s.vertraut, sshEigen: s.sshEigen, sshGlobal: s.sshGlobal, gpgGlobal: s.gpgGlobal });
  const gitCtx = (extra = {}) => { const s = gitSicht(); if (s.gesperrt) throw gesperrtFehler(s); return { ...ctxVon(s), ...extra }; };

  // ---------- Notiz-Index (Spec v2 §5) ----------
  const notizIndex = erzeugeNotizIndex({ wurzel, jetzt, heute: () => opts.heute || berlinHeute(jetzt()),
    gitKontext: () => { const s = gitSicht(); return s.gesperrt ? null : ctxVon(s); } });

  // Lokale Nutzungsmessung (FBL-72): welche Seiten die KI per MCP abruft (.logs/mcp.log). Als „nie genutzt“ kommen nur echte Wiki-Seiten
  // in Frage (09_wiki/, Markdown, nicht generiert, kein Unterstrich-Name). Rein lesend, ohne Kit-Code.
  function nutzung() {
    const wiki = baum().eintraege.filter((e) => e.art === "datei" && e.pfad.startsWith("09_wiki/") && e.pfad.endsWith(".md") && !e.schreibschutz && !e.pfad.split("/").pop().startsWith("_")).map((e) => e.pfad);
    return wertAus(wurzel, wiki);
  }

  // ---------- Posteingang sichten (FBL-68/71): Verwerfen, Später, in eine Wiki-Seite übernehmen — je Aktion ein Commit ----------
  const posteingang = erzeugePosteingang({
    wurzel, heute: () => opts.heute || berlinHeute(jetzt()), notizen: () => notizIndex.notizen(), lies, schreibe, istGeneriert, slug,
    git: {
      // Gesperrtes Git (Vertrauen v2) → 409, bevor irgendetwas angefasst wird; sonst: gibt es ein Repository?
      vorab: async () => { const s = gitSicht(); if (s.gesperrt) throw gesperrtFehler(s); return gitFn.istRepo(wurzel, ctxVon(s)); },
      offen: async () => (await gitFn.status(wurzel, gitCtx())).geaendert.map((e) => e.pfad),
      commit: async (a) => gitFn.commit(wurzel, a, gitCtx({ limit: opts.gitLimitCommit })),
    },
  });

  // Dieselbe Suche für MCP brain_suchen und die Probe-Frage: strukturiert (treffer) und als Text, wie ihn die KI sieht.
  function suchenFuerKi(frage, anzahl) {
    const n = Math.min(20, Math.max(1, Number.parseInt(anzahl, 10) || 10));
    const treffer = suche(frage).treffer.slice(0, n).map((t) => {
      let stufe = "grau"; try { stufe = pruefung(t.pfad).stufe; } catch { /* unlesbar → grau */ }
      return { ...t, stufe };
    });
    const text = treffer.length ? treffer.map((t, i) => `${i + 1}. ${t.pfad} — ${t.titel} [${STUFE_TEXT[t.stufe]}]\n   ${t.auszug}`).join("\n") : "Keine Treffer.";
    return { treffer, text };
  }

  return {
    wurzel, name: basename(wurzel), rueckfragen, kitVersion, kitVorhanden, kit, vertrauen, vertrauenStand: stand, baum, lies, schreibe, neu, merken, suche, suchenFuerKi, pruefung, gesundheit, nutzung,
    posteingangVerwerfen: posteingang.verwerfen, posteingangSpaeter: posteingang.spaeter, posteingangUebernehmen: posteingang.uebernehmen,
    notizen: notizIndex.notizen, notizKontext: notizIndex.kontext, typen: notizIndex.typen, ansichten: notizIndex.ansichten,
    gitLog: async (a) => gitFn.log(wurzel, a || {}, gitCtx()),
    gitRemote: async (url, extra = {}) => gitFn.remoteHinzufuegen(wurzel, url, gitCtx({ limit: opts.gitLimitRemote, ...extra })),
    gitStatus: async () => {
      const s = gitSicht();
      if (s.gesperrt) return { repo: true, gesperrt: true, grund: s.grund };
      return gitFn.status(wurzel, ctxVon(s));
    },
    gitCommit: async (a) => gitFn.commit(wurzel, a || {}, gitCtx({ limit: opts.gitLimitCommit })),
    // konflikteLoesen: bei Konflikten die Zusammenführung offen lassen, damit die Oberfläche pro Datei wählen lässt (sonst wie bisher: abbrechen, 409)
    gitSync: async (a) => gitFn.sync(wurzel, gitCtx({ limitSync: opts.gitLimitSync, limitGesamt: opts.gitLimitAbgleich, konflikteLoesen: !!(a && a.konflikteLoesen === true) })),
    gitKonflikte: async (pfad) => gitFn.konflikte(wurzel, pfad, gitCtx()),
    gitKonfliktAbschliessen: async (a) => gitFn.konfliktAbschliessen(wurzel, a || {}, gitCtx({ limit: opts.gitLimitCommit })),
    gitKonfliktAbbrechen: async () => gitFn.konfliktAbbrechen(wurzel, gitCtx({ limit: opts.gitLimitCommit })),
    gitNachsehen: async () => gitFn.nachsehen(wurzel, gitCtx()),
    gitWiederherstellenVorschau: async (pfad, sha) => gitFn.wiederherstellenVorschau(wurzel, pfad, sha, gitCtx()),
    gitWiederherstellen: async (a) => gitFn.wiederherstellen(wurzel, a || {}, gitCtx({ limit: opts.gitLimitCommit })),
    gitVerlauf: async (pfad, max) => gitFn.verlauf(wurzel, pfad, max, gitCtx()),
    gitDiff: async (pfad, sha) => gitFn.diff(wurzel, pfad, sha, gitCtx()),
    gitFassung: async (pfad, sha) => gitFn.fassung(wurzel, pfad, sha, gitCtx()),
    // Ohne Vertrauen läuft kein git, auch kein rev-parse: dann zählt, ob der Ordner ein .git hat.
    istGitRepo: async () => { const s = gitSicht(); return s.gesperrt ? existsSync(join(wurzel, ".git")) : gitFn.istRepo(wurzel, ctxVon(s)); },
  };
}
