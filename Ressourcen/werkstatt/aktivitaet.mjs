// werkstatt/aktivitaet.mjs — Routen des Aktivitätsprotokolls (Paket P8a): Liste, „gelesen“, Rückgängig für KI-Ablagen, „Anmeldung abgelaufen“.
//   GET  /api/aktivitaet?seit=&art=&limit=&vault=alle&nur=ungelesen  → { vault, ereignisse (neueste zuerst), ungelesen, gesamt }
//   POST /api/aktivitaet/rueckgaengig { id, vault? }                   → { ok, art: "entfernt" | "schon-weg", pfad, commit, papierkorb }
//   POST /api/aktivitaet/gelesen { ids } | { alle: true } (+ vault?)  → { ok, ungelesen }
// Das Protokoll selbst schreiben der MCP-Server, die Hooks und der Kern (gemeinsam/aktivitaet.mjs); hier wird gelesen, der Zustand (gelesen, zurückgenommen) geführt und
// zurückgenommen. Rückgängig ist NUR für Dateien, die Kortex für eine KI abgelegt hat (Aufgabe, Notiz im Posteingang) UND die seitdem unverändert sind (Hash wie bei der Ablage) —
// sonst Rückfrage statt Löschen (409 „geaendert“). Git-sicher: war die Datei schon in der Versionsgeschichte, wird die Löschung mit ausgeschalteten Hooks committet (die Datei
// bleibt in der Geschichte). Vor JEDEM Entfernen liegt eine Kopie im Papierkorb von Kortex (<support>/aktivitaet/papierkorb/<Kennung>/, 30 Tage). Der Eintrag im Protokoll ist nur ein Hinweis (das
// Protokoll liegt außerhalb des Vaults): gelöscht wird nur eine .md-Datei direkt im Ordner der Aufgaben bzw. im Posteingang, die der Eintrag nennt (pfade[0]), um die Zeit des Eintrags angelegt wurde und
// unverändert ist.
import { readFileSync, lstatSync, unlinkSync, mkdirSync, copyFileSync, readdirSync, statSync, rmSync, realpathSync, existsSync, constants } from "node:fs";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { HttpFehler, loese, falte } from "../gemeinsam/basis.mjs";
import { kennungVault, leseEreignisse, leseZustand, aendereZustand, istGelesen, melde, protokollKennungen, aktivitaetOrdner, ARTEN, programmAnzeige } from "../gemeinsam/aktivitaet.mjs";

const MAX_LIMIT = 500;
const PAPIERKORB_TAGE = 30;
const ABLAGE_TOLERANZ_MS = 5 * 60_000;   // die Datei muss um die Zeit des Eintrags angelegt worden sein
const ALIAS_ART = { abweisungen: "abweisung", ablagen: "ablage-aufgabe,ablage-notiz" };
const echt = (p) => { try { return realpathSync.native(p); } catch { return p; } };

