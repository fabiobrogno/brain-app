// electron/aktionen.mjs — die Electron-Hülle setzt den Hüllen-Vertrag um (Ressourcen/studio/huellen-vertrag.json, Feld `electron`): jede Aktion des Vertrags hat hier einen Eintrag.
// Reine Logik OHNE `import "electron"`: alles, was das System anfasst (Dateimanager, Browser, Zwischenablage, Dialog, Mitteilung, Fenster), kommt über `abh` hinein —
// so prüft Tests/Node/electron-huelle.test.mjs die Werte-Prüfung und die Antworten ohne Electron. Die Prüfung der Werte entspricht AppAktion.pruefe (Swift): bekannte Aktionen,
// Pfade nur im Vault, extern nur https, Texte einzeilig und gekürzt. Ungültiger Wert → { ok:false, grund:"ungueltig" } (nie ein Fehler, nie eine Wirkung).
import { realpathSync, existsSync } from "node:fs";
import { join, dirname, basename, sep, isAbsolute } from "node:path";
import { externPruefen } from "./navigation.mjs";

const OK = Object.freeze({ ok: true });
const nein = (grund) => ({ ok: false, grund });
const UNGUELTIG = () => nein("ungueltig");

// Nur bei offener Einrichtung (wie EinrichtungsOverlay.nurAusEinrichtung in Swift; der Vertragstest vergleicht diese Liste)
export const NUR_EINRICHTUNG = ["git-pruefen", "git-installieren", "kopieren", "einrichtung-ende", "einrichtung-schritt"];
export const SCHRITTE = ["vault", "ki", "sicherung"];
const EINSTIEGE = ["vault", "sicherung", "ki"];
const WEGE = ["neu", "beispiel", "oeffnen", "klonen"];
// Endungen, die „anhang-oeffnen“ öffnet: dieselbe Liste wie ANHANG_TYPEN in gemeinsam/anhang-regeln.mjs (der Vertragstest vergleicht sie; hier ohne Import, die Hülle lädt nichts aus Ressourcen/)
export const ANHANG_ENDUNGEN = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "txt", "csv", "rtf", "zip", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "mp3", "m4a", "wav", "mp4", "mov", "webm"]);
const DARSTELLUNGEN = { hell: "light", dunkel: "dark", system: "system" };
const APP_SYMBOLE = ["standard", "dunkel", "graphit", "papier", "smaragd"];
export const MAX_TITEL = 120, MAX_HINWEIS = 200, MAX_FEHLERTEXT = 300, MAX_FEHLERORT = 120, MAX_KOPIEREN = 400, MAX_FEHLER_JE_FENSTER = 20;
// Aktionen, die auf Dialoge, Dateisystem oder Prozesse warten: die Seite bekommt ein Versprechen. Alle anderen antworten sofort (das Preload nimmt dafür den synchronen Weg,
// damit `aktion("extern", …)` wie in der App gleich meldet, ob die Aktion angenommen wurde).
export const ASYNCHRON = ["ordner-waehlen", "ordner-zeigen", "anhang-oeffnen", "git-pruefen", "git-installieren", "mitteilung-probe"];

// Wo die Einrichtung einsteigt (wie EinrichtungsOverlay.einstieg in Swift): ein verlangter Einstieg gilt immer; mit gewähltem Weg oder ohne Vault beginnt die Seite beim Vault (kein `ab`);
// sonst macht sie nach dem zuletzt erledigten Schritt weiter: nach „ki“ bei der Sicherung, sonst (auch nach „sicherung“ = alles erledigt) bei der KI.
export function einstieg({ ab, weg, vaultDa, letzterSchritt }) {
  if (ab) return ab;
  if (weg || !vaultDa) return null;
  return letzterSchritt === "ki" ? "sicherung" : "ki";
}

