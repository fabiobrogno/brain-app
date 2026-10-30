// umstellung/tor.mjs — das Freigabe-Tor für Phase B (Paket P7d, Plan docs/plaene/p7-umstellung.md Abschnitt 4.1 und 6). Nur lesend (auch der Befund liest nur).
//
// Jede Bedingung: { id, titel, erfuellt, art: "automatisch" | "bestaetigung" | "probelauf", grund?, text, details? }. `grund` ist ein fester Kurztext, `text` ein Satz für Nicht-Techniker,
// `details` nur Zahlen und Kategorien – nie Werte, nie Namen von Macs. Das Tor ist offen (`frei`), wenn alle Bedingungen erfüllt sind.
//   phase-a        Phase A ist abgeschlossen, die Prüfung am Schluss (A9) war grün
//   release        diese Kortex-Version ist neuer als die, mit der Phase A lief („frühestens ein Release später“)
//   wartezeit      Phase A liegt mindestens 7 Tage zurück, ohne Fehler im Protokoll seitdem (Fehler eines abgebrochenen Aufräumens, Schritte B…/V…, zählen nicht: sonst gäbe es kein Weitermachen)
//   macs           alle bekannten Macs (Gerätemerker im Vault) haben Phase A hinter sich und laufen mit mindestens der nötigen Kortex-Version (NOETIGE_MAC_VERSION); kernVersion ist in den Einstellungen gesetzt
//   bestaetigung   der Nutzer bestätigt, dass kein anderer Mac den Vault noch mit den alten Werkzeugen nutzt (Macs ohne Merker sind Kit-Macs und unbekannt)
//   prozesse       aus dem alten Werkzeug-Ordner läuft nichts mehr (offene Claude-Sitzungen beenden)
//   restverweise   Restverweise auf den alten Ordner (Claude-Einstellungen, Plugins, Anweisungen, Vault-Dateien, Shell) sind behoben oder einzeln mit „Ist mir bewusst“ quittiert
//   befund         kein anderer Blocker des Befunds (Einstellungen defekt, Ordnernamen …)
//   probelauf      ein frischer, grüner Probelauf für Phase B an einer Kopie
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { kernVersion, liesConfigRoh } from "../pfade.mjs";
import { erstelleBefund } from "./befund.mjs";
import { liesZustand, liesProtokoll } from "./protokoll.mjs";
import { versionKleiner, geraeteId } from "./geraete.mjs";
import { probelaufBStand } from "./probelauf-b-merker.mjs";

export const WARTEZEIT_TAGE = 7;
// Kleinste Kortex-Version, die ein Mac für Phase B haben muss (seit ihr schreibt Phase A den Gerätemerker; ältere Stände kennen Phase B nicht). Ein Gerätemerker trägt die Version von Phase A auf
// diesem Mac – sie wird nicht nachgeführt, darum wird nicht gegen die Version von Phase A verglichen, sondern gegen diese feste Untergrenze (Tests können sie überschreiben).
export const NOETIGE_MAC_VERSION = "0.5.1";
export const RESTVERWEIS_IDS = ["E15", "E16", "E17", "E18", "E22", "E24"];
const istObjekt = (x) => x && typeof x === "object" && !Array.isArray(x);

