// umstellung/schritte.mjs — die Schritte A1, A3, A4, A6 und A7 der Phase A (Paket P7b, Plan docs/plaene/p7-umstellung.md Abschnitt 3). A0 steht in sicherung.mjs, A2 in git-umzug.mjs,
// A5 in mcp-schritt.mjs, A8 in geraete.mjs, A9 in pruefung.mjs.
//
// Jeder Schritt ist ein Modul mit  id, titel, plan(z, ctx), wende(z, ctx), nachpruefen(z, ctx)?, zurueck(z, ctx, undo):
//   plan     nur lesend → { noetig, text }
//   wende    schreibt (nur nach z.*: Original oder Kopie), legt VOR dem ersten Schreiben die Rückweg-Angaben ab (ctx.merkeUndo) → { status: ok|nichts|uebersprungen, anzahl?, grund?, details? }
//   zurueck  stellt her, was wir geändert haben – eine Datei anderer Programme nur, wenn sie seit unserem Schreiben unverändert ist (Hash); sonst nur unsere Einträge (Plan 5.2)
// Alle Datei- und Programmaufrufe gehen über die Ziele `z` (ziele.mjs); nichts davon liest oder schreibt je ein echtes ~ ohne z.
import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync, rmdirSync, writeFileSync, mkdtempSync, lstatSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ALT_KIT_ORDNER, liesConfigRoh } from "../pfade.mjs";
import { uebernehmeOrdner, bestaetigeRemote, pruefeBackupPfad, merkerDateiFuer } from "../backup.mjs";
import { LABEL, bauePlist, profilAusPlist, launchctl, domain } from "../tageslauf/dienst.mjs";
import { hooksPfadArt, adressArt } from "./git-lage.mjs";
import { gitLauf, kernSkript, kennung, findeClaudeProgramm } from "./ziele.mjs";
import { hashDatei, sichereDatei, sicherungsPfad, stelleHer, modusVon, schreibeAtomar, echtesDateiZiel, hashText } from "./protokoll.mjs";
import { nennt, pruefeBefehleUndSkills } from "./restverweise.mjs";
import { spawnSync } from "node:child_process";

const istObjekt = (x) => x && typeof x === "object" && !Array.isArray(x);
const liesText = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const merkerDatei = (z) => merkerDateiFuer(z.vault, z.support);