// Text für Fenster und Dialoge: Steuer- und Zeilentrennzeichen werden zu Leerzeichen, Formatzeichen (u. a. Rechts-nach-links-Umschalter) entfallen, Ränder weg, auf `max` Zeichen gekürzt. Leer → null.
export function einzeilig(text, max) {
  const s = String(text).replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ").replace(/\p{Cf}/gu, "").trim();
  const k = Array.from(s).slice(0, max).join("").trim();
  return k || null;
}
// Ort einer Meldung: bis zum ersten Leerzeichen, `?` oder `#` (Notiztitel gehören nicht ins Protokoll)
export function fehlerOrt(text) {
  const e = einzeilig(text, MAX_FEHLERORT);
  const ort = e ? e.split(/[ ?#]/)[0] : "";
  return ort || null;
}
// Text für die Zwischenablage: 1…400 Zeichen, einzeilig und nur druckbar; es wird nichts bereinigt, sondern abgelehnt.
export function kopierenText(wert) {
  if (typeof wert !== "string" || !wert || Array.from(wert).length > MAX_KOPIEREN || !wert.trim()) return null;
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Co}\p{Cn}]/u.test(wert) ? null : wert;
}

// Symlinks auflösen, auch wenn der Pfad (noch) fehlt: der tiefste vorhandene Ordner wird aufgelöst, der Rest angehängt.
function aufgeloest(pfad) {
  const rest = [];
  let p = pfad;
  while (!existsSync(p)) { const d = dirname(p); if (d === p) break; rest.unshift(basename(p)); p = d; }
  let r; try { r = realpathSync.native(p); } catch { r = p; }
  return join(r, ...rest);
}
// Relativer Pfad → absoluter Pfad im Vault, sonst null. Kein absoluter Pfad, kein `..`, kein NUL; nach dem Auflösen der Verknüpfungen muss das Ziel im (aufgelösten) Vault liegen.
export function ortImVault(relativ, vault, { plattform = process.platform } = {}) {
  if (typeof relativ !== "string" || !relativ || relativ.includes("\0") || relativ.startsWith("/") || relativ.startsWith("\\") || /^[A-Za-z]:/.test(relativ)) return null;
  if (typeof vault !== "string" || !isAbsolute(vault)) return null;
  const teile = relativ.split(/[\\/]/).filter(Boolean);
  if (!teile.length || teile.includes("..")) return null;
  const wurzel = aufgeloest(vault);
  const ziel = aufgeloest(join(vault, ...teile));
  const f = (p) => (plattform === "win32" ? p.toLowerCase() : p);
  return f(ziel).startsWith(f(wurzel.endsWith(sep) ? wurzel : wurzel + sep)) ? ziel : null;
}

/**
 * abh: { support, vaultPfad(): Promise<string|null>, openExternal(url), showItemInFolder(pfad), oeffneDatei(pfad) → Fehlertext oder "" (shell.openPath), schreibeZwischenablage(text), waehleOrdner({titel, vorschlag}): Promise<string|null>,
 *        mitteilung({probe: true}): boolean, darstellung(themeSource), fensterTitel(text|null), fensterZoom(), befehlAnStudio(name, wert), protokoll(zeile),
 *        W2b (alle optional): statusAuffrischen(), kuerzel: { pruefeGlobal(id, text|null), neuLesen() }, appSymbol(name) → boolean, fensterGlas(an) → null | wirkt:boolean,
 *        einrichtung: { lese(support), schreibe(support, o) }, ordner: { pruefeOrdner(pfad) }, git: { pruefen(), hinweis() }, plattform? }
 * → { namen, aktion(name, wert) → Antwort | Promise<Antwort>, seiteNeu(), zustand() }
 */