// Zeit und Version von Phase A: neu aus zustand.phaseA, bei älteren Ständen aus Prüfung/Schritt A8
export function phaseAInfo(zustand) {
  if (zustand.phaseA && typeof zustand.phaseA.zeit === "string") return zustand.phaseA;
  const zeit = (zustand.a9 && zustand.a9.zeit) || (zustand.schritte && zustand.schritte.A8 && zustand.schritte.A8.zeit) || null;
  return zeit ? { zeit, kernVersion: zustand.kernVersion || null } : null;
}
// Hat Phase B schon etwas getan, ohne fertig zu sein (Absturz, Abbruch, ein Schritt schlug fehl)? Dann geht es mit „Weitermachen“ weiter, ohne neuen Probelauf: der Probelauf-Stand ist
// durch die ersten Schritte ohnehin überholt (der alte Ordner ist schon im Archiv). Alle anderen Bedingungen gelten weiter.
export function phaseBBegonnen(zustand) {
  if (zustand.phaseB) return false;
  return ["B1", "B2", "B3"].some((id) => zustand.schritte && zustand.schritte[id] && ["ok", "laeuft"].includes(zustand.schritte[id].status));
}
export function liesGeraete(vault) {
  const aus = [];
  let namen = [];
  try { namen = readdirSync(join(vault, ".kortex", "geraete")).filter((n) => /\.json$/.test(n)).sort(); } catch { return aus; }
  for (const n of namen) {
    const id = n.replace(/\.json$/, "");
    try {
      const j = JSON.parse(readFileSync(join(vault, ".kortex", "geraete", n), "utf8"));
      if (istObjekt(j)) aus.push({ id, phaseA: typeof j.phaseA === "string" ? j.phaseA : null, phaseB: typeof j.phaseB === "string" ? j.phaseB : null, kortexVersion: typeof j.kortexVersion === "string" ? j.kortexVersion : null });
    } catch { aus.push({ id, phaseA: null, phaseB: null, kortexVersion: null, defekt: true }); }
  }
  return aus;
}

