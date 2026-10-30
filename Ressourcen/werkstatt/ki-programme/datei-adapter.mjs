// werkstatt/ki-programme/datei-adapter.mjs — EIN Baustein für alle KI-Programme, die MCP-Server in einer JSON-Datei (auch JSONC) führen
// (Cursor, Claude Desktop, Windsurf, VS Code, Zed …). Ein Programm ist nur eine Beschreibung (programme.mjs); hier steht das Verhalten:
//   verbinde(ctx, e)    Eintrag „brain“ additiv eintragen. Vorher Sicherung (nur letzte 3), danach atomar (Temp-Datei + rename), Rechte der
//                       Datei bleiben, ein Symlink bleibt ein Symlink (geschrieben wird beim echten Ziel), fremde Einträge, Kommentare und
//                       Einrückung bleiben stehen. Eine kaputte oder anders geformte Datei wird NIE überschrieben (422, Text zum Kopieren).
//   trenne(ctx)         nur den eigenen Eintrag „brain“ herausnehmen (gleiche Absicherung); ein fremder Eintrag bleibt (409).
//   konfiguration(ctx)  der Eintrag im Format des Programms zum Kopieren. Liest nur.
// ctx = { home, a: [node, mcp.mjs] | null, art(command, args) → "gleich"|"alt"|"anders", ordner?: <Konfig-Ordner statt Standardort> }.
// `ordner` ist für spätere Profile gedacht (mehrere Konfig-Ordner je Programm); ohne Angabe gilt der Standardort des Programms.
// Vergleich NUR intern: Command/Args eines vorhandenen Eintrags stehen nie in einer Antwort (fremde Einträge können Zugangsdaten enthalten).
import { readFileSync, realpathSync, statSync, writeFileSync, copyFileSync, mkdirSync, renameSync, readdirSync, rmSync, chmodSync, constants as fsKonst } from "node:fs";
import { dirname, basename, join } from "node:path";
import { HttpFehler } from "../../gemeinsam/vault.mjs";
import { parseJsonc, setzeEigenschaft, entferneEigenschaft } from "./jsonc.mjs";

const istObjekt = (x) => !!x && typeof x === "object" && !Array.isArray(x);

// Wert unter Pfad (["a","b"]) oder undefined; null, wenn ein Zwischenwert kein Objekt ist (falsche Form).
function holeAm(doc, pfad) {
  let n = doc;
  for (const p of pfad) {
    if (n === undefined) return undefined;
    if (!istObjekt(n)) return null;
    n = n[p];
  }
  return n;
}

// Die Datei ist brauchbar: leer/neu, oder ein Objekt, in dem jede Ebene des Pfads (falls vorhanden) wieder ein Objekt ist.
function formOk(doc, pfad) {
  if (!istObjekt(doc)) return false;
  let n = doc;
  for (const p of pfad) {
    if (n[p] === undefined) return true;
    if (!istObjekt(n[p])) return false;
    n = n[p];
  }
  return true;
}

// Sicherung neben der Datei (mit den Rechten des Originals, nie eine vorhandene überschreiben); nur die letzten 3 bleiben, sie enthalten fremde Tokens.
export function sichereDatei(datei, ziel, modus) {
  const ordner = dirname(datei);
  const stamm = `${datei}.brain-sicherung-`, zeit = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  let sicherung = null;
  for (let i = 1; i <= 50 && !sicherung; i++) {
    const name = `${stamm}${zeit}${i > 1 ? `-${i}` : ""}`;
    try { copyFileSync(ziel, name, fsKonst.COPYFILE_EXCL); sicherung = name; } catch (err) { if (!err || err.code !== "EEXIST") throw err; }
  }
  if (!sicherung) throw Object.assign(new Error("Sicherung"), { code: "EEXIST" });
  chmodSync(sicherung, modus);
  try {
    const praefix = basename(stamm);
    const alle = readdirSync(ordner).filter((n) => n.startsWith(praefix)).sort();
    for (const n of alle.slice(0, Math.max(0, alle.length - 3))) try { rmSync(join(ordner, n), { force: true }); } catch { /* egal */ }
  } catch { /* Aufräumen ist nicht kritisch */ }
  return sicherung;
}

// Schreibt `text` atomar an `ziel` (Temp-Datei daneben, dann rename) mit den Rechten `modus`. Räumt die Temp-Datei bei jedem Fehler weg.
function schreibeAtomar(ziel, text, modus) {
  const tmp = `${ziel}.brain-neu`;
  try {
    writeFileSync(tmp, text, { mode: modus });
    chmodSync(tmp, modus); // umask darf die Rechte nicht verändern
    renameSync(tmp, ziel);
  } finally { try { rmSync(tmp, { force: true }); } catch { /* egal */ } }
}

