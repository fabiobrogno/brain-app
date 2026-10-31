// werkstatt/ereignisse.mjs — Live-Aktualisierung: die Werkstatt beobachtet den offenen Vault und meldet Änderungen als nummerierte Ereignisse.
//   Erkennen:  fs.watch (rekursiv; macOS: FSEvents) · Rückfall bei Fehler oder BRAIN_WATCH=poll: leichtes Polling der Änderungszeiten.
//              Entprellt (Standard 150 ms nach dem letzten, spätestens nach 600 ms), nur betroffene Pfade — nie eine Neuindizierung des Vaults.
//   Ignoriert: alles Versteckte (.git außer HEAD/refs, .logs, .brain-tmp-*), node_modules, Editor-Reste, Nicht-Textdateien.
//   Echo:      eigene Schreibvorgänge der Werkstatt (markiereEigen) lösen kein Ereignis aus, solange der Inhalt dem entspricht, was wir geschrieben haben.
//   Melden:    Ereignis-Ring (letzte 500) mit fortlaufender Nummer; GET /api/ereignisse?seit=<n> wartet (Long-Poll), bis es Neues gibt.
//   Grenzen:   höchstens `maxJeFlush` Pfade je Meldung, danach ein einziges „alles“; bei Dauerfeuer drosselt die Rate (Ein „alles“ je Sekunde).
// Typen: aufgabe (angelegt|geaendert|entfernt|archiviert, mit pfad, titel, status, quelle) · notiz (pfad, art) · posteingang · git (neuer-stand|konflikt)
//        · aktivitaet (neuer Eintrag im Aktivitätsprotokoll des Vaults, aus <support>/aktivitaet/<Kennung>.jsonl: id, art, zeit, wer, text, rueckgaengig, …; art "zustand" = gelesen/zurückgenommen) · vertrauen · konten · einstellungen (brain.config.json des Vaults oder <support>/einstellungen.json) · alles (der Client lädt alles neu).
import { watch, statSync, readdirSync, readFileSync, openSync, readSync, closeSync, existsSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join, sep, basename } from "node:path";
import { BEARBEITBAR, falte, inboxOrdnerVon } from "../gemeinsam/basis.mjs";
import { kennungVault, leseEreignisse, ereignisDatei } from "../gemeinsam/aktivitaet.mjs";

const wandUhr = () => performance.timeOrigin + performance.now(); // Wanduhr in ms mit Bruchteilen (Dateizeiten haben Nanosekunden)
const HASH = (buf) => createHash("sha256").update(buf).digest("hex");
export const MAX_WARTE_S = 30;