// deps: { support, konten (kontoDaten), vaults: () => [{ name, pfad }], oeffne: (pfad) => Vault, ereignisse (Live-Strom, optional) }
export function erzeugeAktivitaet({ support, konten = null, vaults = () => [], oeffne = null, ereignisse = null } = {}) {
  const bekannte = () => { try { return vaults().filter((x) => x && typeof x.pfad === "string"); } catch { return []; } };
  const kontoVon = (id) => { try { return konten && id ? konten.kontoDaten(id) : null; } catch { return null; } };
  let reihe = Promise.resolve(); // Rückgängig und „gelesen“ laufen nacheinander
  const seriell = (fn) => { const l = reihe.then(fn); reihe = l.catch(() => {}); return l; };

  // Die Vaults, über die gelesen wird: der offene (Standard) oder alle bekannten (vault=alle).
  function ziele(v, wahl) {
    if (wahl === "alle") {
      const m = new Map();
      for (const b of bekannte()) m.set(kennungVault(b.pfad), { name: b.name || basename(b.pfad), pfad: b.pfad });
      if (v && !m.has(kennungVault(v.wurzel))) m.set(kennungVault(v.wurzel), { name: v.name, pfad: v.wurzel });
      return [...m].map(([kennung, x]) => ({ kennung, ...x }));
    }
    return v ? [{ kennung: kennungVault(v.wurzel), name: v.name, pfad: v.wurzel }] : [];
  }

  function lesen(v, q) {
    const wahl = q.get("vault") === "alle" ? "alle" : null;
    const seit = q.get("seit");
    if (seit && !Number.isFinite(Date.parse(seit))) throw new HttpFehler(400, "„seit“ ist eine Zeitangabe (ISO).");
    const arten = (q.get("art") || "").split(",").flatMap((a) => (ALIAS_ART[a.trim()] || a.trim()).split(",")).filter(Boolean);
    if (arten.some((a) => !ARTEN.includes(a))) throw new HttpFehler(400, "Unbekannte Art.");
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(q.get("limit"), 10) || 100));
    const nurUngelesen = q.get("nur") === "ungelesen";
    const offenKennung = v ? kennungVault(v.wurzel) : null;
    const alle = [];
    let ungelesen = 0;
    for (const z of ziele(v, wahl)) {
      const zustand = leseZustand(support, z.kennung);
      for (const e of leseEreignisse(support, z.kennung)) {
        const gelesen = istGelesen(zustand, e);
        if (!gelesen) ungelesen++;
        if ((seit && !(Date.parse(e.zeit) > Date.parse(seit))) || (arten.length && !arten.includes(e.art)) || (nurUngelesen && gelesen)) continue;
        const { rueckgaengig, dk, ...rest } = e;
        const k = kontoVon(e.konto);
        const zurueck = zustand.zurueck[e.id] || null;
        alle.push({ ...rest, vaultName: z.name || e.vaultName || "", ...(wahl === "alle" ? { vaultPfad: z.pfad } : {}), gelesen,
          rueckgaengigMoeglich: !!rueckgaengig && (e.art === "ablage-aufgabe" || e.art === "ablage-notiz") && !zurueck && z.kennung === offenKennung, zurueckgenommen: zurueck,
          kontoName: k && typeof k.name === "string" ? k.name : null, programmName: programmAnzeige(e.programm || (k && k.programm) || "") });
      }
    }
    alle.sort((a, b) => (a.zeit < b.zeit ? 1 : a.zeit > b.zeit ? -1 : 0));
    return { vault: v ? { name: v.name, pfad: v.wurzel, kennung: offenKennung } : null, ereignisse: alle.slice(0, limit), ungelesen, gesamt: alle.length };
  }

  function vaultFuer(v, pfad) {
    if (pfad === undefined || pfad === null || pfad === "") return v;
    if (typeof pfad !== "string") throw new HttpFehler(400, "„vault“ ist ein Pfad.");
    if (v && falte(echt(pfad)) === falte(echt(v.wurzel))) return v;
    const b = bekannte().find((x) => falte(echt(x.pfad)) === falte(echt(pfad)));
    if (!b || typeof oeffne !== "function") throw new HttpFehler(404, "Diesen Vault kennt Kortex nicht (mehr).");
    try { return oeffne(b.pfad); } catch { throw new HttpFehler(404, "Dieser Vault lässt sich nicht öffnen."); }
  }
  const finde = (kennung, id) => leseEreignisse(support, kennung).find((e) => e.id === id) || null;

  function gelesen(v, eingabe) {
    return seriell(async () => {
      const alleVaults = eingabe.vault === "alle";
      const ziel = alleVaults ? null : vaultFuer(v, eingabe.vault);
      const liste = alleVaults ? ziele(v, "alle") : ziel ? ziele(ziel, null) : [];
      if (!liste.length) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true });
      if (eingabe.alle !== true && !(Array.isArray(eingabe.ids) && eingabe.ids.every((i) => typeof i === "string"))) throw new HttpFehler(400, "Bitte „ids“ (Liste) oder „alle“ angeben.");
      let rest = 0;
      for (const z of liste) {
        const zu = aendereZustand(support, z.kennung, (s) => {
          if (eingabe.alle === true) { const letzte = leseEreignisse(support, z.kennung).at(-1); if (letzte) s.gelesenBis = new Date(Math.max(Date.parse(letzte.zeit), Date.parse(s.gelesenBis || 0) || 0)).toISOString(); s.gelesen = []; }
          else for (const id of eingabe.ids) if (!s.gelesen.includes(id)) s.gelesen.push(id);
        });
        rest += leseEreignisse(support, z.kennung).filter((e) => !istGelesen(zu, e)).length;
      }
      ereignisse?.melde({ typ: "aktivitaet", art: "zustand" });
      return { ok: true, ungelesen: rest };
    });
  }

  const sha = (buf) => createHash("sha256").update(buf).digest("hex");
  function papierkorbAufraeumen(kennung) {
    const ordner = join(aktivitaetOrdner(support), "papierkorb", kennung);
    try { for (const n of readdirSync(ordner)) { const p = join(ordner, n); if (Date.now() - statSync(p).mtimeMs > PAPIERKORB_TAGE * 86400e3) rmSync(p, { force: true }); } } catch { /* kein Papierkorb */ }
  }

  // Rückgängig: nur Ablagen von KIs, nur unverändert (Hash), nur in einem vertrauten Vault.
  function rueckgaengig(v, eingabe) {
    return seriell(async () => {
      if (!eingabe || typeof eingabe.id !== "string" || !/^a_[0-9a-z]+_[0-9a-f]{6}$/.test(eingabe.id)) throw new HttpFehler(400, "Die Kennung des Ereignisses fehlt.");
      const vault = vaultFuer(v, eingabe.vault);
      if (!vault) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true, art: "kein-vault" });
      const kennung = kennungVault(vault.wurzel);
      const e = finde(kennung, eingabe.id);
      if (!e) throw new HttpFehler(404, "Dieses Ereignis gibt es nicht (mehr).");
      if (!e.rueckgaengig) throw new HttpFehler(400, "Das lässt sich nicht rückgängig machen.");
      if (leseZustand(support, kennung).zurueck[e.id]) throw new HttpFehler(409, "Das ist schon rückgängig gemacht.", { art: "schon-zurueck" });
      let stand = null; try { stand = vault.vertrauenStand(); } catch { /* unten */ }
      if (!stand || stand.erlaubt !== true) throw new HttpFehler(409, "Dieser Vault ist in Kortex noch nicht als deiner bestätigt, darum ändert Kortex hier nichts. Bestätige ihn in den Einstellungen.", { art: "nicht-vertraut" });
      // Das Protokoll liegt außerhalb des Vaults und kann von einem Programm beschrieben werden, das den Vault nicht sehen darf: ein Eintrag ist nur ein HINWEIS. Gelöscht wird nur,
      // was nach den Regeln des Vaults selbst eine Ablage ist — nie, was der Eintrag behauptet.
      const { abs, rel } = loese(vault.wurzel, e.rueckgaengig.pfad);
      const abgelehnt = (text) => new HttpFehler(409, `${text} Kortex entfernt nichts.`, { art: "unzulaessig" });
      if (!["ablage-aufgabe", "ablage-notiz"].includes(e.art)) throw abgelehnt("Das ist keine Ablage einer KI.");
      if (!Array.isArray(e.pfade) || e.pfade[0] !== e.rueckgaengig.pfad) throw abgelehnt("Der Eintrag nennt nicht eindeutig, was er betrifft.");
      const teile = rel.split("/");
      let erlaubterOrdner = null;
      try { erlaubterOrdner = e.art === "ablage-aufgabe" ? await vault.aufgabenOrdnerName() : vault.inboxOrdnerName(); } catch { erlaubterOrdner = null; }
      if (!erlaubterOrdner || teile.length !== 2 || falte(teile[0]) !== falte(erlaubterOrdner) || !/\.md$/i.test(teile[1])) {
        throw abgelehnt(e.art === "ablage-aufgabe" ? "Das liegt nicht im Ordner der Aufgaben." : "Das liegt nicht im Posteingang.");
      }
      let st = null;
      try { st = lstatSync(abs); } catch { /* weg */ }
      const merke = (art, extra = {}) => {
        aendereZustand(support, kennung, (s) => { s.zurueck[e.id] = new Date().toISOString(); });
        melde(vault.wurzel, { art: "rueckgaengig", text: `Rückgängig: ${art === "entfernt" ? "Die Ablage der KI wurde entfernt" : "Die Ablage der KI war schon weg"}.`, pfade: [rel], vaultName: vault.name }, { support });
        ereignisse?.melde({ typ: "aktivitaet", art: "zustand" });
        return { ok: true, art, pfad: rel, commit: null, papierkorb: false, ...extra };
      };
      if (!st) return merke("schon-weg");
      if (st.isSymbolicLink() || !st.isFile()) throw new HttpFehler(409, "Das ist keine gewöhnliche Datei mehr. Kortex entfernt sie nicht.", { art: "geaendert" });
      if (st.nlink > 1) throw new HttpFehler(423, "Diese Datei ist mehrfach verknüpft. Kortex entfernt sie nicht.", { art: "geaendert" });
      // Die Datei muss zu diesem Ereignis passen: angelegt um die Zeit des Eintrags (eine ältere Datei hat die KI nicht abgelegt)
      const angelegt = st.birthtimeMs > 0 ? st.birthtimeMs : st.ctimeMs;
      if (Math.abs(angelegt - Date.parse(e.zeit)) > ABLAGE_TOLERANZ_MS) throw abgelehnt("Die Datei stammt nicht aus dieser Ablage (sie wurde zu einer anderen Zeit angelegt).");
      const inhalt = readFileSync(abs);
      if (sha(inhalt) !== e.rueckgaengig.hash) throw new HttpFehler(409, "Die Notiz wurde seit der Ablage geändert. Kortex entfernt sie nicht — öffne sie und entscheide selbst.", { art: "geaendert" });
      // Läuft gerade etwas, das den Vault umbaut oder abgleicht, ändert Kortex jetzt nichts.
      if (vault.umstellungLaeuft() || existsSync(join(vault.wurzel, ".git", "MERGE_HEAD")) || vault.gitBeschaeftigt()) {
        throw new HttpFehler(409, "Gerade läuft ein Abgleich oder eine Zusammenführung (oder Kortex räumt den Vault auf). Versuche es gleich noch einmal — es wurde nichts entfernt.", { art: "beschaeftigt" });
      }
      // Git: nur eine versionierte, gegenüber HEAD unveränderte Datei darf per Commit entfernt werden (ls-files + diff); alles andere (nicht versioniert, ignoriert, geändert, kein Repo) nicht
      let versioniert = false;
      try { versioniert = (await vault.gitVersioniert(rel)) === true; } catch { versioniert = false; }
      // IMMER erst eine Kopie in den Papierkorb von Kortex: im schlimmsten Fall wurde eine Datei nur verschoben
      const korb = join(aktivitaetOrdner(support), "papierkorb", kennung);
      mkdirSync(korb, { recursive: true, mode: 0o700 });
      const kopie = join(korb, `${e.id}-${basename(rel)}`);
      copyFileSync(abs, kopie);
      if (sha(readFileSync(kopie)) !== e.rueckgaengig.hash) { rmSync(kopie, { force: true }); throw new HttpFehler(409, "Die Notiz wurde seit der Ablage geändert. Kortex entfernt sie nicht — öffne sie und entscheide selbst.", { art: "geaendert" }); }
      papierkorbAufraeumen(kennung);
      // unmittelbar vor dem Löschen noch einmal prüfen (zwischen Lesen und Löschen kann jemand die Datei ändern)
      let jetzt = null; try { jetzt = readFileSync(abs); } catch { jetzt = null; }
      if (!jetzt || sha(jetzt) !== e.rueckgaengig.hash) { rmSync(kopie, { force: true }); throw new HttpFehler(409, "Die Notiz wurde seit der Ablage geändert. Kortex entfernt sie nicht — öffne sie und entscheide selbst.", { art: "geaendert" }); }
      unlinkSync(abs);
      let commit = null;
      if (versioniert) {
        try { commit = (await vault.gitCommit({ nachricht: `Rückgängig: Ablage einer KI entfernt (${rel})`, dateien: [rel] }, { ohneHooks: true })).sha || null; }
        catch (err) {
          // Der Commit ist gescheitert: die Datei kommt zurück (aus der Kopie), nichts gilt als entfernt
          try { copyFileSync(kopie, abs, constants.COPYFILE_EXCL); } catch { /* die Kopie im Papierkorb bleibt */ }
          throw new HttpFehler(500, `Das Entfernen konnte nicht festgehalten werden${err && err.message ? ` (${String(err.message).slice(0, 120)})` : ""}. Die Datei ist unverändert geblieben.`, { art: "festhalten-fehlgeschlagen" });
        }
      }
      return merke("entfernt", { commit, papierkorb: true });
    });
  }

  // Die Anmeldung eines Kontos ist abgelaufen (aus /api/ki/anmeldung): höchstens alle 6 Stunden je Konto ein Ereignis.
  function anmeldungAbgelaufen(v, kontoId) {
    if (!v) return null;
    const k = kontoVon(kontoId);
    if (!k) return null;
    const e = melde(v.wurzel, { art: "anmeldung-abgelaufen", konto: kontoId, programm: k.programm, wer: `${programmAnzeige(k.programm) || "KI"} · ${k.name || ""}`.replace(/ · $/, ""), vaultName: v.name,
      text: "muss sich neu anmelden. Die Pflege läuft bis dahin ohne KI." }, { support, drossel: { schluessel: `anm|${kontoId}`, sekunden: 6 * 3600 } });
    if (e) ereignisse?.pruefeAktivitaet?.();
    return e;
  }

  return { lesen, gelesen, rueckgaengig, anmeldungAbgelaufen, protokollKennungen: () => protokollKennungen(support) };
}