export function erzeugeDateiAdapter(def) {
  const { id, name, anzeige } = def;
  const pfad = def.pfad; // Schlüsselpfad des Server-Verzeichnisses, z. B. ["mcpServers"]
  const dateiVon = (ctx) => def.datei({ home: ctx.home, ordner: ctx.ordner });
  const text = (a) => JSON.stringify(nestle(pfad, def.baue(a)), null, 2);
  const konfiguration = (ctx) => (ctx.a ? text(ctx.a) : null);

  // Liest die Datei. → { vorhanden, roh, doc } | wirft HttpFehler (kaputt / unlesbar); `befehl` nur beim Verbinden (Text zum Kopieren).
  function lies(datei, befehl, ohneBefehl) {
    const zusatz = ohneBefehl ? {} : { befehl };
    let roh;
    try { roh = readFileSync(datei, "utf8"); } catch (err) {
      if (err && err.code === "ENOENT") return { vorhanden: false, roh: "", doc: {} };
      throw new HttpFehler(502, ohneBefehl ? `Die Datei ${anzeige} ließ sich nicht lesen. Entferne den Eintrag „brain“ dort von Hand.` : `Die Datei ${anzeige} ließ sich nicht lesen. Ergänze den Eintrag von Hand:`, zusatz);
    }
    if (!roh.trim()) return { vorhanden: true, roh, doc: {} }; // leere Datei zählt wie neu
    let doc = null;
    try { doc = parseJsonc(roh); } catch { doc = null; }
    if (!formOk(doc, pfad)) {
      throw new HttpFehler(422, ohneBefehl
        ? `Die Datei ${anzeige} ist kein gültiges JSON in der erwarteten Form. Kortex ändert sie deshalb nicht. Entferne den Eintrag „brain“ dort von Hand.`
        : `Die Datei ${anzeige} ist kein gültiges JSON in der erwarteten Form. Kortex Studio ändert sie deshalb nicht. Ergänze den Eintrag von Hand:`, { art: "kaputt", ...zusatz });
    }
    return { vorhanden: true, roh, doc };
  }

  const vergleiche = (ctx, alt) => {
    const gelesen = alt && typeof alt === "object" ? def.lies(alt) : null;
    return gelesen ? ctx.art(gelesen.command, gelesen.args) : "anders";
  };

  function verbinde(ctx, e = {}) {
    const eintrag = ctx.a ? def.baue(ctx.a) : null, befehl = konfiguration(ctx);
    if (!eintrag) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.", { befehl: null });
    const datei = dateiVon(ctx), ordner = dirname(datei);
    const { vorhanden, roh, doc } = lies(datei, befehl, false);
    const alt = holeAm(doc, pfad) && holeAm(doc, pfad).brain;
    if (alt !== undefined) {
      const v = vergleiche(ctx, alt);
      if (v === "gleich") return { ok: true, schonVerbunden: true };
      if (v !== "alt" && e.umstellen !== true) throw new HttpFehler(409, `Bei ${name} ist unter dem Namen „brain“ schon ein anderer Server eingetragen. Möchtest du ihn auf Kortex Studio umstellen?`, { art: "anders", befehl });
    }
    try {
      let sicherung = null, modus = 0o600; // neue Datei: nur für den Nutzer lesbar (andere MCP-Server tragen oft Tokens ein)
      let ziel = datei; // ein Symlink (Dotfiles) bleibt ein Symlink: geschrieben wird beim echten Ziel
      let neu;
      if (vorhanden) {
        try { ziel = realpathSync(datei); } catch { /* bleibt datei */ }
        modus = statSync(ziel).mode & 0o777;
        if (!roh.trim()) neu = JSON.stringify(nestle(pfad, eintrag), null, 2) + "\n";
        else try { neu = setzeEigenschaft(roh, pfad, "brain", eintrag); } catch {
          throw new HttpFehler(422, `Die Datei ${anzeige} lässt sich nicht sicher ändern. Kortex Studio ändert sie deshalb nicht. Ergänze den Eintrag von Hand:`, { art: "kaputt", befehl });
        }
        sicherung = sichereDatei(datei, ziel, modus);
      } else {
        mkdirSync(ordner, { recursive: true });
        neu = JSON.stringify(nestle(pfad, eintrag), null, 2) + "\n";
      }
      schreibeAtomar(ziel, neu, modus);
      return { ok: true, ...(sicherung ? { sicherung } : {}) };
    } catch (err) {
      if (err instanceof HttpFehler) throw err;
      throw new HttpFehler(502, `${name} ließ sich nicht einrichten (Fehler ${err && err.code ? err.code : "unbekannt"} bei ${anzeige}). Ergänze den Eintrag von Hand:`, { befehl });
    }
  }

  function trenne(ctx) {
    if (!ctx.a) throw new HttpFehler(404, "Der MCP-Server wurde nicht gefunden.");
    const datei = dateiVon(ctx);
    const { vorhanden, roh, doc } = lies(datei, null, true);
    if (!vorhanden || !roh.trim()) return { ok: true, warNichtVerbunden: true };
    const verz = holeAm(doc, pfad);
    const alt = verz && verz.brain;
    if (alt === undefined) return { ok: true, warNichtVerbunden: true };
    if (vergleiche(ctx, alt) === "anders") throw new HttpFehler(409, `Bei ${name} steht unter dem Namen „brain“ ein anderer Eintrag, nicht der von Kortex. Kortex lässt ihn stehen.`, { art: "anders" });
    try {
      let ziel = datei;
      try { ziel = realpathSync(datei); } catch { /* bleibt datei */ }
      const modus = statSync(ziel).mode & 0o777;
      let neu;
      try { neu = entferneEigenschaft(roh, pfad, "brain"); } catch {
        throw new HttpFehler(422, `Die Datei ${anzeige} lässt sich nicht sicher ändern. Kortex ändert sie deshalb nicht. Entferne den Eintrag „brain“ dort von Hand.`, { art: "kaputt" });
      }
      const sicherung = sichereDatei(datei, ziel, modus);
      schreibeAtomar(ziel, neu, modus);
      return { ok: true, sicherung };
    } catch (err) {
      if (err instanceof HttpFehler) throw err;
      throw new HttpFehler(502, `${name} ließ sich nicht trennen (Fehler ${err && err.code ? err.code : "unbekannt"} bei ${anzeige}). Entferne den Eintrag „brain“ dort von Hand.`);
    }
  }

  return { id, name, anzeige, art: "datei", def, verbinde, trenne, konfiguration, datei: dateiVon };
}

function nestle(pfad, eintrag) {
  let wert = { brain: eintrag };
  for (let k = pfad.length - 1; k >= 0; k--) wert = { [pfad[k]]: wert };
  return wert;
}