// ===================================================================================================================================
// A1 — Sicherungsziel übernehmen
// ===================================================================================================================================
export const A1 = {
  id: "A1", titel: "Sicherungsziel übernehmen",
  lage(z, ctx) {
    const roh = liesConfigRoh(z.vault);
    const b = roh.cfg && istObjekt(roh.cfg.backup) ? roh.cfg.backup : null;
    const pfad = b && typeof b.pfad === "string" && b.pfad ? b.pfad : null;
    let origin = null;
    if (existsSync(join(z.vault, ".git"))) { const r = gitLauf(z, ["config", "--local", "--get", "remote.origin.url"]); if (r.status === 0) origin = r.stdout.trim() || null; }
    const art = origin ? adressArt(origin) : "keine";
    const merker = (() => { try { const o = JSON.parse(liesText(merkerDatei(z))); return istObjekt(o) ? o : {}; } catch { return {}; } })();
    return { pfad, ungueltig: pfad ? pruefeBackupPfad(pfad) !== null : false, origin, art, merker, bestaetigen: ctx.entscheidungen.remoteBestaetigen === true && (art === "https" || art === "ssh") && merker.remoteBestaetigt !== origin };
  },
  plan(z, ctx) {
    const l = this.lage(z, ctx);
    const uebernehmen = !!l.pfad && !l.ungueltig && l.merker.pfad !== l.pfad && !(l.merker.pfad && l.merker.pfad !== l.pfad);
    return { noetig: uebernehmen || l.bestaetigen, text: uebernehmen ? "Der Sicherungsordner wird in Kortex übernommen (ohne die Einstellungen des Vaults zu ändern)." : l.bestaetigen ? "Das Online-Sicherungsziel wird von dir bestätigt." : "nichts zu übernehmen" };
  },
  wende(z, ctx) {
    const l = this.lage(z, ctx);
    const aufgaben = [];
    if (l.pfad && !l.ungueltig && l.merker.pfad !== l.pfad) {
      if (l.merker.pfad && l.merker.pfad !== l.pfad) return { status: "uebersprungen", grund: "abweichend" };
      aufgaben.push("pfad");
    } else if (l.pfad && l.ungueltig) {
      if (!l.bestaetigen) return { status: "uebersprungen", grund: "ungueltig" };
    }
    if (l.bestaetigen) aufgaben.push("remote");
    if (!aufgaben.length) return { status: "nichts" };
    const datei = merkerDatei(z);
    const vorherText = liesText(datei);
    // Was wir setzen WOLLEN, steht vor dem Schreiben in den Rückweg-Angaben: der Rückweg entfernt nur Schlüssel, die noch genau diesen Wert tragen (auch nach einem Absturz)
    const undo = { datei, vorherText, hashVorher: vorherText === null ? null : hashText(vorherText), gesetzt: { ...(aufgaben.includes("pfad") ? { pfad: l.pfad } : {}), ...(aufgaben.includes("remote") ? { remoteBestaetigt: l.origin } : {}) } };
    ctx.merkeUndo(undo);
    if (aufgaben.includes("pfad")) {
      const r = uebernehmeOrdner(z.vault, l.pfad, { support: z.support });
      if (!r.ok) throw new Error("sicherungsordner-uebernehmen");
    }
    if (aufgaben.includes("remote")) {
      if (!bestaetigeRemote(z.vault, l.origin, { support: z.support })) throw new Error("remote-bestaetigen");
    }
    ctx.pruefpunkt("nach-schreiben");
    undo.hashNachher = hashDatei(datei);
    ctx.merkeUndo(undo);
    ctx.nachDaten = { gesetzt: undo.gesetzt, datei };
    return { status: "ok", anzahl: aufgaben.length, details: { aufgaben } };
  },
  nachpruefen(z, ctx) {
    const d = ctx.nachDaten;
    if (!d) return true;
    let o = {};
    try { o = JSON.parse(readFileSync(d.datei, "utf8")); } catch { return false; }
    return Object.entries(d.gesetzt).every(([k, v]) => o[k] === v) && (!d.gesetzt.pfad || pruefeBackupPfad(d.gesetzt.pfad) === null);
  },
  zurueck(z, ctx, undo) {
    if (!undo || !undo.datei) return { status: "nichts", hinweise: [] };
    const jetzt = hashDatei(undo.datei);
    if (jetzt === undo.hashVorher) return { status: "nichts", hinweise: [] };
    if (undo.hashNachher && jetzt === undo.hashNachher) {
      if (undo.vorherText === null) { rmSync(undo.datei, { force: true }); try { rmdirSync(join(undo.datei, "..")); } catch { /* nicht leer */ } } else schreibeAtomar(undo.datei, undo.vorherText, 0o600);
      return { status: "ok", hinweise: [] };
    }
    // seit unserem Schreiben verändert: nur die Schlüssel zurück, die noch genau unseren Wert tragen
    let jetztObj = {}, vorherObj = {};
    try { jetztObj = JSON.parse(readFileSync(undo.datei, "utf8")); } catch { return { status: "nichts", hinweise: ["merker-unlesbar"] }; }
    try { vorherObj = undo.vorherText ? JSON.parse(undo.vorherText) : {}; } catch { vorherObj = {}; }
    for (const [k, v] of Object.entries(undo.gesetzt || {})) {
      if (jetztObj[k] !== v) continue;
      if (k in vorherObj) jetztObj[k] = vorherObj[k]; else delete jetztObj[k];
    }
    if (Object.keys(jetztObj).length) schreibeAtomar(undo.datei, JSON.stringify(jetztObj) + "\n", 0o600); else { rmSync(undo.datei, { force: true }); try { rmdirSync(join(undo.datei, "..")); } catch { /* nicht leer */ } }
    return { status: "ok", hinweise: ["merker-einzeln-zurueck"] };
  },
};