export function erzeugeAktionen(abh) {
  let einrichtungOffen = false, einrichtungAngefordert = false;
  let fehlerZaehler = 0;
  const plattform = abh.plattform || process.platform;

  const AKTIONEN = new Map(Object.entries({
    "ansicht": () => nein("kein-kit"),
    "ordner-zeigen": async (w) => {
      const vault = await abh.vaultPfad();
      const ort = vault ? ortImVault(w, vault, { plattform }) : null;
      if (!ort) return UNGUELTIG();
      abh.protokoll("aktion ordner-zeigen");
      abh.showItemInFolder(ort);
      return OK;
    },
    // Anhang mit dem Programm des Systems öffnen (Chip in der Notiz): nur Endungen der Anhang-Liste, nur im Vault, nie Ausführbares
    "anhang-oeffnen": async (w) => {
      const vault = await abh.vaultPfad();
      const ort = vault && typeof w === "string" && ANHANG_ENDUNGEN.has((/\.([A-Za-z0-9]{1,8})$/.exec(w) || [, ""])[1].toLowerCase()) ? ortImVault(w, vault, { plattform }) : null;
      if (!ort) return UNGUELTIG();
      if (!existsSync(ort)) return nein("fehlt");
      abh.protokoll("aktion anhang-oeffnen");
      try { return (await abh.oeffneDatei(ort)) ? nein("nicht-verfuegbar") : OK; } catch { return nein("nicht-verfuegbar"); }
    },
    "extern": (w) => {
      const r = externPruefen(w, { nurHttps: true, einrichtungOffen });
      if (!r.ok) { abh.protokoll(einrichtungOffen ? "aktion extern abgelehnt einrichtung" : "aktion extern abgelehnt"); return nein(r.grund); }
      abh.protokoll("aktion extern");
      abh.openExternal(r.url);
      return OK;
    },
    "ordner-waehlen": async (w) => {
      if (w !== undefined && w !== null && (typeof w !== "object" || Array.isArray(w))) return UNGUELTIG();
      const titel = typeof w?.titel === "string" ? einzeilig(w.titel, MAX_HINWEIS) : null;
      const vorschlag = typeof w?.vorschlag === "string" && isAbsolute(w.vorschlag) && !w.vorschlag.includes("\0") ? w.vorschlag : null;
      abh.protokoll("aktion ordner-waehlen");
      const pfad = await abh.waehleOrdner({ titel, vorschlag });
      if (!pfad) return null; // Abbruch
      const r = abh.ordner.pruefeOrdner(pfad);
      if (!r || r.ok !== true) return null;
      const { ok: _ok, ...antwort } = r; // wie OrdnerWahlAntwort in Swift: { pfad, breit?, notizen, ordner, mehr? }
      return antwort;
    },
    // Vault, Vertrauen oder Zähler haben sich geändert: Menü und Tray lesen den Stand neu (gebündelt, wie StatusAuffrischung in Swift)
    "vault-gewechselt": () => { abh.statusAuffrischen?.(); return OK; },
    "vertrauen-geaendert": () => { abh.statusAuffrischen?.(); return OK; },
    "status-auffrischen": () => { abh.statusAuffrischen?.(); return OK; },
    "titel": (w) => {
      if (w !== undefined && w !== null && typeof w !== "string") return UNGUELTIG();
      abh.fensterTitel(typeof w === "string" ? einzeilig(w, MAX_TITEL) : null);
      return OK;
    },
    "fehler": (w) => {
      if (!w || typeof w !== "object" || typeof w.text !== "string") return UNGUELTIG();
      if (++fehlerZaehler > MAX_FEHLER_JE_FENSTER) { if (fehlerZaehler === MAX_FEHLER_JE_FENSTER + 1) abh.protokoll("js-fehler gedrosselt"); return nein("gedrosselt"); }
      const ort = (typeof w.ort === "string" ? fehlerOrt(w.ort) : null) || "unbekannt";
      abh.protokoll(`js-fehler ${ort} ${einzeilig(w.text, MAX_FEHLERTEXT) || "(ohne Text)"}`);
      return OK;
    },
    "git-pruefen": async () => abh.git.pruefen(),
    "git-installieren": async () => ({ ok: false, stand: "fehlt", meldung: abh.git.hinweis() }),
    "kopieren": (w) => {
      const t = kopierenText(w);
      if (t === null) return nein("text-nicht-erlaubt");
      abh.protokoll("aktion kopieren"); // der Text gehört nicht ins Protokoll
      abh.schreibeZwischenablage(t);
      return OK;
    },
    "einrichtung-ende": (w) => {
      if (!w || !["fertig", "spaeter"].includes(w.art)) return UNGUELTIG();
      einrichtungOffen = false;
      abh.einrichtung.schreibe(abh.support, { ende: w.art });
      abh.protokoll(`aktion einrichtung-ende ${w.art}`);
      return OK;
    },
    "einrichtung-sitzung": (w) => {
      if (!w || typeof w.offen !== "boolean") return UNGUELTIG();
      if (!w.offen) { einrichtungOffen = false; einrichtungAngefordert = false; return OK; }
      if (!einrichtungAngefordert && !einrichtungOffen) return nein("nicht-angefordert");
      einrichtungAngefordert = false; einrichtungOffen = true;
      abh.protokoll("einrichtung-sitzung bestaetigt");
      return OK;
    },
    "einrichtung-schritt": (w) => {
      if (!w || !SCHRITTE.includes(w.schritt)) return UNGUELTIG();
      abh.einrichtung.schreibe(abh.support, { schritt: w.schritt });
      return OK;
    },
    "einrichtung-oeffnen": (w) => {
      if (w !== undefined && w !== null && (typeof w !== "object" || Array.isArray(w))) return UNGUELTIG();
      const ab = w?.ab ?? null, weg = w?.weg ?? null;
      if ((ab !== null && !EINSTIEGE.includes(ab)) || (weg !== null && !WEGE.includes(weg))) return UNGUELTIG();
      einrichtungAngefordert = true;
      abh.protokoll("aktion einrichtung-oeffnen");
      Promise.resolve(abh.vaultPfad()).catch(() => null).then((vault) => {
        const von = einstieg({ ab, weg, vaultDa: !!vault, letzterSchritt: abh.einrichtung.lese(abh.support)?.letzterSchritt ?? null });
        abh.befehlAnStudio("einrichtung", { ...(von ? { ab: von } : {}), ...(weg ? { weg } : {}) });
      });
      return OK;
    },
    "mitteilung-probe": async () => abh.mitteilung({ probe: true }) ? OK : nein("nicht-verfuegbar"),
    "kuerzel-geaendert": () => { abh.kuerzel?.neuLesen(); return OK; }, // tastenkuerzel.json hat sich geändert: Menüs und globale Kürzel neu belegen
    "kuerzel-global": (w) => {
      if (!w || typeof w.id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(w.id) || w.id.length > 40) return UNGUELTIG();
      if (w.kuerzel !== null && w.kuerzel !== undefined && (typeof w.kuerzel !== "string" || !w.kuerzel || w.kuerzel.length > 40)) return UNGUELTIG();
      return abh.kuerzel ? abh.kuerzel.pruefeGlobal(w.id, w.kuerzel ?? null) : nein("nicht-verfuegbar"); // { ok:true } | { ok:false, text } wie KuerzelSteuerung.pruefeGlobal (Swift)
    },
    "fenster-ziehen": () => OK, // nativer Fensterrahmen: das System zieht selbst
    "fenster-zoom": () => { abh.fensterZoom(); return OK; },
    "darstellung": (w) => {
      if (typeof w !== "string" || !Object.hasOwn(DARSTELLUNGEN, w)) return UNGUELTIG();
      abh.darstellung(DARSTELLUNGEN[w]);
      return OK;
    },
    "app-symbol": (w) => (typeof w === "string" && APP_SYMBOLE.includes(w) ? (abh.appSymbol?.(w) ? OK : nein("nicht-verfuegbar")) : UNGUELTIG()),
    "fenster-durchscheinend": (w) => {
      if (typeof w !== "boolean") return UNGUELTIG();
      const wirkt = abh.fensterGlas ? abh.fensterGlas(w) : null; // null = kein Fenstermaterial möglich
      return wirkt === null || wirkt === undefined ? nein("nicht-verfuegbar") : { ok: true, wirkt };
    },
  }));

  function aktion(name, wert) {
    if (typeof name !== "string" || !AKTIONEN.has(name)) return nein("unbekannt");
    if (NUR_EINRICHTUNG.includes(name) && !einrichtungOffen) return nein("einrichtung-nicht-offen");
    try {
      const r = AKTIONEN.get(name)(wert);
      return r && typeof r.then === "function" ? r.catch(() => nein("fehler")) : r;
    } catch { return nein("fehler"); }
  }
  return {
    namen: [...AKTIONEN.keys()],
    aktion,
    // Jede neu geladene Seite meldet „Einrichtung zu“: ein Neuladen lässt nichts offen
    seiteNeu() { einrichtungOffen = false; einrichtungAngefordert = false; },
    zustand: () => ({ einrichtungOffen, einrichtungAngefordert }),
  };
}
