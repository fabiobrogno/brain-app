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
// P2 (Oberfläche, Sperre in Claude Code):
//   PUT  /api/ki/zugriff    { konto, vault, stufe, heimat?, claudeSperre? }  — „gesperrt“ + claudeSperre:true trägt das Leseverbot in die settings.json des Claude-Profils ein;
//                           jede andere Stufe (oder claudeSperre:false) nimmt genau die eigenen Regeln wieder heraus
//   PUT  /api/ki/standard   { vault, stufe }                 — was für ein neu erkanntes Konto in diesem Vault gilt (gesperrt | lesen | posteingang)
//   POST /api/ki/schutz     { konto, sandbox, bestaetigt }   — „Strenger Schutz“ (Sandbox von Claude Code) je Konto, nur mit bestaetigt:true
//   POST /api/ki/hinweis    { quittiert: true }              — den Hinweis „Liste war beschädigt“ ausblenden
//   POST /api/ki/vorher     { bestaetigt: true }             — die frühere Fassung der Liste zurückholen (kann Sperren lockern: nur nach Bestätigung)
// P3 (Pflege-Konto und Modell je Vault):
//   POST /api/ki/pflege   { vault, konto|null, stufe: klein|mittel|aus }  — vaults[v].pflege = { konto, stufe }; nur ein Claude-Code-Konto mit der Stufe „erweitert“ für diesen Vault
//   Migration (einmal): ein festes CLAUDE_CONFIG_DIR in der alten plist des Dienstes wird das Pflege-Konto der Vaults in dienst.json (hat das Konto erweitert: Stufe mittel, sonst ohne KI + Hinweis)
//  · Was Kortex in settings.json eingetragen hat, steht in ki-konten.json unter `eingetragen` (je Konto), der Wunsch „Strenger Schutz“ unter `schutz`. Der Rückweg entfernt nur das.
import { readFileSync, realpathSync, lstatSync, mkdirSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { homedir, tmpdir } from "node:os";
import { HttpFehler, testmodus } from "../gemeinsam/basis.mjs";
import * as vertrauenFn from "../gemeinsam/vertrauen.mjs";
import { STUFEN, ABOS, kontenPfad, pruefeDaten, stelleVorherWiederHer, sichereSpur, liesKonten, aendere, repariere, leerDaten, neueId, pruefeName, vaultEintrag, stufeFuer, kennungVon, echterOrt, stufeNr, darfMindestens, PFLEGE_STUFEN, pflegeFuer, pflegeWirksam } from "../gemeinsam/ki-konten.mjs";
import { vaultRegeln, sandboxPfade, einstellungsRegeln, sandboxGeheim, sandboxSchreibschutz, eineSicherung, tragRegelnEin, nimmRegelnHeraus, liesRegelStand, gleicheSandboxAb, liesSandboxStand } from "../gemeinsam/claude-sperre.mjs";
import { erkenneKonten } from "./konten-erkennung.mjs";
import { verwaltetWurzel, verwaltetWurzelZustand, istVerwalteterOrdner } from "./profile.mjs";
import { schutzAmpel } from "./schutz-ampel.mjs";
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

// Altform: Hat dieses Konto einen MCP-Eintrag „brain“ oder Kortex-Hooks OHNE `--konto <id>`? Solche Einträge sagen dem Server nicht, für wen er läuft; für sie gilt nur die Umgebung bzw. „ohneKonto“ des
// Vaults (nie lockerer als das strengste Konto). Gelesen wird nur, ob `--konto` fehlt — nichts davon wird behalten oder ausgegeben. → { mcp: bool, hooks: bool }
export function altformStandard(k, home = homedir()) {
  const aus = { mcp: false, hooks: false };
  try {
    const ohne = (args) => !(Array.isArray(args) && args.includes("--konto"));
    if (k.programm === "claude") {
      const s = dateiText(join(k.ordner, "settings.json"));
      if (s) { const j = JSON.parse(s); const cmds = Object.values(istObj(j.hooks) ? j.hooks : {}).flat().flatMap((e) => (istObj(e) && Array.isArray(e.hooks) ? e.hooks : [])).map((h) => h && h.command).filter((c) => typeof c === "string" && /kortex' hook [a-z]/.test(c)); aus.hooks = cmds.length > 0 && cmds.some((c) => !/ --konto k_[0-9a-f]{8}/.test(c)); }
      const cj = dateiText(k.standard ? join(home, ".claude.json") : join(k.ordner, ".claude.json"));
      if (cj) { const j = JSON.parse(cj); const e = istObj(j) && istObj(j.mcpServers) ? j.mcpServers.brain : undefined; aus.mcp = istObj(e) && ohne(e.args); }
      return aus;
    }
    if (k.programm === "codex") {
      const t = dateiText(join(k.ordner, "config.toml"));
      const m = t ? /^\s*\[mcp_servers\.brain\]([\s\S]*?)(?=^\s*\[|$(?![\s\S]))/m.exec(t) : null;
      if (m) { const a = /args\s*=\s*\[([\s\S]*?)\]/.exec(m[1]); aus.mcp = !a || !a[1].includes("--konto"); }
      return aus;
    }
    const b = BESCHREIBUNGEN.find((x) => x.id === k.programm);
    if (!b) return aus;
    const t = dateiText(b.datei({ home }));
    if (!t || !t.trim()) return aus;
    const verz = holeAm(parseJsonc(t), b.pfad);
    const e = istObj(verz) ? verz.brain : undefined;
    aus.mcp = istObj(e) && ohne(e.args);
  } catch { /* nicht lesbar: keine Aussage */ }
  return aus;
}

// Im Testmodus liest die Erkennung nur ein Home unter dem Temp-Ordner — nie den echten Benutzerordner des Rechners, auf dem die Tests laufen.
const echtPfad = (p) => { try { return realpathSync.native(p); } catch { return p; } };
const homeErlaubt = (h) => !testmodus() || echtPfad(h).startsWith(echtPfad(tmpdir()) + sep);

export function erzeugeKonten({ support, home = () => homedir(), vaults = () => [], erkennung = null, verbunden = null, quelleVon = null } = {}) {
  const erkenne = () => (erkennung ? erkennung() : homeErlaubt(home()) ? erkenneKonten({ home: home(), support }) : []);
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
    // „Genau ein Konto“ zählt nur Konten eines tatsächlich verbundenen KI-Programms (Hooks oder MCP-Eintrag „brain“); ein erkanntes, aber nicht verbundenes Programm
    // verhindert die Ausnahme nicht, bekommt sie aber auch nicht.
    let einzigesCache;
    const einziges = () => { if (einzigesCache === undefined) { const vb = ids.filter((id) => istVerbunden(daten.konten[id])); einzigesCache = vb.length === 1 ? vb[0] : null; } return einzigesCache; };
    const darfAuto = (id, q) => !c.streng && KORTEX_VON_KORTEX.includes(q) && id === einziges();
    for (const v of c.vaults) {
      let echt, kennung;
      try { echt = realpathSync.native(v.pfad); kennung = kennungVon(echt); } catch { continue; }
      const t = vaultEintrag(daten, echt);
      if (t && t.eintrag) { // umbenannt oder verschoben: dieselben Regeln gelten weiter
        if (t.schluessel !== echt) {
          delete daten.vaults[t.schluessel]; daten.vaults[echt] = t.eintrag;
          for (const e of Object.values(istObj(daten.eingetragen) ? daten.eingetragen : {})) if (istObj(e) && istObj(e.claudeDeny) && Object.hasOwn(e.claudeDeny, t.schluessel)) { e.claudeDeny[echt] = e.claudeDeny[t.schluessel]; delete e.claudeDeny[t.schluessel]; }
        }
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
    if (c.streng) daten.hinweis = { art: "defekt-neu", seit: jetzt(), grund: c.grund || "defekt" }; // bleibt, bis der Nutzer ihn quittiert (die Werkstatt gleicht schon beim App-Start ab)
    return daten;
  }

  // Gleicht die Liste mit dem Rechner ab (Konten, Vaults). → { zustand, hinweis? } Der erste Start (Datei fehlt) ist die Migration.
  function synchronisiere() {
    let hinweis = null, streng = false, grund = null;
    let r = liesKonten(support);
    if (r.zustand === "defekt" || r.zustand === "geloescht") {
      // beschädigt ODER gelöscht (die Datei fehlt, aber es gibt Spuren, dass sie einmal da war): neu anfangen, alles gesperrt, keine Migration (sie würde alte Rechte wieder öffnen)
      const rep = repariere(support);
      hinweis = "defekt-neu"; streng = true; grund = r.zustand === "geloescht" || rep.grund === "geloescht" ? "geloescht" : "defekt";
      r = liesKonten(support);
    }
    const migration = r.zustand === "fehlt" && !streng;
    const erkannt = erkenne();
    aendere(support, (alt) => rechne(alt, { erkannt, vaults: vaultListe(), migration, streng, grund }), { neuAnfangen: streng });
    if (liesKonten(support).zustand === "ok") { sichereSpur(support); nachfuehren(); }
    return { zustand: liesKonten(support).zustand, ...(hinweis ? { hinweis, hinweisGrund: grund } : {}) };
  }

  const lade = () => { const r = liesKonten(support); return r.zustand === "ok" ? r.daten : null; };
  const ladeOderSynchronisiere = () => { let d = lade(); if (!d) { synchronisiere(); d = lade(); } if (!d) throw new HttpFehler(500, "Die Liste der KI-Konten ist nicht verfügbar."); return d; };

  const kurz = (p) => { const h = home(); return p === h ? "~" : p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p; };

  // ───────────── Sperre in Claude Code (nur Konten, die die Werkstatt kennt; nur das Programm „claude“) ─────────────
  // Im Testmodus schreibt Kortex nie in einen Ordner außerhalb des Temp-Ordners (nie ins echte ~/.claude des Rechners, auf dem die Tests laufen).
  const ordnerErlaubt = (o) => !testmodus() || echtPfad(o).startsWith(echtPfad(tmpdir()) + sep);
  const claudeOrdner = (daten, kontoId) => {
    const k = daten && Object.hasOwn(daten.konten, kontoId) ? daten.konten[kontoId] : null;
    if (!k || k.programm !== "claude") throw new HttpFehler(409, "Das Leseverbot in den Einstellungen gibt es nur für Claude Code.", { art: "kein-claude" });
    if (!ordnerErlaubt(k.ordner)) throw new HttpFehler(409, "Im Testmodus schreibt Kortex nur unter dem Temp-Ordner.", { art: "testmodus" });
    return k.ordner;
  };
  // Der Schlüssel „@einstellungen“ in eingetragen.<konto>.claudeDeny steht für die Einstellungsregeln (Kortex-Einstellungen und Einstellungsdateien des Profils), kein Vault.
  const EINST = "@einstellungen";
  const eingetragenVon = (daten, kontoId) => {
    const e = istObj(daten.eingetragen) && istObj(daten.eingetragen[kontoId]) ? daten.eingetragen[kontoId] : {};
    return { claudeDeny: istObj(e.claudeDeny) ? e.claudeDeny : {}, sandbox: istObj(e.sandbox) ? e.sandbox : null, denyAngelegt: Array.isArray(e.denyAngelegt) ? e.denyAngelegt : [] };
  };
  // Alle Orte eines Vaults aus der Liste der App (wie angegeben und aufgelöst) — daraus die Regeln.
  const vaultOrte = (schluessel) => { const bekannt = vaultListe().find((v) => { try { return falte(realpathSync.native(v.pfad)) === falte(schluessel); } catch { return false; } }); return bekannt ? [bekannt.pfad, schluessel] : [schluessel]; };
  const gesperrteVaults = (daten, kontoId) => Object.keys(daten.vaults).filter((k) => stufeFuer(daten, k, kontoId) === "gesperrt");
  const speichere = (fn) => aendere(support, (alt) => { if (!alt) throw new HttpFehler(500, "Die Liste der KI-Konten ist nicht verfügbar."); fn(alt); return alt; }).daten;
  const setzeEingetragen = (daten, kontoId, teil) => {
    if (!istObj(daten.eingetragen)) daten.eingetragen = {};
    daten.eingetragen[kontoId] = { ...(istObj(daten.eingetragen[kontoId]) ? daten.eingetragen[kontoId] : {}), ...teil };
    const e = daten.eingetragen[kontoId];
    if (e.claudeDeny && !Object.keys(e.claudeDeny).length) delete e.claudeDeny;
    if (e.sandbox === null || e.sandbox === undefined) delete e.sandbox;
    if (Array.isArray(e.denyAngelegt) && (!e.denyAngelegt.length || !e.claudeDeny)) delete e.denyAngelegt;
    if (!Object.keys(e).length) delete daten.eingetragen[kontoId];
    if (!Object.keys(daten.eingetragen).length) delete daten.eingetragen;
  };
  const sollRegeln = (daten, kontoId, schluessel) => (schluessel === EINST
    ? einstellungsRegeln({ support, profil: daten.konten[kontoId].ordner, home: home(), standard: daten.konten[kontoId].standard === true })
    : vaultRegeln(...vaultOrte(schluessel)));

  // Bringt das Leseverbot eines Vaults (oder die Einstellungsregeln, schluessel = EINST) in den gewünschten Zustand: an = die Regeln stehen in der settings.json (und nur diese sind als „von Kortex“
  // vermerkt), aus = genau die vermerkten Regeln sind heraus. Vermerkt wird VOR dem Schreiben (ein Absturz dazwischen hinterlässt keine Regel ohne Vermerk); schlägt das Schreiben fehl, geht der Vermerk
  // zurück. Leere Behälter in der settings.json entfernt nur, wer sie angelegt hat (denyAngelegt). → { aktion, regeln }
  function leseverbot(kontoId, schluessel, an) {
    const daten = lade();
    const eing = eingetragenVon(daten, kontoId);
    const vermerkt = eing.claudeDeny[schluessel] || [];
    if (!an && !vermerkt.length) return { aktion: "nichts", regeln: [] }; // nichts von Kortex eingetragen: die Einstellungen von Claude Code werden nicht einmal geöffnet
    const ordner = claudeOrdner(daten, kontoId);
    if (!an) {
      const r = nimmRegelnHeraus(ordner, vermerkt, eing.denyAngelegt);
      speichere((d) => { const e = eingetragenVon(d, kontoId); delete e.claudeDeny[schluessel]; setzeEingetragen(d, kontoId, { claudeDeny: e.claudeDeny, denyAngelegt: e.denyAngelegt.filter((x) => !r.entfernt.includes(x)) }); });
      return { aktion: "entfernt", regeln: vermerkt };
    }
    const soll = sollRegeln(daten, kontoId, schluessel);
    // Was Kortex früher eingetragen hat und jetzt nicht mehr gilt (z. B. der Vault wurde verschoben): heraus.
    const veraltet = vermerkt.filter((r) => !soll.includes(r));
    // Eine Regel, die schon vor Kortex da war, gehört dem Nutzer: sie wird nicht vermerkt und nie von Kortex entfernt.
    const vorschau = liesRegelStand(ordner, soll);
    if (vorschau.zustand === "defekt") throw new HttpFehler(409, "Die Einstellungen von Claude Code (settings.json) sind kaputt oder nicht lesbar. Kortex ändert nichts daran — bitte zuerst reparieren.", { art: "einstellungen-defekt" });
    const eigene = soll.filter((r) => vermerkt.includes(r) || !vorschau.da.includes(r));
    speichere((d) => { const e = eingetragenVon(d, kontoId); e.claudeDeny[schluessel] = eigene; setzeEingetragen(d, kontoId, { claudeDeny: e.claudeDeny }); });
    try {
      if (veraltet.length) nimmRegelnHeraus(ordner, veraltet);
      const r = tragRegelnEin(ordner, soll);
      if (r.angelegt.length) speichere((d) => { const e = eingetragenVon(d, kontoId); setzeEingetragen(d, kontoId, { denyAngelegt: [...new Set([...e.denyAngelegt, ...r.angelegt])] }); });
    } catch (err) {
      try { speichere((d) => { const e = eingetragenVon(d, kontoId); if (vermerkt.length) e.claudeDeny[schluessel] = vermerkt; else delete e.claudeDeny[schluessel]; setzeEingetragen(d, kontoId, { claudeDeny: e.claudeDeny }); }); } catch { /* der Vermerk ist harmlos: er entfernt höchstens eine Regel, die es nicht gibt */ }
      throw err;
    }
    return { aktion: "eingetragen", regeln: soll };
  }

  // Die Einstellungsregeln gehören zum Schutz, solange das Konto irgendein Leseverbot oder den Strengen Schutz hat — und nur dann.
  function einstellungsSchutz(kontoId) {
    const daten = lade();
    const e = eingetragenVon(daten, kontoId);
    const gewuenscht = istObj(daten.schutz) && istObj(daten.schutz[kontoId]) && daten.schutz[kontoId].sandbox === true;
    const wollen = gewuenscht || Object.keys(e.claudeDeny).some((k) => k !== EINST && (e.claudeDeny[k] || []).length);
    if (!wollen && !(e.claudeDeny[EINST] || []).length) return { aktion: "nichts" };
    return leseverbot(kontoId, EINST, wollen);
  }

  // „Strenger Schutz“ nachführen: ist er für das Konto gewünscht, gehören alle gesperrten Vaults in sandbox.filesystem.denyRead UND denyWrite, dazu die Kortex-Listen (denyRead) und der Support-Ordner und
  // das Profil (denyWrite); sonst ist alles von Kortex Eingetragene heraus.
  function strengerSchutz(kontoId) {
    const daten = lade();
    const gewuenscht = istObj(daten.schutz) && istObj(daten.schutz[kontoId]) && daten.schutz[kontoId].sandbox === true;
    const frueher = eingetragenVon(daten, kontoId).sandbox;
    if (!gewuenscht && !frueher) return { aktion: "nichts" };
    const ordner = claudeOrdner(daten, kontoId);
    const k = daten.konten[kontoId];
    let soll = null;
    if (gewuenscht) {
      const vaultPfade = [...new Set(gesperrteVaults(daten, kontoId).flatMap((s) => sandboxPfade(...vaultOrte(s))))];
      soll = {
        denyRead: [...vaultPfade, ...sandboxGeheim({ support, profil: ordner })],
        denyWrite: [...vaultPfade, ...sandboxSchreibschutz({ support, profil: ordner, home: home(), standard: k.standard === true })],
      };
    }
    const neu = gleicheSandboxAb(ordner, frueher, soll);
    speichere((d) => setzeEingetragen(d, kontoId, { sandbox: neu }));
    einstellungsSchutz(kontoId);
    return { aktion: gewuenscht ? "an" : "aus", pfade: soll ? soll.denyRead : [] };
  }

  // Alles nachführen, was an Orten hängt, die sich ändern können: verschobene oder neu hinzugekommene Vaults (Regeln und Pfade des Strengen Schutzes), Einstellungsregeln. Nur was der Nutzer schon
  // ausdrücklich eingeschaltet hat (Leseverbot für diesen Vault, Strenger Schutz) — nie ein neues Leseverbot von selbst. Fehler bleiben still (die Anzeige zeigt „fehlt“ oder „veraltet“).
  function nachfuehren() {
    const daten = lade();
    if (!daten) return;
    for (const [id, k] of Object.entries(daten.konten)) {
      if (k.programm !== "claude" || !istObj(daten.eingetragen) || !istObj(daten.eingetragen[id])) continue;
      try {
        eineSicherung(() => {
          const e = eingetragenVon(lade(), id);
          for (const schluessel of Object.keys(e.claudeDeny)) {
            if (schluessel === EINST) continue;
            if (stufeFuer(lade(), schluessel, id) !== "gesperrt") { leseverbot(id, schluessel, false); continue; }
            const soll = sollRegeln(lade(), id, schluessel);
            const vermerkt = e.claudeDeny[schluessel] || [];
            if (vermerkt.length !== soll.length || vermerkt.some((r) => !soll.includes(r))) leseverbot(id, schluessel, true);
          }
          strengerSchutz(id);
          einstellungsSchutz(id);
        });
      } catch { /* nächste Anzeige zeigt es */ }
    }
  }

  // Die Meldung an die Oberfläche, wenn das Schreiben in die Einstellungen von Claude Code scheitert (die Stufe in Kortex ist dann trotzdem gesetzt).
  const fehlerText = (err) => (err instanceof HttpFehler ? err.message : "Die Einstellungen von Claude Code ließen sich nicht ändern.");

  // Zustand des Schutzes je Konto für die Anzeige (liest nur).
  function schutzStand(daten, kontoId, k) {
    if (k.programm !== "claude") return { moeglich: false, ampel: schutzAmpel({ programm: k.programm, gesperrt: gesperrteVaults(daten, kontoId).length }) };
    const gewuenscht = istObj(daten.schutz) && istObj(daten.schutz[kontoId]) && daten.schutz[kontoId].sandbox === true;
    const e = eingetragenVon(daten, kontoId);
    const erlaubt = ordnerErlaubt(k.ordner);
    const vaults = {};
    for (const schluessel of Object.keys(daten.vaults)) {
      if (stufeFuer(daten, schluessel, kontoId) !== "gesperrt") continue;
      const vermerkt = e.claudeDeny[schluessel] || [];
      if (!erlaubt) { vaults[schluessel] = vermerkt.length ? "fehlt" : "aus"; continue; }
      const soll = vaultRegeln(...vaultOrte(schluessel));
      const st = liesRegelStand(k.ordner, vermerkt.length ? vermerkt : soll);
      if (st.zustand === "defekt") vaults[schluessel] = "defekt";
      else if (!vermerkt.length) vaults[schluessel] = soll.every((r) => st.da.includes(r)) ? "eigene" : "aus"; // steht schon eine Regel des Nutzers da, gilt sie
      else if (vermerkt.some((r) => !soll.includes(r))) vaults[schluessel] = "veraltet";
      else vaults[schluessel] = vermerkt.every((r) => st.da.includes(r)) ? "aktiv" : "fehlt";
    }
    let strengAktiv = false, warnungen = [];
    if (gewuenscht || e.sandbox) {
      const st = erlaubt ? liesSandboxStand(k.ordner, (e.sandbox && e.sandbox.denyRead) || []) : { an: false, da: [], warnungen: [] };
      strengAktiv = st.an && (!e.sandbox || (e.sandbox.denyRead || []).every((p) => st.da.includes(p)));
      warnungen = st.warnungen || [];
    }
    const roh = { moeglich: true, strenger: gewuenscht, strengerAktiv: strengAktiv, warnungen, vaults };
    return { ...roh, ampel: schutzAmpel({ programm: "claude", gesperrt: Object.keys(vaults).length, schutz: roh }) };
  }

  const programmName = (id) => (id === "claude" ? "Claude Code" : id === "codex" ? "Codex" : (BESCHREIBUNGEN.find((x) => x.id === id) || {}).name || id);
  function vorherBrauchbar() {
    try { const v = `${kontenPfad(support)}.vorher`; const st = lstatSync(v); return st.isFile() && st.size <= 4 * 1024 * 1024 && pruefeDaten(JSON.parse(readFileSync(v, "utf8"))); } catch { return false; }
  }

  function stand() {
    const s = synchronisiere();
    const daten = lade();
    if (!daten) return { zustand: "defekt", stufen: STUFEN, konten: [], vaults: [], zugriff: {} };
    const liste = vaultListe();
    const anmeldungen = anmeldungLesen();
    const konten = Object.entries(daten.konten).map(([id, k]) => {
      let vorhanden = false; try { vorhanden = lstatSync(k.ordner).isDirectory(); } catch { /* weg */ }
      return { id, programm: k.programm, programmName: programmName(k.programm), name: k.name, ...(k.abo ? { abo: k.abo } : {}), standard: k.standard === true, ordner: kurz(k.ordner), pfad: k.ordner, verwaltet: istVerwaltet(k), ...(anmeldungen.konten[id]?.zuletzt ? { zuletztAngemeldet: anmeldungen.konten[id].zuletzt } : {}), vorhanden,
        verbunden: istVerbunden(k), altform: homeErlaubt(home()) ? altformStandard(k, home()) : { mcp: false, hooks: false }, schutz: schutzStand(daten, id, k), ...(k.heimat ? { heimat: k.heimat } : {}) };
    });
    const zugriff = {};
    for (const id of Object.keys(daten.konten)) zugriff[id] = Object.fromEntries(liste.map((v) => [v.pfad, stufeFuer(daten, v.pfad, id)]));
    const vs = liste.map((v) => {
      const t = vaultEintrag(daten, v.pfad);
      const e = t && t.eintrag ? t.eintrag : null;
      const p = e ? pflegeFuer(daten, v.pfad) : { gesetzt: false };
      const w = e ? pflegeWirksam(daten, v.pfad) : null;
      const pflege = p.gesetzt ? { gesetzt: true, konto: p.konto, stufe: p.stufe, wirksam: w.modus, bewusst: w.bewusst, ...(w.problem ? { problem: w.problem } : {}) } : { gesetzt: false, wirksam: "alt" };
      return { pfad: v.pfad, name: v.name, neueKonten: e ? e.neueKonten || "gesperrt" : "gesperrt", ohneKonto: e ? e.ohneKonto || "gesperrt" : "gesperrt", pflege, ...(t && t.schluessel ? { schluessel: t.schluessel } : {}), ...(t && t.ausgetauscht ? { ausgetauscht: true } : {}) };
    });
    const hinweis = s.hinweis || (daten.hinweis && daten.hinweis.art === "defekt-neu" ? "defekt-neu" : null);
    const hinweisGrund = (daten.hinweis && daten.hinweis.grund) || s.hinweisGrund || "defekt";
    return { zustand: "ok", ...(hinweis ? { hinweis, hinweisGrund, ...(daten.hinweis && daten.hinweis.seit ? { hinweisSeit: daten.hinweis.seit } : {}), vorherDa: vorherBrauchbar() } : {}), stufen: STUFEN, konten, vaults: vs, zugriff, ...(pflegeHinweise(daten).length ? { pflegeHinweise: pflegeHinweise(daten) } : {}),
      ...(istObj(daten.pflegeMigration) && daten.pflegeMigration.plistOffen === true ? { pflegePlist: { offen: true, grund: typeof daten.pflegeMigration.plistGrund === "string" ? daten.pflegeMigration.plistGrund : "fehler" } } : {}) };
  }
  // Hinweise der Migration (Konto des Dienstes hatte nicht „erweitert“): nur solange der Vault noch auf „ohne KI“ aus der Migration steht
  const pflegeHinweise = (daten) => {
    const m = daten && istObj(daten.pflegeMigration) ? daten.pflegeMigration : null;
    if (!m || !Array.isArray(m.hinweise)) return [];
    return m.hinweise.filter((h) => istObj(h) && typeof h.vault === "string" && Object.hasOwn(daten.vaults, h.vault)).map((h) => ({ vault: h.vault, grund: h.grund, ...(typeof h.konto === "string" && Object.hasOwn(daten.konten, h.konto) ? { konto: h.konto } : {}) }));
  };

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
    const verbunden = KORTEX_VON_KORTEX.includes(q) ? ids.filter((id) => istVerbunden(daten.konten[id])) : [];
    const einziges = verbunden.length === 1 ? verbunden[0] : null;
    const konten = Object.fromEntries(ids.map((id) => [id, id === einziges ? "posteingang" : "gesperrt"]));
    return { ordnerKennung: kennung, neueKonten: "gesperrt", ohneKonto: "gesperrt", konten };
  }
  const entferneEintraege = (daten, echt, kennung) => {
    for (const [k, e] of Object.entries(daten.vaults)) if (falte(k) === falte(echt) || e.ordnerKennung === kennung) delete daten.vaults[k];
  };

  function setzeZugriff(e) {
    if (typeof e.konto !== "string" || typeof e.vault !== "string") throw new HttpFehler(400, "Konto und Vault müssen angegeben werden.");
    if (!STUFEN.includes(e.stufe)) throw new HttpFehler(400, `Die Stufe muss eine von ${STUFEN.join(", ")} sein.`);
    if (e.heimat !== undefined && typeof e.heimat !== "boolean") throw new HttpFehler(400, "„heimat“ muss true oder false sein.");
    if (e.claudeSperre !== undefined && typeof e.claudeSperre !== "boolean") throw new HttpFehler(400, "„claudeSperre“ muss true oder false sein.");
    ladeOderSynchronisiere();
    // Nur Vaults aus der Liste der App (nie ein frei gewählter Pfad).
    const echtVon = (p) => { try { return falte(realpathSync.native(p)); } catch { return null; } };
    const wunsch = echtVon(e.vault);
    const bekannt = vaultListe().find((v) => v.pfad === e.vault || falte(v.pfad) === falte(e.vault) || (wunsch !== null && echtVon(v.pfad) === wunsch));
    if (!bekannt) throw new HttpFehler(404, "Diesen Vault kennt Kortex nicht (mehr).");
    let echt;
    try { echt = realpathSync.native(bekannt.pfad); } catch { throw new HttpFehler(404, "Der Ordner dieses Vaults fehlt."); }
    const kennung = kennungVon(echt);
    let schluessel = echt;
    // Der Assistent („KI verbinden“) darf ein Konto, das der Nutzer selbst für diesen Vault gesperrt hat, nie still wieder öffnen: ohne ausdrückliche Wahl (ausdruecklich:true) bleibt es gesperrt.
    if (e.quelle === "assistent" && e.stufe !== "gesperrt") {
      const daten = lade(), t0 = daten ? vaultEintrag(daten, echt) : null;
      if (t0 && t0.eintrag && stufeFuer(daten, echt, e.konto) === "gesperrt" && istObj(t0.eintrag.gesperrtNutzer) && t0.eintrag.gesperrtNutzer[e.konto] === true && e.ausdruecklich !== true) {
        return { ...stand(), zugriffGesetzt: false, zugriffGrund: "vom-nutzer-gesperrt" };
      }
    }
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
      schluessel = t.schluessel;
      if (!istObj(eintrag.konten)) eintrag.konten = {};
      eintrag.konten[e.konto] = e.stufe;
      // Wer sperrt, sperrt auch die Altform: Einträge ohne --konto (ohneKonto) dürfen die Sperre nicht umgehen (wirksam ist ohnehin das Minimum, siehe stufeFuer)
      if (e.stufe === "gesperrt") eintrag.ohneKonto = "gesperrt";
      // Wer ausdrücklich sperrt (nicht der Assistent), dessen Sperre bleibt vermerkt: nur eine ausdrückliche Wahl hebt sie wieder auf.
      if (!istObj(eintrag.gesperrtNutzer)) eintrag.gesperrtNutzer = {};
      if (e.stufe === "gesperrt" && e.quelle !== "assistent") eintrag.gesperrtNutzer[e.konto] = true; else if (e.stufe !== "gesperrt") delete eintrag.gesperrtNutzer[e.konto];
      if (!Object.keys(eintrag.gesperrtNutzer).length) delete eintrag.gesperrtNutzer;
      const k = alt.konten[e.konto];
      if (e.heimat === true && stufeNr(e.stufe) >= stufeNr("lesen")) k.heimat = t.schluessel;
      else if (e.heimat === false || stufeNr(e.stufe) < stufeNr("lesen")) { if (k.heimat && falte(k.heimat) === falte(t.schluessel)) delete k.heimat; }
      return alt;
    });
    // Zweiter Schritt: Claude Code. Die Stufe in Kortex gilt schon; scheitert das Schreiben in die Einstellungen, meldet die Antwort es ausdrücklich.
    //  · gesperrt + claudeSperre:true → Leseverbot eintragen (nur nach ausdrücklicher Bestätigung der Oberfläche) · jede andere Stufe oder claudeSperre:false → eigene Regeln heraus
    //  · ist „Strenger Schutz“ an, wird die Liste der gesperrten Pfade nachgeführt
    const claude = { aktion: "nichts" };
    const k = programmVon(e.konto);
    if (k && k.programm === "claude") {
      try {
        eineSicherung(() => {
          if (e.stufe === "gesperrt") { if (e.claudeSperre === true) Object.assign(claude, leseverbot(e.konto, schluessel, true)); else if (e.claudeSperre === false) Object.assign(claude, leseverbot(e.konto, schluessel, false)); }
          else Object.assign(claude, leseverbot(e.konto, schluessel, false));
          const sb = strengerSchutz(e.konto);
          if (sb.aktion !== "nichts") claude.strenger = sb.aktion;
          einstellungsSchutz(e.konto);
        });
      } catch (err) { claude.aktion = "fehler"; claude.fehler = fehlerText(err); }
    } else if (e.claudeSperre === true && e.stufe === "gesperrt") { claude.aktion = "nicht-moeglich"; }
    const warnungen = e.stufe === "gesperrt" && k ? gedaechtnisWarnung(k) : [];
    return { ...stand(), claude, ...(warnungen.length ? { warnungen } : {}) };
  }

  // Der Gedächtnis-Abgleich (kern/gedaechtnis.mjs) verteilt Projekt-Gedächtnisse an die Konten, die ein Vault in brain.config.json unter automatik.gedaechtnisKonten nennt (Standard ~/.claude), wenn
  // automatik.gedaechtnisTeilen „an“ ist. Seit der Sperre bekommt ein Konto die Projekte eines für es gesperrten Vaults nicht mehr; schon kopierte Dateien bleiben. → Warnungen (Text ohne Vault-Namen)
  function gedaechtnisWarnung(k) {
    try {
      const echtOrt = (p) => falte(echterOrt(p));
      const meins = echtOrt(k.ordner);
      for (const v of vaultListe()) {
        let cfg; try { cfg = JSON.parse(readFileSync(join(v.pfad, "brain.config.json"), "utf8")); } catch { continue; }
        const auto = istObj(cfg) && istObj(cfg.automatik) ? cfg.automatik : {};
        if (auto.gedaechtnisTeilen !== "an") continue;
        const liste = Array.isArray(auto.gedaechtnisKonten) ? auto.gedaechtnisKonten : ["~/.claude"];
        const h = home();
        if (liste.some((x) => typeof x === "string" && echtOrt(x === "~" ? h : x.startsWith("~/") ? join(h, x.slice(2)) : x) === meins)) {
          return ["Dieses Konto steht im Gedächtnis-Abgleich. Gedächtnisse von Projekten gesperrter Vaults werden ihm nicht mehr zugeteilt; was schon in diesem Konto liegt, bleibt dort (Kortex entfernt es nicht)."];
        }
      }
    } catch { /* keine Aussage */ }
    return [];
  }

  // Was für ein neu erkanntes Konto in diesem Vault gilt (gesperrt | lesen | posteingang) — „Standard für neue Konten“.
  function setzeStandard(e) {
    if (typeof e.vault !== "string") throw new HttpFehler(400, "Der Vault muss angegeben werden.");
    if (!["gesperrt", "lesen", "posteingang"].includes(e.stufe)) throw new HttpFehler(400, "Für neue Konten gilt gesperrt, lesen oder posteingang.");
    ladeOderSynchronisiere();
    const bekannt = vaultListe().find((v) => v.pfad === e.vault || falte(v.pfad) === falte(e.vault));
    if (!bekannt) throw new HttpFehler(404, "Diesen Vault kennt Kortex nicht (mehr).");
    let echt, kennung;
    try { echt = realpathSync.native(bekannt.pfad); kennung = kennungVon(echt); } catch { throw new HttpFehler(404, "Der Ordner dieses Vaults fehlt."); }
    aendere(support, (alt) => {
      if (!alt) throw new HttpFehler(500, "Die Liste der KI-Konten ist nicht verfügbar.");
      let t = vaultEintrag(alt, echt);
      if (!t || !t.eintrag) {
        entferneEintraege(alt, echt, kennung);
        const frisch = frischerEintrag(alt, echt, null, kennung);
        for (const id of Object.keys(frisch.konten)) frisch.konten[id] = "gesperrt";
        alt.vaults[echt] = frisch; t = { eintrag: frisch, schluessel: echt };
      }
      t.eintrag.neueKonten = e.stufe;
      return alt;
    });
    return stand();
  }

  // „Strenger Schutz“ (Sandbox von Claude Code) je Konto. Ändert, wie Claude Code ALLE Shell-Befehle dieses Profils ausführt — darum nur mit bestaetigt:true.
  function setzeSchutz(e) {
    if (typeof e.konto !== "string") throw new HttpFehler(400, "Das KI-Konto muss angegeben werden.");
    if (typeof e.sandbox !== "boolean") throw new HttpFehler(400, "„sandbox“ muss true oder false sein.");
    if (e.sandbox === true && e.bestaetigt !== true) throw new HttpFehler(400, "Der Strenge Schutz ändert, wie Claude Code Befehle ausführt. Kortex schaltet ihn nur nach deiner Bestätigung ein.", { art: "bestaetigung" });
    const d0 = ladeOderSynchronisiere();
    claudeOrdner(d0, e.konto); // 404/409 für Unbekanntes, Nicht-Claude
    if (e.sandbox === true && !gesperrteVaults(d0, e.konto).length) throw new HttpFehler(409, "Der Strenge Schutz schützt nur Vaults, die für dieses Konto gesperrt sind. Sperre zuerst einen Vault.", { art: "kein-gesperrter-vault" });
    const vorher = istObj(d0.schutz) && istObj(d0.schutz[e.konto]) ? d0.schutz[e.konto].sandbox === true : false;
    speichere((d) => {
      if (!istObj(d.schutz)) d.schutz = {};
      if (e.sandbox) d.schutz[e.konto] = { ...(istObj(d.schutz[e.konto]) ? d.schutz[e.konto] : {}), sandbox: true };
      else { delete d.schutz[e.konto]; if (!Object.keys(d.schutz).length) delete d.schutz; }
    });
    try { eineSicherung(() => strengerSchutz(e.konto)); }
    catch (err) {
      try { speichere((d) => { if (!istObj(d.schutz)) d.schutz = {}; if (vorher) d.schutz[e.konto] = { sandbox: true }; else { delete d.schutz[e.konto]; if (!Object.keys(d.schutz).length) delete d.schutz; } }); } catch { /* bleibt */ }
      throw err;
    }
    return stand();
  }

  // ───────────── Pflege-Konto je Vault ─────────────
  const vaultSchluessel = (pfad) => {
    const wunsch = (() => { try { return falte(realpathSync.native(pfad)); } catch { return null; } })();
    const bekannt = vaultListe().find((v) => v.pfad === pfad || falte(v.pfad) === falte(pfad) || (wunsch !== null && (() => { try { return falte(realpathSync.native(v.pfad)) === wunsch; } catch { return false; } })()));
    if (!bekannt) throw new HttpFehler(404, "Diesen Vault kennt Kortex nicht (mehr).");
    try { return realpathSync.native(bekannt.pfad); } catch { throw new HttpFehler(404, "Der Ordner dieses Vaults fehlt."); }
  };
  // POST /api/ki/pflege { vault, konto|null, stufe } — Nur Vaults und Konten aus den Listen; das Konto muss Claude Code sein und für diesen Vault „erweitert“ haben (sonst 409 art „stufe“ mit dem Weg dorthin).
  // Geprüft wird UNTER der Sperre der Liste (im Callback von aendere), nicht davor: zwischen Prüfung und Schreiben kann sonst eine Stufe sinken. nurWennUngesetzt (nur intern, Vorschlag des Assistenten):
  // schreibt nichts, wenn der Vault schon eine Einstellung hat.
  function setzePflege(e, { nurWennUngesetzt = false } = {}) {
    if (typeof e.vault !== "string") throw new HttpFehler(400, "Der Vault muss angegeben werden.");
    if (!PFLEGE_STUFEN.includes(e.stufe)) throw new HttpFehler(400, `Die Stufe muss eine von ${PFLEGE_STUFEN.join(", ")} sein.`);
    if (e.konto !== null && e.konto !== undefined && typeof e.konto !== "string") throw new HttpFehler(400, "Das KI-Konto muss eine Kennung oder leer sein.");
    ladeOderSynchronisiere();
    const echt = vaultSchluessel(e.vault);
    const konto = typeof e.konto === "string" ? e.konto : null;
    if (konto === null && e.stufe !== "aus") throw new HttpFehler(409, "Wähle ein KI-Konto für die Pflege oder stelle „Ohne KI“ ein.", { art: "kein-konto" });
    let geschrieben = true;
    aendere(support, (alt) => {
      if (!alt) throw new HttpFehler(500, "Die Liste der KI-Konten ist nicht verfügbar.");
      let ziel = null;
      if (konto !== null) {
        if (!Object.hasOwn(alt.konten, konto)) throw new HttpFehler(404, "Dieses KI-Konto gibt es nicht (mehr).");
        if (alt.konten[konto].programm !== "claude") { if (e.stufe !== "aus") throw new HttpFehler(409, "Die Pflege läuft über Claude Code. Wähle ein Claude-Code-Konto.", { art: "kein-claude" }); }
        else {
          if (e.stufe !== "aus" && !darfMindestens(stufeFuer(alt, echt, konto), "erweitert")) {
            throw new HttpFehler(409, "Dieses Konto darf den Vault noch nicht pflegen. Gib ihm unter „Wer darf diesen Vault sehen?“ die Stufe „Erweitert“, dann kannst du es hier wählen.", { art: "stufe" });
          }
          ziel = konto;
        }
      }
      const t = vaultEintrag(alt, echt);
      if (!t || !t.eintrag) throw new HttpFehler(404, "Dieser Vault ist in der Liste der KI-Konten noch nicht eingetragen. Öffne die KI-Konten einmal neu.");
      if (nurWennUngesetzt && t.eintrag.pflege !== undefined) { geschrieben = false; return null; }
      t.eintrag.pflege = { konto: ziel, stufe: e.stufe };
      // Wer die Pflege selbst einstellt, hat den Hinweis aus der Migration gesehen
      if (istObj(alt.pflegeMigration) && Array.isArray(alt.pflegeMigration.hinweise)) alt.pflegeMigration.hinweise = alt.pflegeMigration.hinweise.filter((h) => !(istObj(h) && h.vault === t.schluessel));
      return alt;
    });
    return nurWennUngesetzt ? { geschrieben } : stand();
  }

  // Migration: Die alte plist des Dienstes trug EIN festes CLAUDE_CONFIG_DIR für alle Vaults. Es wird das Pflege-Konto der Vaults, für die der Dienst eingeschaltet ist (dienst.json) und die noch keine
  // Pflege-Einstellung haben: hat das Konto „erweitert“, gilt Stufe „mittel“, sonst „ohne KI“ mit Hinweis. Ohne Variable in der plist lief der Dienst im Standardprofil → dessen Konto (nur beim ersten Mal,
  // solange es noch keinen Vermerk gibt: später heißt eine plist ohne Variable „neue Form“). Idempotent: je Vault nur, wenn noch nichts eingestellt ist; läuft bei jedem Start, solange die plist eine Variable trägt.
  // Der Vermerk `pflegeMigration` heißt „die Übernahme ist geschehen“; `plistOffen` bleibt wahr, bis die plist neu geschrieben ist (vermerkePlist) — vorher behält `dienst an` das feste Profil (kern/tageslauf/dienst.mjs).
  // profil: Pfad aus der plist | null · dienstVaults: Pfade aus dienst.json. → { gemacht, vaults, hinweise }
  function migrierePflege({ profil, dienstVaults }) {
    const aus = { gemacht: false, vaults: [], hinweise: [] };
    if (!lade()) return aus;
    aendere(support, (alt) => {
      if (!alt) return null;
      const vermerkt = istObj(alt.pflegeMigration);
      if (vermerkt && !profil) return null;                                  // neue Form der plist, nichts zu übernehmen
      const konten0 = Object.entries(alt.konten).filter(([, k]) => k.programm === "claude");
      const kontoId = profil ? (nachOrt(alt, "claude", profil) || null) : (konten0.find(([, k]) => k.standard === true) || [null])[0];
      const m = vermerkt ? alt.pflegeMigration : { seit: jetzt(), hinweise: [], plistOffen: !!profil };
      if (!Array.isArray(m.hinweise)) m.hinweise = [];
      for (const pfad of dienstVaults) {
        const t = vaultEintrag(alt, pfad);
        if (!t || !t.eintrag || t.eintrag.pflege !== undefined) continue;
        if (kontoId && darfMindestens(stufeFuer(alt, t.schluessel, kontoId), "erweitert")) t.eintrag.pflege = { konto: kontoId, stufe: "mittel" };
        else {
          t.eintrag.pflege = { konto: kontoId, stufe: "aus" };
          if (!m.hinweise.some((h) => h && h.vault === t.schluessel)) m.hinweise.push({ vault: t.schluessel, grund: kontoId ? "stufe" : "kein-konto", ...(kontoId ? { konto: kontoId } : {}) });
        }
        aus.vaults.push(t.schluessel);
      }
      aus.hinweise = m.hinweise;
      if (!vermerkt) { alt.pflegeMigration = m; aus.gemacht = true; }
      else if (aus.vaults.length) aus.gemacht = true;
      else return null;
      return alt;
    });
    return aus;
  }
  const migrationVermerkt = () => { const d = lade(); return !!(d && istObj(d.pflegeMigration)); };
  // Ob die plist des Dienstes noch ein festes Profil trägt (offen) und warum sie nicht neu geschrieben werden konnte (grund: kein-vault · nicht-im-dienst · kein-starter · unlesbar · fehler …).
  function vermerkePlist({ offen, grund = null }) {
    if (!lade()) return;
    aendere(support, (alt) => {
      if (!alt || !istObj(alt.pflegeMigration)) return null;
      const m = alt.pflegeMigration;
      if (offen) { if (m.plistOffen === true && m.plistGrund === grund) return null; m.plistOffen = true; if (grund) m.plistGrund = grund; else delete m.plistGrund; }
      else { if (m.plistOffen !== true && m.plistGrund === undefined) return null; m.plistOffen = false; delete m.plistGrund; }
      return alt;
    });
  }

  // ───────────── Konto hinzufügen, entfernen, Anmeldestand (Einstellungen → KI & Konten) ─────────────
  // „Konto hinzufügen“ legt einen NEUEN, eigenen Konfigurationsordner unter <Support>/ki-konten-ordner/<programm>-<kennung> an (CLAUDE_CONFIG_DIR bzw. CODEX_HOME zeigen später dorthin). Nie wird
  // ein Ordner im Home angelegt oder angefasst: `~/.claude` und `~/.codex` bleiben das „System-Standard“-Konto und werden nur als Ort referenziert. Die Anmeldung läuft im Programm selbst
  // (Terminal); Kortex liest nie Zugangsdaten. Entfernen verschiebt NUR einen von Kortex angelegten Ordner in den Papierkorb (nie ein Konto aus dem Home) — die Oberfläche fragt vorher.
  const ANLEGBAR = ["claude", "codex"];
  const wurzelVerwaltet = () => verwaltetWurzel(support);
  const ordnerKennzeichen = (name) => String(name).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "konto";
  const istVerwaltet = (k) => istVerwalteterOrdner(support, k.ordner, k.programm, { fehltOk: true }); // lstat der Wurzel und des Ordners, Name und Ort ohne Auflösen (profile.mjs)
  const supportErlaubt = () => !testmodus() || echtPfad(support).startsWith(echtPfad(tmpdir()) + sep);

  function legeKontoAn(e) {
    if (!ANLEGBAR.includes(e.programm)) throw new HttpFehler(400, "Ein weiteres Konto gibt es nur für Claude Code und Codex.");
    const name = pruefeName(e.name);
    const stufe = e.stufe === undefined ? "gesperrt" : e.stufe;
    if (!["gesperrt", "lesen"].includes(stufe)) throw new HttpFehler(400, "Ein neues Konto startet gesperrt oder mit „Lesen“.");
    if (!supportErlaubt()) throw new HttpFehler(409, "Im Testmodus legt Kortex Konto-Ordner nur unter dem Temp-Ordner an.", { art: "testmodus" });
    if (verwaltetWurzelZustand(support) === "link") throw new HttpFehler(409, "Der Ordner für die Konten von Kortex ist ein Verweis oder kein Ordner. Kortex legt darin nichts an. Entferne den Verweis „ki-konten-ordner“ im Ordner von Kortex und versuche es noch einmal.", { art: "wurzel-link" });
    ladeOderSynchronisiere();
    if (Object.values(lade().konten).some((k) => k.programm === e.programm && falte(k.name) === falte(name))) throw new HttpFehler(409, "Ein Konto mit diesem Namen gibt es schon. Wähle einen anderen Namen.", { art: "name-doppelt" });
    const wurzel = wurzelVerwaltet();
    const basis = `${e.programm}-${ordnerKennzeichen(name)}`;
    let ordner = join(wurzel, basis);
    for (let i = 2; existsSync(ordner) && i < 100; i++) ordner = join(wurzel, `${basis}-${i}`);
    if (existsSync(ordner)) throw new HttpFehler(409, "Der Ordner für dieses Konto gibt es schon. Wähle einen anderen Namen.", { art: "ordner-da" });
    try { mkdirSync(wurzel, { recursive: true, mode: 0o700 }); mkdirSync(ordner, { mode: 0o700 }); } catch { throw new HttpFehler(500, "Der Ordner für das neue Konto ließ sich nicht anlegen. Prüfe, ob Kortex in seinen Ordner schreiben darf, und versuche es noch einmal."); }
    const roh = echterOrt(ordner);
    const erkannt = [{ programm: e.programm, ordner: roh, standard: false, name, ordnerKennung: kennungVon(roh) }];
    let id = null;
    aendere(support, (alt) => {
      const daten = rechne(alt, { erkannt, vaults: vaultListe(), migration: false, streng: false });
      id = Object.entries(daten.konten).find(([, k]) => k.programm === e.programm && falte(k.ordner) === falte(roh))?.[0] || null;
      if (!id) throw new HttpFehler(500, "Das neue Konto ließ sich nicht eintragen.");
      daten.konten[id].name = name;
      if (stufe === "lesen") for (const v of Object.values(daten.vaults)) { if (!istObj(v.konten)) v.konten = {}; v.konten[id] = "lesen"; }
      return daten;
    });
    return { ...stand(), neuesKonto: { id, programm: e.programm, pfad: roh } };
  }

  // Papierkorb des Nutzers — nur der Rückfall für Browser und Entwicklung (Testmodus: nur im Home unter Temp). In der App legt Swift den Ordner über FileManager.trashItem in den Papierkorb
  // (so kann der Finder ihn „Zurücklegen“); diese Route wird dort gar nicht erreicht. Ein Ordner mit gleichem Namen im Papierkorb bekommt eine Zeit-Endung.
  const inDenPapierkorb = (ordner) => {
    const korb = join(home(), ".Trash");
    if (!homeErlaubt(home())) throw new HttpFehler(409, "Im Testmodus verschiebt Kortex nur im Temp-Ordner.", { art: "testmodus" });
    try { mkdirSync(korb, { recursive: true, mode: 0o700 }); } catch { /* existiert */ }
    const basis = ordner.split(sep).pop();
    let ziel = join(korb, basis);
    if (existsSync(ziel)) ziel = join(korb, `${basis} ${new Date().toISOString().replace(/[:.]/g, "-")}`);
    try { renameSync(ordner, ziel); } catch { throw new HttpFehler(502, "Der Ordner ließ sich nicht in den Papierkorb legen. Lege ihn im Finder selbst in den Papierkorb und klicke dann auf „Neu suchen“.", { art: "papierkorb" }); }
    return ziel;
  };
  const eigenesKonto = (e) => {
    if (typeof e.id !== "string") throw new HttpFehler(400, "Die Konto-Kennung fehlt.");
    const d0 = ladeOderSynchronisiere();
    const k = Object.hasOwn(d0.konten, e.id) ? d0.konten[e.id] : null;
    if (!k) throw new HttpFehler(404, "Dieses KI-Konto gibt es nicht (mehr).");
    if (k.standard === true || !ANLEGBAR.includes(k.programm) || !istVerwaltet(k)) throw new HttpFehler(409, "Dieses Konto hat Kortex nicht angelegt. Kortex entfernt nur eigene Konten; dessen Ordner bleibt, wo er ist.", { art: "nicht-verwaltet" });
    if (!supportErlaubt()) throw new HttpFehler(409, "Im Testmodus entfernt Kortex Konto-Ordner nur unter dem Temp-Ordner.", { art: "testmodus" });
    return k;
  };
  // POST /api/ki/ordner-papierkorb { id } — Rückfall (Browser): den Ordner eines EIGENEN Kontos in den Papierkorb legen. Geprüft wird wie in der App: echte Wurzel, Ordner direkt darin, Name passt zum Programm, kein Verweis.
  function papierkorbOrdner(e) {
    const k = eigenesKonto(e);
    if (!existsSync(k.ordner)) return { ok: true, papierkorb: false };
    inDenPapierkorb(k.ordner);
    return { ok: true, papierkorb: true };
  }

  // Entfernt das Konto aus der Liste. Der Ordner liegt dann schon im Papierkorb (Swift bzw. papierkorbOrdner): liegt er noch da, geht es nicht (kein stilles Löschen eines Ordners ohne Papierkorb).
  function entferneKonto(e) {
    const k = eigenesKonto(e);
    if (existsSync(k.ordner)) throw new HttpFehler(409, "Der Ordner dieses Kontos liegt noch im Ordner von Kortex. Lege ihn zuerst in den Papierkorb („Konto entfernen …“ tut das und entfernt dann das Konto).", { art: "ordner-da" });
    speichere((d) => {
      delete d.konten[e.id];
      for (const v of Object.values(d.vaults)) {
        if (istObj(v.konten)) delete v.konten[e.id];
        if (istObj(v.gesperrtNutzer)) { delete v.gesperrtNutzer[e.id]; if (!Object.keys(v.gesperrtNutzer).length) delete v.gesperrtNutzer; }
        if (istObj(v.pflege) && v.pflege.konto === e.id) v.pflege = { konto: null, stufe: "aus" };
      }
      for (const feld of ["schutz", "eingetragen"]) if (istObj(d[feld])) { delete d[feld][e.id]; if (!Object.keys(d[feld]).length) delete d[feld]; }
    });
    anmeldungSchreiben((a) => { delete a.konten[e.id]; });
    return { ...stand(), entfernt: { id: e.id } };
  }

  // Anmeldestand: Kortex liest nie Anmeldedaten. Die App fragt das Programm selbst („claude auth status“ / „codex login status“) und meldet nur das Ergebnis hierher. Die Werkstatt merkt sich,
  // WANN ein Konto zuletzt angemeldet war: war es das früher und ist es jetzt nicht mehr, heißt das „Anmeldung abgelaufen“ (ein Abmelden von Hand sieht gleich aus).
  const anmeldeDatei = () => join(support, "ki-anmeldung.json");
  function anmeldungLesen() {
    try { const j = JSON.parse(readFileSync(anmeldeDatei(), "utf8")); if (istObj(j) && istObj(j.konten)) return j; } catch { /* fehlt oder kaputt: leer anfangen */ }
    return { version: 1, konten: {} };
  }
  function anmeldungSchreiben(fn) {
    const a = anmeldungLesen();
    fn(a);
    const tmp = `${anmeldeDatei()}.tmp-${process.pid}`;
    try { writeFileSync(tmp, JSON.stringify(a), { mode: 0o600 }); renameSync(tmp, anmeldeDatei()); } catch { /* der Vermerk ist Beiwerk */ }
  }
  function anmeldung(e) {
    if (typeof e.konto !== "string") throw new HttpFehler(400, "Die Konto-Kennung fehlt.");
    if (!["angemeldet", "nicht-angemeldet", "unbekannt"].includes(e.zustand)) throw new HttpFehler(400, "Der Zustand muss angemeldet, nicht-angemeldet oder unbekannt sein.");
    const d = lade();
    if (!d || !Object.hasOwn(d.konten, e.konto)) throw new HttpFehler(404, "Dieses KI-Konto gibt es nicht (mehr).");
    if (e.zustand === "angemeldet") anmeldungSchreiben((a) => { a.konten[e.konto] = { zuletzt: jetzt() }; });
    const zuletzt = anmeldungLesen().konten[e.konto]?.zuletzt || null;
    return { zustand: e.zustand === "nicht-angemeldet" && zuletzt ? "abgelaufen" : e.zustand, zuletzt };
  }

  // Der Hinweis „Die Liste war beschädigt“ wurde gelesen.
  function quittiereHinweis() {
    ladeOderSynchronisiere();
    speichere((d) => { delete d.hinweis; });
    return stand();
  }
  // Die frühere Fassung der Liste zurückholen. Sie kann Sperren enthalten, die der Nutzer inzwischen gelockert hat, oder fehlen lassen, die er gesetzt hat: nur nach Bestätigung.
  function holeVorher(e) {
    if (e.bestaetigt !== true) throw new HttpFehler(400, "Das Zurückholen kann Sperren verändern. Kortex macht es nur nach deiner Bestätigung.", { art: "bestaetigung" });
    stelleVorherWiederHer(support);
    try { speichere((d) => { delete d.hinweis; }); } catch { /* der Hinweis bleibt */ }
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
    nachfuehren(); // ein neuer Vault ist für die meisten Konten gesperrt: bei eingeschaltetem Strengen Schutz gehört er sofort in die Pfade
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

  return { synchronisiere, altform: (id) => { const k = lade() && Object.hasOwn(lade().konten, id) ? lade().konten[id] : null; return k && homeErlaubt(home()) ? altformStandard(k, home()) : { mcp: false, hooks: false }; }, stand, setzeName, setzeZugriff, setzeStandard, setzePflege, migrierePflege, migrationVermerkt, vermerkePlist, setzeSchutz, legeKontoAn, entferneKonto, papierkorbOrdner, anmeldung, quittiereHinweis, holeVorher, vaultHinzu, kontoFuerProfil, kontoFuerProgramm, kontoDaten, probeKonto, lade };
}