// ===================================================================================================================================
// A3 — core.hooksPath auf den Kern
// ===================================================================================================================================
const lieseHooksPfad = (z) => { const r = gitLauf(z, ["config", "--local", "--get-all", "core.hooksPath"]); return r.status === 0 ? (r.stdout.split("\n").filter(Boolean).pop() ?? null) : null; };
export const A3 = {
  id: "A3", titel: "Prüfung vor dem Speichern auf den Kern umstellen",
  lage(z) {
    if (!existsSync(join(z.vault, ".git"))) return { art: "kein-git" };
    const w = lieseHooksPfad(z);
    if (!w) return { art: "keiner", wert: null };
    const ziel = z.kern ? join(z.kern, "git-hooks").split("\\").join("/") : null;
    const h = hooksPfadArt(w, z.musterVault, ALT_KIT_ORDNER, z.festSupport);
    if (h.art === "kortex" && ziel && w.split("\\").join("/").replace(/\/+$/, "") === ziel) return { art: "schon-neu", wert: w, ziel };
    return { art: h.art, wert: w, ziel };
  },
  plan(z) {
    const l = this.lage(z);
    return { noetig: l.art === "kit-alt" || l.art === "kortex", text: l.art === "kit-alt" ? "Die Prüfung vor dem Speichern zeigt auf den alten Werkzeug-Ordner und wird auf Kortex umgestellt." : l.art === "fremd" ? "Eine fremde Prüfung vor dem Speichern bleibt unverändert (nur mit „Ersetzen“)." : "nichts umzustellen" };
  },
  wende(z, ctx) {
    const l = this.lage(z);
    if (l.art === "kein-git") return { status: "uebersprungen", grund: "kein-git" };
    if (l.art === "keiner" || l.art === "schon-neu") return { status: "nichts" };
    if (!z.kern) throw new Error("kein-stabiler-kern");
    if (l.art === "fremd" && ctx.entscheidungen.hooksErsetzen !== true) return { status: "uebersprungen", grund: "fremder-hookspfad" };
    ctx.merkeUndo({ vorher: l.wert, nachher: l.ziel });
    const r = kernSkript(z, "install-git-hooks.mjs", [z.vault, ...(l.art === "fremd" ? ["--ersetzen"] : [])]);
    if (r.status === 3) throw new Error("kein-stabiler-kern");
    if (r.status === 5) throw new Error("vault-nicht-vertraut");
    if (r.status !== 0) throw new Error("hooks-install-fehlgeschlagen");
    ctx.nachDaten = { ziel: l.ziel };
    return { status: "ok", anzahl: 1, details: { vorher: l.art } };
  },
  nachpruefen(z, ctx) { const w = lieseHooksPfad(z); return !!w && !!ctx.nachDaten && w.split("\\").join("/") === ctx.nachDaten.ziel; },
  zurueck(z, ctx, undo) {
    if (!undo || undo.vorher === undefined) return { status: "nichts", hinweise: [] };
    const jetzt = lieseHooksPfad(z);
    if (jetzt === undo.vorher) return { status: "nichts", hinweise: [] };
    if (jetzt !== null && jetzt.split("\\").join("/") !== String(undo.nachher).split("\\").join("/")) return { status: "nichts", hinweise: ["hookspfad-geaendert"] };
    const r = undo.vorher === null ? gitLauf(z, ["config", "--local", "--unset-all", "core.hooksPath"]) : gitLauf(z, ["config", "--local", "core.hooksPath", undo.vorher]);
    return { status: r.status === 0 ? "ok" : "nichts", hinweise: r.status === 0 ? [] : ["hookspfad-nicht-zurueck"] };
  },
};

// ===================================================================================================================================
// A4 — Claude-Hooks, Statuszeile und Befehle je Profil
// ===================================================================================================================================
const INSTALL = join("adapters", "claude-code", "install.mjs");
const jsonZeile = (t) => { try { return JSON.parse(String(t).trim().split("\n").pop()); } catch { return null; } };
const befehleStand = (profil) => { const m = {}; try { for (const n of readdirSync(join(profil, "commands"))) if (n.endsWith(".md")) m[n] = hashDatei(join(profil, "commands", n)); } catch { /* keine Befehle */ } return m; };
const bakDateien = (profil) => {
  const aus = [];
  for (const [dir, re] of [[profil, /^settings\.json\.bak-/], [join(profil, "commands"), /\.bak-/]]) { try { for (const n of readdirSync(dir)) if (re.test(n)) aus.push(join(dir, n)); } catch { /* nichts */ } }
  return aus;
};

