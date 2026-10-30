// werkstatt/konten.mjs — KI-Konten und Vault-Zugriff in der Werkstatt (docs/plaene/ki-konten.md, Paket P1): Konten erkennen und in <support>/ki-konten.json
// führen, Namen und Stufen setzen, Migration bestehender Verbindungen. Die Regeln selbst (Stufe, Konto bestimmen) stehen in gemeinsam/ki-konten.mjs.
//   GET  /api/ki/konten   → Stand (gleicht vorher die Liste ab: neu erkannte Konten starten gesperrt)
//   POST /api/ki/konten   { id, name?, abo? }
//   PUT  /api/ki/zugriff  { konto, vault, stufe, heimat? }
// Grundsätze:
//  · Neu erkannte Konten sind für jeden Vault GESPERRT, bis der Nutzer sie zuordnet. Ausnahme: Gibt es genau EIN Konto insgesamt, bekommt es für Vaults, die Kortex angelegt
//    oder geklont hat, automatisch „posteingang“. Neue Vaults starten für alle bekannten Konten gesperrt (dieselbe Ausnahme).
//  · Migration (die Liste gibt es noch nicht): Konten mit einer bestehenden Verbindung zu Kortex (Hooks in settings.json, MCP-Eintrag „brain“) behalten ihre heutigen
//    Rechte — „posteingang“ für alle Vaults der App; ebenso ältere Einträge ohne --konto (ohneKonto). Alle anderen Konten starten gesperrt.
//  · Ist die Datei beschädigt, wird sie beiseitegelegt und leer neu angelegt: alles gesperrt (nie lockerer als vorher). Die frühere Fassung bleibt als .vorher liegen.
//  · Konten und Vaults nennen die Routen nur aus den erkannten Listen (nie ein frei gewählter Pfad).
import { readFileSync, realpathSync, lstatSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { HttpFehler, testmodus } from "../gemeinsam/basis.mjs";
import * as vertrauenFn from "../gemeinsam/vertrauen.mjs";
import { STUFEN, ABOS, liesKonten, aendere, repariere, leerDaten, neueId, pruefeName, vaultEintrag, stufeFuer, kennungVon, echterOrt, stufeNr, darfMindestens } from "../gemeinsam/ki-konten.mjs";
import { erkenneKonten } from "./konten-erkennung.mjs";
import { BESCHREIBUNGEN } from "./ki-programme/programme.mjs";
import { parseJsonc } from "./ki-programme/jsonc.mjs";

const falte = (s) => String(s).normalize("NFC").toLowerCase();
const istObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const KORTEX_VON_KORTEX = ["angelegt", "geklont"];
const MAX_LESEN = 2 * 1024 * 1024;

const dateiText = (pfad) => {
  try { const st = lstatSync(pfad); if (!st.isFile() || st.size > MAX_LESEN) return null; return readFileSync(pfad, "utf8"); } catch { return null; }
};
const holeAm = (doc, pfad) => { let n = doc; for (const p of pfad) { if (!istObj(n)) return undefined; n = n[p]; } return n; };

// Hat dieses Konto heute schon eine Verbindung zu Kortex? Nur für die Migration. Gelesen wird nur, ob es den Eintrag gibt — nichts davon wird behalten oder ausgegeben.
//   claude: Kortex-Hooks in <profil>/settings.json, oder der MCP-Eintrag „brain“ in der Claude-Konfiguration des Profils (~/.claude.json bzw. <profil>/.claude.json)
//   codex:  [mcp_servers.brain] in config.toml · übrige Programme: der Eintrag „brain“ in ihrer MCP-Datei
export function verbundenStandard(k, home = homedir()) {
  try {
    if (k.programm === "claude") {
      const s = dateiText(join(k.ordner, "settings.json"));
      if (s && (/kortex' hook [a-z]/.test(s) || /\/adapters\/claude-code\/[a-z-]+\.mjs/.test(s))) return true;
      const cj = dateiText(k.standard ? join(home, ".claude.json") : join(k.ordner, ".claude.json"));
      if (cj) { const j = JSON.parse(cj); return istObj(j) && istObj(j.mcpServers) && j.mcpServers.brain !== undefined; }
      return false;
    }
    if (k.programm === "codex") { const t = dateiText(join(k.ordner, "config.toml")); return !!t && /^\s*\[mcp_servers\.brain\]/m.test(t); }
    const b = BESCHREIBUNGEN.find((x) => x.id === k.programm);
    if (!b) return false;
    const t = dateiText(b.datei({ home }));
    if (!t || !t.trim()) return false;
    const doc = parseJsonc(t);
    const verz = holeAm(doc, b.pfad);
    return istObj(verz) && verz.brain !== undefined;
  } catch { return false; }
}

// Im Testmodus liest die Erkennung nur ein Home unter dem Temp-Ordner — nie den echten Benutzerordner des Rechners, auf dem die Tests laufen.
const echtPfad = (p) => { try { return realpathSync.native(p); } catch { return p; } };
const homeErlaubt = (h) => !testmodus() || echtPfad(h).startsWith(echtPfad(tmpdir()) + sep);

export function erzeugeKonten({ support, home = () => homedir(), vaults = () => [], erkennung = null, verbunden = null, quelleVon = null } = {}) {
  const erkenne = () => (erkennung ? erkennung() : homeErlaubt(home()) ? erkenneKonten({ home: home() }) : []);
  const istVerbunden = (k) => (verbunden ? !!verbunden(k) : verbundenStandard(k, home()));
  const quelle = (pfad) => { try { return quelleVon ? quelleVon(pfad) : vertrauenFn.pruefeVertrauen(pfad, { support }).quelle; } catch { return null; } };
  const vaultListe = () => { try { return vaults().filter((v) => v && typeof v.pfad === "string"); } catch { return []; } };
  const jetzt = () => new Date().toISOString();

  // Rechnet die Liste fort (rein bis auf Dateizugriffe lesender Art). alt = bisherige Daten oder null. c.migration: die Liste gibt es noch nicht. c.streng: alles gesperrt.
  function rechne(alt, c) {
    const daten = alt || leerDaten();
    const migration = !alt && c.migration === true;
    const verbundene = new Set();
    const neueIds = [];
    for (const e of c.erkannt) {
      const f = falte(e.ordner);
      const gleich = Object.entries(daten.konten).filter(([, k]) => k.programm === e.programm && falte(k.ordner) === f);
      const treffer = gleich.find(([, k]) => k.ordnerKennung === e.ordnerKennung) || gleich.find(([, k]) => k.ordnerKennung === "");
      if (treffer) { if (treffer[1].ordnerKennung === "" && e.ordnerKennung) treffer[1].ordnerKennung = e.ordnerKennung; continue; }
      if (gleich.length && !e.ordnerKennung) continue; // der Ordner ist (vorübergehend) weg: das Konto bleibt, es entsteht kein neues
      // gleicher Ort, andere Kennung = ein neu angelegter Ordner: ein NEUES Konto, es erbt keine Erlaubnis
      const id = neueId(daten);
      daten.konten[id] = { programm: e.programm, ordner: e.ordner, standard: e.standard === true, name: e.name, ordnerKennung: e.ordnerKennung, seit: jetzt() };
      neueIds.push(id);
      if (migration && istVerbunden(daten.konten[id])) verbundene.add(id);
    }
    const ids = Object.keys(daten.konten);
    const einziges = ids.length === 1 ? ids[0] : null;
    const darfAuto = (id, q) => !c.streng && id === einziges && KORTEX_VON_KORTEX.includes(q);
    for (const v of c.vaults) {
      let echt, kennung;
      try { echt = realpathSync.native(v.pfad); kennung = kennungVon(echt); } catch { continue; }
      const t = vaultEintrag(daten, echt);
      if (t && t.eintrag) { // umbenannt oder verschoben: dieselben Regeln gelten weiter
        if (t.schluessel !== echt) { delete daten.vaults[t.schluessel]; daten.vaults[echt] = t.eintrag; }
        continue;
      }
      if (t && t.ausgetauscht) continue; // anderer Ordner am selben Pfad: bleibt gesperrt, bis der Nutzer ausdrücklich entscheidet
      const q = quelle(echt);
      const konten = {};
      for (const id of ids) konten[id] = (migration && verbundene.has(id)) || darfAuto(id, q) ? "posteingang" : "gesperrt";
      daten.vaults[echt] = { ordnerKennung: kennung, neueKonten: "gesperrt", ohneKonto: migration && verbundene.size ? "posteingang" : "gesperrt", konten };
    }
    // Neu erkannte Konten in schon bekannten Vaults: ausdrücklich gesperrt (Ausnahme: das einzige Konto und ein von Kortex angelegter oder geklonter Vault).
    for (const id of neueIds) for (const [pfad, e] of Object.entries(daten.vaults)) {
      if (!istObj(e.konten)) e.konten = {};
      if (!Object.hasOwn(e.konten, id)) e.konten[id] = darfAuto(id, quelle(pfad)) ? "posteingang" : "gesperrt";
    }
    return daten;
  }

  // Gleicht die Liste mit dem Rechner ab (Konten, Vaults). → { zustand, hinweis? } Der erste Start (Datei fehlt) ist die Migration.
  function synchronisiere() {
    let hinweis = null, streng = false;
    let r = liesKonten(support);
    if (r.zustand === "defekt") {
      repariere(support);
      hinweis = "defekt-neu"; streng = true;
      r = liesKonten(support);
    }
    const migration = r.zustand === "fehlt" && !streng;
    const erkannt = erkenne();
    aendere(support, (alt) => rechne(alt, { erkannt, vaults: vaultListe(), migration, streng }));
    return { zustand: liesKonten(support).zustand, ...(hinweis ? { hinweis } : {}) };
  }

  const lade = () => { const r = liesKonten(support); return r.zustand === "ok" ? r.daten : null; };
  const ladeOderSynchronisiere = () => { let d = lade(); if (!d) { synchronisiere(); d = lade(); } if (!d) throw new HttpFehler(500, "Die Liste der KI-Konten ist nicht verfügbar."); return d; };

  const kurz = (p) => { const h = home(); return p === h ? "~" : p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p; };

  function stand() {
    const s = synchronisiere();
    const daten = lade();
    if (!daten) return { zustand: "defekt", stufen: STUFEN, konten: [], vaults: [], zugriff: {} };
    const liste = vaultListe();
    const konten = Object.entries(daten.konten).map(([id, k]) => {
      let vorhanden = false; try { vorhanden = lstatSync(k.ordner).isDirectory(); } catch { /* weg */ }
      return { id, programm: k.programm, name: k.name, ...(k.abo ? { abo: k.abo } : {}), standard: k.standard === true, ordner: kurz(k.ordner), vorhanden, ...(k.heimat ? { heimat: k.heimat } : {}) };
    });
    const zugriff = {};
    for (const id of Object.keys(daten.konten)) zugriff[id] = Object.fromEntries(liste.map((v) => [v.pfad, stufeFuer(daten, v.pfad, id)]));
    const vs = liste.map((v) => {
      const t = vaultEintrag(daten, v.pfad);
      const e = t && t.eintrag ? t.eintrag : null;
      return { pfad: v.pfad, name: v.name, neueKonten: e ? e.neueKonten || "gesperrt" : "gesperrt", ohneKonto: e ? e.ohneKonto || "gesperrt" : "gesperrt", ...(t && t.ausgetauscht ? { ausgetauscht: true } : {}) };
    });
    return { zustand: "ok", ...(s.hinweis ? { hinweis: s.hinweis } : {}), stufen: STUFEN, konten, vaults: vs, zugriff };
  }

  function setzeName(e) {
    if (typeof e.id !== "string") throw new HttpFehler(400, "Die Konto-Kennung fehlt.");
    const name = e.name === undefined ? undefined : pruefeName(e.name);
    if (e.abo !== undefined && !ABOS.includes(e.abo)) throw new HttpFehler(400, `Das Abo muss eines von ${ABOS.join(", ")} sein.`);
    ladeOderSynchronisiere();
    aendere(support, (alt) => {
      if (!alt || !Object.hasOwn(alt.konten, e.id)) throw new HttpFehler(404, "Dieses KI-Konto gibt es nicht (mehr).");
      if (name !== undefined) alt.konten[e.id].name = name;
      if (e.abo !== undefined) alt.konten[e.id].abo = e.abo;
      return alt;
    });
    return stand();
  }

  // Ein Eintrag für einen Vault, den es in der Liste noch nicht (oder nur ausgetauscht) gibt — alles gesperrt, außer der Ausnahme für das einzige Konto.
  function frischerEintrag(daten, echt, q, kennung) {
    const ids = Object.keys(daten.konten);
    const einziges = ids.length === 1 ? ids[0] : null;
    const konten = Object.fromEntries(ids.map((id) => [id, id === einziges && KORTEX_VON_KORTEX.includes(q) ? "posteingang" : "gesperrt"]));
    return { ordnerKennung: kennung, neueKonten: "gesperrt", ohneKonto: "gesperrt", konten };
  }
  const entferneEintraege = (daten, echt, kennung) => {
    for (const [k, e] of Object.entries(daten.vaults)) if (falte(k) === falte(echt) || e.ordnerKennung === kennung) delete daten.vaults[k];
  };

  function setzeZugriff(e) {
    if (typeof e.konto !== "string" || typeof e.vault !== "string") throw new HttpFehler(400, "Konto und Vault müssen angegeben werden.");
    if (!STUFEN.includes(e.stufe)) throw new HttpFehler(400, `Die Stufe muss eine von ${STUFEN.join(", ")} sein.`);
    if (e.heimat !== undefined && typeof e.heimat !== "boolean") throw new HttpFehler(400, "„heimat“ muss true oder false sein.");
    ladeOderSynchronisiere();
    // Nur Vaults aus der Liste der App (nie ein frei gewählter Pfad).
    const echtVon = (p) => { try { return falte(realpathSync.native(p)); } catch { return null; } };
    const wunsch = echtVon(e.vault);
    const bekannt = vaultListe().find((v) => v.pfad === e.vault || falte(v.pfad) === falte(e.vault) || (wunsch !== null && echtVon(v.pfad) === wunsch));
    if (!bekannt) throw new HttpFehler(404, "Diesen Vault kennt Kortex nicht (mehr).");
    let echt;
    try { echt = realpathSync.native(bekannt.pfad); } catch { throw new HttpFehler(404, "Der Ordner dieses Vaults fehlt."); }
    const kennung = kennungVon(echt);
    aendere(support, (alt) => {
      if (!alt || !Object.hasOwn(alt.konten, e.konto)) throw new HttpFehler(404, "Dieses KI-Konto gibt es nicht (mehr).");
      let t = vaultEintrag(alt, echt);
      if (!t || !t.eintrag) { // neu, oder ausgetauschter Ordner: der Nutzer entscheidet jetzt ausdrücklich
        entferneEintraege(alt, echt, kennung);
        const frisch = frischerEintrag(alt, echt, null, kennung);
        for (const id of Object.keys(frisch.konten)) frisch.konten[id] = "gesperrt";
        alt.vaults[echt] = frisch;
        t = { eintrag: frisch, schluessel: echt };
      }
      const eintrag = t.eintrag;
      if (!istObj(eintrag.konten)) eintrag.konten = {};
      eintrag.konten[e.konto] = e.stufe;
      const k = alt.konten[e.konto];
      if (e.heimat === true && stufeNr(e.stufe) >= stufeNr("lesen")) k.heimat = t.schluessel;
      else if (e.heimat === false || stufeNr(e.stufe) < stufeNr("lesen")) { if (k.heimat && falte(k.heimat) === falte(t.schluessel)) delete k.heimat; }
      return alt;
    });
    return stand();
  }

  // Kortex hat einen Vault angelegt (quelle "angelegt"), geklont ("geklont") oder einen Ordner geöffnet ("geoeffnet"). Neue Vaults sind für alle Konten gesperrt;
  // das einzige Konto bekommt bei angelegt/geklont „posteingang“. Ein schon bekannter Vault behält seine Regeln.
  function vaultHinzu(pfad, q = "geoeffnet") {
    let echt, kennung;
    try { echt = realpathSync.native(pfad); kennung = kennungVon(echt); } catch { return; }
    ladeOderSynchronisiere();
    aendere(support, (alt) => {
      const daten = alt || leerDaten();
      const t = vaultEintrag(daten, echt);
      if (t && t.eintrag) return daten;
      entferneEintraege(daten, echt, kennung);
      daten.vaults[echt] = frischerEintrag(daten, echt, q, kennung);
      return daten;
    });
  }

  // Die Konto-Kennung für ein Programm/Profil, damit der Eintrag bei der KI `--konto <id>` tragen kann. null = kein Konto bekannt (Altform).
  const nachOrt = (daten, programm, ordner) => {
    const f = falte(echterOrt(ordner));
    const t = Object.entries(daten.konten).filter(([, k]) => k.programm === programm && falte(k.ordner) === f);
    if (t.length <= 1) return t.length ? t[0][0] : null;
    let kennung = ""; try { kennung = kennungVon(echterOrt(ordner)); } catch { /* fehlt */ }
    return (t.find(([, k]) => k.ordnerKennung === kennung) || [null])[0];
  };
  function kontoFuerProfil(pfad) {
    const d = lade();
    return d && typeof pfad === "string" ? nachOrt(d, "claude", pfad) : null;
  }
  // anlegen: das Programm ist bekannt (der Nutzer verbindet es gerade), aber noch kein Konto erkannt → das Standardkonto des Programms wird eingetragen.
  function kontoFuerProgramm(programm, { anlegen = false } = {}) {
    let d = lade();
    const standardOrdner = () => {
      const h = home();
      if (programm === "claude") return join(h, ".claude");
      if (programm === "codex") return join(h, ".codex");
      const b = BESCHREIBUNGEN.find((x) => x.id === programm);
      return b ? dirname(b.datei({ home: h })) : null;
    };
    const finde = (daten) => {
      const t = Object.entries(daten.konten).filter(([, k]) => k.programm === programm && (programm === "claude" || programm === "codex" ? k.standard === true : true));
      return t.length ? t[0][0] : null;
    };
    let id = d ? finde(d) : null;
    if (id || !anlegen) return id;
    const ordner = standardOrdner();
    if (!ordner || !homeErlaubt(home())) return null;
    if (!d) synchronisiere();
    d = lade();
    id = d ? finde(d) : null;
    if (id) return id;
    const roh = echterOrt(ordner);
    const name = programm === "claude" ? "Claude Code" : programm === "codex" ? "Codex" : (BESCHREIBUNGEN.find((x) => x.id === programm) || {}).name || programm;
    const erkannt = [{ programm, ordner: roh, standard: true, name, ordnerKennung: (() => { try { return kennungVon(roh); } catch { return ""; } })() }];
    aendere(support, (alt) => rechne(alt, { erkannt, vaults: vaultListe(), migration: false, streng: false }));
    d = lade();
    return d ? finde(d) : null;
  }
  const programmVon = (id) => { const d = lade(); return d && Object.hasOwn(d.konten, id) ? d.konten[id] : null; };
  const kontoDaten = (id) => programmVon(id);

  // Für die Probe-Frage der App: ein Konto, das den Vault lesen darf (claude zuerst). null, wenn es die Liste noch nicht gibt (bisheriges Verhalten);
  // gibt es die Liste, aber kein Konto mit Zugriff, ist das ein Fehler für den Aufrufer (nichts gefunden zu haben wäre sonst irreführend).
  function probeKonto(vaultPfad) {
    const d = lade();
    if (!d) return { konto: null, liste: false };
    const ids = Object.keys(d.konten).sort((a, b) => (d.konten[a].programm === "claude" ? 0 : 1) - (d.konten[b].programm === "claude" ? 0 : 1));
    for (const id of ids) if (darfMindestens(stufeFuer(d, vaultPfad, id), "lesen")) return { konto: id, liste: true };
    return { konto: null, liste: true };
  }

  return { synchronisiere, stand, setzeName, setzeZugriff, vaultHinzu, kontoFuerProfil, kontoFuerProgramm, kontoDaten, probeKonto, lade };
}
