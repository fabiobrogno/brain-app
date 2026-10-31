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
import { readFileSync, writeFileSync, renameSync, statSync, mkdirSync, chmodSync, rmSync, readdirSync, rmdirSync, realpathSync, existsSync, accessSync, constants } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { randomBytes, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { HttpFehler, testmodus, kindUmgebung } from "../gemeinsam/basis.mjs";
import { liesSettings, echtesZiel } from "../gemeinsam/claude-sperre.mjs";
import { istVerwalteterOrdner, mitCodexHome } from "./profile.mjs";
import { TAKT_MS, MIN_NEU_MS, VERALTET_MS, fehlerPause, liesCodexKontingent, codexUmgebung } from "../gemeinsam/kontingent.mjs";
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
  // Die Konto-Kennung, die im eingetragenen Befehl steht (`--konto k_…`). Kette, Merker und Sicherung gehören zu DIESER Kennung — auch wenn die Liste der Konten inzwischen eine andere vergeben hat
  // (Liste neu angelegt): dann gilt „neu verknüpfen“, nie „weg damit“.
  const idImBefehl = (cmd) => { const m = /--konto (k_[0-9a-f]{8})(?![0-9a-f])/.exec(String(cmd)); return m ? m[1] : null; };
  const hatKetteImBefehl = (cmd) => /; else \/bin\/sh '/.test(String(cmd));
  // Befehl der Kette. Mit früherer Statuszeile läuft diese weiter, falls das Skript oder Node fehlt (z. B. nach einem Aufräumen): die Ausgabe bleibt dann wie vorher. Ihr Text steht NICHT im Befehl,
  // sondern in kette/<konto>.sh: sonst hielte der Installer der Hooks (kern/adapters/claude-code/install.mjs) einen eingebetteten Aufruf der eigenen Kortex-Statuszeile für seinen Eintrag und ersetzte die Kette.
  function kettenBefehl(id, mitOriginal) {
    const n = shellText(nodePfad), s = shellText(skriptPfad());
    const kern = `${n} ${s} --konto ${id}`;
    return mitOriginal ? `if [ -x ${n} ] && [ -f ${s} ]; then ${kern}; else /bin/sh ${shellText(ketteSh(id))}; fi` : `if [ -x ${n} ] && [ -f ${s} ]; then ${kern}; fi`;
  }
  // → { zustand: "nicht" | "unsere" | "fremd" | "andere-form", sl, id (bei „unsere“: Kennung im Befehl), text, doc }
  function klassifiziere(doc, text) {
    const sl = doc.statusLine;
    if (sl === undefined || sl === null) return { zustand: "nicht", sl: null, text, doc };
    if (istUnsere(sl)) return { zustand: "unsere", sl, id: idImBefehl(sl.command), text, doc };
    if (istObj(sl) && sl.type === "command" && typeof sl.command === "string" && sl.command.trim()) return { zustand: "fremd", sl, text, doc };
    return { zustand: "andere-form", sl, text, doc };
  }
  // → wie klassifiziere, dazu „defekt“, wenn settings.json nicht lesbar oder kaputt ist
  function lieseStatuszeile(k) {
    let r;
    try { r = liesSettings(settingsDatei(k)); } catch (e) { return { zustand: "defekt", fehler: e instanceof HttpFehler ? e.message : null }; }
    return klassifiziere(r.doc, r.text);
  }
  // Test-Haken: wird nach dem Schreiben der Temp-Datei und vor dem Prüfen/Umbenennen einmal aufgerufen (ein Test ändert dort die Datei „zwischendurch“).
  let hakenVorUmbenennen = null;
  const setzeHaken = (f) => { hakenVorUmbenennen = typeof f === "function" ? f : null; };
  // Schreibt settings.json atomar (Temp-Datei im selben Ordner, Rechte der alten Datei, ein Verweis bleibt ein Verweis); wirft 503, wenn sich die Datei zwischen Lesen und Schreiben ändert.
  function schreibeSettings(datei, neuerText, erwartet) {
    const ziel = echtesZiel(datei);
    mkdirSync(dirname(ziel), { recursive: true });
    let modus = 0o600;
    try { modus = statSync(ziel).mode & 0o777; } catch { /* neue Datei */ }
    const tmp = `${ziel}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    try {
      writeFileSync(tmp, neuerText, { mode: modus, flag: "wx" }); chmodSync(tmp, modus);
      if (hakenVorUmbenennen) { const h = hakenVorUmbenennen; hakenVorUmbenennen = null; h(ziel); }
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
  // Liest settings.json als Text UND als Bytes und besteht darauf, dass beides dieselbe Fassung ist (sonst 503: neu versuchen). Sicherung und Prüfsumme kommen aus genau diesen Bytes.
  function liesFassung(datei) {
    const ziel = echtesZiel(datei);
    const roh = liesBytes(ziel);
    const r = liesSettings(datei);
    if ((roh === null ? null : roh.toString("utf8")) !== r.text) throw new HttpFehler(503, "Die Einstellungen von Claude Code werden gerade von einem anderen Vorgang geändert. Versuche es gleich noch einmal.");
    return { ziel, roh, r };
  }

  function legeSkriptAb() {
    const quelle = readFileSync(QUELLE);
    const vorhanden = liesBytes(skriptPfad());
    if (!vorhanden || !vorhanden.equals(quelle)) schreibeAtomar(skriptPfad(), quelle, 0o700);
    try { chmodSync(skriptPfad(), 0o700); } catch { /* egal */ }
  }
  // Wirft weg, was von Kortex für diese Kennung liegt (Kette, Werte); die Sicherung nur auf Wunsch.
  function raeumeAuf(id, { sicherung = null } = {}) {
    try {
      rmSync(ketteDatei(id), { force: true }); rmSync(ketteSh(id), { force: true }); rmSync(kontoDatei(id), { force: true });
      if (sicherung) rmSync(join(sicherungOrdner(), sicherung), { force: true });
    } catch { /* egal */ }
  }
  // Das Skript und der Merker gehen, wenn kein Konto sie mehr braucht.
  function raeumeLeer() {
    const e = liesEintraege();
    if (Object.keys(e.konten).length) return;
    try { rmSync(skriptPfad(), { force: true }); rmSync(eintragDatei(), { force: true }); } catch { /* egal */ }
    for (const d of [join(ordner(), "bin"), join(ordner(), "kette"), sicherungOrdner()]) { try { if (!readdirSync(d).length) rmdirSync(d); } catch { /* nicht leer oder weg */ } }
  }
  // Die frühere Statuszeile zu einer Kennung: aus kette/<id>.json (das Objekt, sonst nur der Befehl), sonst aus der Sicherung der settings.json (wenn der Merker eine Kette vermerkt) — sonst null.
  function fruehereStatuszeile(id, rec) {
    try {
      const j = JSON.parse(readFileSync(ketteDatei(id), "utf8"));
      if (istObj(j) && istObj(j.original)) return { sl: j.original };
      if (istObj(j) && typeof j.command === "string" && j.command.trim()) return { sl: { type: "command", command: j.command } };
    } catch { /* keine oder kaputt: die Sicherung versuchen */ }
    if (rec && rec.kette === true && rec.sicherung) {
      try { const b = JSON.parse(readFileSync(join(sicherungOrdner(), rec.sicherung), "utf8")); if (istObj(b) && istObj(b.statusLine) && typeof b.statusLine.command === "string") return { sl: b.statusLine }; } catch { /* nicht lesbar */ }
    }
    return { sl: null };
  }
  const KEINE_KETTE = "Die frühere Statuszeile dieses Kontos ließ sich nicht wiederherstellen (ihre Sicherung fehlt oder ist unlesbar). Kortex ändert nichts, damit sie nicht verloren geht. Stelle sie aus einer Kopie deiner settings.json wieder her oder entferne den Eintrag „statusLine“ selbst.";

  function pruefeKonto(id) {
    const k = kontoVon(id);
    if (!k) throw new HttpFehler(404, "Dieses Konto kennt Kortex nicht (mehr). Öffne Einstellungen → KI & Konten und lade die Liste neu.");
    if (k.programm !== "claude") throw new HttpFehler(409, "Die Statuszeile gibt es nur bei Claude Code. Für Codex fragt Kortex das Programm selbst — dafür ist nichts einzuschalten.", { art: "kein-claude" });
    if (!ordnerErlaubt(k.ordner)) throw new HttpFehler(409, "Im Testmodus schreibt Kortex nur unter dem Temp-Ordner.", { art: "testmodus" });
    return k;
  }
  const defektFehler = (st) => new HttpFehler(409, st.fehler || "Die Einstellungen von Claude Code (settings.json) sind kaputt oder nicht lesbar. Kortex ändert nichts daran — bitte zuerst reparieren, dann geht es hier weiter.", { art: "einstellungen-defekt" });
  const ANDERE_FORM = "In den Einstellungen dieses Kontos steht eine Statuszeile in einer Form, die Kortex nicht weiterreichen kann. Kortex ändert nichts daran. Du kannst das Kontingent in Claude Code mit /usage ansehen.";

  // Stimmt der eingetragene Befehl noch (Node-Pfad, Skript-Ort) und gibt es Node und Skript noch? → bool. Der Inhalt des Skripts zählt nicht: ein älteres Skript meldet dasselbe.
  function istIntakt(k, st) {
    const mit = hatKetteImBefehl(st.sl.command);
    if (st.sl.command !== kettenBefehl(k.id, mit)) return false;
    try { accessSync(nodePfad, constants.X_OK); } catch { return false; }
    if (!liesBytes(skriptPfad())) return false;
    if (mit && !liesBytes(ketteSh(k.id))) return false;
    return true;
  }
  function merkeHashNachher(id, datei) {
    const x = liesEintraege();
    if (!x.konten[id]) return;
    const nachher = liesBytes(echtesZiel(datei));
    x.konten[id].hashNachher = nachher ? sha(nachher) : null;
    speichereEintraege(x);
  }

  // ───────────── Einschalten ─────────────
  // Die Statuszeile ist schon von Kortex: stimmt alles → „schon-da“; stimmt der Befehl nicht mehr (Node/Skript verschoben) → „repariert“; gehört sie zu einer früheren Kennung → „neu-verknuepft“.
  function behandleUnsere(k, datei) {
    return mitWiederholung(() => {
      const { r } = liesFassung(datei);
      const st = klassifiziere(r.doc, r.text);
      if (st.zustand !== "unsere") throw new HttpFehler(409, "Die Statuszeile wurde gerade geändert. Versuche es noch einmal.", { art: "geaendert" });
      const alt = st.id;
      const eintraege = liesEintraege();
      if (alt === k.id) {
        if (istIntakt(k, st)) { legeSkriptAb(); return { aktion: "schon-da", exakt: true }; }
        const mit = hatKetteImBefehl(st.sl.command);
        legeSkriptAb();
        if (mit && !liesBytes(ketteSh(k.id))) {
          const f = fruehereStatuszeile(k.id, eintraege.konten[k.id]);
          if (!f.sl) throw new HttpFehler(409, KEINE_KETTE, { art: "keine-kette" });
          schreibeAtomar(ketteSh(k.id), `${f.sl.command}\n`);
        }
        schreibeSettings(datei, JSON.stringify({ ...r.doc, statusLine: { ...st.sl, command: kettenBefehl(k.id, mit) } }, null, 2) + "\n", r.text);
        merkeHashNachher(k.id, datei);
        return { aktion: "repariert", exakt: true };
      }
      // Kennung im Befehl ≠ Kennung in der Liste: Kette und Merker der alten Kennung wandern zur neuen (nichts geht verloren)
      const rec = alt ? eintraege.konten[alt] : null;
      const mitKette = hatKetteImBefehl(st.sl.command);
      const f = mitKette ? fruehereStatuszeile(alt || k.id, rec) : { sl: null };
      if (mitKette && !f.sl) throw new HttpFehler(409, KEINE_KETTE, { art: "keine-kette" });
      legeSkriptAb();
      if (f.sl) { schreibeAtomar(ketteDatei(k.id), JSON.stringify({ command: f.sl.command, original: f.sl }) + "\n"); schreibeAtomar(ketteSh(k.id), `${f.sl.command}\n`); }
      schreibeSettings(datei, JSON.stringify({ ...r.doc, statusLine: { ...st.sl, command: kettenBefehl(k.id, !!f.sl) } }, null, 2) + "\n", r.text);
      if (rec) { eintraege.konten[k.id] = { ...rec, ordner: k.ordner, kette: !!f.sl }; delete eintraege.konten[alt]; speichereEintraege(eintraege); merkeHashNachher(k.id, datei); }
      if (alt) raeumeAuf(alt);
      return { aktion: "neu-verknuepft", exakt: true, kette: !!f.sl };
    });
  }

  function schalteEin(k, { bestaetigt }) {
    const verwaltet = istVerwalteterOrdner(support, k.ordner, "claude");
    if (!verwaltet && bestaetigt !== true) {
      throw new HttpFehler(409, "Dieses Konto liegt außerhalb von Kortex. Kortex ändert dort nur, wenn du es auf der Seite ausdrücklich bestätigst: Klicke auf „Kontingent anzeigen“ und bestätige die Frage.", { art: "bestaetigung" });
    }
    const datei = settingsDatei(k);
    const erst = lieseStatuszeile(k);
    if (erst.zustand === "defekt") throw defektFehler(erst);
    if (erst.zustand === "andere-form") throw new HttpFehler(409, ANDERE_FORM, { art: "andere-form" });
    if (erst.zustand === "unsere") return behandleUnsere(k, datei);
    const ordnerAngelegt = !existsSync(dirname(echtesZiel(datei))); // z. B. ~/.claude gibt es noch nicht (nur ~/.claude.json): der Rückweg räumt den leeren Ordner wieder weg
    let sicherung = null, ergebnis = null;
    // Alles, was Kortex anlegt (Skript, Kette, Sicherung, Merker), entsteht innerhalb dieses try: scheitert etwas, bleibt nichts zurück.
    try {
      mitWiederholung(() => {
        // Sicherung, Prüfsumme und Eintrag kommen aus EXAKT der Fassung, die jetzt geschrieben wird: ändert sich die Datei dazwischen, beginnt dieser Durchgang von vorn (503).
        const { roh, r } = liesFassung(datei);
        const st = klassifiziere(r.doc, r.text);
        if (st.zustand === "unsere") throw new HttpFehler(409, "Die Statuszeile wurde gerade geändert. Versuche es noch einmal.", { art: "geaendert" });
        if (st.zustand === "andere-form") throw new HttpFehler(409, ANDERE_FORM, { art: "andere-form" });
        const original = st.zustand === "fremd" ? st.sl : null;
        if (sicherung) { try { rmSync(join(sicherungOrdner(), sicherung), { force: true }); } catch { /* weg */ } sicherung = null; }
        privatMkdir(ordner());
        legeSkriptAb();
        raeumeAuf(k.id);
        if (original) { schreibeAtomar(ketteDatei(k.id), JSON.stringify({ command: original.command, original }) + "\n"); schreibeAtomar(ketteSh(k.id), `${original.command}\n`); }
        if (roh) { sicherung = `${k.id}-${zeitstempel()}-${randomBytes(3).toString("hex")}-settings.json`; privatMkdir(sicherungOrdner()); const sp = join(sicherungOrdner(), sicherung); writeFileSync(sp, roh, { mode: 0o600, flag: "wx" }); chmodSync(sp, 0o600); }
        // vermerkt wird VOR dem Schreiben (ein Absturz dazwischen hinterlässt keinen Eintrag ohne Merker)
        const eintraege = liesEintraege();
        eintraege.konten[k.id] = { ordner: k.ordner, seit: new Date(jetzt()).toISOString(), dateiDa: !!roh, sicherung, hashVorher: roh ? sha(roh) : null, hashNachher: null, kette: !!original, ordnerAngelegt };
        speichereEintraege(eintraege);
        const neu = { ...r.doc, statusLine: { ...(original || { type: "command" }), type: "command", command: kettenBefehl(k.id, !!original) } };
        schreibeSettings(datei, JSON.stringify(neu, null, 2) + "\n", r.text);
        merkeHashNachher(k.id, datei);
        ergebnis = { aktion: "eingetragen", kette: !!original, sicherung: sicherung ? join(sicherungOrdner(), sicherung) : null };
      });
    } catch (e) {
      try { const x = liesEintraege(); delete x.konten[k.id]; speichereEintraege(x); } catch { /* der Merker ist harmlos */ }
      raeumeAuf(k.id, { sicherung });
      raeumeLeer();
      throw e;
    }
    return ergebnis;
  }

  // ───────────── Ausschalten ─────────────
  function schalteAus(k) {
    const datei = settingsDatei(k);
    const eintraege = liesEintraege();
    const st = lieseStatuszeile(k);
    // Kette, Merker und Sicherung gehören zur Kennung, die im EINGETRAGENEN Befehl steht (die Liste der Konten kann inzwischen eine andere vergeben haben).
    const id = st.zustand === "unsere" && st.id ? st.id : k.id;
    const rec = eintraege.konten[id] || null;
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
      if (st.zustand === "defekt") throw defektFehler(st);
      if (st.zustand === "unsere") {
        // Die Datei wurde seitdem geändert (von dir oder von Claude Code): nur der eigene Eintrag geht heraus, alles andere bleibt; die frühere Statuszeile kommt zurück.
        // „statusLine“ wird NIE gelöscht, solange es eine Kette zu dieser Kennung gibt: dann kommt die frühere Statuszeile zurück (oder Kortex ändert nichts und sagt es).
        const hatKette = hatKetteImBefehl(st.sl.command) || existsSync(ketteDatei(id));
        const frueher = fruehereStatuszeile(id, rec).sl;
        if (hatKette && !frueher) throw new HttpFehler(409, KEINE_KETTE, { art: "keine-kette" });
        mitWiederholung(() => {
          const { r } = liesFassung(datei);
          const neu = { ...r.doc };
          if (frueher) neu.statusLine = frueher; else delete neu.statusLine;
          schreibeSettings(datei, JSON.stringify(neu, null, 2) + "\n", r.text);
        });
      } else aktion = "schon-weg";
    }
    // aufräumen: Kette, Werte, Sicherung, Merker (die Kennung im Befehl und die der Liste); das Skript, wenn kein Konto es mehr braucht
    raeumeAuf(id, { sicherung: rec && rec.sicherung ? rec.sicherung : null });
    if (id !== k.id) { const r2 = eintraege.konten[k.id]; raeumeAuf(k.id, { sicherung: r2 && r2.sicherung ? r2.sicherung : null }); delete eintraege.konten[k.id]; }
    delete eintraege.konten[id];
    if (rec || id !== k.id) speichereEintraege(eintraege);
    raeumeLeer();
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
          const env = mitCodexHome(codexUmgebung(kindUmgebung({ CI: "1", PATH: `${dirname(prog)}:${kindUmgebung().PATH || "/usr/bin:/bin"}` })), k);
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
    const eingetragen = { ...basis, eingetragen: true, kette: !!(rec && rec.kette) };
    // Die Kennung im eingetragenen Befehl ist nicht die der Liste (Liste neu angelegt): „neu verknüpfen“ — nie als eigene Werte lesen
    if (st.id !== k.id) return { ...eingetragen, status: "neu-verknuepfen" };
    // Node oder Skript sind nicht mehr dort, wo der Befehl sie sucht (Kortex verschoben, Update): „reparieren“ — die frühere Statuszeile läuft derweil allein weiter
    if (!istIntakt(k, st)) return { ...eingetragen, status: "reparieren" };
    const w = liesWerte(k.id);
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
  return { stand, schalteStatuszeile, warteAufAbfragen, _setzeHaken: setzeHaken };
}