// --- gezielte Umkehr der Hook-Einträge (A4-Rückweg bei inzwischen geänderter settings.json) --------------------------------------------------------------------------------
// Aus der Sicherung vor A4 und dem Stand danach ergibt sich genau, was der Installer geändert hat: `neu` = Hook-Einträge, die er hinzugefügt oder umgeschrieben hat, `alt` = die
// Einträge, die dafür weggefallen sind (mit Gruppe/Matcher und dem ganzen Hook-Objekt). Der Rückweg nimmt NUR `neu` heraus und setzt `alt` wieder ein – alles andere in der Datei bleibt.
const hakenListe = (doc) => {
  const aus = [];
  for (const [ev, liste] of Object.entries(istObjekt(doc && doc.hooks) ? doc.hooks : {})) for (const g of Array.isArray(liste) ? liste : []) for (const h of Array.isArray(g && g.hooks) ? g.hooks : []) aus.push({ ev, matcher: g.matcher ?? null, hook: h });
  return aus;
};
const hakenSchluessel = (x) => `${x.ev}\u0000${x.matcher ?? ""}\u0000${JSON.stringify(x.hook)}`;
export function hakenDiff(vorher, nachher) {
  const v = hakenListe(vorher), n = hakenListe(nachher);
  const vs = new Set(v.map(hakenSchluessel)), ns = new Set(n.map(hakenSchluessel));
  return {
    neu: n.filter((x) => !vs.has(hakenSchluessel(x))), alt: v.filter((x) => !ns.has(hakenSchluessel(x))),
    statusVorher: istObjekt(vorher && vorher.statusLine) ? vorher.statusLine : null, statusNachher: istObjekt(nachher && nachher.statusLine) ? nachher.statusLine : null,
  };
}
export function hakenZurueck(doc, diff) {
  doc.hooks = istObjekt(doc.hooks) ? doc.hooks : {};
  for (const x of diff.neu) {
    const liste = doc.hooks[x.ev];
    if (!Array.isArray(liste)) continue;
    for (const g of liste) {
      if (!Array.isArray(g && g.hooks) || (g.matcher ?? null) !== x.matcher) continue;
      const i = g.hooks.findIndex((h) => JSON.stringify(h) === JSON.stringify(x.hook));
      if (i >= 0) { g.hooks.splice(i, 1); break; }
    }
    doc.hooks[x.ev] = liste.filter((g) => !(Array.isArray(g && g.hooks) && g.hooks.length === 0));
    if (!doc.hooks[x.ev].length) delete doc.hooks[x.ev];
  }
  for (const x of diff.alt) {
    if (hakenListe(doc).some((y) => hakenSchluessel(y) === hakenSchluessel(x))) continue;
    const liste = (doc.hooks[x.ev] = Array.isArray(doc.hooks[x.ev]) ? doc.hooks[x.ev] : []);
    const g = liste.find((y) => Array.isArray(y && y.hooks) && (y.matcher ?? null) === x.matcher);
    if (g) g.hooks.push(x.hook); else liste.unshift({ ...(x.matcher === null ? {} : { matcher: x.matcher }), hooks: [x.hook] });
  }
  if (JSON.stringify(doc.statusLine ?? null) === JSON.stringify(diff.statusNachher)) { if (diff.statusVorher) doc.statusLine = diff.statusVorher; else delete doc.statusLine; }
  if (istObjekt(doc.hooks) && !Object.keys(doc.hooks).length) delete doc.hooks;
  return doc;
}

export function vorschauProfil(z, profil) {
  // der Vault ist das ORIGINAL (nur für die Erkennung alter Einträge): sein Vertrauen steht im echten Support-Ordner, nicht im Probe-Support
  const r = kernSkript(z, INSTALL, [z.musterVault, "--vorschau", "--claude-home", profil.pfad], { extraEnv: { BRAIN_APP_SUPPORT: z.supportOriginal || z.support } });
  const j = r.status === 0 ? jsonZeile(r.stdout) : null;
  return { status: r.status, vorschau: j && j.vorschau ? j : null, stderr: r.stderr };
}
const standProfil = (z, profil) => { const r = kernSkript(z, INSTALL, ["--stand", "--claude-home", profil.pfad]); return r.status === 0 ? jsonZeile(r.stdout) : null; };