// Einordnung eines Pfads (relativ zum Vault, beliebiges Trennzeichen). Rein, ohne Plattenzugriff.
//   null → ignorieren · { bereich: "git" | "aufgabe" | "posteingang" | "notiz", pfad, text } (text = hat eine Textendung; sonst ist es evtl. ein Ordner)
export function klassifiziere(roh, { aufgabenOrdner = "05_aufgaben", inboxOrdner = "00_inbox" } = {}) {
  if (typeof roh !== "string" || !roh) return null;
  const rel = roh.split(sep).join("/").normalize("NFC");
  const teile = rel.split("/").filter(Boolean);
  if (!teile.length || teile.some((t) => t === "..")) return null;
  if (teile[0] === ".git") {
    const r = teile.slice(1).join("/");
    if (!r || /\.lock$/i.test(r)) return null;
    return r === "HEAD" || r === "MERGE_HEAD" || r === "packed-refs" || r.startsWith("refs/") ? { bereich: "git", pfad: `.git/${r}`, text: false } : null;
  }
  if (teile.some((t) => t.startsWith(".") || falte(t) === "node_modules")) return null; // .logs, .brain-tmp-*, .obsidian, .DS_Store …
  const name = teile[teile.length - 1];
  if (/~$|\.(swp|swx|swo|tmp|temp|part|crdownload|bak)$/i.test(name) || /^#.*#$/.test(name)) return null; // Editor-Reste
  if (teile.length === 1 && name === "brain.config.json") return { bereich: "einstellungen", pfad: name, text: true }; // Einstellungen des Vaults (Seite „Einstellungen“, `brain einstellungen`)
  const text = BEARBEITBAR.test(name);
  if (!text && /\.[A-Za-z0-9]{1,8}$/.test(name)) return null; // Bild, PDF, … (ein Ordner heißt selten „x.pdf“)
  const pfad = teile.join("/");
  if (teile.length > 1 && falte(teile[0]) === falte(aufgabenOrdner)) return { bereich: "aufgabe", pfad, text };
  if (teile.length > 1 && falte(teile[0]) === falte(inboxOrdner)) return { bereich: "posteingang", pfad, text };
  return { bereich: "notiz", pfad, text };
}

// Kopfzeilen einer Aufgabe (nur für die Meldung): titel, status, quelle. Eigenes kleines Lesen — das Format kennt nur der Kern (kern/aufgaben.mjs).
function kopfLesen(abs, n = 4096) {
  let fd;
  try { fd = openSync(abs, "r"); const b = Buffer.alloc(n); const len = readSync(fd, b, 0, n, 0); return b.subarray(0, len).toString("utf8"); }
  catch { return ""; } finally { if (fd !== undefined) try { closeSync(fd); } catch { /* egal */ } }
}
export function aufgabenKopf(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const wert = (k) => {
    const z = new RegExp(`^${k}:[ \\t]*(.*?)[ \\t]*$`, "m").exec(m[1]);
    if (!z) return undefined;
    let w = z[1];
    if (/^".*"$/.test(w)) { try { w = JSON.parse(w); } catch { w = w.slice(1, -1); } } else if (/^'.*'$/.test(w)) w = w.slice(1, -1).replace(/''/g, "'");
    return w;
  };
  const r = {};
  for (const k of ["titel", "status", "quelle", "typ"]) { const w = wert(k); if (w !== undefined && w !== "") r[k] = String(w).slice(0, 200); }
  return r;
}

// Der Stand von HEAD: { kopf (Sha oder null), merge (MERGE_HEAD vorhanden) } — nur aus Dateien gelesen, ohne git zu starten.
export function gitStand(wurzel) {
  const gd = join(wurzel, ".git");
  try {
    if (!statSync(gd).isDirectory()) return null;
    const head = readFileSync(join(gd, "HEAD"), "utf8").trim();
    let kopf = null;
    const m = /^ref:\s*(\S+)$/.exec(head);
    if (!m) kopf = /^[0-9a-f]{7,64}$/i.test(head) ? head : null;
    else {
      try { kopf = readFileSync(join(gd, ...m[1].split("/")), "utf8").trim(); }
      catch {
        try { const z = readFileSync(join(gd, "packed-refs"), "utf8").split("\n").find((l) => l.endsWith(" " + m[1])); kopf = z ? z.split(" ")[0] : null; } catch { kopf = null; }
      }
    }
    return { kopf, merge: existsSync(join(gd, "MERGE_HEAD")) };
  } catch { return null; }
}

// o: { entprellMs, maxWarteMs, pollMs, modus ("auto" | "watch" | "poll"), ring, maxJeFlush, maxProFenster, fensterMs, support (Ordner mit vertrauen.json / ki-konten.json) }
export function erzeugeEreignisse(o = {}) {
  // Auto: macOS (FSEvents) und Windows beobachten per fs.watch. Unter Linux (nur Entwicklung/CI) ist der rekursive fs.watch von Node unzuverlässig
  // (ein per Umbenennen ersetzter Dateiname wird nicht mehr beobachtet) und frisst inotify-Handles: dort wird gepollt, dafür schneller.
  const modusWunsch = o.modus || process.env.BRAIN_WATCH || (process.platform === "linux" ? "poll" : "auto");
  const entprellMs = o.entprellMs ?? 150, maxWarteMs = o.maxWarteMs ?? 600, pollMs = o.pollMs ?? (modusWunsch === "poll" ? 400 : 2000);
  const ringMax = o.ring ?? 500, maxJeFlush = o.maxJeFlush ?? 200, maxProFenster = o.maxProFenster ?? 300, fensterMs = o.fensterMs ?? 5000;
  const eigenTtl = o.eigenTtlMs ?? 10_000;
  const aktPollMs = o.aktivitaetPollMs ?? 1000;   // Aktivitätsprotokoll: wie oft die Dateigröße geprüft wird (0 = nie; nur Tests)

  let epoche = randomBytes(6).toString("hex");
  let nr = 0;
  const ring = [];
  let wartende = [];
  let wurzel = null, aufgabenOrdner = () => "05_aufgaben", aktiv = false;
  let watcher = null, supportWatcher = null, pollUhr = null, modus = null;
  let offen = new Set(), zeitErster = 0, flushUhr = null, ueberlauf = false, supportOffen = new Set();
  let bekannteAufgaben = new Set(), bekannteOrdner = new Set(), gitLetzter = null, momentaufnahme = null;
  let verlauf = [];           // Zeitpunkte der gemeldeten Ereignisse (für die Ratenbegrenzung)
  let gedrosselt = false;
  let eigenLaeuft = 0, haltSeit = 0, startZeit = 0;
  const eigen = new Map();    // Schlüssel → { hash, bis }
  // Aktivitätsprotokoll (P8a): andere Prozesse (MCP-Server, Hooks, Kern) hängen an <support>/aktivitaet/<Kennung>.jsonl an. Alle `aktPollMs` wird nur Größe und Zeit der Datei(en)
  // angesehen; hat sich etwas geändert, werden die neuen Einträge (Ids, die noch nicht gemeldet wurden) als Ereignis „aktivitaet“ gemeldet.
  // Hochwassermarke statt Liste bekannter Ids: aktMarke = Zeit des neuesten gemeldeten Eintrags; gemeldet wird nur, was NEUER ist (Zeit ≥ Marke − Toleranz, die Zeit steht VOR dem Anhängen, zwei Prozesse
  // können sich um Millisekunden überholen) und dessen Id nicht in aktRand steht (Ids der letzten Sekunden). Alte Einträge werden so nie erneut gemeldet — auch nicht nach vielen Einträgen oder einer Rotation.
  const AKT_TOLERANZ_MS = 3000;
  let aktUhr = null, aktSchluessel = "", aktMarke = 0, aktRand = new Map();
  const aktDateien = () => { const d = o.support && wurzel ? ereignisDatei(o.support, kennungVault(wurzel)) : null; return d ? [`${d}.alt`, d] : []; };
  const aktAnsehen = () => aktDateien().map((d) => { try { const st = statSync(d); return `${st.size}:${st.mtimeMs}`; } catch { return "-"; } }).join("|");
  function aktStart() {
    if (!o.support || !wurzel) return;
    aktSchluessel = aktAnsehen();
    let neuester = 0;
    try { for (const e of leseEreignisse(o.support, kennungVault(wurzel))) neuester = Math.max(neuester, Date.parse(e.zeit)); } catch { /* ohne Protokoll */ }
    aktMarke = Math.max(neuester, Date.now()); aktRand = new Map();   // was beim Start schon im Protokoll stand, ist alt
    if (aktPollMs > 0 && !aktUhr) { aktUhr = setInterval(pruefeAktivitaet, aktPollMs); aktUhr.unref?.(); }
  }
  function pruefeAktivitaet() {
    if (!aktiv || !wurzel || !o.support) return;
    const jetzt = aktAnsehen();
    if (jetzt === aktSchluessel) return;
    aktSchluessel = jetzt;
    let neu = [];
    try { neu = leseEreignisse(o.support, kennungVault(wurzel), { seit: new Date(aktMarke - AKT_TOLERANZ_MS - 1).toISOString() }).filter((e) => !aktRand.has(e.id)); } catch { return; }
    if (!neu.length) return;
    for (const e of neu) { aktMarke = Math.max(aktMarke, Date.parse(e.zeit)); aktRand.set(e.id, Date.parse(e.zeit)); }
    for (const [id, t] of aktRand) if (t < aktMarke - 2 * AKT_TOLERANZ_MS) aktRand.delete(id);
    for (const e of neu.slice(-20)) {
      melde({ typ: "aktivitaet", id: e.id, art: e.art, zeit: e.zeit, ...(e.grund ? { grund: e.grund } : {}), konto: e.konto ?? null, programm: e.programm ?? null, ...(e.quelle ? { quelle: e.quelle } : {}),
        ...(e.wer ? { wer: e.wer } : {}), text: e.text, ...(e.pfade ? { pfade: e.pfade } : {}), rueckgaengig: !!e.rueckgaengig, vaultName: e.vaultName || "" });
    }
    if (neu.length > 20) melde({ typ: "aktivitaet", art: "zustand" });
  }

  const supportPfad = (name) => (o.support ? join(o.support, name) : null);
  const SUPPORT_TYP = { "vertrauen.json": "vertrauen", "ki-konten.json": "konten", "einstellungen.json": "einstellungen", "tastenkuerzel.json": "tastenkuerzel" };

  // ---------- Ring und Long-Poll ----------
  function melde(e) {
    const ereignis = { n: ++nr, zeit: Date.now(), ...e };
    ring.push(ereignis);
    if (ring.length > ringMax) ring.splice(0, ring.length - ringMax);
    verlauf.push(ereignis.zeit);
    const w = wartende; wartende = [];
    for (const f of w) f();
    return ereignis;
  }
  function antwort(seit, ep) {
    const aktuell = nr;
    if (seit === null) return { epoche, aktuell, verpasst: false, ereignisse: [] };
    if ((ep && ep !== epoche) || seit > aktuell) return { epoche, aktuell, verpasst: true, ereignisse: [] }; // andere Werkstatt/anderer Vault: Zähler passt nicht mehr
    const aelteste = ring.length ? ring[0].n : aktuell + 1;
    if (seit < aelteste - 1 && seit < aktuell) return { epoche, aktuell, verpasst: true, ereignisse: [] };
    const neu = ring.filter((e) => e.n > seit);
    return { epoche, aktuell, verpasst: false, ereignisse: neu.slice(0, 200), ...(neu.length > 200 ? { mehr: true } : {}) };
  }
  // seit = null → nur den Stand nennen (sofort). Sonst: Neues sofort, sonst bis zu warteMs warten.
  function warte({ seit = null, epoche: ep = null, warteMs = 25_000 } = {}) {
    aktiviere();
    const s = seit === null || seit === undefined ? null : Math.max(0, Math.floor(Number(seit)) || 0);
    const grenze = Math.min(Math.max(0, warteMs), MAX_WARTE_S * 1000);
    const jetzt = antwort(s, ep);
    if (s === null || jetzt.verpasst || jetzt.ereignisse.length || grenze === 0) return Promise.resolve(jetzt);
    return new Promise((fertig) => {
      let uhr;
      const los = () => { clearTimeout(uhr); wartende = wartende.filter((x) => x !== los); fertig(antwort(s, ep)); };
      uhr = setTimeout(los, grenze);
      wartende.push(los);
    });
  }

  // ---------- Echo: eigene Schreibvorgänge ----------
  const hashVon = (abs) => { try { const st = statSync(abs); return st.isFile() ? HASH(readFileSync(abs)) : null; } catch { return null; } };
  const absVon = (schluessel) => {
    if (schluessel.startsWith("@support/")) { const p = supportPfad(schluessel.slice(9)); return p; }
    if (!wurzel || schluessel.startsWith("/") || schluessel.split("/").includes("..")) return null;
    return join(wurzel, ...schluessel.split("/"));
  };
  // Nach einem eigenen Schreibvorgang: der Inhalt, den die Datei jetzt hat, ist kein „Ereignis“ (null = gibt es nicht mehr).
  function markiereEigen(schluessel) {
    for (const k of [].concat(schluessel)) {
      if (typeof k !== "string" || !k) continue;
      const abs = absVon(k.normalize("NFC"));
      if (abs) eigen.set(k.normalize("NFC"), { hash: hashVon(abs), bis: Date.now() + eigenTtl });
    }
    if (eigen.size > 2000) for (const [k, v] of eigen) if (v.bis < Date.now()) eigen.delete(k);
  }
  // Nach eigenem Git (Commit, Abgleich, Posteingang): der neue Kopf gilt als bekannt.
  function markiereEigenenKopf() { if (wurzel) { const s = gitStand(wurzel); if (s) gitLetzter = s; } }
  const istEigen = (k) => {
    const e = eigen.get(k);
    if (!e) return false;
    if (e.bis < Date.now()) { eigen.delete(k); return false; }
    return true;
  };

  // ---------- Sammeln und Melden ----------
  function planeFlush() {
    const jetzt = Date.now();
    if (!zeitErster) zeitErster = jetzt;
    clearTimeout(flushUhr);
    const verzoegerung = gedrosselt ? 1000 : Math.max(0, Math.min(entprellMs, zeitErster + maxWarteMs - jetzt));
    flushUhr = setTimeout(flush, verzoegerung);
    flushUhr.unref?.();
  }
  function roh(rel) {
    if (!aktiv || typeof rel !== "string") return;
    if (!klassifiziere(rel, { aufgabenOrdner: aufgabenOrdner() })) return; // Verstecktes, .git-Innenleben, Editor-Reste: gar nicht erst sammeln
    if (offen.size >= maxJeFlush * 5) { ueberlauf = true; planeFlush(); return; } // nie unbegrenzt sammeln
    offen.add(rel);
    planeFlush();
  }
  function rohSupport(name) {
    if (!SUPPORT_TYP[name]) return;
    supportOffen.add(name);
    planeFlush();
  }

  // macOS (FSEvents) liefert kurz nach dem Start noch Geschehenes von VOR dem Start nach: Dateien, die seit dem Start nicht angefasst wurden, zählen in den ersten 2 s nicht
  const altesEcho = (abs) => {
    if (wandUhr() - startZeit > 2000) return false;
    try { const st = statSync(abs); return Math.max(st.mtimeMs, st.ctimeMs) < startZeit; } catch { return false; }
  };
  function aufgabeEreignis(k) {
    const abs = join(wurzel, ...k.pfad.split("/"));
    if (k.text && altesEcho(abs)) { bekannteAufgaben.add(k.pfad); return null; }
    if (!k.text) return null;
    const hash = hashVon(abs);
    const war = bekannteAufgaben.has(k.pfad);
    if (hash === null) bekannteAufgaben.delete(k.pfad); else bekannteAufgaben.add(k.pfad);
    if (istEigen(k.pfad) && eigen.get(k.pfad).hash === hash) return null; // eigener Schreibvorgang: kein Echo
    if (hash === null) return { typ: "aufgabe", art: "entfernt", pfad: k.pfad };
    // <aufgaben-ordner>/archiv/…: Archiv (kern/aufgaben.mjs ARCHIV_ORDNER). Eine dort ankommende Datei ist nie eine NEUE Aufgabe (kein Hinweis „angelegt“); das Board lädt neu, die Karte verschwindet
    if (falte(k.pfad.split("/")[1] || "") === "archiv") return { typ: "aufgabe", art: "archiviert", pfad: k.pfad };
    const kopf = aufgabenKopf(kopfLesen(abs));
    return { typ: "aufgabe", art: war ? "geaendert" : "angelegt", pfad: k.pfad, ...(kopf.titel ? { titel: kopf.titel } : {}), ...(kopf.status ? { status: kopf.status } : {}), ...(kopf.quelle ? { quelle: kopf.quelle } : {}) };
  }
  function dateiEreignis(k) {
    const abs = join(wurzel, ...k.pfad.split("/"));
    let st = null; try { st = statSync(abs); } catch { /* weg */ }
    if (st && altesEcho(abs)) return null;
    if (!k.text) { // ohne Textendung zählt nur ein Ordner, der neu ist oder verschwindet — Ordner melden sich auch, wenn nur ihr Inhalt wechselt
      if (st && !st.isDirectory()) return null;
      const typ = k.bereich === "posteingang" ? "posteingang" : "notiz";
      if (!st) { const kannte = bekannteOrdner.delete(k.pfad); for (const o of [...bekannteOrdner]) if (o.startsWith(k.pfad + "/")) bekannteOrdner.delete(o); return kannte && !istEigen(k.pfad) ? { typ, art: "entfernt", pfad: k.pfad } : null; }
      if (bekannteOrdner.has(k.pfad)) return null;
      bekannteOrdner.add(k.pfad);
      return istEigen(k.pfad) ? null : { typ, art: "ordner", pfad: k.pfad };
    }
    if (istEigen(k.pfad) && eigen.get(k.pfad).hash === hashVon(abs)) return null;
    if (st && !st.isFile()) return null;
    // Wandert eine Aufgabe ins Archiv (90_…), ist es für das Board ein „archiviert“ — den Pfad der Datei im Archiv, nicht der Aufgabenordner
    if (st && /^90_/.test(k.pfad) && aufgabenKopf(kopfLesen(abs)).typ === "aufgabe") return { typ: "aufgabe", art: "archiviert", pfad: k.pfad };
    return { typ: k.bereich === "posteingang" ? "posteingang" : "notiz", art: st ? "geaendert" : "entfernt", pfad: k.pfad };
  }

  // Läuft gerade ein eigener Schreibvorgang der Werkstatt (Anfrage von der Oberfläche), wird die Meldung kurz zurückgehalten (höchstens 5 s):
  // erst wenn die Anfrage fertig ist und ihre Dateien als „eigen“ markiert sind, lässt sich das Echo erkennen.
  function beginneEigenes() { if (eigenLaeuft++ === 0) haltSeit = Date.now(); }
  function endeEigenes(schluessel = [], { kopf = false } = {}) {
    markiereEigen(schluessel);
    if (kopf) markiereEigenenKopf();
    if (eigenLaeuft > 0) eigenLaeuft--;
    if (eigenLaeuft === 0 && aktiv && (offen.size || supportOffen.size || ueberlauf)) planeFlush();
  }
  function flush() {
    if (eigenLaeuft > 0 && Date.now() - haltSeit < 5000) { flushUhr = setTimeout(flush, 80); flushUhr.unref?.(); return; }
    flushUhr = null; zeitErster = 0;
    const pfade = [...offen]; offen = new Set();
    const supports = [...supportOffen]; supportOffen = new Set();
    const wardrin = ueberlauf; ueberlauf = false;
    if (!aktiv || !wurzel) return;
    const jetzt = Date.now();
    verlauf = verlauf.filter((t) => t > jetzt - fensterMs);
    // Ratenbegrenzung: bei Dauerfeuer ein einziges „alles“ und längere Pause, bis es ruhig ist
    const zuViel = wardrin || pfade.length > maxJeFlush || verlauf.length + pfade.length > maxProFenster;
    if (zuViel) { gedrosselt = true; melde({ typ: "alles", grund: "viele-aenderungen" }); if (pfade.length || wardrin) bekannteAufgaben = new Set(lieAufgabenNamen()); return; }
    gedrosselt = verlauf.length > maxProFenster / 2;
    const ordner = aufgabenOrdner();
    const inbox = inboxOrdnerVon(wurzel); // bei jedem Flush neu gelesen: eine geänderte brain.config.json braucht keinen Neustart
    const gesehen = new Set(), ergebnisse = [];
    let gitBetroffen = false, einstBetroffen = false;
    for (const rel of pfade) {
      const k = klassifiziere(rel, { aufgabenOrdner: ordner, inboxOrdner: inbox });
      if (!k || gesehen.has(k.pfad)) continue;
      gesehen.add(k.pfad);
      if (k.bereich === "git") { gitBetroffen = true; continue; }
      if (k.bereich === "einstellungen") { // brain.config.json: eigene Schreibvorgänge (Echo) und Altes aus der Zeit vor dem Start zählen nicht
        const abs = join(wurzel, k.pfad);
        if (!(altesEcho(abs) || (istEigen(k.pfad) && eigen.get(k.pfad).hash === hashVon(abs)))) einstBetroffen = true;
        continue;
      }
      let e = null;
      try { e = k.bereich === "aufgabe" ? aufgabeEreignis(k) : dateiEreignis(k); } catch { e = null; }
      if (e) ergebnisse.push(e);
    }
    for (const e of ergebnisse) melde(e);
    if (einstBetroffen) melde({ typ: "einstellungen" });
    if (gitBetroffen) {
      const s = gitStand(wurzel);
      if (s && (!gitLetzter || s.kopf !== gitLetzter.kopf || s.merge !== gitLetzter.merge)) {
        melde({ typ: "git", art: s.merge ? "konflikt" : "neuer-stand" });
        gitLetzter = s;
      }
    }
    for (const name of supports) {
      const k = "@support/" + name, abs = supportPfad(name);
      if (!abs) continue;
      if (istEigen(k) && eigen.get(k).hash === hashVon(abs)) continue;
      melde({ typ: SUPPORT_TYP[name] });
    }
  }

  // ---------- Beobachten ----------
  function lieAufgabenNamen() {
    try { return readdirSync(join(wurzel, aufgabenOrdner())).filter((n) => !n.startsWith(".") && BEARBEITBAR.test(n)).map((n) => `${aufgabenOrdner()}/${n}`.normalize("NFC")); }
    catch { return []; }
  }
  // Alle Ordner (nur Namen, ohne Dateien zu öffnen) bis Tiefe 4, höchstens 3000: damit „neuer Ordner“ von „Inhalt eines Ordners hat gewechselt“ zu unterscheiden ist
  function ordnerNamen() {
    const l = [];
    const geh = (rel, tiefe) => {
      let eintraege;
      try { eintraege = readdirSync(rel ? join(wurzel, ...rel.split("/")) : wurzel, { withFileTypes: true }); } catch { return; }
      for (const d of eintraege) {
        if (!d.isDirectory() || d.name.startsWith(".") || falte(d.name) === "node_modules" || l.length >= 3000) continue;
        const r = (rel ? `${rel}/${d.name}` : d.name).normalize("NFC");
        l.push(r);
        if (tiefe < 4) geh(r, tiefe + 1);
      }
    };
    geh("", 1);
    return l;
  }
  function startePoll() {
    modus = "poll";
    momentaufnahme = scanne();
    pollUhr = setInterval(() => {
      const neu = scanne();
      const alt = momentaufnahme; momentaufnahme = neu;
      for (const [p, k] of neu) if (alt.get(p) !== k) roh(p);
      for (const p of alt.keys()) if (!neu.has(p)) roh(p);
      const g = gitStand(wurzel);
      if (g && (!gitLetzter || g.kopf !== gitLetzter.kopf || g.merge !== gitLetzter.merge)) roh(".git/HEAD");
    }, pollMs);
    pollUhr.unref?.();
  }
  // Änderungszeit + Größe der Textdateien bis Tiefe 3 (höchstens 4000 Dateien), Ordner nur als Eintrag
  function scanne() {
    const m = new Map();
    let n = 0;
    const geh = (rel, tiefe) => {
      let liste;
      try { liste = readdirSync(rel ? join(wurzel, ...rel.split("/")) : wurzel, { withFileTypes: true }); } catch { return; }
      for (const d of liste) {
        if (d.name.startsWith(".") || falte(d.name) === "node_modules") continue;
        const r = rel ? `${rel}/${d.name}` : d.name;
        if (d.isDirectory()) { m.set(r, "d"); if (tiefe < 3) geh(r, tiefe + 1); }
        else if (d.isFile() && (BEARBEITBAR.test(d.name) || (tiefe === 0 && d.name === "brain.config.json"))) {
          if (++n > 4000) return;
          try { const st = statSync(join(wurzel, ...r.split("/"))); m.set(r, `${st.mtimeMs}:${st.size}`); } catch { /* weg */ }
        }
      }
    };
    geh("", 0);
    return m;
  }
  function starteWatch() {
    try {
      watcher = watch(wurzel, { recursive: true, persistent: false }, (_art, name) => {
        if (name == null) { ueberlauf = true; planeFlush(); return; }
        // macOS meldet kurz vor dem Start Geschehenes am Wurzelordner selbst unter dessen Namen: kein Ereignis des Vaults
        if (String(name) === basename(wurzel)) { try { if (!statSync(join(wurzel, String(name))).isDirectory()) return; } catch { return; } }
        roh(String(name));
      });
      watcher.on("error", () => { try { watcher?.close(); } catch { /* egal */ } watcher = null; if (aktiv && !pollUhr) startePoll(); });
      modus = "watch";
    } catch { watcher = null; startePoll(); }
  }
  function starteSupport() {
    if (!o.support) return;
    try {
      supportWatcher = watch(o.support, { persistent: false }, (_a, name) => { if (name) rohSupport(String(name)); });
      supportWatcher.on("error", () => { try { supportWatcher?.close(); } catch { /* egal */ } supportWatcher = null; });
    } catch { supportWatcher = null; }
  }
  function stoppeBeobachten() {
    try { watcher?.close(); } catch { /* egal */ }
    try { supportWatcher?.close(); } catch { /* egal */ }
    watcher = null; supportWatcher = null;
    if (pollUhr) clearInterval(pollUhr);
    pollUhr = null; modus = null;
    if (aktUhr) clearInterval(aktUhr);
    aktUhr = null; aktRand = new Map(); aktMarke = 0;
    clearTimeout(flushUhr); flushUhr = null; zeitErster = 0;
    offen = new Set(); supportOffen = new Set(); ueberlauf = false;
  }
  function aktiviere() {
    if (aktiv || !wurzel) return;
    aktiv = true;
    startZeit = wandUhr();
    bekannteAufgaben = new Set(lieAufgabenNamen());
    bekannteOrdner = new Set(ordnerNamen());
    gitLetzter = gitStand(wurzel);
    if (modusWunsch === "poll") startePoll(); else starteWatch();
    starteSupport();
    aktStart();
  }

  // Der offene Vault hat gewechselt (oder es gibt keinen): neue Epoche, die Clients laden alles neu
  function richteAuf(neueWurzel, { aufgabenOrdner: ao } = {}) {
    const lief = aktiv;
    stoppeBeobachten();
    aktiv = false;
    wurzel = neueWurzel || null;
    aufgabenOrdner = () => ao || "05_aufgaben";
    eigen.clear(); ring.length = 0; verlauf = []; gedrosselt = false;
    epoche = randomBytes(6).toString("hex");
    nr = 0;
    const w = wartende; wartende = [];
    for (const f of w) f(); // wartende Abrufe bekommen „verpasst“ (neue Epoche)
    if (lief) aktiviere();
  }
  function beende() {
    stoppeBeobachten();
    aktiv = false;
    const w = wartende; wartende = [];
    for (const f of w) f();
  }

  return {
    warte, richteAuf, beende, beginneEigenes, endeEigenes, setzeAufgabenOrdner: (n) => { if (typeof n === "string" && n) aufgabenOrdner = () => n; },
    markiereEigen, markiereEigenenKopf, aktiviere, pruefeAktivitaet,
    melde: (e) => melde(e), // von der Werkstatt selbst (z. B. Vertrauen geändert)
    stand: () => ({ epoche, aktuell: nr, modus, aktiv }),
    // nur für Tests
    _flush: () => { clearTimeout(flushUhr); flush(); },
    _roh: roh,
  };
}
