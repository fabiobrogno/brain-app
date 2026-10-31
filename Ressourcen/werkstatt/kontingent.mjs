// werkstatt/kontingent.mjs — Kontingent (5 Std / Woche) je KI-Konto (Paket P7).
//   GET  /api/ki/kontingent[?neu=1]          Stand aller Konten (liest nur; Codex wird höchstens alle 15 Min gefragt, „neu“ frühestens 5 Min nach der letzten Abfrage)
//   POST /api/ki/kontingent/statuszeile      { konto, an, einwilligung: true, bestaetigt?: true }  — die Statuszeile von Kortex bei Claude Code ein- oder ausschalten
//
// Claude Code: Kortex trägt (nur nach dem Klick des Nutzers) im Konto-Ordner eine Statuszeile als KETTE ein: `statusLine.command` startet <Support>/kontingent/bin/kortex-statuszeile.mjs,
// das eine vorhandene Statuszeile mit derselben Eingabe aufruft und ihre Ausgabe unverändert durchreicht und nur `rate_limits` nach <Support>/kontingent/<konto>.json merkt
// (gemeinsam/kortex-statuszeile.mjs). Vorher wird settings.json gesichert (Kopie unter <Support>/kontingent/sicherung/, Rechte 0600, mit Prüfsumme); der Rückweg spielt die Sicherung
// BYTEGLEICH zurück, solange die Datei seitdem niemand geändert hat — sonst nimmt er nur den eigenen Eintrag heraus (und stellt die frühere Statuszeile wieder her).
//  · Konten, die Kortex selbst angelegt hat (<Support>/ki-konten-ordner/claude-*): ein Klick genügt.
//  · Alles andere (das System-Standardkonto ~/.claude, ~/.claude-*): zusätzlich die Bestätigung innerhalb der Seite (`bestaetigt: true`), damit nichts außerhalb von Kortex ungefragt geändert wird.
// Codex: Kortex fragt das Programm selbst (`codex app-server`, `account/rateLimits/read`, gemeinsam/kontingent.mjs). Kein Token wird gelesen, kein Schlüsselbund geöffnet, und Kortex
// ruft weder Anthropic noch OpenAI an. Wo es nichts gibt (Cursor, Gemini …), steht ehrlich „nicht abrufbar“.
import { readFileSync, writeFileSync, renameSync, statSync, mkdirSync, chmodSync, rmSync, copyFileSync, readdirSync, rmdirSync, realpathSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { HttpFehler, testmodus, kindUmgebung } from "../gemeinsam/basis.mjs";
import { liesSettings, echtesZiel } from "../gemeinsam/claude-sperre.mjs";
import { istVerwalteterOrdner, mitCodexHome } from "./profile.mjs";
import { TAKT_MS, MIN_NEU_MS, VERALTET_MS, fehlerPause, liesCodexKontingent } from "../gemeinsam/kontingent.mjs";
import { stufeFuer } from "../gemeinsam/ki-konten.mjs";

export const MARKE = "kortex-statuszeile.mjs";
const QUELLE = fileURLToPath(new URL("../gemeinsam/kortex-statuszeile.mjs", import.meta.url));
const KONTO_ID = /^k_[0-9a-f]{8}$/;
const istObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const zeitstempel = () => new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
const echtPfad = (p) => { try { return realpathSync.native(p); } catch { return p; } };
const shellText = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const NICHT_ABRUFBAR = { cursor: "Cursor", gemini: "Gemini CLI", copilot: "Copilot CLI", opencode: "OpenCode", zed: "Zed", warp: "Warp", "claude-desktop": "Claude Desktop" };

export function erzeugeKontingent({ support, konten, nodePfad = process.execPath, home = () => homedir(), codexProgramm = () => null, jetzt = () => Date.now(), codexLauf = liesCodexKontingent } = {}) {
  const ordner = () => join(support, "kontingent");
  const kontoDatei = (id) => join(ordner(), `${id}.json`);
  const skriptPfad = () => join(ordner(), "bin", MARKE);
  const ketteDatei = (id) => join(ordner(), "kette", `${id}.json`);
  const ketteSh = (id) => join(ordner(), "kette", `${id}.sh`);
  const eintragDatei = () => join(ordner(), "eintragung.json");
  const sicherungOrdner = () => join(ordner(), "sicherung");

  // Im Testmodus schreibt Kortex nie in einen Ordner außerhalb des Temp-Ordners (nie ins echte ~/.claude des Rechners, auf dem die Tests laufen).
  const ordnerErlaubt = (o) => !testmodus() || echtPfad(o).startsWith(echtPfad(tmpdir()) + "/");
  const datenVon = () => { try { return konten.lade() || { konten: {} }; } catch { return { konten: {} }; } };
  const kontoVon = (id) => { const d = datenVon(); return typeof id === "string" && Object.hasOwn(d.konten, id) ? { id, ...d.konten[id] } : null; };

  // ───────────── Dateien ─────────────
  function privatMkdir(p) { mkdirSync(p, { recursive: true, mode: 0o700 }); try { chmodSync(p, 0o700); } catch { /* egal */ } }
  function schreibeAtomar(ziel, daten, modus = 0o600) {
    privatMkdir(dirname(ziel));
    const tmp = `${ziel}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    try { writeFileSync(tmp, daten, { mode: modus, flag: "wx" }); chmodSync(tmp, modus); renameSync(tmp, ziel); }
    catch (e) { try { rmSync(tmp, { force: true }); } catch { /* weg */ } throw e; }
  }
  const liesBytes = (p) => { try { return readFileSync(p); } catch { return null; } };

  // Merker: was Kortex bei welchem Konto eingetragen hat
  function liesEintraege() {
    try { const j = JSON.parse(readFileSync(eintragDatei(), "utf8")); if (istObj(j) && istObj(j.konten)) return j; } catch { /* keine oder kaputt */ }
    return { v: 1, konten: {} };
  }
  const speichereEintraege = (e) => schreibeAtomar(eintragDatei(), JSON.stringify(e, null, 1) + "\n");

  // ───────────── Statuszeile in settings.json ─────────────
  const settingsDatei = (k) => join(k.ordner, "settings.json");
  const istUnsere = (sl) => istObj(sl) && typeof sl.command === "string" && sl.command.includes(`/kontingent/bin/${MARKE}`);
  // Befehl der Kette. Mit früherer Statuszeile läuft diese weiter, falls das Skript oder Node fehlt (z. B. nach einem Aufräumen): die Ausgabe bleibt dann wie vorher. Ihr Text steht NICHT im Befehl,
  // sondern in kette/<konto>.sh: sonst hielte der Installer der Hooks (kern/adapters/claude-code/install.mjs) einen eingebetteten Aufruf der eigenen Kortex-Statuszeile für seinen Eintrag und ersetzte die Kette.
  function kettenBefehl(id, mitOriginal) {
    const n = shellText(nodePfad), s = shellText(skriptPfad());
    const kern = `${n} ${s} --konto ${id}`;
    return mitOriginal ? `if [ -x ${n} ] && [ -f ${s} ]; then ${kern}; else /bin/sh ${shellText(ketteSh(id))}; fi` : `if [ -x ${n} ] && [ -f ${s} ]; then ${kern}; fi`;
  }
  // → { zustand: "nicht" | "unsere" | "fremd" | "andere-form" | "defekt", sl, text, doc }
  function lieseStatuszeile(k) {
    let r;
    try { r = liesSettings(settingsDatei(k)); } catch (e) { return { zustand: "defekt", fehler: e instanceof HttpFehler ? e.message : null }; }
    const sl = r.doc.statusLine;
    if (sl === undefined || sl === null) return { zustand: "nicht", sl: null, text: r.text, doc: r.doc };
    if (istUnsere(sl)) return { zustand: "unsere", sl, text: r.text, doc: r.doc };
    if (istObj(sl) && sl.type === "command" && typeof sl.command === "string" && sl.command.trim()) return { zustand: "fremd", sl, text: r.text, doc: r.doc };
    return { zustand: "andere-form", sl, text: r.text, doc: r.doc };
  }
  // Schreibt settings.json atomar (Temp-Datei im selben Ordner, Rechte der alten Datei, ein Verweis bleibt ein Verweis); wirft 503, wenn sich die Datei zwischen Lesen und Schreiben ändert.
  function schreibeSettings(datei, neuerText, erwartet) {
    const ziel = echtesZiel(datei);
    mkdirSync(dirname(ziel), { recursive: true });
    let modus = 0o600;
    try { modus = statSync(ziel).mode & 0o777; } catch { /* neue Datei */ }
    const tmp = `${ziel}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    try {
      writeFileSync(tmp, neuerText, { mode: modus, flag: "wx" }); chmodSync(tmp, modus);
      const jetztInhalt = liesBytes(ziel);
      if ((jetztInhalt === null ? null : jetztInhalt.toString("utf8")) !== erwartet) { rmSync(tmp, { force: true }); throw new HttpFehler(503, "Die Einstellungen von Claude Code werden gerade von einem anderen Vorgang geändert. Versuche es gleich noch einmal."); }
      renameSync(tmp, ziel);
    } catch (e) {
      try { rmSync(tmp, { force: true }); } catch { /* weg */ }
      if (e instanceof HttpFehler) throw e;
      throw new HttpFehler(500, "Die Einstellungen von Claude Code ließen sich gerade nicht schreiben — es wurde nichts geändert. Versuche es noch einmal.");
    }
    return ziel;
  }
  const mitWiederholung = (fn) => { let letzter; for (let i = 0; i < 3; i++) { try { return fn(); } catch (e) { if (!(e instanceof HttpFehler) || e.status !== 503) throw e; letzter = e; } } throw letzter; };

  function legeSkriptAb() {
    const quelle = readFileSync(QUELLE);
    const vorhanden = liesBytes(skriptPfad());
    if (!vorhanden || !vorhanden.equals(quelle)) schreibeAtomar(skriptPfad(), quelle, 0o700);
    try { chmodSync(skriptPfad(), 0o700); } catch { /* egal */ }
  }

  function pruefeKonto(id) {
    const k = kontoVon(id);
    if (!k) throw new HttpFehler(404, "Dieses Konto kennt Kortex nicht (mehr). Öffne Einstellungen → KI & Konten und lade die Liste neu.");
    if (k.programm !== "claude") throw new HttpFehler(409, "Die Statuszeile gibt es nur bei Claude Code. Für Codex fragt Kortex das Programm selbst — dafür ist nichts einzuschalten.", { art: "kein-claude" });
    if (!ordnerErlaubt(k.ordner)) throw new HttpFehler(409, "Im Testmodus schreibt Kortex nur unter dem Temp-Ordner.", { art: "testmodus" });
    return k;
  }

  // ───────────── Einschalten ─────────────
  function schalteEin(k, { bestaetigt }) {
    const verwaltet = istVerwalteterOrdner(support, k.ordner, "claude");
    if (!verwaltet && bestaetigt !== true) {
      throw new HttpFehler(409, "Dieses Konto liegt außerhalb von Kortex. Kortex ändert dort nur, wenn du es auf der Seite ausdrücklich bestätigst: Klicke auf „Kontingent anzeigen“ und bestätige die Frage.", { art: "bestaetigung" });
    }
    const st = lieseStatuszeile(k);
    if (st.zustand === "defekt") throw new HttpFehler(409, st.fehler || "Die Einstellungen von Claude Code (settings.json) sind kaputt oder nicht lesbar. Kortex ändert nichts daran — bitte zuerst reparieren, dann geht es hier weiter.", { art: "einstellungen-defekt" });
    if (st.zustand === "andere-form") throw new HttpFehler(409, "In den Einstellungen dieses Kontos steht eine Statuszeile in einer Form, die Kortex nicht weiterreichen kann. Kortex ändert nichts daran. Du kannst das Kontingent in Claude Code mit /usage ansehen.", { art: "andere-form" });
    const eintraege = liesEintraege();
    if (st.zustand === "unsere") { // schon eingetragen: nur das Skript auf den neuen Stand bringen
      legeSkriptAb();
      return { aktion: "schon-da", exakt: true };
    }
    const datei = settingsDatei(k);
    const ziel = echtesZiel(datei);
    const vorher = liesBytes(ziel);
    const original = st.zustand === "fremd" ? st.sl : null;
    const ordnerAngelegt = !existsSync(dirname(ziel)); // z. B. ~/.claude gibt es noch nicht (nur ~/.claude.json): der Rückweg räumt den leeren Ordner wieder weg
    privatMkdir(ordner());
    legeSkriptAb();
    if (original) { schreibeAtomar(ketteDatei(k.id), JSON.stringify({ command: original.command, original }) + "\n"); schreibeAtomar(ketteSh(k.id), `${original.command}\n`); }
    let sicherung = null;
    if (vorher) { sicherung = `${k.id}-${zeitstempel()}-${randomBytes(3).toString("hex")}-settings.json`; privatMkdir(sicherungOrdner()); copyFileSync(ziel, join(sicherungOrdner(), sicherung)); chmodSync(join(sicherungOrdner(), sicherung), 0o600); }
    // vermerkt wird VOR dem Schreiben (ein Absturz dazwischen hinterlässt keinen Eintrag ohne Merker); scheitert das Schreiben, geht der Merker wieder weg
    eintraege.konten[k.id] = { ordner: k.ordner, seit: new Date(jetzt()).toISOString(), dateiDa: !!vorher, sicherung, hashVorher: vorher ? sha(vorher) : null, hashNachher: null, kette: !!original, ordnerAngelegt };
    speichereEintraege(eintraege);
    try {
      mitWiederholung(() => {
        const r = liesSettings(datei);
        const neu = { ...r.doc, statusLine: { ...(original || { type: "command" }), type: "command", command: kettenBefehl(k.id, !!original) } };
        schreibeSettings(datei, JSON.stringify(neu, null, 2) + "\n", r.text);
      });
    } catch (e) {
      try { const x = liesEintraege(); delete x.konten[k.id]; speichereEintraege(x); } catch { /* der Merker ist harmlos */ }
      try { rmSync(ketteDatei(k.id), { force: true }); rmSync(ketteSh(k.id), { force: true }); if (sicherung) rmSync(join(sicherungOrdner(), sicherung), { force: true }); } catch { /* egal */ }
      throw e;
    }
    const nachher = liesBytes(echtesZiel(datei));
    const x = liesEintraege();
    x.konten[k.id].hashNachher = nachher ? sha(nachher) : null;
    speichereEintraege(x);
    return { aktion: "eingetragen", kette: !!original, sicherung: sicherung ? join(sicherungOrdner(), sicherung) : null, bakDatei: vorher ? true : false };
  }

  // ───────────── Ausschalten ─────────────
  function schalteAus(k) {
    const datei = settingsDatei(k);
    const eintraege = liesEintraege();
    const rec = eintraege.konten[k.id] || null;
    const st = lieseStatuszeile(k);
    const ziel = echtesZiel(datei);
    const aktuell = liesBytes(ziel);
    let exakt = false, aktion = "entfernt";
    if (rec && rec.hashNachher && aktuell && sha(aktuell) === rec.hashNachher) {
      // seit dem Eintragen unverändert: den früheren Zustand BYTEGLEICH zurück
      if (rec.dateiDa) {
        const alt = rec.sicherung ? liesBytes(join(sicherungOrdner(), rec.sicherung)) : null;
        if (alt && sha(alt) === rec.hashVorher) {
          let modus = 0o600; try { modus = statSync(ziel).mode & 0o777; } catch { /* egal */ }
          const tmp = `${ziel}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
          try { writeFileSync(tmp, alt, { mode: modus, flag: "wx" }); chmodSync(tmp, modus); renameSync(tmp, ziel); exakt = true; }
          catch { try { rmSync(tmp, { force: true }); } catch { /* weg */ } throw new HttpFehler(500, "Die Einstellungen von Claude Code ließen sich gerade nicht zurückschreiben — es wurde nichts geändert. Versuche es noch einmal."); }
        }
      } else {
        try { rmSync(ziel); exakt = true; } catch { throw new HttpFehler(500, "Die Einstellungen von Claude Code ließen sich nicht zurücksetzen. Versuche es noch einmal."); }
        if (rec.ordnerAngelegt === true) { try { rmdirSync(dirname(ziel)); } catch { /* nicht leer: bleibt */ } }
      }
    }
    if (!exakt) {
      if (st.zustand === "defekt") throw new HttpFehler(409, "Die Einstellungen von Claude Code (settings.json) sind kaputt oder nicht lesbar. Kortex ändert nichts daran — bitte zuerst reparieren, dann geht es hier weiter.", { art: "einstellungen-defekt" });
      if (st.zustand === "unsere") {
        // Die Datei wurde seitdem geändert (von dir oder von Claude Code): nur der eigene Eintrag geht heraus, alles andere bleibt; die frühere Statuszeile kommt zurück
        let frueher = null;
        try { const j = JSON.parse(readFileSync(ketteDatei(k.id), "utf8")); if (istObj(j) && istObj(j.original)) frueher = j.original; } catch { /* keine frühere Statuszeile */ }
        mitWiederholung(() => {
          const r = liesSettings(datei);
          const neu = { ...r.doc };
          if (frueher) neu.statusLine = frueher; else delete neu.statusLine;
          schreibeSettings(datei, JSON.stringify(neu, null, 2) + "\n", r.text);
        });
        aktion = "entfernt";
      } else aktion = "schon-weg";
    }
    // aufräumen: Kette, Werte, Sicherung, Merker; das Skript, wenn kein Konto es mehr braucht
    try { rmSync(ketteDatei(k.id), { force: true }); rmSync(ketteSh(k.id), { force: true }); rmSync(kontoDatei(k.id), { force: true }); if (rec && rec.sicherung) rmSync(join(sicherungOrdner(), rec.sicherung), { force: true }); } catch { /* egal */ }
    if (rec) { delete eintraege.konten[k.id]; speichereEintraege(eintraege); }
    if (!Object.keys(eintraege.konten).length) {
      try { rmSync(skriptPfad(), { force: true }); rmSync(eintragDatei(), { force: true }); } catch { /* egal */ }
      for (const d of [join(ordner(), "bin"), join(ordner(), "kette"), sicherungOrdner()]) { try { if (!readdirSync(d).length) rmdirSync(d); } catch { /* nicht leer oder weg */ } }
    }
    return { aktion, exakt };
  }

  function schalteStatuszeile(e) {
    if (!istObj(e)) throw new HttpFehler(400, "Die Anfrage ist ungültig.");
    if (typeof e.konto !== "string" || !KONTO_ID.test(e.konto)) throw new HttpFehler(400, "„konto“ fehlt oder ist ungültig.");
    if (typeof e.an !== "boolean") throw new HttpFehler(400, "„an“ muss true oder false sein.");
    if (e.einwilligung !== true) throw new HttpFehler(409, "Kortex ändert die Einstellungen von Claude Code nur nach deinem Klick. Klicke in Einstellungen → KI & Konten auf „Kontingent anzeigen“.", { art: "einwilligung" });
    const k = pruefeKonto(e.konto);
    const r = e.an ? schalteEin(k, { bestaetigt: e.bestaetigt }) : schalteAus(k);
    return { ok: true, ...r, stand: stand({}) };
  }

  // ───────────── Werte lesen ─────────────
  const zahl = (x) => typeof x === "number" && Number.isFinite(x);
  const fenster = (w, minuten) => (istObj(w) && zahl(w.usedPercent) ? { usedPercent: Math.min(100, Math.max(0, w.usedPercent)), windowMinutes: minuten, resetsAt: zahl(w.resetsAt) ? w.resetsAt : null } : null);
  function liesWerte(id) {
    try {
      const j = JSON.parse(readFileSync(kontoDatei(id), "utf8"));
      if (!istObj(j) || j.v !== 1) return null;
      const t = Date.parse(j.geschrieben);
      if (!Number.isFinite(t)) return null;
      if (j.ohne === true) return { geschrieben: t, ohne: true, session: null, weekly: null };
      const session = fenster(j.session, 300), weekly = fenster(j.weekly, 10080);
      return session || weekly ? { geschrieben: t, ohne: false, session, weekly } : null;
    } catch { return null; }
  }

  // ───────────── Codex ─────────────
  const cache = new Map(); // id → { session, weekly, erfolgAm, versuchtAm, fehler (Anzahl in Folge), fehlerArt, laeuft }
  let kette = Promise.resolve();
  function arbeitsordner() { const d = join(ordner(), "arbeit"); privatMkdir(d); return d; }
  function frageCodex(k) {
    const c = cache.get(k.id) || { session: null, weekly: null, erfolgAm: 0, versuchtAm: 0, fehler: 0, fehlerArt: null, laeuft: false };
    c.laeuft = true; c.versuchtAm = jetzt(); cache.set(k.id, c);
    kette = kette.then(async () => {
      const prog = codexProgramm();
      let erg;
      if (!prog) erg = { ok: false, art: "fehlt" };
      else {
        try {
          const env = mitCodexHome(kindUmgebung({ CI: "1", PATH: `${dirname(prog)}:${kindUmgebung().PATH || "/usr/bin:/bin"}` }), k);
          erg = await codexLauf({ programm: prog, env, cwd: arbeitsordner() });
        } catch { erg = { ok: false, art: "start" }; }
      }
      c.laeuft = false;
      if (erg.ok) { c.session = erg.session; c.weekly = erg.weekly; c.erfolgAm = jetzt(); c.fehler = 0; c.fehlerArt = null; }
      else if (erg.art !== "ende") { c.fehler++; c.fehlerArt = erg.art; }
    }).catch(() => { c.laeuft = false; });
    return c;
  }
  const codexFaellig = (c, neu) => {
    if (!c) return true;
    if (c.laeuft) return false;
    const seit = jetzt() - c.versuchtAm;
    if (neu) return seit >= MIN_NEU_MS;
    return seit >= (c.fehler ? fehlerPause(c.fehler) : TAKT_MS);
  };

  // ───────────── Stand ─────────────
  const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
  function claudeEintrag(k) {
    const verwaltet = istVerwalteterOrdner(support, k.ordner, "claude");
    const basis = { quelle: "statuszeile", verwaltet, bestaetigungNoetig: !verwaltet };
    if (!ordnerErlaubt(k.ordner)) return { ...basis, status: "nicht-eingerichtet" };
    const st = lieseStatuszeile(k);
    const rec = liesEintraege().konten[k.id];
    if (st.zustand === "defekt") return { ...basis, status: "einstellungen-defekt" };
    if (st.zustand !== "unsere") return { ...basis, status: rec ? "geaendert" : "nicht-eingerichtet", ...(st.zustand === "andere-form" ? { andereForm: true } : {}), ...(st.zustand === "fremd" ? { fremdeStatuszeile: true } : {}) };
    const w = liesWerte(k.id);
    const eingetragen = { ...basis, eingetragen: true, kette: !!(rec && rec.kette) };
    if (!w) return { ...eingetragen, status: "keine-werte" };
    if (w.ohne) return { ...eingetragen, status: "ohne-kontingent", aktualisiert: iso(w.geschrieben) };
    const alt = jetzt() - w.geschrieben > VERALTET_MS;
    return { ...eingetragen, status: alt ? "veraltet" : "ok", session: w.session, weekly: w.weekly, aktualisiert: iso(w.geschrieben) };
  }
  function codexEintrag(k, neu) {
    const basis = { quelle: "codex" };
    if (testmodus() && !ordnerErlaubt(k.ordner)) return { ...basis, status: "fehler", fehlerArt: "start" }; // nie ein echtes CODEX_HOME des Rechners, auf dem die Tests laufen
    let c = cache.get(k.id);
    if (codexFaellig(c, neu)) c = frageCodex(k);
    if (c.laeuft && !c.erfolgAm) return { ...basis, status: "laedt", abgefragt: iso(c.versuchtAm) };
    const gemeinsam = { abgefragt: iso(c.versuchtAm), naechste: iso(c.versuchtAm + (c.fehler ? fehlerPause(c.fehler) : TAKT_MS)), neuAb: iso(c.versuchtAm + MIN_NEU_MS) };
    if (c.erfolgAm) {
      const alt = jetzt() - c.erfolgAm > VERALTET_MS;
      return { ...basis, ...gemeinsam, status: c.fehlerArt ? "fehler-mit-wert" : alt ? "veraltet" : "ok", session: c.session, weekly: c.weekly, aktualisiert: iso(c.erfolgAm), ...(c.fehlerArt ? { fehlerArt: c.fehlerArt, ...(alt ? { veraltet: true } : {}) } : {}), ...(c.laeuft ? { laedt: true } : {}) };
    }
    return { ...basis, ...gemeinsam, status: "fehler", fehlerArt: c.fehlerArt || "beendet" };
  }

  // → { jetzt, takt, konten: [{ id, programm, name, standard, quelle, status, session, weekly, aktualisiert, … }] }. „neu“: die Abfrage bei Codex früher erlauben (frühestens 5 Min nach der letzten).
  // `vault`: der offene Vault — dann trägt jedes Konto seine Stufe darin (`stufe`; gelesen aus der Liste der Konten, ohne sie abzugleichen), damit die Statusleiste gesperrte Konten ausgrauen kann.
  function stand({ neu = false, vault = null } = {}) {
    const d = datenVon();
    const liste = [];
    for (const [id, roh] of Object.entries(d.konten)) {
      const k = { id, ...roh };
      let stufe = "gesperrt";
      if (vault) { try { stufe = stufeFuer(d, vault, id); } catch { /* unbekannt = gesperrt */ } }
      const kopf = { id, programm: k.programm, name: k.name, standard: k.standard === true, ...(vault ? { stufe } : {}) };
      let e;
      try {
        if (k.programm === "claude") e = claudeEintrag(k);
        else if (k.programm === "codex") e = codexEintrag(k, neu);
        else e = { quelle: null, status: "nicht-abrufbar", ...(NICHT_ABRUFBAR[k.programm] ? { programmName: NICHT_ABRUFBAR[k.programm] } : {}) };
      } catch { e = { quelle: null, status: "nicht-abrufbar" }; }
      liste.push({ ...kopf, ...e });
    }
    return { jetzt: iso(jetzt()), takt: { abfrageMs: TAKT_MS, neuFruehestensMs: MIN_NEU_MS, veraltetMs: VERALTET_MS }, konten: liste };
  }

  // Nur für Tests und das Beenden: wartet, bis alle laufenden Codex-Abfragen fertig sind.
  const warteAufAbfragen = () => kette;
  return { stand, schalteStatuszeile, warteAufAbfragen };
}