export const A4 = {
  id: "A4", titel: "Claude Code einklinken",
  plan(z, ctx) {
    let n = 0;
    for (const p of ctx.profile) { const v = vorschauProfil(z, p); if (v.vorschau && (v.vorschau.geaendert || pruefeBefehleUndSkills(p.pfad).mitMarke > 0)) n++; }
    return { noetig: n > 0, text: n ? `Hooks, Statuszeile und Befehle von ${n} Claude-Profil(en) werden auf Kortex umgestellt (Fremdes bleibt).` : "nichts umzustellen", anzahl: n };
  },
  wende(z, ctx) {
    if (!z.kern || !z.starter) throw new Error("kein-stabiler-kern");
    const undo = { profile: [] };
    let anzahl = 0, uebersprungen = 0;
    const vorschauen = [];
    for (const p of ctx.profile) {
      const v = vorschauProfil(z, p);
      if (!v.vorschau) { uebersprungen++; continue; }                                  // kaputtes settings.json: bleibt unangetastet
      const alteBefehle = pruefeBefehleUndSkills(p.pfad).mitMarke > 0;
      vorschauen.push({ name: p.name, geaendert: v.vorschau.geaendert, eintraege: v.vorschau.eintraege.length, restVerweise: v.vorschau.restVerweise });
      if (!v.vorschau.geaendert && !alteBefehle) continue;
      if (!z.schreibeClaude) { anzahl++; continue; }                                    // Probelauf: nur im Speicher gerechnet
      const settings = join(p.pfad, "settings.json");
      const s = sichereDatei(z, ctx.sicherungsDir, settings, `settings-${p.name}.vor-a4.json`);
      const eintrag = { pfad: p.pfad, name: p.name, settings: { existierte: !!s, rel: s && s.rel, hashVorher: s && s.hash, modus: modusVon(settings), hashNachher: null },
        befehleVorher: befehleStand(p.pfad), befehleNachher: null, befehleSicherung: null, bakVorher: bakDateien(p.pfad) };
      // Befehle sichern (nur kleine .md-Dateien)
      const bdir = join(p.pfad, "commands");
      eintrag.befehleOrdnerNeu = !existsSync(bdir);
      if (existsSync(bdir)) {
        eintrag.befehleSicherung = {};
        for (const n of Object.keys(eintrag.befehleVorher)) { const b = sichereDatei(z, ctx.sicherungsDir, join(bdir, n), join(`befehle-${p.name}`, n)); if (b) eintrag.befehleSicherung[n] = b.rel; }
      }
      undo.profile.push(eintrag);
      ctx.merkeUndo(undo);
      const r = kernSkript(z, INSTALL, [z.vault, "--claude-home", p.pfad]);
      if (r.status === 3) throw new Error("kein-stabiler-kern");
      if (r.status === 5) throw new Error("vault-nicht-vertraut");
      if (r.status !== 0) throw new Error("claude-hooks-fehlgeschlagen");
      ctx.pruefpunkt("nach-install");
      eintrag.settings.hashNachher = hashDatei(settings);
      try { eintrag.diff = hakenDiff(s ? JSON.parse(readFileSync(sicherungsPfad(z, s.rel), "utf8")) : {}, JSON.parse(readFileSync(settings, "utf8"))); } catch { eintrag.diff = null; }
      eintrag.befehleNachher = befehleStand(p.pfad);
      eintrag.bakNeu = bakDateien(p.pfad).filter((f) => !eintrag.bakVorher.includes(f)).map((f) => ({ pfad: f, hash: hashDatei(f) }));
      ctx.merkeUndo(undo);
      anzahl++;
    }
    ctx.nachDaten = { profile: undo.profile.map((e) => ({ pfad: e.pfad, name: e.name })) };
    if (!anzahl) return { status: uebersprungen ? "uebersprungen" : "nichts", grund: uebersprungen ? "einstellungen-defekt" : undefined, details: { vorschau: vorschauen } };
    return { status: "ok", anzahl, details: { profile: anzahl, uebersprungen, vorschau: z.schreibeClaude ? undefined : vorschauen } };
  },
  nachpruefen(z, ctx) {
    for (const p of (ctx.nachDaten && ctx.nachDaten.profile) || []) { const s = standProfil(z, p); if (!s || s.aktiv !== true) return false; }
    return true;
  },
  zurueck(z, ctx, undo) {
    const hinweise = [];
    let n = 0;
    for (const e of (undo && undo.profile) || []) {
      const settings = join(e.pfad, "settings.json");
      const jetzt = hashDatei(settings);
      const st = e.settings || {};
      if (jetzt === st.hashVorher) { /* unverändert */ }
      else if (st.hashNachher && jetzt === st.hashNachher) {
        if (st.existierte && st.rel) stelleHer(settings, sicherungsPfad(z, st.rel), st.modus || 0o600); else rmSync(echtesDateiZiel(settings), { force: true });
        n++;
      } else {
        // inzwischen von dir oder einem Programm geändert: gezielt umkehren – nur die Einträge entfernen, die der Installer eingetragen hat, die ersetzten alten wieder einsetzen,
        // alles andere (auch Hooks, die schon vorher in neuer Form da waren) bleibt. Ohne Angaben (Absturz mitten im Schritt): nichts anfassen.
        let doc = null;
        try { doc = JSON.parse(readFileSync(settings, "utf8")); } catch { /* defekt */ }
        // Absturz vor dem Vermerken des Stands (hashNachher/diff fehlen): die Änderung ergibt sich aus der Sicherung und dem jetzigen Stand
        let diff = e.diff;
        if (!diff && doc && !st.hashNachher) { try { diff = hakenDiff(st.existierte && st.rel ? JSON.parse(readFileSync(sicherungsPfad(z, st.rel), "utf8")) : {}, doc); } catch { diff = null; } }
        if (doc && diff) {
          schreibeAtomar(echtesDateiZiel(settings), JSON.stringify(hakenZurueck(doc, diff), null, 2) + "\n", st.modus || 0o600);
          hinweise.push("settings-geaendert-gezielt-zurueck");
          n++;
        } else hinweise.push("settings-geaendert");
      }
      // Befehle
      const jetztB = befehleStand(e.pfad), vorher = e.befehleVorher || {}, nachher = e.befehleNachher || {};
      for (const [name, h] of Object.entries(nachher)) {
        const datei = join(e.pfad, "commands", name);
        if (jetztB[name] !== h) continue;                                                   // von dir geändert: bleibt
        if (name in vorher) { const rel = e.befehleSicherung && e.befehleSicherung[name]; if (rel && vorher[name] !== h) stelleHer(datei, sicherungsPfad(z, rel)); }
        else rmSync(datei, { force: true });
      }
      for (const [name, rel] of Object.entries(e.befehleSicherung || {})) {             // ein von uns überschriebener, inzwischen gelöschter Befehl kommt aus der Sicherung wieder
        if (!(name in jetztB) && rel) { mkdirSync(join(e.pfad, "commands"), { recursive: true }); stelleHer(join(e.pfad, "commands", name), sicherungsPfad(z, rel)); n++; }
      }
      for (const b of e.bakNeu || []) { if (hashDatei(b.pfad) === b.hash) rmSync(b.pfad, { force: true }); }
      if (e.befehleOrdnerNeu) { try { rmdirSync(join(e.pfad, "commands")); } catch { /* nicht leer */ } }
    }
    return { status: n ? "ok" : "nichts", hinweise };
  },
};

