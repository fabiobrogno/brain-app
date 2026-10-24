// gemeinsam/vault.mjs — Kern von Brain Studio (Spec §3/§5): Pfad-Schutz, Baum, Lesen/Schreiben (atomar, Hash),
// Neu, Merken, Suche, Prüf-Signale, Git, Kit-Gesundheit. Wird von der Werkstatt und vom MCP-Server importiert.
import {
  realpathSync, statSync, lstatSync, readdirSync, readFileSync, writeFileSync, openSync, readSync, closeSync,
  mkdirSync, renameSync, linkSync, unlinkSync, existsSync,
} from "node:fs";
import { join, basename } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { HttpFehler, MAX_DATEI, loese, imVault } from "./basis.mjs";
import { pruefeText, berlinHeute, leseKopf } from "./pruefung.mjs";
import * as gitFn from "./git.mjs";

export { HttpFehler, pruefeText, berlinHeute };

const BEARBEITBAR = /\.(md|txt)$/i;
const GENERIERT_NAMEN = new Set(["INDEX.md", "_index.md", "graph.json"]);
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
  const kitPfad = join(wurzel, ".tools", "brain.mjs");

  // „generiert — nicht editieren“ in den ersten 3 Zeilen, bekannte generierte Namen, _*.md unter 09_wiki
  function istGeneriert(rel, abs) {
    const name = rel.split("/").pop();
    if (GENERIERT_NAMEN.has(name)) return true;
    if (rel.startsWith("09_wiki/") && name.startsWith("_") && name !== "_schema.md" && name !== "_log.md") return true;
    if (!abs || !BEARBEITBAR.test(name)) return false;
    const kopf = kopfBytes(abs).split(/\r?\n/).slice(0, 3).join("\n");
    return /generiert\s+—\s+nicht\s+editieren/i.test(kopf);
  }
  const schreibgeschuetzt = (rel, abs) => !BEARBEITBAR.test(rel) || istGeneriert(rel, abs);

  // ---------- Baum ----------
  // Titel je Datei (H1, sonst Frontmatter title/titel/name) für die Befehlspalette; Cache je Pfad+Änderungszeit+Größe.
  const titelCache = new Map();
  function titelFuerBaum(rel, abs, st) {
    if (!BEARBEITBAR.test(rel) || st.size > 1024 * 1024) return "";
    const schluessel = `${st.mtimeMs}:${st.size}`;
    const c = titelCache.get(rel);
    if (c && c.k === schluessel) return c.t;
    const t = titelVon(rel, kopfBytes(abs, 8192));
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
        if (d.name.startsWith(".") || d.name === "node_modules") continue;
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
        eintraege.push({ pfad: f.rel, art: "datei", geaendert: st.mtime.toISOString(), groesse: st.size, schreibschutz: schreibgeschuetzt(f.rel, a), titel: titelFuerBaum(f.rel, a, st) });
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
    return { pfad: sauber, inhalt, hash: HASH(buf), geaendert: st.mtime.toISOString(), schreibschutz: schreibgeschuetzt(sauber, abs) };
  }

  function tmpName(abs) { return join(abs, "..", `.brain-tmp-${process.pid}-${randomBytes(4).toString("hex")}`); }

  function schreibe({ pfad, inhalt, basisHash }) {
    if (typeof inhalt !== "string") throw new HttpFehler(400, "Der Inhalt fehlt.");
    if (basisHash !== null && typeof basisHash !== "string") throw new HttpFehler(400, "basisHash fehlt (null = neu anlegen).");
    const { abs, rel } = loese(wurzel, pfad);
    if (!BEARBEITBAR.test(rel)) throw new HttpFehler(403, "Nur Markdown- und Textdateien lassen sich bearbeiten.");
    const buf = Buffer.from(inhalt, "utf8");
    if (buf.length > MAX_DATEI) throw new HttpFehler(413, "Die Datei ist zu groß.");
    let alt = null;
    try { const st = lstatSync(abs); if (!st.isFile() && !st.isSymbolicLink()) throw new HttpFehler(400, "Das ist ein Ordner, keine Datei."); alt = readFileSync(abs); } catch (e) { if (e instanceof HttpFehler) throw e; }
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
        if (d.name.startsWith(".") || d.name === "node_modules") continue;
        const rel = relOrdner ? `${relOrdner}/${d.name}` : d.name;
        if (d.isDirectory()) geh(rel);
        else if (d.isFile() && BEARBEITBAR.test(d.name) && !GENERIERT_NAMEN.has(d.name) && !(rel.startsWith("09_wiki/") && d.name.startsWith("_") && d.name !== "_schema.md" && d.name !== "_log.md")) aus.push(rel);
      }
    };
    geh("");
    return aus;
  }
  const norm = (s) => s.normalize("NFC").toLowerCase();

  function titelVon(rel, text) {
    const { felder, bis } = leseKopf(text);
    const zeilen = text.split(/\r?\n/);
    for (let i = bis; i < Math.min(zeilen.length, bis + 40); i++) { const m = /^#\s+(.+?)\s*#*\s*$/.exec(zeilen[i]); if (m) return m[1]; }
    return felder.title || felder.titel || felder.name || basename(rel).replace(/\.(md|txt)$/i, "");
  }

  function suche(q) {
    const woerter = norm(String(q || "")).split(/\s+/).filter(Boolean);
    if (!woerter.length) return { treffer: [] };
    const titelTreffer = [], inhaltTreffer = [];
    for (const rel of alleTexte()) {
      let buf; try { const a = join(wurzel, rel); const st = statSync(a); if (st.size > 1024 * 1024) continue; buf = readFileSync(a); } catch { continue; }
      const text = buf.toString("utf8");
      const titel = titelVon(rel, text);
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

  // ---------- Kit ----------
  const kitVersion = () => { try { return readFileSync(join(wurzel, ".tools", "VERSION"), "utf8").trim() || null; } catch { return null; } };
  let gesCache = null;
  function gesundheit() {
    if (gesCache && Date.now() - gesCache.t < 120_000) return Promise.resolve(gesCache.wert);
    if (!existsSync(kitPfad)) return Promise.resolve({ verfuegbar: false });
    return new Promise((ok) => {
      execFile(process.execPath, [kitPfad, "gesundheit", "--json"], { cwd: wurzel, timeout: 20_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NO_COLOR: "1" } },
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
  let rfCache = null;
  async function rueckfragen() {
    if (rfCache && Date.now() - rfCache.t < 120_000) return rfCache.wert;
    let wert = { verfuegbar: false };
    try {
      const modul = join(wurzel, ".tools", "rueckfragen.mjs");
      if (existsSync(modul)) {
        const m = await import(pathToFileURL(modul).href);
        const s = typeof m.sichtbare === "function" ? m.sichtbare(wurzel) : null;
        if (s && Array.isArray(s.fragen) && Number.isFinite(s.wartend)) wert = { verfuegbar: true, offen: s.fragen.length + s.wartend };
      }
    } catch { /* Kit fehlt oder ist anders aufgebaut → keine Zahl statt einer falschen */ }
    if (wert.verfuegbar) rfCache = { t: Date.now(), wert };
    return wert;
  }

  return {
    wurzel, name: basename(wurzel), rueckfragen, kitVersion, baum, lies, schreibe, neu, merken, suche, pruefung, gesundheit,
    gitStatus: () => gitFn.status(wurzel),
    gitCommit: (a) => gitFn.commit(wurzel, a || {}),
    gitSync: () => gitFn.sync(wurzel),
    gitVerlauf: (pfad, max) => gitFn.verlauf(wurzel, pfad, max),
    gitDiff: (pfad, sha) => gitFn.diff(wurzel, pfad, sha),
    gitFassung: (pfad, sha) => gitFn.fassung(wurzel, pfad, sha),
    istGitRepo: () => gitFn.istRepo(wurzel),
  };
}
