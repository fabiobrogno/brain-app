// gemeinsam/dateiaktionen.mjs — Notizen und Ordner umbenennen, verschieben und in den Papierkorb legen, mit Link-Pflege und Rückgängig.
// Genutzt von der Werkstatt (Routen /api/notiz/*, /api/ordner/*, /api/papierkorb/*) und vom MCP-Server (brain_umbenennen, brain_verschieben) — EINE Logik.
//
// Ablauf jeder Aktion: planen (nichts wird geschrieben; liefert die Vorschau „N Verweise in M Notizen“ und ein Token über den gelesenen Stand) → ausführen:
// Zustand sichern (Journal), betroffene Notizen atomar neu schreiben (je Datei Hash-Prüfung, 409 bei fremder Änderung), dann EIN Umbenennen/Verschieben, ein Eintrag im
// Aktivitätsprotokoll (art „datei-aktion“, rueckgaengig: { art: "vorgang", id }). Scheitert etwas, wird alles zurückgenommen.
// Das Journal liegt im Vault unter .kortex-lokal/ (eigener Punkt-Ordner, für alles andere unsichtbar, aus git gehalten; .kortex gehört der Umstellung und wird hier nie angefasst): .kortex-lokal/papierkorb/vorgaenge/<id>/ (Ordner 0700, Dateien 0600):
//   manifest.json · vorher/<n> und nachher/<n> (Bytes der umgeschriebenen Notizen) · inhalt/<Name> (beim Löschen: die Datei oder der Ordner selbst — der Papierkorb).
// Sperre und Marke liegen je Gerät in .kortex-lokal/aktionen/<Geräte-Hash>/, die Quarantäne in .kortex-lokal/quarantaene/. Alles ist rename auf demselben Laufwerk; kopiert wird nie.
// Gelöscht wird nie endgültig, außer auf ausdrücklichen Klick („Endgültig löschen“, „Papierkorb leeren“). Nichts wird automatisch geleert.
import { lstatSync, statSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmdirSync, renameSync, linkSync, unlinkSync, rmSync, existsSync, chmodSync, cpSync, realpathSync, openSync, closeSync, utimesSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { geraeteKennung, prozessStart } from "./plattform.mjs";
import { HttpFehler, loese, sauber, BEARBEITBAR, MAX_DATEI, gesperrterName, generiertName, wikiGeneriert, falte, imVault, inboxOrdnerVon } from "./basis.mjs";
import { kennungVault, melde, aendereZustand, leseZustand } from "./aktivitaet.mjs";
import { planeVerweise, setzeTitel, verlinktVon } from "./linkpflege.mjs";
import { titelAus } from "./notizen.mjs";
import { ordnerVonPfad } from "./wikilink.mjs";

const HASH = (buf) => createHash("sha256").update(buf).digest("hex");
export const PAPIERKORB_TAGE = 30;
const TAG_MS = 86400e3;
const MAX_DATEIEN_ORDNER = 100000;
const MAX_LISTE = 200;
const ID = /^v_[0-9a-f]{12}$/;
const SPERRE_FRIST_MS = 60_000;

const ohneEndungName = (n) => n.replace(/\.(md|txt)$/i, "");
const NFC = (s) => String(s).normalize("NFC");

// Name einer Datei oder eines Ordners prüfen → bereinigter Name (NFC). 400 bei Unsinn.
export function pruefeName(name, { was = "Name" } = {}) {
  if (typeof name !== "string") throw new HttpFehler(400, `Bitte einen ${was} angeben.`);
  const n = NFC(name).replace(/\s+/g, " ").trim();
  if (!n) throw new HttpFehler(400, `Bitte einen ${was} angeben.`);
  if (Buffer.byteLength(n) > 250) throw new HttpFehler(400, `Der ${was} ist zu lang.`);
  if (/[\/\\\0:]/.test(n) || /[\u0000-\u001f\u007f]/.test(n)) throw new HttpFehler(400, `Im ${was} sind Schrägstriche, Doppelpunkte und Steuerzeichen nicht erlaubt.`);
  if (n === "." || n === ".." || n.startsWith(".")) throw new HttpFehler(400, `Der ${was} darf nicht mit einem Punkt beginnen.`);
  if (falte(n) === "node_modules") throw new HttpFehler(400, `Dieser ${was} ist nicht erlaubt.`);
  return n;
}

const HEX = (n) => randomBytes(n).toString("hex");
const MEINE_TOKEN = new Set(); // Sperr-Token, die DIESER Prozess hält (auch über mehrere Vault-Objekte hinweg)
const JOURNAL_MAX = 100, JOURNAL_TAGE = 30, JOURNAL_BYTES = 50 * 1024 * 1024; // Grenzen für Rückgängig-Journale von Umbenennen/Verschieben (nie für gelöschte Notizen)

/**
 * haken: nur für Tests ({ rename } ersetzt das Umbenennen beim Papierkorb, z. B. um EXDEV nachzustellen; geraet(pfad) ersetzt stat().dev für den älteren Papierkorb; geraeteId; punkt(name)).
 * deps: { wurzel (echter Pfad), support, name (Vault-Name), istGeneriert(rel, abs), ueberspringeOrdner(abs), aufgabenOrdner(): Promise<string|null>, slug(titel), wer, jetzt() }
 */
export function erzeugeDateiaktionen({ wurzel, support, name = "", istGeneriert = () => false, ueberspringeOrdner = () => false, aufgabenOrdner = async () => null, vorlagenOrdner = () => null, slug = (s) => s, wer = "Du", jetzt = () => new Date(), haken = {} }) {
  const kennung = kennungVault(wurzel);
  // Wo liegt was? ALLES im Vault unter .kortex-lokal/: Papierkorb und Journale in .kortex-lokal/papierkorb/vorgaenge/<id>/, Sperre und Marke JE GERÄT in .kortex-lokal/aktionen/<Geräte-Hash>/, Quarantäne in .kortex-lokal/quarantaene/. Alle Prozesse (Werkstatt, MCP-Server, später
  // gestartete) sehen denselben Ort; Umbenennen oder Verschieben des Vault-Ordners nimmt alles mit, eine Kopie des Vaults hat ihre eigene Kopie davon. rename bleibt auf demselben Laufwerk; ein Unterordner,
  // der ein eigenes Volume ist, liefert EXDEV und wird abgelehnt (Kortex kopiert nie). Ein Papierkorb aus früheren Versionen unter <Support>/papierkorb/<Pfad-Hash>/ bleibt sichtbar (altVerz),
  // wird nie automatisch gelöscht oder verschoben.
  const kortexDir = join(wurzel, ".kortex-lokal"); // eigener Ordner: .kortex gehört der Umstellung (wird committed) und wird hier nie angefasst
  const korb = join(kortexDir, "papierkorb"), vorgaenge = join(korb, "vorgaenge"), quarantaeneDir = join(kortexDir, "quarantaene");
  const altKorb = join(support, "papierkorb", kennung);
  const altVerz = () => { const v = join(altKorb, "vorgaenge"); return existsSync(v) ? [v] : []; };
  const geraet = (pfad) => (haken.geraet ? haken.geraet(pfad) : statSync(pfad).dev);
  const vorgangDir = (id) => { for (const v of [vorgaenge, ...altVerz()]) if (existsSync(join(v, id))) return join(v, id); return join(vorgaenge, id); };
  const imAltenKorb = (m) => vorgangDir(m.id).startsWith(altKorb);

  // Auf welchem Gerät ist ein Vorgang entstanden? { hw: Hardware-UUID (macOS) bzw. machine-id (Linux), host: "host:<Rechnername>" }. Haben BEIDE Seiten eine Hardware-ID, entscheidet sie allein; der Rechnername
  // zählt nur, wenn einer Seite die Hardware-ID fehlt. Eine leere Antwort von ioreg wird nicht gemerkt (nächster Lauf fragt neu); gefunden wird einmal je Prozess. Fremdes wird nie angefasst,
  // nur als Hinweis gezeigt; Sperre und Marke liegen je Gerät, ein Prozess bricht nie die Sperre eines anderen Geräts.
  let hwGemerkt = "", geraetLauf = null;
  const normGeraet = (g) => (!g ? null : Array.isArray(g) ? { hw: g.find((x) => !String(x).startsWith("host:")) || "", host: g.find((x) => String(x).startsWith("host:")) || "" } : typeof g === "object" ? { hw: g.hw || "", host: g.host || "" } : { hw: String(g).startsWith("host:") ? "" : String(g), host: String(g).startsWith("host:") ? String(g) : "" });
  function eigenesGeraet() {
    if (haken.geraeteId) return normGeraet(haken.geraeteId);
    if (geraetLauf) return geraetLauf;
    if (!hwGemerkt) {
      hwGemerkt = geraeteKennung();
    }
    return (geraetLauf = { hw: hwGemerkt, host: `host:${hostname()}` });
  }
  const eigenes = (m) => { const g = normGeraet(m.geraet); if (!g || (!g.hw && !g.host)) return true; const ich = eigenesGeraet(); if (ich.hw && g.hw) return ich.hw === g.hw; return !!ich.host && ich.host === g.host; };
  let aktionen = null, sperrDatei = null, bruchDatei = null, markeDatei = null;
  function setzeAktionen() {
    geraetLauf = null; // je Lauf frisch (ein leeres ioreg-Ergebnis wird nicht festgehalten)
    const ich = eigenesGeraet();
    aktionen = join(kortexDir, "aktionen", createHash("sha256").update(ich.hw || ich.host).digest("hex").slice(0, 12));
    sperrDatei = join(aktionen, ".sperre"); bruchDatei = join(aktionen, ".sperre.bruch"); markeDatei = join(aktionen, ".laeuft");
  }
  setzeAktionen();
  const pruefeVaultDa = () => { try { if (!statSync(wurzel).isDirectory()) throw 0; } catch { throw new HttpFehler(409, "Der Vault-Ordner gibt es nicht mehr an dieser Stelle. Kortex ändert nichts.", { art: "kein-vault" }); } };
  const punkt = (n) => { if (haken.punkt) haken.punkt(n); }; // nur für Tests: hier darf ein Kindprozess sich beenden (SIGKILL)

  // ───────────── Sperre: eine Aktion zugleich (im Prozess und zwischen Prozessen) ─────────────
  // Die Sperrdatei (<Vault>/.kortex-lokal/aktionen/<Gerät>/.sperre) trägt { pid, start, token }; sie entsteht fertig beschrieben per link() (atomar). Gebrochen wird sie NUR, wenn der Halter nicht mehr
  // lebt — sofort erkannt, nie nach einer Zeitgrenze. Gegen PID-Wiederverwendung gilt zusätzlich die Startzeit des Prozesses (ps -o lstart=). Das Brechen geschieht unter einer eigenen kurzen
  // Bruch-Sperre (.sperre.bruch), damit sich mehrere Brecher nie gegenseitig eine frische Sperre löschen. Zusätzlich liegt während jeder Aktion eine Marke (.laeuft): bleibt sie nach einem
  // Absturz liegen, wird dieser Vorgang beim nächsten Mal zurückgefahren.
  let kette = Promise.resolve(), erholt = false;
  const lebt = (pid) => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
  // Startzeit eines Prozesses: Werkstatt und MCP-Server laufen mit verschiedenem LANG/LC_ALL/TZ, die Ausgabe von ps hängt davon ab — darum absoluter Pfad und feste Umgebung (C, UTC)
  const startzeit = (pid) => prozessStart(pid);
  let eigenStart = null;
  const halterLebt = (h) => {
    if (!h || !Number.isInteger(h.pid) || h.pid <= 0 || !lebt(h.pid)) return false;
    if (h.start) { const jetzt = startzeit(h.pid); if (jetzt && jetzt !== h.start) return false; } // dieselbe PID, aber ein anderer Prozess
    return true;
  };
  const liesSperre = (datei) => { try { return JSON.parse(readFileSync(datei, "utf8")); } catch { return null; } };
  // Datei exklusiv anlegen, mit vollständigem Inhalt (link ist atomar; ohne link-Unterstützung wx). → Inhalt oder null (gibt es schon)
  function nimmDatei(datei) {
    if (eigenStart === null) eigenStart = startzeit(process.pid);
    const inhalt = { pid: process.pid, start: eigenStart, token: HEX(8) };
    const tmp = `${datei}.${process.pid}.${HEX(4)}`;
    writeFileSync(tmp, JSON.stringify(inhalt) + "\n", { mode: 0o600 });
    try { linkSync(tmp, datei); MEINE_TOKEN.add(inhalt.token); return inhalt; }
    catch (e) {
      if (e.code === "EEXIST") return null;
      if (e.code === "EPERM" || e.code === "ENOTSUP" || e.code === "EXDEV") {
        try { writeFileSync(datei, JSON.stringify(inhalt) + "\n", { flag: "wx", mode: 0o600 }); MEINE_TOKEN.add(inhalt.token); return inhalt; } catch (e2) { if (e2.code === "EEXIST") return null; throw e2; }
      }
      throw e;
    } finally { try { unlinkSync(tmp); } catch { /* weg */ } }
  }
  const raeume = (datei) => { const u = `${datei}.alt.${process.pid}.${HEX(4)}`; try { renameSync(datei, u); unlinkSync(u); } catch { /* schon weg */ } };
  function sperreVeraltet(datei) {
    const h = liesSperre(datei);
    if (h && h.pid === process.pid && h.start && h.start === eigenStart && !MEINE_TOKEN.has(h.token)) return true; // eigene PID und Startzeit, aber ein Token, das dieser Prozess nicht hält (Vault-Kopie, Umzug)
    if (h) return !halterLebt(h);
    try { return Date.now() - statSync(datei).mtimeMs > 10_000; } catch { return false; } // unlesbar (halb geschrieben): erst nach 10 s
  }
  // Eine veraltete Sperre brechen: nur unter der Bruch-Sperre, und nur, wenn es noch dieselbe Sperre ist, die als veraltet erkannt wurde. → true: es wurde etwas bewegt (erneut versuchen)
  function brichSperre() {
    const stand = liesSperre(sperrDatei);
    if (!sperreVeraltet(sperrDatei)) return false;
    const b = nimmDatei(bruchDatei);
    if (!b) { if (sperreVeraltet(bruchDatei)) raeume(bruchDatei); return true; }
    try { if (JSON.stringify(liesSperre(sperrDatei)) === JSON.stringify(stand)) raeume(sperrDatei); }
    finally { const mein = liesSperre(bruchDatei); if (mein && mein.token === b.token) { try { unlinkSync(bruchDatei); } catch { /* weg */ } } }
    return true;
  }
  // Läuft gerade eine Aktion dieses Vaults (auch in einem anderen Prozess)? Für git.mjs: Abgleich und Commit warten dann.
  function sperreAktiv() { try { setzeAktionen(); statSync(sperrDatei); return !sperreVeraltet(sperrDatei); } catch { return false; } }
  async function mitSperre(fn) {
    const lauf = kette.catch(() => {}).then(async () => {
      pruefeVaultDa(); // kein Geister-.kortex-lokal an einem Pfad, den es nicht mehr gibt
      setzeAktionen();
      mkdirSync(aktionen, { recursive: true, mode: 0o700 });
      let meine = null;
      for (let i = 0; i < 60 && !meine; i++) {
        meine = nimmDatei(sperrDatei);
        if (meine) break;
        if (brichSperre()) continue;
        await new Promise((ok) => setTimeout(ok, 50));
      }
      if (!meine) throw new HttpFehler(409, "Gerade läuft eine andere Änderung am Vault. Versuche es gleich noch einmal.", { art: "beschaeftigt" });
      try { erholeAngefangene(); return await fn(); }
      catch (e) {
        // Hat jemand .kortex-lokal mitten in der Aktion gelöscht, gibt es eine verständliche Meldung statt eines rohen ENOENT
        if (e && !(e instanceof HttpFehler) && e.code === "ENOENT" && String(e.path || "").startsWith(kortexDir)) throw new HttpFehler(409, "Der Ordner „.kortex-lokal“ im Vault wurde während der Aktion entfernt. Kortex hat angehalten; prüfe die Notizen (zum Beispiel im Verlauf) und versuche es noch einmal.", { art: "kortex-lokal-weg" });
        throw e;
      }
      finally { MEINE_TOKEN.delete(meine.token); const jetzt = liesSperre(sperrDatei); if (jetzt && jetzt.token === meine.token) { try { unlinkSync(sperrDatei); } catch { /* weg */ } } }
    });
    kette = lauf;
    return lauf;
  }
  const setzeMarke = (id, aktion = "op") => { try { writeFileSync(markeDatei, JSON.stringify({ id, aktion }) + "\n", { mode: 0o600 }); } catch { /* egal */ } };
  const ergaenzeMarke = (felder) => { try { const m = JSON.parse(readFileSync(markeDatei, "utf8")); writeFileSync(markeDatei, JSON.stringify({ ...m, ...felder }) + "\n", { mode: 0o600 }); } catch { /* egal */ } };
  const loescheMarke = () => { try { unlinkSync(markeDatei); } catch { /* weg */ } };

  // ───────────── Dateisystem-Helfer ─────────────
  const absVon = (rel) => join(wurzel, ...rel.split("/"));
  function atomarSchreiben(abs, buf, modus = 0o644) {
    const tmp = join(dirname(abs), `.brain-tmp-${process.pid}-${HEX(4)}`);
    try { writeFileSync(tmp, buf, { flag: "wx", mode: modus }); renameSync(tmp, abs); }
    catch (e) { try { unlinkSync(tmp); } catch { /* schon weg */ } throw e; }
  }
  const leseHash = (abs) => { try { return HASH(readFileSync(abs)); } catch { return null; } };
  function sichereKorb() {
    pruefeVaultDa();
    mkdirSync(vorgaenge, { recursive: true, mode: 0o700 });
    mkdirSync(aktionen, { recursive: true, mode: 0o700 });
    for (const d of [kortexDir, korb, vorgaenge, aktionen]) { try { chmodSync(d, 0o700); } catch { /* egal */ } }
    // Der Ordner .kortex-lokal ist nie in git: `.kortex-lokal/.gitignore` mit „*“ deckt Worktrees (.git ist eine Datei), Vaults in Unterordnern eines Repos und später eingerichtetes git;
    // zusätzlich .git/info/exclude (nie die .gitignore des Nutzers).
    try { const gi = join(kortexDir, ".gitignore"); if (!existsSync(gi)) writeFileSync(gi, "*\n"); } catch { /* nicht schreibbar */ }
    try {
      const info = join(wurzel, ".git", "info"), ex = join(info, "exclude");
      if (lstatSync(join(wurzel, ".git")).isDirectory()) {
        mkdirSync(info, { recursive: true });
        let t = ""; try { t = readFileSync(ex, "utf8"); } catch { /* neu */ }
        if (!t.split("\n").some((z) => z.trim() === "/.kortex-lokal/")) writeFileSync(ex, `${t}${t && !t.endsWith("\n") ? "\n" : ""}/.kortex-lokal/\n`);
      }
    } catch { /* ohne Git oder nicht schreibbar */ }
  }
  const schreibeManifest = (m) => {
    const datei = join(vorgangDir(m.id), "manifest.json"), tmp = `${datei}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(m) + "\n", { mode: 0o600 });
    renameSync(tmp, datei);
  };
  function leseManifest(id) {
    if (typeof id !== "string" || !ID.test(id)) return null;
    try {
      const m = JSON.parse(readFileSync(join(vorgangDir(id), "manifest.json"), "utf8"));
      return m && m.v === 1 && m.id === id ? m : null;
    } catch { return null; }
  }
  function chmodRekursiv(p, ordnerModus, dateiModus) {
    let st; try { st = lstatSync(p); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) { try { chmodSync(p, ordnerModus); } catch { /* egal */ } for (const n of readdirSync(p)) chmodRekursiv(join(p, n), ordnerModus, dateiModus); }
    else { try { chmodSync(p, dateiModus); } catch { /* egal */ } }
  }

  // ───────────── Notizen des Vaults lesen ─────────────
  function sammle() {
    const notizen = [], uebersprungen = new Map();
    const geh = (relOrdner) => {
      const abs = relOrdner ? absVon(relOrdner) : wurzel;
      let liste; try { liste = readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const d of liste) {
        if (gesperrterName(d.name)) continue;
        const rel = relOrdner ? `${relOrdner}/${d.name}` : d.name;
        if (d.isDirectory()) { if (!ueberspringeOrdner(join(abs, d.name))) geh(rel); continue; }
        if (!BEARBEITBAR.test(d.name)) continue;
        const a = join(abs, d.name);
        let st, symbol = false;
        try {
          if (d.isSymbolicLink()) { const echt = realpathSync(a); if (!imVault(echt, wurzel)) continue; st = statSync(echt); if (!st.isFile()) continue; symbol = true; }
          else if (d.isFile()) st = statSync(a); else continue;
        } catch { continue; }
        if (st.size > MAX_DATEI) { uebersprungen.set(rel, "zu groß"); continue; }
        let buf; try { buf = readFileSync(a); } catch { continue; }
        const text = buf.toString("utf8");
        if (Buffer.compare(Buffer.from(text, "utf8"), buf) !== 0) { uebersprungen.set(rel, "kein gültiger UTF-8-Text"); continue; }
        notizen.push({ pfad: rel, abs: a, buf, text, hash: HASH(buf), modus: st.mode & 0o777, symbol, mehrfach: st.nlink > 1 });
      }
    };
    geh("");
    return { notizen, uebersprungen };
  }

  // ───────────── Ziel prüfen ─────────────
  async function pruefeZiel(pfad, erwartet) {
    if (typeof pfad !== "string") throw new HttpFehler(400, "Der Pfad fehlt.");
    const l = loese(wurzel, pfad);
    let st;
    try { st = lstatSync(l.abs); } catch { throw new HttpFehler(404, "Das gibt es nicht (mehr)."); }
    if (ueberspringeOrdner(l.abs) || l.segmente.slice(0, -1).some((_, i) => ueberspringeOrdner(join(wurzel, ...l.segmente.slice(0, i + 1))))) throw new HttpFehler(404, "Das gibt es nicht (mehr).");
    if (st.isSymbolicLink()) throw new HttpFehler(403, "Verweise (Symlinks) fasst Kortex hier nicht an.");
    const typ = st.isDirectory() ? "ordner" : st.isFile() ? "datei" : null;
    if (!typ) throw new HttpFehler(400, "Das ist weder Datei noch Ordner.");
    if (erwartet && typ !== erwartet) throw new HttpFehler(400, erwartet === "datei" ? "Das ist ein Ordner, keine Notiz." : "Das ist eine Datei, kein Ordner.");
    if (typ === "datei") {
      if (!BEARBEITBAR.test(l.rel)) throw new HttpFehler(415, "Nur Markdown- und Textdateien lassen sich hier umbenennen, verschieben oder löschen.");
      if (istGeneriert(l.rel, l.abs)) throw new HttpFehler(403, "Diese Datei wird automatisch erzeugt und ist geschützt.");
      if (st.nlink > 1) throw new HttpFehler(423, "Diese Datei ist mehrfach verknüpft (derselbe Inhalt liegt unter einem zweiten Namen). Kortex fasst sie hier nicht an.");
    } else if (l.segmente.length === 1) {
      const fest = new Set([inboxOrdnerVon(wurzel), "09_wiki", "90_archiv", "01_vorlagen", vorlagenOrdner() || "01_vorlagen", (await aufgabenOrdner().catch(() => null)) || "05_aufgaben"].map(falte));
      if (fest.has(falte(l.segmente[0]))) throw new HttpFehler(403, "Dieser Ordner gehört fest zu Kortex (Posteingang, Aufgaben, Wiki, Archiv, Vorlagen) und lässt sich nicht umbenennen, verschieben oder löschen.");
    }
    return { ...l, st, typ };
  }
  const gleicheDatei = (a, b) => { try { const x = lstatSync(a), y = lstatSync(b); return x.ino === y.ino && x.dev === y.dev; } catch { return false; } };

  // Ziel ohne Umwandlung der Schreibweise des letzten Teils (loese() würde „Kaffee.md“ zu einer vorhandenen „kaffee.md“ umdeuten — beim Umbenennen nur der Groß-/Kleinschreibung falsch)
  function loeseBlatt(rel) {
    const segs = sauber(rel);
    const blatt = segs.pop();
    const eltern = segs.length ? loese(wurzel, segs.join("/")) : { abs: wurzel, rel: "" };
    return { abs: join(eltern.abs, blatt), rel: (eltern.rel ? eltern.rel + "/" : "") + blatt, eltern: eltern.rel };
  }
  const gibtEs = (abs) => { try { lstatSync(abs); return true; } catch { return false; } };

  // Ort prüfen, gemeinsam für Umbenennen, Verschieben und Wiederherstellen: Zielordner (muss es geben, außer beim Wiederherstellen, das ihn anlegt), kein Unter-Vault unter den Vorfahren,
  // bei Dateien kein reservierter oder erzeugter Name (index.md, _…md im Wiki)
  function pruefeOrt(l, typ, { elternMuss = true } = {}) {
    if (l.eltern) {
      if (elternMuss) {
        let st; try { st = statSync(absVon(l.eltern)); } catch { throw new HttpFehler(404, "Der Zielordner existiert nicht."); }
        if (!st.isDirectory()) throw new HttpFehler(404, "Der Zielordner existiert nicht.");
      }
      const teile = l.eltern.split("/");
      for (let i = 1; i <= teile.length; i++) { const ab = absVon(teile.slice(0, i).join("/")); if ((elternMuss || existsSync(ab)) && ueberspringeOrdner(ab)) throw new HttpFehler(404, "Der Zielordner existiert nicht."); }
    }
    if (typ === "datei") {
      const blatt = basename(l.rel);
      if (generiertName(blatt) || wikiGeneriert(l.rel, blatt)) throw new HttpFehler(403, "Dieser Name ist für automatisch erzeugte Dateien reserviert (zum Beispiel index.md oder _…md im Wiki). Bitte einen anderen wählen.", { art: "reserviert" });
    }
  }

  // Zielpfad prüfen: der Name darf nicht belegt sein (außer es ist dieselbe Datei in anderer Schreibweise)
  function pruefeNach(von, nachRel, typ) {
    const l = loeseBlatt(nachRel);
    if (typ === "ordner" && falte(l.rel) !== falte(von.rel) && falte(l.rel).startsWith(falte(von.rel) + "/")) throw new HttpFehler(400, "Ein Ordner lässt sich nicht in sich selbst verschieben.");
    pruefeOrt(l, typ);
    let casePur = false;
    if (gibtEs(l.abs)) {
      if (gleicheDatei(von.abs, l.abs)) {
        if (basename(von.abs) === basename(l.abs) && dirname(von.abs) === dirname(l.abs)) return { ...l, unveraendert: true, casePur: false };
        casePur = true;
      } else throw new HttpFehler(409, typ === "ordner" ? "Einen Ordner mit diesem Namen gibt es dort schon." : "Eine Datei mit diesem Namen gibt es dort schon.", { art: "belegt" });
    }
    return { ...l, casePur };
  }

  // ───────────── Plan ─────────────
  // Nach SEGMENTEN, nicht nach Zeichen: „Übungen“ als NFD im Dateisystem und als NFC im Link sind nicht gleich lang — geschnitten wird nach Teilen des Pfads
  const abbilder = (von, nach, typ) => {
    const vs = von.split("/").map(falte);
    return (p) => {
      const ps = p.split("/");
      if (ps.length < vs.length || (typ === "datei" && ps.length !== vs.length)) return p;
      for (let i = 0; i < vs.length; i++) if (falte(ps[i]) !== vs[i]) return p;
      return [nach, ...ps.slice(vs.length)].join("/");
    };
  };

  function schreibbarGrund(n, selbst) {
    if (n.symbol) return "ist ein Verweis (Symlink)";
    if (n.mehrfach) return "ist mehrfach verknüpft";
    if (istGeneriert(n.pfad, n.abs)) return "wird automatisch erzeugt";
    return null;
  }

  // art: "umbenennen" | "verschieben" | "loeschen";  typ: "datei" | "ordner"
  async function plane({ art, typ, pfad, nachRel = null, titel = null, basisHash = null }) {
    const von = await pruefeZiel(pfad, typ);
    const { notizen, uebersprungen: uebersp } = sammle();
    const mapNotiz = new Map(notizen.map((n) => [n.pfad, n]));
    const selbst = typ === "datei" ? mapNotiz.get(von.rel) : null;
    if (typ === "datei" && !selbst) throw new HttpFehler(415, "Diese Datei lässt sich nicht lesen.");
    if (selbst && basisHash !== null && basisHash !== undefined && selbst.hash !== basisHash) throw new HttpFehler(409, "Die Notiz wurde inzwischen geändert (zum Beispiel von einem anderen Programm).", { aktuellerHash: selbst.hash, art: "geaendert" });
    const plan = { art, typ, von: von.rel, nach: null, vonAbs: von.abs, dateien: [], uebersprungen: [], verlinktVon: [], notizenImOrdner: 0, casePur: false, titelAlt: null, titelNeu: null, hash: selbst ? selbst.hash : null };
    if (typ === "datei") plan.titelAlt = titelAus(von.rel, selbst.text);
    if (typ === "ordner") plan.notizenImOrdner = notizen.filter((n) => falte(n.pfad).startsWith(falte(von.rel) + "/")).length;

    if (art === "loeschen") {
      plan.verlinktVon = verlinktVon({ notizen, ziele: [von.rel], existiert: (p) => existsSync(absVon(p)) }).map((x) => ({ ...x, titel: titelAus(x.pfad, mapNotiz.get(x.pfad).text) }));
      plan.verweise = plan.verlinktVon.reduce((s, x) => s + x.anzahl, 0);
      plan.notizen = plan.verlinktVon.length;
      plan.token = token(plan, notizen, von);
      return plan;
    }

    const nach = pruefeNach(von, nachRel, typ);
    plan.nach = nach.rel; plan.nachAbs = nach.abs; plan.casePur = nach.casePur; plan.keinUmzug = !!nach.unveraendert;
    const abb = abbilder(von.rel, nach.rel, typ);
    // Neuer Titel: im Text der Notiz selbst
    let selbstText = selbst ? selbst.text : null, titelGesetzt = false;
    const neueTexte = new Map();
    if (selbst && titel !== null) {
      const r = setzeTitel(selbst.text, titel);
      titelGesetzt = r.geaendert;
      if (r.geaendert && r.text !== selbst.text) { selbstText = r.text; neueTexte.set(selbst.pfad, r.text); plan.titelNeu = titelAus(von.rel, r.text); } else titelGesetzt = false;
    }
    plan.titelGesetzt = titelGesetzt;
    if (nach.unveraendert && !titelGesetzt) { plan.unveraendert = true; plan.verweise = 0; plan.notizen = 0; plan.liste = []; plan.token = token(plan, notizen, von); return plan; }
    const aenderungen = planeVerweise({ notizen: notizen.filter((n) => !n.fehler), abb, neueTexte, existiert: (p) => existsSync(absVon(p)) });
    let verweise = 0;
    const liste = [];
    for (const [alt, a] of aenderungen) {
      const n = mapNotiz.get(alt);
      const grund = schreibbarGrund(n);
      if (grund) { plan.uebersprungen.push({ pfad: alt, grund }); continue; }
      let text = a.text;
      plan.dateien.push({ pfad: alt, vorher: n.buf, hashVorher: n.hash, modus: n.modus, text, anzahl: a.verweise.length });
      verweise += a.verweise.length;
      liste.push({ pfad: abb(alt), alterPfad: alt, titel: titelAus(alt, n.text), anzahl: a.verweise.length, zeilen: a.verweise.slice(0, 3).map((z) => ({ zeile: z.zeile, vorher: z.vorher, nachher: z.nachher })) });
    }
    // Titel der Notiz selbst (auch wenn sie sonst keine Verweise hat)
    if (selbst && titelGesetzt) {
      const d = plan.dateien.find((x) => x.pfad === selbst.pfad);
      const mitLinks = d ? d.text : selbst.text;
      const r = setzeTitel(mitLinks, titel);
      if (d) d.text = r.text; else plan.dateien.push({ pfad: selbst.pfad, vorher: selbst.buf, hashVorher: selbst.hash, modus: selbst.modus, text: r.text, anzahl: 0 });
    }
    for (const d of plan.dateien) { d.nachher = Buffer.from(d.text, "utf8"); d.hashNachher = HASH(d.nachher); delete d.text; }
    for (const [p, grund] of uebersp) plan.uebersprungen.push({ pfad: p, grund });
    plan.verweise = verweise;
    plan.notizen = liste.length;
    plan.liste = liste.sort((a, b) => a.pfad.localeCompare(b.pfad, "de")).slice(0, MAX_LISTE);
    plan.mehrListe = Math.max(0, liste.length - MAX_LISTE);
    plan.token = token(plan, notizen, von);
    return plan;
  }

  // Fingerabdruck dessen, was der Plan gelesen hat: ändert sich eine der Dateien, stimmt das Token beim Ausführen nicht mehr
  function token(plan, notizen, von) {
    const h = createHash("sha256");
    h.update(`${plan.art}\0${plan.typ}\0${plan.von}\0${plan.nach || ""}\0${plan.hash || ""}\n`);
    for (const d of (plan.dateien || []).slice().sort((a, b) => (a.pfad < b.pfad ? -1 : 1))) h.update(`${d.pfad}\0${d.hashVorher}\0${HASH(d.nachher || Buffer.alloc(0))}\n`);
    if (plan.art === "loeschen" && plan.typ === "ordner") {
      for (const n of notizen.filter((x) => falte(x.pfad).startsWith(falte(von.rel) + "/")).sort((a, b) => (a.pfad < b.pfad ? -1 : 1))) h.update(`${n.pfad}\0${n.hash}\n`);
    }
    return h.digest("hex").slice(0, 32);
  }

  const vorschauVon = (plan) => ({
    ok: true, art: plan.art, typ: plan.typ, von: plan.von, nach: plan.nach, unveraendert: !!plan.unveraendert, verweise: plan.verweise || 0, notizen: plan.notizen || 0,
    liste: plan.liste || [], mehr: plan.mehrListe || 0, uebersprungen: plan.uebersprungen.slice(0, MAX_LISTE),
    verlinktVon: plan.verlinktVon.slice(0, MAX_LISTE), notizenImOrdner: plan.notizenImOrdner, titelAlt: plan.titelAlt, titelNeu: plan.titelNeu,
    hash: plan.hash, token: plan.token,
  });

  // ───────────── Ausführen ─────────────
  function vorgangId() { return `v_${HEX(6)}`; }
  function ordnerListe(abs) { // alle Einträge eines Ordners: [{ pfad, art, groesse, modus, hash }]
    const aus = [];
    const geh = (rel) => {
      for (const d of readdirSync(rel ? join(abs, rel) : abs, { withFileTypes: true })) {
        const r = rel ? `${rel}/${d.name}` : d.name;
        const a = join(abs, r);
        const st = lstatSync(a);
        if (aus.length > MAX_DATEIEN_ORDNER) throw new HttpFehler(413, "Dieser Ordner enthält zu viele Dateien für den Papierkorb.");
        if (st.isDirectory()) { aus.push({ pfad: r, art: "ordner", modus: st.mode & 0o777 }); geh(r); }
        else if (st.isSymbolicLink()) aus.push({ pfad: r, art: "verweis", modus: 0 });
        else aus.push({ pfad: r, art: "datei", groesse: st.size, modus: st.mode & 0o777, hash: st.size <= MAX_DATEI ? HASH(readFileSync(a)) : null });
      }
    };
    geh("");
    return aus;
  }

  // Verschieben im Dateisystem (nur innerhalb des Vaults und nur ohne zu überschreiben)
  function verschiebeFs(vonAbs, nachAbs, typ, casePur) {
    if (casePur) { renameSync(vonAbs, nachAbs); return; }
    if (typ === "datei") {
      try { linkSync(vonAbs, nachAbs); }
      catch (e) {
        if (e.code === "EEXIST") throw new HttpFehler(409, "Eine Datei mit diesem Namen gibt es dort schon.", { art: "belegt" });
        if (e.code === "EPERM" || e.code === "ENOTSUP" || e.code === "EXDEV") { if (existsSync(nachAbs)) throw new HttpFehler(409, "Eine Datei mit diesem Namen gibt es dort schon.", { art: "belegt" }); renameSync(vonAbs, nachAbs); return; }
        throw e;
      }
      punkt("nach-link");
      unlinkSync(vonAbs);
    } else {
      // Atomar ohne Ersetzen: das Ziel wird zuerst exklusiv als leerer Ordner angelegt (EEXIST → belegt); rename darf nur diesen leeren Ordner ersetzen
      try { mkdirSync(nachAbs, { mode: 0o700 }); }
      catch (e) { if (e.code === "EEXIST") throw new HttpFehler(409, "Einen Ordner mit diesem Namen gibt es dort schon.", { art: "belegt" }); throw e; }
      punkt("nach-mkdir");
      try { renameSync(vonAbs, nachAbs); }
      catch (e) { try { rmdirSync(nachAbs); } catch { /* nicht leer: nicht anfassen */ } throw e; }
    }
  }
  // Inhalt eines Ordners oder einer Datei als Liste (Pfad, Größe, Hash): für „derselbe Inhalt?“ beim Wiederholen
  const inhaltListe = (abs) => (lstatSync(abs).isDirectory() ? ordnerListe(abs) : [{ pfad: "", art: "datei", groesse: lstatSync(abs).size, hash: HASH(readFileSync(abs)) }]);
  const gleicheListen = (a, b) => {
    if (a.length !== b.length) return false;
    const m = new Map(b.map((e) => [e.pfad, e]));
    return a.every((e) => { const x = m.get(e.pfad); return x && x.art === e.art && (e.art !== "datei" || (x.groesse === e.groesse && x.hash === e.hash)); });
  };
  // Papierkorb, Wiederherstellen, Wiederholen: nur rename auf demselben Laufwerk. Liefert rename EXDEV (Bind-Mount, Ordner aus einem anderen Volume im Vault), wird abgelehnt — nichts ist angefasst.
  function verschiebeLokal(vonAbs, nachAbs) {
    try { (haken.rename || renameSync)(vonAbs, nachAbs); }
    catch (e) {
      if (e.code === "EXDEV") throw new HttpFehler(409, "Das lässt sich nicht in den Papierkorb legen oder zurückholen, weil Quelle und Ziel auf verschiedenen Laufwerken liegen. Kortex kopiert dabei nie; es wurde nichts verändert.", { art: "anderes-laufwerk" });
      throw e;
    }
  }

  const textFuer = (art, typ, plan) => {
    const was = typ === "ordner" ? "Ordner" : "Notiz";
    const v = plan.verweise ? ` · ${plan.verweise} ${plan.verweise === 1 ? "Verweis" : "Verweise"} in ${plan.notizen} ${plan.notizen === 1 ? "Notiz" : "Notizen"} angepasst` : "";
    if (art === "loeschen") return `${was} in den Papierkorb gelegt${plan.verweise ? ` · von ${plan.notizen} ${plan.notizen === 1 ? "Notiz" : "Notizen"} verlinkt` : ""}`;
    return `${was} ${art === "umbenennen" ? "umbenannt" : "verschoben"}${v}`;
  };

  // Die eigene Aktion steht im Protokoll, ist aber schon gelesen: sie soll die Glocke nicht als „neu“ anzeigen
  const alsGelesen = (e) => { try { if (e) aendereZustand(support, kennung, (s) => { if (!s.gelesen.includes(e.id)) s.gelesen.push(e.id); }); } catch { /* das Protokoll ist Beiwerk */ } return e; };
  function protokolliere(m, plan) {
    const pfade = plan.art === "loeschen" ? [plan.von] : [plan.nach, plan.von];
    const e = alsGelesen(melde(wurzel, { art: "datei-aktion", wer, vaultName: name, text: textFuer(plan.art, plan.typ, plan), pfade, rueckgaengig: { art: "vorgang", id: m.id } }, { support }));
    return e ? e.id : null;
  }

  async function fuehreAus(plan, eingabe = {}) {
    if (eingabe.token !== undefined && eingabe.token !== null && eingabe.token !== plan.token) {
      throw new HttpFehler(409, "Der Vault hat sich seit der Vorschau verändert. Bitte noch einmal ansehen.", { art: "vorschau-veraltet" });
    }
    if (plan.unveraendert) return { ok: true, unveraendert: true, art: plan.art, typ: plan.typ, von: plan.von, nach: plan.nach, pfad: plan.nach, verweise: 0, notizen: 0 };
    sichereKorb();
    const id = vorgangId(), dir = vorgangDir(id);
    mkdirSync(join(dir, "vorher"), { recursive: true, mode: 0o700 });
    mkdirSync(join(dir, "nachher"), { recursive: true, mode: 0o700 });
    const m = { v: 1, id, geraet: eigenesGeraet(), art: plan.art, typ: plan.typ, zeit: jetzt().toISOString(), status: "laeuft", von: plan.von, nach: plan.nach, casePur: plan.casePur, titelAlt: plan.titelAlt, titelNeu: plan.titelNeu,
      verweise: plan.verweise || 0, notizen: plan.notizen || 0, eintrag: null,
      dateien: plan.dateien.map((d, i) => ({ n: i, pfad: d.pfad, hashVorher: d.hashVorher, hashNachher: d.hashNachher, modus: d.modus })),
      groesse: plan.dateien.reduce((a, d) => a + d.vorher.length + d.nachher.length, 0) };
    try {
      if (plan.art === "loeschen") return await loescheInKorb(plan, m, eingabe);
      plan.dateien.forEach((d, i) => { writeFileSync(join(dir, "vorher", String(i)), d.vorher, { mode: 0o600 }); writeFileSync(join(dir, "nachher", String(i)), d.nachher, { mode: 0o600 }); });
      schreibeManifest(m);
      setzeMarke(id);
      const geschrieben = [];
      try {
        for (const d of plan.dateien) {
          const abs = absVon(d.pfad);
          if (leseHash(abs) !== d.hashVorher) throw new HttpFehler(409, `„${basename(d.pfad)}“ wurde inzwischen geändert (zum Beispiel von einem anderen Programm). Es wurde nichts verändert.`, { art: "geaendert", pfad: d.pfad });
          atomarSchreiben(abs, d.nachher, d.modus);
          geschrieben.push(d);
        }
        punkt("nach-schreiben");
        // letzte Prüfung vor dem Umbenennen: gibt es das Ziel noch, ist die Quelle noch da
        if (!existsSync(plan.vonAbs)) throw new HttpFehler(404, "Das gibt es nicht mehr.");
        if (!plan.keinUmzug) verschiebeFs(plan.vonAbs, plan.nachAbs, plan.typ, plan.casePur);
        punkt("nach-umzug");
      } catch (e) {
        for (const d of geschrieben.reverse()) { try { if (leseHash(absVon(d.pfad)) === d.hashNachher) atomarSchreiben(absVon(d.pfad), d.vorher, d.modus); } catch { /* bester Versuch; die Kopie bleibt im Journal */ } }
        throw e;
      }
      m.status = "fertig";
      schreibeManifest(m);
      loescheMarke();
    } catch (e) {
      if (plan.art !== "loeschen") { loescheMarke(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* egal */ } } // das Löschen räumt selbst auf: dort liegt der Inhalt im Journal
      throw e;
    }
    try { begrenzeJournale(m.id); } catch { /* Beiwerk */ }
    m.eintrag = eingabe.eintrag === false ? null : protokolliere(m, plan); // eintrag: false = der Aufrufer (MCP-Server) schreibt den Eintrag selbst, mit Konto und Programm
    if (m.eintrag) { try { schreibeManifest(m); } catch { /* der Eintrag verweist auf die Kennung, nicht umgekehrt */ } }
    const nachPfad = (p) => (plan.typ === "datei" ? (p === plan.von ? plan.nach : p) : (falte(p).startsWith(falte(plan.von) + "/") ? plan.nach + p.slice(plan.von.length) : p));
    const geaendert = [...new Set([plan.von, plan.nach, ...plan.dateien.map((d) => nachPfad(d.pfad))])];
    const neuerHash = plan.typ === "datei" ? leseHash(plan.nachAbs) : null;
    return { ok: true, art: plan.art, typ: plan.typ, von: plan.von, nach: plan.nach, pfad: plan.nach, ziel: plan.typ === "datei" ? plan.nach : undefined, verweise: plan.verweise || 0, notizen: plan.notizen || 0,
      dateien: plan.dateien.map((d) => ({ pfad: nachPfad(d.pfad), anzahl: d.anzahl })), geaendert, hash: neuerHash, vorgang: id, aktivitaetId: m.eintrag, titel: plan.titelNeu || null };
  }

  async function loescheInKorb(plan, m, eingabe = {}) {
    const dir = vorgangDir(m.id);
    const inhaltDir = join(dir, "inhalt");
    const ziel = join(inhaltDir, basename(plan.vonAbs));
    const aufraeumenKlein = () => { loescheMarke(); try { rmSync(dir, { recursive: true, force: true }); } catch { /* egal */ } };
    try {
      mkdirSync(inhaltDir, { recursive: true, mode: 0o700 });
      const st = lstatSync(plan.vonAbs);
      const eintraege = plan.typ === "ordner" ? ordnerListe(plan.vonAbs) : [{ pfad: "", art: "datei", groesse: st.size, modus: st.mode & 0o777, hash: HASH(readFileSync(plan.vonAbs)) }];
      if (plan.typ === "datei" && eintraege[0].hash !== plan.hash) throw new HttpFehler(409, "Die Notiz wurde inzwischen geändert (zum Beispiel von einem anderen Programm). Es wurde nichts verändert.", { art: "geaendert", aktuellerHash: eintraege[0].hash });
      m.inhalt = { name: basename(plan.vonAbs), modus: st.mode & 0o777, eintraege };
      m.titel = plan.titelAlt || null;
      schreibeManifest(m);
      setzeMarke(m.id);
    } catch (e) { aufraeumenKlein(); throw e; }
    punkt("loeschen-vorher");
    try { verschiebeLokal(plan.vonAbs, ziel); }
    catch (e) { aufraeumenKlein(); throw e; } // rename ist atomar: es wurde nichts bewegt
    punkt("loeschen-nachher");
    chmodRekursiv(ziel, 0o700, 0o600);
    m.status = "fertig";
    schreibeManifest(m);
    loescheMarke();
    m.eintrag = eingabe.eintrag === false ? null : protokolliere(m, plan);
    if (m.eintrag) { try { schreibeManifest(m); } catch { /* egal */ } }
    return { ok: true, art: "loeschen", typ: plan.typ, von: plan.von, nach: null, pfad: plan.von, verweise: plan.verweise || 0, notizen: plan.notizen || 0, verlinktVon: plan.verlinktVon.slice(0, MAX_LISTE),
      geaendert: [plan.von], vorgang: m.id, aktivitaetId: m.eintrag };
  }

  // ───────────── Öffentliche Aktionen ─────────────
  const gemeinsamEin = (e) => { if (!e || typeof e !== "object") throw new HttpFehler(400, "Die Anfrage ist leer."); return e; };
  const flag = (e) => (e.vorschau === true);

  function benenne(e, typ) {
    const ort = ordnerVonPfad(e.pfad || "");
    const alt = basename(String(e.pfad || ""));
    // Datei: Titel und/oder Dateiname. Ohne Dateiname bleibt er, außer es gibt keine Quelle für den Titel im Text (dann ist der Titel der Dateiname) oder „dateinameAusTitel“.
    if (typ === "ordner") return { nachRel: (ort ? ort + "/" : "") + pruefeName(e.name, { was: "Ordnername" }), titel: null };
    const endung = (/\.(md|txt)$/i.exec(alt) || [""])[0];
    let titel = null;
    if (e.titel !== undefined && e.titel !== null) {
      if (typeof e.titel !== "string" || !e.titel.trim()) throw new HttpFehler(400, "Bitte einen Titel angeben.");
      if (e.titel.length > 200) throw new HttpFehler(400, "Der Titel ist zu lang.");
      titel = e.titel.replace(/\s+/g, " ").trim();
    }
    let dateiname = null;
    if (e.dateiname !== undefined && e.dateiname !== null) {
      let n = pruefeName(e.dateiname, { was: "Dateiname" });
      const neueEndung = (/\.(md|txt)$/i.exec(n) || [""])[0];
      if (neueEndung && endung && neueEndung.toLowerCase() !== endung.toLowerCase()) throw new HttpFehler(400, `Die Endung ${endung} bleibt, wie sie ist.`);
      if (!neueEndung) n += endung || ".md";
      dateiname = n;
    }
    if (titel === null && dateiname === null) throw new HttpFehler(400, "Bitte einen neuen Titel oder Dateinamen angeben.");
    return { nachRel: (ort ? ort + "/" : "") + (dateiname ?? alt), titel, dateinameAusTitel: e.dateinameAusTitel === true, endung, alt };
  }

  async function umbenennen(eingabe) {
    const e = gemeinsamEin(eingabe);
    const typ = e.typ === "ordner" ? "ordner" : "datei";
    const b = benenne(e, typ);
    let nachRel = b.nachRel;
    let titel = b.titel;
    if (typ === "datei" && titel !== null && e.dateiname === undefined) {
      // Titel ohne Quelle im Text → der Dateiname IST der Titel; oder ausdrücklich gewünscht: Dateiname folgt dem Titel
      const probe = await mitSperre(async () => { const v = await pruefeZiel(e.pfad, "datei"); return setzeTitel(readFileSync(v.abs, "utf8"), titel).geaendert; });
      if (!probe || b.dateinameAusTitel) {
        const stamm = ohneEndungName(b.alt);
        const n = /^[a-z0-9][a-z0-9-]*$/.test(stamm) ? slug(titel, 60) : pruefeName(titel.replace(/[\/\\:\u0000-\u001f]+/g, "-").replace(/^\.+/, ""), { was: "Dateiname" }).slice(0, 120);
        const ordnerTeil = ordnerVonPfad(e.pfad) ? ordnerVonPfad(e.pfad) + "/" : "";
        let voll = n + b.endung;
        if (generiertName(voll) || wikiGeneriert(ordnerTeil + voll, voll) || voll.startsWith("_")) voll = `${n}-notiz${b.endung}`; // ein Titel „Index“ darf nicht index.md werden
        nachRel = ordnerTeil + voll;
        if (!probe) titel = titel; // setzeTitel ändert dann nichts; der Titel ergibt sich aus dem Dateinamen
      }
    }
    return mitSperre(async () => {
      const plan = await plane({ art: "umbenennen", typ, pfad: e.pfad, nachRel, titel: typ === "datei" ? titel : null, basisHash: e.basisHash ?? null });
      if (flag(e)) return vorschauVon(plan);
      return fuehreAus(plan, e);
    });
  }

  async function verschieben(eingabe) {
    const e = gemeinsamEin(eingabe);
    const typ = e.typ === "ordner" ? "ordner" : "datei";
    if (typeof e.ziel !== "string") throw new HttpFehler(400, "Bitte einen Zielordner angeben.");
    const ziel = e.ziel.replace(/^\/+|\/+$/g, "");
    return mitSperre(async () => {
      const name = basename(String(e.pfad || ""));
      const nachRel = (ziel ? ziel + "/" : "") + name;
      const plan = await plane({ art: "verschieben", typ, pfad: e.pfad, nachRel, basisHash: e.basisHash ?? null });
      if (flag(e)) return vorschauVon(plan);
      return fuehreAus(plan, e);
    });
  }

  async function loeschen(eingabe) {
    const e = gemeinsamEin(eingabe);
    const typ = e.typ === "ordner" ? "ordner" : "datei";
    return mitSperre(async () => {
      const plan = await plane({ art: "loeschen", typ, pfad: e.pfad, basisHash: e.basisHash ?? null });
      if (flag(e)) return vorschauVon(plan);
      return fuehreAus(plan, e);
    });
  }

  // ───────────── Rückgängig / Wiederherstellen ─────────────
  // richtung "zurueck": Zustand von vor der Aktion herstellen · "vor": die Aktion noch einmal ausführen (nach einem Rückgängig)
  function wechsle(m, richtung, { teilweise = false } = {}) {
    const zurueck = richtung === "zurueck";
    if (m.art === "loeschen") return wechsleLoeschen(m, zurueck);
    const abb = abbilder(m.von, m.nach, m.typ);
    const aktuell = (p) => (zurueck ? abb(p) : p);           // wo liegt die Datei (alte Koordinaten p) gerade?
    const quelle = zurueck ? m.nach : m.von, ziel = zurueck ? m.von : m.nach;
    const quelleAbs = absVon(quelle), zielAbs = absVon(ziel);
    const gleich = m.von === m.nach; // nur Titel geändert, Datei blieb
    if (!existsSync(quelleAbs) && !(() => { try { lstatSync(quelleAbs); return true; } catch { return false; } })()) throw new HttpFehler(409, `„${basename(quelle)}“ gibt es nicht mehr an dieser Stelle. Kortex nimmt nichts zurück.`, { art: "fehlt" });
    let casePur = false;
    if (!gleich && existsSync(zielAbs)) { if (gleicheDatei(quelleAbs, zielAbs)) casePur = true; else throw new HttpFehler(409, `Am Ursprungsort liegt inzwischen etwas anderes („${basename(ziel)}“). Kortex überschreibt nichts.`, { art: "belegt" }); }
    // Dateien prüfen
    const bereit = [], abweichend = [];
    for (const d of m.dateien) {
      const abs = absVon(aktuell(d.pfad));
      const erwartet = zurueck ? d.hashNachher : d.hashVorher;
      const jetztHash = leseHash(abs);
      let bytes; try { bytes = readFileSync(join(vorgangDir(m.id), zurueck ? "vorher" : "nachher", String(d.n))); } catch { bytes = null; }
      if (jetztHash !== erwartet || !bytes) abweichend.push(d); else bereit.push({ d, abs, bytes });
    }
    if (abweichend.length && !teilweise) {
      throw new HttpFehler(409, `Seit der Aktion ${abweichend.length === 1 ? "wurde eine Notiz" : `wurden ${abweichend.length} Notizen`} geändert. Rückgängig würde diese Änderungen überschreiben.`,
        { art: "geaendert", dateien: abweichend.map((d) => aktuell(d.pfad)).slice(0, MAX_LISTE) });
    }
    sichereKorb();
    const geschrieben = [];
    try {
      for (const { d, abs, bytes } of bereit) {
        if (leseHash(abs) !== (zurueck ? d.hashNachher : d.hashVorher)) throw new HttpFehler(409, `„${basename(abs)}“ wurde inzwischen geändert. Es wurde nichts verändert.`, { art: "geaendert", dateien: [aktuell(d.pfad)] });
        const alt = readFileSync(abs);
        atomarSchreiben(abs, bytes, d.modus);
        geschrieben.push({ abs, alt, modus: d.modus, hash: zurueck ? d.hashVorher : d.hashNachher });
      }
      // Titel der Notiz selbst, wenn sie seit der Aktion weiterbearbeitet wurde (Dateiinhalt weicht ab, aber der Titel ist noch der neue)
      if (abweichend.length && m.typ === "datei" && m.titelAlt && m.titelNeu) {
        const selbst = abweichend.find((d) => d.pfad === m.von);
        if (selbst) {
          const abs = absVon(aktuell(selbst.pfad));
          const text = readFileSync(abs, "utf8");
          const gewollt = zurueck ? m.titelAlt : m.titelNeu, jetztTitel = zurueck ? m.titelNeu : m.titelAlt;
          if (titelAus(m.von, text) === jetztTitel) { const r = setzeTitel(text, gewollt); if (r.geaendert) { const alt = Buffer.from(text, "utf8"); atomarSchreiben(abs, Buffer.from(r.text, "utf8"), selbst.modus); geschrieben.push({ abs, alt, modus: selbst.modus, hash: HASH(Buffer.from(r.text, "utf8")) }); } }
        }
      }
      punkt(zurueck ? "undo-nach-schreiben" : "redo-nach-schreiben");
      if (!gleich) verschiebeFs(quelleAbs, zielAbs, m.typ, casePur);
      punkt(zurueck ? "undo-nach-umzug" : "redo-nach-umzug");
    } catch (e) {
      for (const g of geschrieben.reverse()) { try { atomarSchreiben(g.abs, g.alt, g.modus); } catch { /* bester Versuch */ } }
      throw e;
    }
    return { ok: true, typ: m.typ, art: zurueck ? "zurueck" : "wieder", von: quelle, nach: ziel, pfad: ziel, uebersprungen: abweichend.map((d) => aktuell(d.pfad)), geaendert: [...new Set([quelle, ziel, ...m.dateien.map((d) => (zurueck ? d.pfad : abb(d.pfad)))])] };
  }

  // Zurücklegen ohne je etwas zu überschreiben: Dateien per link + unlink (EEXIST → belegt), Ordner reservieren das Ziel mit mkdir und ersetzen nur diesen leeren Ordner
  function legeZurueck(vonAbs, nachAbs, typ) {
    const belegt = () => new HttpFehler(409, typ === "ordner" ? "Einen Ordner mit diesem Namen gibt es dort schon. Kortex überschreibt nichts." : "Eine Datei mit diesem Namen gibt es dort schon. Kortex überschreibt nichts.", { art: "belegt" });
    if (haken.rename) { try { haken.rename(vonAbs, nachAbs); return; } catch (e) { if (e.code === "EXDEV") throw new HttpFehler(409, "Quelle und Ziel liegen auf verschiedenen Laufwerken.", { art: "anderes-laufwerk" }); throw e; } } // nur Tests: EXDEV nachstellen
    punkt("restore-vor-link");
    if (typ === "datei") {
      try { linkSync(vonAbs, nachAbs); }
      catch (e) {
        if (e.code === "EEXIST") throw belegt();
        if (e.code === "EXDEV") throw new HttpFehler(409, "Quelle und Ziel liegen auf verschiedenen Laufwerken.", { art: "anderes-laufwerk" });
        if (e.code === "EPERM" || e.code === "ENOTSUP") { if (gibtEs(nachAbs)) throw belegt(); verschiebeLokal(vonAbs, nachAbs); return; }
        throw e;
      }
      punkt("restore-nach-link");
      unlinkSync(vonAbs);
    } else {
      try { mkdirSync(nachAbs, { mode: 0o700 }); } catch (e) { if (e.code === "EEXIST") throw belegt(); throw e; }
      punkt("restore-nach-mkdir");
      try { verschiebeLokal(vonAbs, nachAbs); } catch (e) { try { rmdirSync(nachAbs); } catch { /* nicht leer */ } throw e; }
    }
  }
  function wechsleLoeschen(m, zurueck, { name: neuerName = null, ziel: neuerOrdner = null } = {}) {
    const inhaltAbs = join(vorgangDir(m.id), "inhalt", m.inhalt.name);
    if (zurueck) {
      const ordner = neuerOrdner !== null ? neuerOrdner.replace(/^\/+|\/+$/g, "") : ordnerVonPfad(m.von);
      let nm = basename(m.von);
      if (neuerName) {
        nm = pruefeName(neuerName, { was: m.typ === "ordner" ? "Ordnername" : "Dateiname" });
        if (m.typ === "datei") { // die Endung bleibt, wie beim Umbenennen
          const alt = (/\.(md|txt)$/i.exec(basename(m.von)) || [""])[0], neu = (/\.(md|txt)$/i.exec(nm) || [""])[0];
          if (neu && alt && neu.toLowerCase() !== alt.toLowerCase()) throw new HttpFehler(400, `Die Endung ${alt} bleibt, wie sie ist.`);
          if (!neu) nm += alt || ".md";
        }
      }
      const nachRel = (ordner ? ordner + "/" : "") + nm;
      const l = loeseBlatt(nachRel);
      pruefeOrt(l, m.typ, { elternMuss: false }); // dieselben Prüfungen wie beim Umbenennen
      ergaenzeMarke({ ziel: l.rel }); // die Erholung braucht das Ziel (anderer Name, anderer Ordner)
      if (gibtEs(l.abs)) throw new HttpFehler(409, "An der alten Stelle liegt inzwischen etwas anderes. Kortex überschreibt nichts.", { art: "belegt" });
      if (!existsSync(inhaltAbs)) throw new HttpFehler(404, "Der Inhalt liegt nicht mehr im Papierkorb.", { art: "keine-kopie" });
      // Unverändert?
      if (m.typ === "datei") { const e0 = m.inhalt.eintraege[0]; if (e0.hash && leseHash(inhaltAbs) !== e0.hash) throw new HttpFehler(409, "Die Kopie im Papierkorb ist nicht mehr dieselbe. Kortex stellt sie nicht wieder her.", { art: "kopie-veraendert" }); }
      mkdirSync(dirname(l.abs), { recursive: true }); // loeseBlatt hat den Vorfahren geprüft: er liegt im Vault
      try { legeZurueck(inhaltAbs, l.abs, m.typ); punkt("restore-nach-umzug"); }
      catch (e) {
        if (e.extra?.art === "anderes-laufwerk") throw new HttpFehler(409, `Das liegt auf einem anderen Laufwerk als dein Vault: ${inhaltAbs}. Kortex kopiert nie und löscht nichts — öffne den Ordner im Finder und lege es selbst zurück.`, { art: "anderes-laufwerk", ort: inhaltAbs });
        throw e;
      }
      if (m.typ === "ordner") { for (const e of m.inhalt.eintraege) { try { if (e.art === "ordner") chmodSync(join(l.abs, e.pfad), e.modus || 0o755); else if (e.art === "datei") chmodSync(join(l.abs, e.pfad), e.modus || 0o644); } catch { /* egal */ } } try { chmodSync(l.abs, m.inhalt.modus || 0o755); } catch { /* egal */ } }
      else { try { chmodSync(l.abs, m.inhalt.modus || 0o644); } catch { /* egal */ } }
      return { ok: true, typ: m.typ, art: "wiederhergestellt", von: null, nach: l.rel, pfad: l.rel, geaendert: [l.rel] };
    }
    // erneut löschen
    const v = loeseBlatt(m.von);
    let st; try { st = lstatSync(v.abs); } catch { throw new HttpFehler(409, "Das gibt es an dieser Stelle nicht (mehr).", { art: "fehlt" }); }
    if (m.typ === "datei") { if (!st.isFile() || leseHash(v.abs) !== m.inhalt.eintraege[0].hash) throw new HttpFehler(409, "Die Notiz wurde inzwischen geändert. Kortex legt sie nicht noch einmal in den Papierkorb.", { art: "geaendert" }); }
    else {
      if (!st.isDirectory()) throw new HttpFehler(409, "Das ist kein Ordner mehr.", { art: "geaendert" });
      // derselbe Inhalt wie beim Löschen? Sonst (zum Beispiel ein neuer Ordner gleichen Namens) bleibt er, wo er ist
      if (!gleicheListen(ordnerListe(v.abs), m.inhalt.eintraege.map((x) => ({ pfad: x.pfad, art: x.art, groesse: x.groesse, hash: x.hash })))) throw new HttpFehler(409, "In diesem Ordner liegt inzwischen etwas anderes als beim Löschen. Kortex legt ihn nicht noch einmal in den Papierkorb.", { art: "geaendert" });
    }
    mkdirSync(join(vorgangDir(m.id), "inhalt"), { recursive: true, mode: 0o700 });
    verschiebeLokal(v.abs, inhaltAbs);
    punkt("redo-nach-umzug");
    chmodRekursiv(inhaltAbs, 0o700, 0o600);
    return { ok: true, typ: m.typ, art: "wieder", von: m.von, nach: null, pfad: m.von, geaendert: [m.von] };
  }

  const eintragLog = (m, text, pfade) => alsGelesen(melde(wurzel, { art: "rueckgaengig", wer, vaultName: name, text, pfade }, { support }));

  // Für die Routen des Aktivitätsprotokolls (werkstatt/aktivitaet.mjs): Eintrag e mit rueckgaengig.art "vorgang"
  function vorgangStand(id) {
    const m = leseManifest(id);
    if (!m) return null;
    if (m.status === "endgueltig" || m.status === "laeuft") return null;
    return m;
  }
  function vorgangZurueck(id, eingabe = {}) {
    return mitSperre(async () => {
      const m = vorgangStand(id);
      if (!m) throw new HttpFehler(404, "Dafür gibt es kein Rückgängig mehr (es wird nach 30 Tagen gelöscht).", { art: "keine-kopie" });
      if (m.status === "zurueck") throw new HttpFehler(409, "Das ist schon rückgängig gemacht.", { art: "schon-zurueck" });
      setzeMarke(id, "undo");
      let erg;
      try { erg = wechsle(m, "zurueck", { teilweise: eingabe.teilweise === true }); } catch (e) { loescheMarke(); throw e; } // ein Fehler (409 …) heißt: nichts angefasst; nur ein Absturz lässt die Marke stehen
      m.status = "zurueck"; schreibeManifest(m);
      loescheMarke();
      eintragLog(m, m.art === "loeschen" ? "Rückgängig: Aus dem Papierkorb zurückgelegt." : `Rückgängig: ${m.art === "umbenennen" ? "Umbenennen" : "Verschieben"} zurückgenommen.`, [erg.nach || erg.pfad, erg.von].filter(Boolean)); // [jetziger Ort, voriger Ort]: offene Studios folgen
      return { ...erg, ok: true, art: m.art === "loeschen" ? "wiederhergestellt" : "zurueck", vorgangArt: m.art };
    });
  }
  function vorgangWieder(id, eingabe = {}) {
    return mitSperre(async () => {
      const m = vorgangStand(id);
      if (!m) throw new HttpFehler(404, "Dafür gibt es kein Wiederherstellen mehr.", { art: "keine-kopie" });
      if (m.status !== "zurueck") throw new HttpFehler(409, "Das wurde nicht rückgängig gemacht.", { art: "nicht-zurueck" });
      setzeMarke(id, "redo");
      let erg;
      try { erg = wechsle(m, "vor", { teilweise: eingabe.teilweise === true }); } catch (e) { loescheMarke(); throw e; }
      m.status = "fertig"; if (m.art === "loeschen") m.zeit = jetzt().toISOString(); // „gelöscht vor N Tagen“ beginnt neu
      schreibeManifest(m);
      loescheMarke();
      eintragLog(m, "Wiederhergestellt: Die Aktion gilt wieder.", [erg.nach || erg.pfad, erg.von].filter(Boolean));
      return { ...erg, ok: true, art: "wieder", vorgangArt: m.art };
    });
  }
  const vorgangMoeglich = (id) => { const m = vorgangStand(id); return m ? { moeglich: m.status === "fertig", zurueckgenommen: m.status === "zurueck", art: m.art } : null; };

  // ───────────── Papierkorb ─────────────
  function alleManifeste() {
    const aus = [];
    for (const v of [vorgaenge, ...altVerz()]) {
      let namen = [];
      try { namen = readdirSync(v); } catch { continue; }
      for (const n of namen) { const m = leseManifest(n); if (m) aus.push(m); }
    }
    return aus;
  }
  // Liegt dieser Eintrag auf einem anderen Laufwerk als der Vault? Dann geht Wiederherstellen nur im Finder.
  const andersesLaufwerk = (m) => { try { return imAltenKorb(m) && geraet(altKorb) !== geraet(wurzel); } catch { return false; } };
  // Rückgängig-Journale von Umbenennen/Verschieben (nie gelöschte Notizen!) automatisch begrenzen: die letzten 100, höchstens 30 Tage, höchstens 50 MB — je nachdem, was zuerst greift, die ältesten zuerst.
  // Nie ein laufender oder „unklar“-Vorgang, nie der neueste. Echte Papierkorb-Einträge werden nie automatisch gelöscht.
  const istRueckgaengigJournal = (m) => m.art !== "loeschen" && (m.status === "fertig" || m.status === "zurueck") && !imAltenKorb(m);
  function begrenzeJournale(ausser = null) {
    const kand = alleManifeste().filter(istRueckgaengigJournal).sort((a, b) => (a.zeit < b.zeit ? 1 : -1));
    const jetztMs = Date.now();
    let bytes = 0;
    kand.forEach((m, i) => {
      bytes += m.groesse || 0;
      if (i === 0 || m.id === ausser) return;
      if (i >= JOURNAL_MAX || jetztMs - Date.parse(m.zeit) > JOURNAL_TAGE * TAG_MS || bytes > JOURNAL_BYTES) { try { rmSync(vorgangDir(m.id), { recursive: true, force: true }); } catch { /* egal */ } }
    });
  }
  const ID_NAME = /^v_[0-9a-f]{12}$/;
  const ausgeblendetDatei = () => join(aktionen, "ausgeblendet.json");
  const liesAusgeblendet = () => { try { const j = JSON.parse(readFileSync(ausgeblendetDatei(), "utf8")); return Array.isArray(j) ? j : []; } catch { return []; } };
  // Journal-Ordner ohne lesbares Manifest (halb synchronisiert, Rechte, kaputt): NICHT in die Quarantäne, sondern liegen lassen und als Hinweis „noch nicht vollständig“ zeigen.
  // Nur wirklich kaputtes JSON, das älter als 7 Tage ist, kommt in die Quarantäne (nie gelöscht).
  function pruefeJournalOrdner() {
    const unvollstaendig = [];
    for (const v of [vorgaenge, ...altVerz()]) {
      let namen = []; try { namen = readdirSync(v); } catch { continue; }
      for (const n of namen) {
        if (!ID_NAME.test(n) || leseManifest(n)) continue;
        let art = "kaputt";
        try { JSON.parse(readFileSync(join(v, n, "manifest.json"), "utf8")); } catch (e) { if (e && (e.code === "ENOENT" || e.code === "EACCES" || e.code === "EPERM")) art = "fehlt"; }
        let alt = false; try { alt = Date.now() - statSync(join(v, n)).mtimeMs > 7 * TAG_MS; } catch { /* egal */ }
        if (art === "kaputt" && alt && v === vorgaenge) {
          try { mkdirSync(quarantaeneDir, { recursive: true, mode: 0o700 }); renameSync(join(v, n), join(quarantaeneDir, `${n}-${Date.now()}`)); continue; } catch { /* bleibt liegen */ }
        }
        unvollstaendig.push({ id: n, unvollstaendig: true, ort: join(v, n) });
      }
    }
    return unvollstaendig;
  }
  function papierkorbListe() {
    return mitSperre(async () => {
      const alle = alleManifeste();
      const aus = alle.filter((m) => m.art === "loeschen" && m.status === "fertig" && m.inhalt).map((m) => {
        const dateien = m.inhalt.eintraege.filter((e) => e.art === "datei");
        const fremd = andersesLaufwerk(m);
        return { id: m.id, name: m.inhalt.name, titel: m.titel || ohneEndungName(m.inhalt.name), pfad: m.von, ordner: ordnerVonPfad(m.von), typ: m.typ, zeit: m.zeit, alt: Date.now() - Date.parse(m.zeit) > PAPIERKORB_TAGE * TAG_MS,
          anzahl: m.typ === "ordner" ? dateien.length : 1, groesse: dateien.reduce((s, e) => s + (e.groesse || 0), 0),
          ...(imAltenKorb(m) ? { aelterKorb: true } : {}), ...(fremd ? { nurImFinder: true, ort: join(vorgangDir(m.id), "inhalt", m.inhalt.name) } : {}) };
      });
      aus.sort((a, b) => (a.zeit < b.zeit ? 1 : -1));
      const aus2 = new Set(liesAusgeblendet());
      // Vorgänge, die nicht sauber zurückgefahren werden konnten (eigene), laufende anderer Geräte (nur anzeigen), unvollständige Journale: sichtbar, nie still liegen lassen
      const hinweise = [
        ...alle.filter((m) => m.status === "unklar" || (m.status === "laeuft" && !eigenes(m))).filter((m) => !aus2.has(m.id)).map((m) => ({ id: m.id, art: m.art, typ: m.typ, von: m.von, nach: m.nach || null, zeit: m.zeit, ort: vorgangDir(m.id), ...(m.status === "laeuft" ? { fremd: true } : {}) })),
        ...pruefeJournalOrdner(),
      ];
      const journale = alle.filter(istRueckgaengigJournal);
      let quarantiert = 0; try { quarantiert = readdirSync(quarantaeneDir).length; } catch { /* keine */ }
      return { eintraege: aus, hinweise, aelter: aus.filter((e) => e.alt).length, tage: PAPIERKORB_TAGE, groesse: aus.reduce((s, e) => s + e.groesse, 0) + journale.reduce((s, m) => s + (m.groesse || 0), 0),
        journale: { anzahl: journale.length, groesse: journale.reduce((s, m) => s + (m.groesse || 0), 0) }, quarantaene: { anzahl: quarantiert, ort: quarantaeneDir } };
    });
  }
  // „Erledigt“: ein eigener unklarer Vorgang wandert mit seinem Journal in die Quarantäne (nie löschen); bei einem fremden Vorgang wird NICHTS bewegt, der Hinweis wird nur auf diesem Gerät ausgeblendet
  function papierkorbHinweisErledigt(eingabe) {
    const e = gemeinsamEin(eingabe);
    return mitSperre(async () => {
      const m = leseManifest(e.id);
      if (!m || (m.status !== "unklar" && !(m.status === "laeuft" && !eigenes(m)))) throw new HttpFehler(404, "Diesen Hinweis gibt es nicht (mehr).");
      if (m.status === "laeuft") { // fremd
        const liste = liesAusgeblendet(); if (!liste.includes(m.id)) liste.push(m.id);
        writeFileSync(ausgeblendetDatei(), JSON.stringify(liste.slice(-200)) + "\n", { mode: 0o600 });
        return { ok: true, ausgeblendet: true };
      }
      const q = imAltenKorb(m) ? join(altKorb, "quarantaene") : quarantaeneDir; mkdirSync(q, { recursive: true, mode: 0o700 });
      const ziel = join(q, `${m.id}-${Date.now()}`);
      renameSync(vorgangDir(m.id), ziel);
      return { ok: true, ort: ziel };
    });
  }
  function papierkorbWiederherstellen(eingabe) {
    const e = gemeinsamEin(eingabe);
    return mitSperre(async () => {
      const m = leseManifest(e.id);
      if (!m || m.art !== "loeschen" || m.status !== "fertig") throw new HttpFehler(404, "Das liegt nicht (mehr) im Papierkorb.");
      setzeMarke(m.id, "restore");
      let erg;
      try { erg = wechsleLoeschen(m, true, { name: typeof e.name === "string" && e.name ? e.name : null, ziel: typeof e.ziel === "string" ? e.ziel : null }); } catch (err) { loescheMarke(); throw err; }
      m.status = "wiederhergestellt"; schreibeManifest(m); loescheMarke(); // nicht „zurueck“: ein Wiederholen des Löschens aus dem Protokoll wäre jetzt falsch (der Platz kann neu belegt sein)
      // der Eintrag im Protokoll gilt als zurückgenommen
      try { if (m.eintrag) aendereZustand(support, kennung, (s) => { s.zurueck[m.eintrag] = new Date().toISOString(); }); } catch { /* egal */ }
      eintragLog(m, "Aus dem Papierkorb wiederhergestellt.", [erg.pfad]);
      return erg;
    });
  }
  function papierkorbEndgueltig(eingabe) {
    const e = gemeinsamEin(eingabe);
    const ids = e.alle === true || e.aelterAlsTage ? null : Array.isArray(e.ids) ? e.ids : typeof e.id === "string" ? [e.id] : null;
    const grenze = Number.isFinite(e.aelterAlsTage) && e.aelterAlsTage >= 1 ? Date.now() - e.aelterAlsTage * TAG_MS : null; // nur auf ausdrücklichen Wunsch: „Einträge älter als N Tage leeren“
    if (!ids && e.alle !== true && grenze === null) throw new HttpFehler(400, "Bitte angeben, was endgültig gelöscht werden soll.");
    return mitSperre(async () => {
      let n = 0;
      for (const m of alleManifeste()) {
        if (m.art !== "loeschen" || m.status !== "fertig") continue;
        if (ids && !ids.includes(m.id)) continue;
        if (grenze !== null && !(Date.parse(m.zeit) < grenze)) continue;
        try { rmSync(join(vorgangDir(m.id), "inhalt"), { recursive: true, force: true }); } catch { continue; }
        m.status = "endgueltig"; schreibeManifest(m); n++;
        entferneKopien(m);
      }
      if (ids && n === 0) throw new HttpFehler(404, "Das liegt nicht (mehr) im Papierkorb.");
      let freigegeben = 0;
      if (e.alle === true) { // „Papierkorb leeren“ entfernt auch die alten Rückgängig-Journale (nie laufende oder unklare)
        for (const m of alleManifeste().filter(istRueckgaengigJournal)) { freigegeben += m.groesse || 0; try { rmSync(vorgangDir(m.id), { recursive: true, force: true }); } catch { /* egal */ } }
      }
      return { ok: true, geloescht: n, freigegeben };
    });
  }
  // „Endgültig“ heißt auch: Kopien dieser Dateien in den Journalen anderer Vorgänge (vorher/nachher) verschwinden
  function entferneKopien(geloescht) {
    const drin = (p) => p === geloescht.von || p.startsWith(geloescht.von + "/");
    for (const m of alleManifeste()) {
      if (m.id === geloescht.id || !Array.isArray(m.dateien)) continue;
      // Die Dateien eines Journals stehen in den Pfaden VOR dessen Aktion; die gelöschte Notiz kann inzwischen unter dem Pfad NACH der Aktion gelegen haben: beides zählt (Bezug über den Vorgang)
      const abb = m.von && m.nach ? abbilder(m.von, m.nach, m.typ) : (p) => p;
      const weg = m.dateien.filter((d) => drin(d.pfad) || drin(abb(d.pfad)));
      if (!weg.length) continue;
      for (const d of weg) for (const art of ["vorher", "nachher"]) { try { rmSync(join(vorgangDir(m.id), art, String(d.n)), { force: true }); } catch { /* egal */ } }
      m.dateien = m.dateien.filter((d) => !weg.includes(d));
      try { schreibeManifest(m); } catch { /* egal */ }
    }
  }

  // ───────────── Erholung nach einem Absturz ─────────────
  // Läuft nur unter der Sperre: ein Vorgang mit Status „laeuft“ (oder eine Marke) gehört dann keinem lebenden Lauf mehr. Alles Verschieben ist ein einzelnes rename (atomar); zurückgefahren wird
  // rückwärts: erst der Umzug, dann die Notizen. Ist die Lage nicht eindeutig, bleibt das Journal liegen (Status „unklar“) und erscheint im Papierkorb mit Hinweis — nichts wird gelöscht.
  const nameDa = (rel) => { try { const a = absVon(rel); return readdirSync(dirname(a)).some((n) => n.normalize("NFC") === basename(a).normalize("NFC")); } catch { return false; } };
  const leererOrdner = (abs) => { try { return lstatSync(abs).isDirectory() && readdirSync(abs).length === 0; } catch { return false; } };
  // Reste von atomarSchreiben abgestürzter Prozesse: .brain-tmp-<pid>-* toter PIDs
  function raeumeTmp(dirAbs) {
    let namen = []; try { namen = readdirSync(dirAbs); } catch { return; }
    for (const n of namen) { const mm = /^\.brain-tmp-(\d+)-/.exec(n); if (mm && !lebt(Number(mm[1]))) { try { unlinkSync(join(dirAbs, n)); } catch { /* egal */ } } }
  }
  function erhole(m) {
    const dir = vorgangDir(m.id);
    const unklar = () => { m.status = "unklar"; try { schreibeManifest(m); } catch { /* egal */ } };
    try {
      if (m.art === "loeschen") {
        const ziel = join(dir, "inhalt", m.inhalt ? m.inhalt.name : "-");
        const v = loeseBlatt(m.von);
        const korbDa = existsSync(ziel), quelleDa = gibtEs(v.abs);
        if (!korbDa) { rmSync(dir, { recursive: true, force: true }); return; }                 // nichts bewegt
        if (!quelleDa) { verschiebeLokal(ziel, v.abs); rmSync(dir, { recursive: true, force: true }); return; } // zurücklegen
        unklar(); return;
      }
      for (const d of m.dateien || []) raeumeTmp(dirname(absVon(d.pfad)));
      if (m.von !== m.nach) {
        let vonDa = nameDa(m.von), nachDa = nameDa(m.nach);
        // Fenster zwischen mkdir(Ziel) und rename bei Ordnern: das Ziel ist leer und die Quelle noch da = der Umzug ist nicht passiert
        if (m.typ === "ordner" && vonDa && nachDa && leererOrdner(absVon(m.nach))) { try { rmdirSync(absVon(m.nach)); nachDa = false; } catch { /* nicht leer */ } }
        // Datei: zwischen link und unlink abgestürzt = zwei Namen, ein Inode → der neue Name wird abgeräumt (Umzug nicht passiert)
        if (m.typ === "datei" && !m.casePur && vonDa && nachDa && gleicheDatei(absVon(m.von), absVon(m.nach))) { try { unlinkSync(absVon(m.nach)); nachDa = false; } catch { /* egal */ } }
        if (nachDa && !vonDa) verschiebeFs(absVon(m.nach), absVon(m.von), m.typ, !!m.casePur);
        else if (!(vonDa && !nachDa)) { unklar(); return; }
      }
      for (const d of m.dateien || []) {
        try { const abs = absVon(d.pfad); if (leseHash(abs) === d.hashNachher) atomarSchreiben(abs, readFileSync(join(dir, "vorher", String(d.n))), d.modus); } catch { /* bester Versuch */ }
      }
      rmSync(dir, { recursive: true, force: true });
    } catch { unklar(); }
  }
  // Marke eines abgebrochenen Rückgängig/Wiederholen/Wiederherstellen
  function erholeAktion(m, aktion, marke = {}) {
    const dir = vorgangDir(m.id);
    if (m.art === "loeschen" && m.inhalt) {
      const trashDa = existsSync(join(dir, "inhalt", m.inhalt.name));
      if (trashDa && m.typ === "ordner" && (aktion === "restore" || aktion === "undo")) { // zwischen mkdir(Ziel) und rename abgebrochen: das leere Ziel wird abgeräumt, der Inhalt liegt noch im Papierkorb
        try { const zv = loeseBlatt(typeof marke.ziel === "string" && marke.ziel ? marke.ziel : m.von); if (leererOrdner(zv.abs)) rmdirSync(zv.abs); } catch { /* egal */ }
      }
      if (aktion === "restore" && !trashDa) { m.status = "wiederhergestellt"; schreibeManifest(m); }
      else if (aktion === "undo" && !trashDa) { m.status = "zurueck"; schreibeManifest(m); }
      else if (aktion === "redo" && trashDa) { m.status = "fertig"; m.zeit = jetzt().toISOString(); schreibeManifest(m); }
      else if (aktion === "restore" || aktion === "undo") { // Absturz zwischen link und unlink: zwei Namen, ein Inode → das Wiederherstellen wird zu Ende geführt (Papierkorb-Name entfernen)
        try {
          const v = loeseBlatt(typeof marke.ziel === "string" && marke.ziel ? marke.ziel : m.von); const t = join(dir, "inhalt", m.inhalt.name);
          if (m.typ === "datei" && gibtEs(v.abs) && gleicheDatei(v.abs, t)) { unlinkSync(t); m.status = aktion === "restore" ? "wiederhergestellt" : "zurueck"; schreibeManifest(m); }
        } catch { /* egal */ }
      }
      return;
    }
    // Umbenennen/Verschieben: Rückgängig/Wiederholen zu Ende führen (das Journal hat alle Bytes). Ist die Lage nicht eindeutig (jemand hat dazwischen geändert), „unklar“ und sichtbar.
    const zurueck = aktion === "undo";
    const unklar = () => { m.status = "unklar"; try { schreibeManifest(m); } catch { /* egal */ } };
    try {
      for (const d of m.dateien || []) raeumeTmp(dirname(absVon(zurueck ? abbilder(m.von, m.nach, m.typ)(d.pfad) : d.pfad)));
      const abb = abbilder(m.von, m.nach, m.typ);
      const quelle = zurueck ? m.nach : m.von, ziel = zurueck ? m.von : m.nach;
      const quelleAbs = absVon(quelle), zielAbs = absVon(ziel);
      let umgezogen = false;
      if (m.von !== m.nach) {
        let qDa = nameDa(quelle), zDa = nameDa(ziel);
        if (m.typ === "ordner" && qDa && zDa && leererOrdner(zielAbs)) { rmdirSync(zielAbs); zDa = false; }                  // mkdir war schon, rename noch nicht
        if (m.typ === "datei" && qDa && zDa && gleicheDatei(quelleAbs, zielAbs) && !m.casePur) { unlinkSync(zielAbs); zDa = false; } // zwischen link und unlink abgestürzt
        if (zDa && !qDa) umgezogen = true;
        else if (!(qDa && !zDa)) { unklar(); return; }
      }
      const zielHash = (d) => (zurueck ? d.hashVorher : d.hashNachher), quellHash = (d) => (zurueck ? d.hashNachher : d.hashVorher);
      for (const d of m.dateien || []) {
        const vorUmzug = zurueck ? abb(d.pfad) : d.pfad, nachUmzug = zurueck ? d.pfad : abb(d.pfad);
        const abs = absVon(umgezogen ? nachUmzug : vorUmzug);
        const h = leseHash(abs);
        if (h === zielHash(d)) continue;
        if (h !== quellHash(d)) { unklar(); return; }
        atomarSchreiben(abs, readFileSync(join(dir, zurueck ? "vorher" : "nachher", String(d.n))), d.modus);
      }
      if (!umgezogen && m.von !== m.nach) verschiebeFs(quelleAbs, zielAbs, m.typ, !!m.casePur);
      m.status = zurueck ? "zurueck" : "fertig"; schreibeManifest(m);
    } catch { unklar(); }
  }
  function erholeAngefangene() {
    let marke = null;
    try { marke = JSON.parse(readFileSync(markeDatei, "utf8")); } catch { /* keine Marke */ }
    if (marke && marke.id) {
      const m = leseManifest(marke.id);
      if (m && eigenes(m)) { if (marke.aktion === "op") { if (m.status === "laeuft") erhole(m); } else erholeAktion(m, marke.aktion, marke); }
      if (!m || eigenes(m)) loescheMarke(); // die Marke eines fremden Geräts bleibt, wo sie ist
    }
    if (erholt) return;
    erholt = true;
    // Reste abgestürzter Prozesse in der Sperr-Ablage: .sperre.<pid>.*, .sperre.bruch.<pid>.*, .sperre.alt.<pid>.*
    try { for (const n of readdirSync(aktionen)) { const mm = /^\.sperre(?:\.bruch|\.alt)?\.(\d+)\.[0-9a-f]+$/.exec(n); if (mm && !lebt(Number(mm[1]))) { try { unlinkSync(join(aktionen, n)); } catch { /* egal */ } } } } catch { /* keine Ablage */ }
    let namen = []; try { namen = readdirSync(vorgaenge); } catch { namen = []; }
    for (const n of namen) {
      const m = leseManifest(n);
      if (!m) continue; // nicht lesbar (Sync, Rechte, kaputt): liegen lassen; papierkorbListe zeigt es als Hinweis
      if (m.status === "laeuft" && eigenes(m)) erhole(m);
    }
  }

  return { sperreAktiv, aktionenOrt: () => { setzeAktionen(); return aktionen; }, papierkorbHinweisErledigt, umbenennen, verschieben, loeschen, papierkorbListe, papierkorbWiederherstellen, papierkorbEndgueltig, vorgangZurueck, vorgangWieder, vorgangMoeglich, kennung, korb };
}