// ===================================================================================================================================
// A6 — Hintergrunddienst
// ===================================================================================================================================
const plistDatei = (z) => join(z.launchAgents, `${LABEL}.plist`);
const plistQuelle = (z) => join(z.launchAgentsQuelle || z.launchAgents, `${LABEL}.plist`);   // im Probelauf: die echte plist (nur gelesen)
const unxml = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
// → { alt, dieser: true|false|null } wie der Befund (E20): BRAIN_VAULT oder Verweis auf den alten Werkzeug-Ordner = alte Form; „dieser“ = gehört zu diesem Vault
export function analysierePlist(text, vaulte) {
  const strings = [...text.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => unxml(m[1]));
  const bv = /<key>BRAIN_VAULT<\/key>\s*<string>([^<]*)<\/string>/.exec(text);
  const alt = !!bv || strings.some((s) => nennt(s));
  if (!alt) return { alt: false, dieser: null };
  const falte = (s) => String(s).normalize("NFC").toLowerCase();
  const gleich = (p) => vaulte.some((v) => falte(v) === falte(p));
  const echt = (p) => { try { return realpathSync(p); } catch { return p; } };
  if (bv) { const p = unxml(bv[1]); return { alt, dieser: gleich(p) || gleich(echt(p)) }; }
  const orte = strings.map((s) => new RegExp(`^(.*)/${ALT_KIT_ORDNER.replace(/\./g, "\\.")}(?:/|$)`).exec(s)).filter(Boolean).map((m) => m[1]);
  return { alt, dieser: orte.length ? orte.some((o) => gleich(o) || gleich(echt(o))) : null };
}