export function pruefeTor(z, { entscheidungen = {}, jetzt = Date.now(), befund = null, noetigeVersion = NOETIGE_MAC_VERSION } = {}) {
  const zustand = liesZustand(z);
  const info = phaseAInfo(zustand);
  const aktuell = kernVersion();
  const b = [];
  const add = (id, titel, erfuellt, art, text, grund, details) => b.push({ id, titel, erfuellt: !!erfuellt, art, ...(erfuellt ? {} : { grund }), text, ...(details ? { details } : {}) });

  // 1 Phase A
  const aOk = zustand.phase === "A" && !!info;
  const a9Gruen = !!zustand.a9 && zustand.a9.ampel === "gruen";
  add("phase-a", "Die Umstellung (Phase A) ist abgeschlossen", aOk && a9Gruen, "automatisch",
    aOk && a9Gruen ? "Phase A ist durch, die Prüfung am Schluss war in Ordnung." : !aOk ? "Phase A ist noch nicht abgeschlossen. Stelle zuerst um." : "Die Prüfung am Ende von Phase A war nicht in Ordnung.",
    !aOk ? "nicht-umgestellt" : "pruefung-rot");

  // 2 Release
  const neuer = !!info && !!info.kernVersion && versionKleiner(info.kernVersion, aktuell);
  add("release", "Mindestens ein Kortex-Update seit der Umstellung", neuer, "automatisch",
    neuer ? "Seit der Umstellung gab es ein Kortex-Update." : "Das Aufräumen gibt es frühestens mit dem nächsten Kortex-Update nach der Umstellung.", info && info.kernVersion ? "gleiche-version" : "version-unbekannt");

  // 3 Wartezeit
  const seit = info ? Date.parse(info.zeit) : NaN;
  const tage = Number.isFinite(seit) ? (jetzt - seit) / 86_400_000 : 0;
  const fehler = Number.isFinite(seit) ? liesProtokoll(z).filter((e) => e.lauf === "original" && e.ereignis === "fehler" && !/^[BV]/.test(String(e.schritt || "")) && Date.parse(e.zeit) >= seit).length : 0;
  const lang = tage >= WARTEZEIT_TAGE;
  add("wartezeit", `Seit der Umstellung sind mindestens ${WARTEZEIT_TAGE} Tage vergangen`, lang && fehler === 0, "automatisch",
    !lang ? `Kortex wartet ${WARTEZEIT_TAGE} Tage nach der Umstellung, damit sich Probleme zeigen können (noch ${Math.max(1, Math.ceil(WARTEZEIT_TAGE - tage))} Tage).` : fehler ? "Seit der Umstellung ist im Protokoll ein Fehler aufgetaucht. Schau ins Protokoll." : "Die Wartezeit ist um, ohne Fehler im Protokoll.",
    !lang ? "zu-frueh" : "fehler-im-protokoll", { tage: Math.floor(tage), noch: Math.max(0, Math.ceil(WARTEZEIT_TAGE - tage)), fehler });

  // 4 Macs
  const geraete = liesGeraete(z.vault);
  const roh = liesConfigRoh(z.vault);
  const kv = roh.cfg && typeof roh.cfg.kernVersion === "string" ? roh.cfg.kernVersion : null;
  const ohnePhaseA = geraete.filter((g) => !g.phaseA).length;
  const zuAlt = geraete.filter((g) => g.phaseA && (!g.kortexVersion || versionKleiner(g.kortexVersion, noetigeVersion))).length;
  // dieser Mac muss selbst einen Gerätemerker haben (sonst weiß der Vault nichts von ihm, und die Prüfung der anderen sagt nichts)
  const eigene = geraeteId(z, { anlegen: false });
  const dieserOhne = !(eigene && geraete.some((g) => g.id === eigene));
  const macsOk = !roh.fehler && !!kv && !dieserOhne && ohnePhaseA === 0 && zuAlt === 0;
  add("macs", "Alle bekannten Macs sind umgestellt", macsOk, "automatisch",
    macsOk ? `${geraete.length === 1 ? "Der einzige bekannte Mac ist" : `Alle ${geraete.length} bekannten Macs sind`} umgestellt.`
      : roh.fehler ? "Die Einstellungsdatei des Vaults ist beschädigt."
      : !kv ? "In den Einstellungen des Vaults fehlt der Vermerk der Kortex-Version (kernVersion). Stelle Phase A noch einmal fertig."
      : dieserOhne ? "Für diesen Mac gibt es im Vault noch keinen Vermerk. Stelle Phase A hier noch einmal fertig."
      : ohnePhaseA ? `Auf ${ohnePhaseA === 1 ? "einem Mac" : ohnePhaseA + " Macs"} ist die Umstellung noch nicht abgeschlossen. Öffne Kortex dort, stelle um und gleiche den Vault ab.`
      : `Auf ${zuAlt === 1 ? "einem Mac" : zuAlt + " Macs"} ist Kortex älter, oder der Vermerk im Vault ist veraltet. Öffne Kortex dort einmal in der aktuellen Version (der Vermerk wird beim Start erneuert) und gleiche den Vault ab.`,
    roh.fehler ? "config-defekt" : !kv ? "kernversion-fehlt" : dieserOhne ? "dieser-mac-ohne-merker" : ohnePhaseA ? "geraet-ohne-phase-a" : "geraet-zu-alt", { macs: geraete.length, ohnePhaseA, zuAlt });

  // 5 Bestätigung
  const bestaetigt = entscheidungen.keineAltenMacs === true;
  add("bestaetigung", "Auf keinem anderen Mac läuft der Vault noch mit den alten Werkzeugen", bestaetigt, "bestaetigung",
    bestaetigt ? "Bestätigt: kein anderer Mac nutzt noch den alten Werkzeug-Ordner." : "Bestätige bitte: Auf keinem anderen Mac läuft dieser Vault noch mit den alten Werkzeugen. Sonst bricht dort Claude Code, und die Passwort-Prüfung vor dem Speichern fehlt.",
    "nicht-bestaetigt");

  // 6–8 aus dem Befund
  const bf = befund || erstelleBefund({ vault: z.vault, home: z.home, support: z.support, claudeHomes: null });
  const prozesse = bf.funde.find((f) => f.id === "E3");
  const unklar = !!(prozesse && prozesse.details && prozesse.details.unklar);
  add("prozesse", "Aus dem alten Werkzeug-Ordner läuft nichts mehr", !prozesse, "automatisch",
    !prozesse ? "Es laufen keine Programme aus dem alten Werkzeug-Ordner (geprüft nach dem Pfad in der Befehlszeile und, wo möglich, nach geöffneten Dateien; ein Programm, das den Ordner nur auf anderem Weg erreicht, erkennt Kortex nicht – beende im Zweifel offene Claude-Sitzungen)."
      : unklar ? prozesse.text
      : `Es laufen noch ${prozesse.anzahl} ${prozesse.anzahl === 1 ? "Programm" : "Programme"} aus dem alten Werkzeug-Ordner. Beende offene Claude-Sitzungen und versuche es noch einmal.`,
    unklar ? "konnte-nicht-pruefen" : "laufende-prozesse", prozesse && !unklar ? { anzahl: prozesse.anzahl } : undefined);
  const bewusst = new Set(Array.isArray(entscheidungen.bewusst) ? entscheidungen.bewusst : []);
  const rest = [];
  for (const f of bf.funde) {
    if (!RESTVERWEIS_IDS.includes(f.id) || f.schwere === "auto") continue;
    const e = rest.find((r) => r.id === f.id);
    if (e) e.anzahl += f.anzahl; else rest.push({ id: f.id, kategorie: f.kategorie, anzahl: f.anzahl, text: f.text });
  }
  const offen = rest.filter((r) => !bewusst.has(r.id));
  add("restverweise", "Verweise auf den alten Ordner sind behoben oder bewusst gelassen", offen.length === 0, "bestaetigung",
    offen.length === 0 ? (rest.length ? "Alle gemeldeten Verweise sind quittiert." : "Es gibt keine Verweise auf den alten Ordner.")
      : `${offen.length} ${offen.length === 1 ? "Verweis zeigt" : "Verweise zeigen"} noch auf den alten Ordner und ${offen.length === 1 ? "würde" : "würden"} danach nicht mehr funktionieren. Behebe ${offen.length === 1 ? "ihn" : "sie"} oder bestätige „Ist mir bewusst“.`,
    "offen", { liste: rest.map((r) => ({ id: r.id, kategorie: r.kategorie, anzahl: r.anzahl, text: r.text, quittiert: bewusst.has(r.id) })) });
  const blocker = bf.funde.filter((f) => f.schwere === "blocker" && f.id !== "E3");
  add("befund", "Die Einstellungen des Vaults sind in Ordnung", blocker.length === 0, "automatisch",
    blocker.length === 0 ? "Der Befund meldet nichts, was das Aufräumen verhindert." : "Der Befund meldet etwas, das zuerst behoben werden muss (siehe Befund).", "blocker", blocker.length ? { ids: blocker.map((f) => f.id) } : undefined);

  // 9 Probelauf
  const begonnen = phaseBBegonnen(zustand);
  const p = begonnen ? { gueltig: true, begonnen: true } : probelaufBStand(z, jetzt);
  add("probelauf", "Ein frischer Probelauf an einer Kopie war in Ordnung", p.gueltig, "probelauf",
    p.begonnen ? "Das Aufräumen hat schon begonnen und wird fortgesetzt; ein neuer Probelauf ist nicht nötig."
      : p.gueltig ? "Der Probelauf an einer Kopie war in Ordnung."
      : p.grund === "fehlt" ? "Kortex probiert das Aufräumen zuerst an einer Kopie aus. Starte den Probelauf."
      : p.grund === "rot" ? "Der Probelauf war nicht in Ordnung. Am Original wurde nichts geändert."
      : p.grund === "veraltet" ? "Seit dem Probelauf hat sich etwas geändert. Starte ihn bitte noch einmal." : "Der Probelauf ist älter als ein Tag. Starte ihn bitte noch einmal.",
    p.grund || "fehlt");
  return { frei: b.every((x) => x.erfuellt), bedingungen: b, offen: b.filter((x) => !x.erfuellt).map((x) => x.id), probelauf: p };
}