export const A6 = {
  id: "A6", titel: "Hintergrunddienst umstellen",
  lage(z, ctx) {
    const text = liesText(plistQuelle(z));
    if (text === null) return { art: "kein-dienst" };
    const vaulte = [z.musterVault, z.vault].flatMap((v) => [v, (() => { try { return realpathSync(v); } catch { return v; } })()]);
    const a = analysierePlist(text, vaulte);
    if (!a.alt) return { art: "schon-neu", text };
    return { art: a.dieser === true ? "alt-dieser" : "alt-anderer", text, profil: profilAusPlist(plistQuelle(z)) };
  },
  plan(z, ctx) {
    const l = this.lage(z, ctx);
    return { noetig: l.art === "alt-dieser" || (l.art === "alt-anderer" && ctx.entscheidungen.dienstAnderer === true), text: l.art === "alt-dieser" ? "Der Hintergrunddienst startet künftig Kortex statt des alten Programms (dein Claude-Profil bleibt)." : l.art === "alt-anderer" ? "Der Hintergrunddienst gehört zu einem anderen Vault und bleibt, solange du ihn nicht ausdrücklich umstellst." : "nichts umzustellen" };
  },
  wende(z, ctx) {
    const l = this.lage(z, ctx);
    if (l.art === "kein-dienst" || l.art === "schon-neu") return { status: "nichts" };
    if (l.art === "alt-anderer" && ctx.entscheidungen.dienstAnderer !== true) return { status: "uebersprungen", grund: "anderer-vault" };
    if (process.platform !== "darwin") return { status: "uebersprungen", grund: "kein-mac" };
    if (!z.kern || !z.starter) throw new Error("kein-stabiler-kern");
    if (!z.launchctl) {
      // Probelauf: die neue plist nur rendern (in den Probe-Ordner) und prüfen, kein launchctl
      const claude = findeClaudeProgramm(z);
      const { text } = bauePlist({ starter: z.starter, node: z.node, claude, profilRoh: l.profil, home: z.home, support: z.festSupport });
      mkdirSync(z.launchAgents, { recursive: true });
      const ziel = plistDatei(z);
      writeFileSync(ziel, text);
      const lint = existsSync("/usr/bin/plutil") ? spawnSync("/usr/bin/plutil", ["-lint", ziel], { encoding: "utf8" }).status === 0 : true;
      if (!lint) throw new Error("plist-ungueltig");
      return { status: "ok", anzahl: 1, details: { gerendert: true } };
    }
    const sich = sichereDatei(z, ctx.sicherungsDir, plistDatei(z), "dienst.vor-a6.plist");
    const merker = join(z.support, "dienst.json");
    const merkerSich = sichereDatei(z, ctx.sicherungsDir, merker, "dienst-json.vor-a6");
    // Die neue plist vorher rendern: ihr Hash kommt als `hashErwartet` in die Rückweg-Angaben, damit der Rückweg sie auch erkennt, wenn `dienst an` mitten im Schreiben scheitert
    // (hashNachher steht erst nach Erfolg fest). Im Fehlerfall desselben Laufs stellt der Rückweg ohnehin immer aus der Sicherung her (ctx.imFehler).
    const erwartet = bauePlist({ starter: z.starter, node: z.node, claude: findeClaudeProgramm(z), profilRoh: l.profil, home: z.home, support: z.festSupport });
    const undo = { plist: { rel: sich && sich.rel, hashVorher: sich && sich.hash, hashNachher: null, hashErwartet: hashText(erwartet.text), modus: modusVon(plistDatei(z)) },
      merkerVorher: merkerSich ? merkerSich.rel : null, merkerHashVorher: merkerSich ? merkerSich.hash : null, merkerHashNachher: null,
      geladenVorher: launchctl(["print", `${domain()}/${LABEL}`]) };
    ctx.merkeUndo(undo);
    const r = kernSkript(z, "brain.mjs", ["dienst", "an", "--vault", z.vault], { extraEnv: l.profil ? { CLAUDE_CONFIG_DIR: l.profil } : {} });
    if (r.status === 5) throw new Error("vault-nicht-vertraut");
    if (r.status !== 0) throw new Error("dienst-an-fehlgeschlagen");
    ctx.pruefpunkt("nach-dienst");
    undo.plist.hashNachher = hashDatei(plistDatei(z));
    undo.merkerHashNachher = hashDatei(merker);
    ctx.merkeUndo(undo);
    ctx.nachDaten = { profil: l.profil };
    return { status: "ok", anzahl: 1, details: { profilUebernommen: !!l.profil } };
  },
  nachpruefen(z, ctx) {
    if (!ctx.nachDaten) return true;
    const t = liesText(plistDatei(z));
    if (t === null) return false;
    const a = analysierePlist(t, [z.vault]);
    const profilOk = !ctx.nachDaten.profil || profilAusPlist(plistDatei(z)) === ctx.nachDaten.profil;
    return !a.alt && t.includes(z.starter) && !/BRAIN_VAULT|node-start\.sh/.test(t) && profilOk;
  },
  zurueck(z, ctx, undo) {
    const hinweise = [];
    if (!undo || !undo.plist) return { status: "nichts", hinweise };
    const datei = plistDatei(z), jetzt = hashDatei(datei), p = undo.plist;
    const erzwingen = ctx && ctx.imFehler === true;                          // der Schritt ist in diesem Lauf gescheitert: immer aus der Sicherung herstellen
    let n = 0;
    const text = liesText(datei);
    const siehtNeuAus = text !== null && z.starter && text.includes(z.starter) && !analysierePlist(text, [z.vault, z.musterVault]).alt;
    const unsere = jetzt !== null && (jetzt === p.hashNachher || jetzt === p.hashErwartet || (p.hashNachher === null && siehtNeuAus));
    if (jetzt === p.hashVorher) { /* unverändert */ }
    else if (erzwingen || unsere) {
      if (z.launchctl) launchctl(["bootout", `${domain()}/${LABEL}`]);
      if (p.rel) stelleHer(datei, sicherungsPfad(z, p.rel), p.modus || 0o644); else rmSync(datei, { force: true });
      if (z.launchctl && p.rel && undo.geladenVorher) {
        if (!launchctl(["bootstrap", domain(), datei])) hinweise.push("dienst-nicht-geladen");
      }
      n++;
    } else hinweise.push("plist-geaendert");
    // Dienst-Merker (dienst.json) auf den vorherigen Stand
    const merker = join(z.support, "dienst.json");
    const mj = hashDatei(merker);
    const merkerUnserer = mj !== undo.merkerHashVorher && (erzwingen || undo.merkerHashNachher === null || undo.merkerHashNachher === undefined || mj === undo.merkerHashNachher);
    if (merkerUnserer) {
      if (undo.merkerVorher) stelleHer(merker, sicherungsPfad(z, undo.merkerVorher)); else rmSync(merker, { force: true });
      n++;
    }
    return { status: n ? "ok" : "nichts", hinweise };
  },
};

// ===================================================================================================================================
// A7 — AGENTS.md neu rendern (nur wenn sie nicht versioniert ist)
// ===================================================================================================================================
export const A7 = {
  id: "A7", titel: "Anweisungsdatei für KI-Programme erneuern",
  lage(z) {
    const datei = join(z.vault, "AGENTS.md");
    let l;
    try { l = lstatSync(datei); } catch { return { art: "keine" }; }
    if (!l.isFile()) return { art: "keine" };
    if (existsSync(join(z.vault, ".git"))) {
      const r = gitLauf(z, ["ls-files", "-z", "--", "AGENTS.md"]);
      if (r.status === 0 && r.stdout.split("\0").filter(Boolean).length) return { art: "versioniert" };
    }
    const text = liesText(datei);
    return text !== null && nennt(text) ? { art: "alt", datei } : { art: "schon-neu" };
  },
  plan(z) { const l = this.lage(z); return { noetig: l.art === "alt", text: l.art === "alt" ? "Die Datei AGENTS.md nennt noch den alten Werkzeug-Ordner und wird neu erzeugt." : l.art === "versioniert" ? "AGENTS.md steht im Versionsverlauf und bleibt (Aufräumen später)." : "nichts zu erneuern" }; },
  wende(z, ctx) {
    const l = this.lage(z);
    if (l.art === "versioniert") return { status: "uebersprungen", grund: "versioniert" };
    if (l.art !== "alt") return { status: "nichts" };
    const tmp = mkdtempSync(join(tmpdir(), "kortex-agents-"));
    try {
      const ziel = join(tmp, "AGENTS.md");
      const r = kernSkript(z, "skills-build.mjs", [z.vault, "--ziel", "agents", ziel]);
      if (r.status === 5) throw new Error("vault-nicht-vertraut");
      if (r.status !== 0 || !existsSync(ziel)) throw new Error("agents-rendern-fehlgeschlagen");
      const neu = readFileSync(ziel, "utf8");
      const s = sichereDatei(z, ctx.sicherungsDir, l.datei, "AGENTS.vor-a7.md");
      const undo = { rel: s && s.rel, hashVorher: s && s.hash, modus: modusVon(l.datei), hashNachher: hashText(neu) };
      ctx.merkeUndo(undo);
      schreibeAtomar(l.datei, neu, undo.modus);
      ctx.nachDaten = { datei: l.datei, hash: undo.hashNachher };
    } finally { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* weg */ } }
    return { status: "ok", anzahl: 1 };
  },
  nachpruefen(z, ctx) { const t = ctx.nachDaten && liesText(ctx.nachDaten.datei); return t !== null && t !== undefined && !nennt(t); },
  zurueck(z, ctx, undo) {
    if (!undo || !undo.rel) return { status: "nichts", hinweise: [] };
    const datei = join(z.vault, "AGENTS.md");
    const jetzt = hashDatei(datei);
    if (jetzt === undo.hashVorher) return { status: "nichts", hinweise: [] };
    if (jetzt === undo.hashNachher) { stelleHer(datei, sicherungsPfad(z, undo.rel), undo.modus || 0o644); return { status: "ok", hinweise: [] }; }
    return { status: "nichts", hinweise: ["agents-geaendert"] };
  },
};
