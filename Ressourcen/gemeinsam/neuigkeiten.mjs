// gemeinsam/neuigkeiten.mjs — „Was ist neu“: die Zusammenfassung seit dem letzten Besuch (oder seit einer gewählten Zeit), nur aus lokalen Daten, ohne KI.
// Rein: baueNeuigkeiten() rechnet aus den Zeilen des Notiz-Index, den Aufgaben, dem Aktivitätsprotokoll (#78) und dem Git-Status (#67/#73). Dazu der Merker „gelesen bis“ je Vault
// (<support>/neuigkeiten/<Kennung>.json, außerhalb des Vaults, atomar). Genutzt von der Werkstatt (GET /api/neuigkeiten) und vom MCP-Server (brain_neuigkeiten).
import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const STANDARD_TAGE = 7;     // ohne Merker und ohne Auswahl: die letzten sieben Tage
export const MAX_LISTE = 5;         // so viele Einträge je Zeile nennt die Antwort
const TAG_MS = 86400e3;
const ms = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? t : null; };
const istNotiz = (n) => ["inbox", "notiz", "wissen"].includes(n.bereich) && !n.generiert;

const spaeterBis = (n) => { const w = n?.felder?.spaeter_bis; return typeof w === "string" && /^\d{4}-\d{2}-\d{2}$/.test(w.trim()) ? w.trim() : null; };

// ───────────── Merker „gelesen bis“ ─────────────
const ordner = (support) => join(support, "neuigkeiten");
const datei = (support, kennung) => join(ordner(support), `${kennung}.json`);
export function leseMarke(support, kennung) {
  try {
    const j = JSON.parse(readFileSync(datei(support, kennung), "utf8"));
    return typeof j.gelesenBis === "string" && ms(j.gelesenBis) !== null ? new Date(ms(j.gelesenBis)).toISOString() : null;
  } catch { return null; }
}
export function setzeMarke(support, kennung, bis) {
  const t = ms(bis);
  if (t === null) throw new Error("Zeitangabe ungültig");
  mkdirSync(ordner(support), { recursive: true, mode: 0o700 });
  const d = datei(support, kennung), tmp = `${d}.${process.pid}.tmp`;
  const iso = new Date(t).toISOString();
  try { writeFileSync(tmp, JSON.stringify({ gelesenBis: iso }) + "\n", { mode: 0o600 }); renameSync(tmp, d); } catch (e) { try { unlinkSync(tmp); } catch { /* weg */ } throw e; }
  return iso;
}

// ───────────── Abgleich-Zustand in einem Satz ─────────────
export function syncZustand(git) {
  if (!git) return { zustand: "unbekannt", text: "Der Abgleich-Stand ist gerade nicht zu lesen." };
  if (git.gesperrt) return { zustand: "gesperrt", text: "Git ist für diesen Vault gesperrt (noch nicht als deiner bestätigt)." };
  if (!git.repo) return { zustand: "kein-git", text: "Dieser Vault wird nicht mit Git gesichert." };
  const geaendert = Array.isArray(git.geaendert) ? git.geaendert.length : 0;
  if (git.konflikt) return { zustand: "konflikt", text: "Beim Abgleich gibt es einen Konflikt, der auf dich wartet.", geaendert };
  if (!git.remote) return { zustand: "kein-remote", text: geaendert ? `Nur lokal gesichert · ${geaendert} ${geaendert === 1 ? "Änderung" : "Änderungen"} noch nicht gesichert.` : "Nur lokal gesichert, ohne Ziel im Netz.", geaendert };
  const vor = git.vor || 0, zurueck = git.zurueck || 0;
  if (zurueck > 0) return { zustand: "holen", text: `${zurueck} ${zurueck === 1 ? "Stand wartet" : "Stände warten"} auf dem Server.`, vor, zurueck, geaendert };
  if (vor > 0 || geaendert > 0) return { zustand: "senden", text: `${geaendert ? `${geaendert} ${geaendert === 1 ? "Änderung" : "Änderungen"} noch nicht gesichert` : ""}${geaendert && vor ? " · " : ""}${vor ? `${vor} ${vor === 1 ? "Stand" : "Stände"} noch nicht gesendet` : ""}.`, vor, zurueck, geaendert };
  return { zustand: "ok", text: git.letzterSync ? "Alles abgeglichen." : "Nichts offen.", vor, zurueck, geaendert, letzterSync: git.letzterSync || null };
}

/**
 * eingabe: { seit (ISO | null), jetzt (Date), heute ("JJJJ-MM-TT"), notizen: [Zeilen des Notiz-Index] | null, aufgaben: [Aufgaben] | null, ereignisse: [Einträge des Protokolls] | null, git: Antwort von git.status | null }
 * → { seit, bis, notizen, aufgaben, ki, sync, inbox, leer }   (null-Quellen werden als „nicht verfügbar“ gemeldet, nie erfunden)
 */
export function baueNeuigkeiten({ seit, jetzt = new Date(), heute, notizen = null, aufgaben = null, ereignisse = null, git = null }) {
  const bis = jetzt.getTime();
  const seitMs = ms(seit) ?? bis - STANDARD_TAGE * TAG_MS;
  const nach = (iso) => { const t = ms(iso); return t !== null && t > seitMs; };
  const kurz = (liste, abbilden) => liste.slice(0, MAX_LISTE).map(abbilden);

  let n = null;
  if (Array.isArray(notizen)) {
    const alle = notizen.filter(istNotiz);
    const neu = alle.filter((x) => nach(x.erstellt)).sort((a, b) => (a.erstellt < b.erstellt ? 1 : -1));
    const neuSet = new Set(neu.map((x) => x.pfad));
    const geaendert = alle.filter((x) => !neuSet.has(x.pfad) && nach(x.geaendert)).sort((a, b) => (a.geaendert < b.geaendert ? 1 : -1));
    n = { neu: neu.length, geaendert: geaendert.length,
      neuListe: kurz(neu, (x) => ({ pfad: x.pfad, titel: x.titel, zeit: x.erstellt })), geaendertListe: kurz(geaendert, (x) => ({ pfad: x.pfad, titel: x.titel, zeit: x.geaendert })) };
  }

  let a = null;
  if (Array.isArray(aufgaben)) {
    const neu = aufgaben.filter((x) => nach(x.erstellt)).sort((p, q) => ((p.erstellt || "") < (q.erstellt || "") ? 1 : -1));
    const erledigt = aufgaben.filter((x) => x.status === "erledigt" && nach(x.geaendert)).sort((p, q) => ((p.geaendert || "") < (q.geaendert || "") ? 1 : -1));
    const ueber = aufgaben.filter((x) => x.status !== "erledigt" && typeof x.faellig === "string" && heute && x.faellig < heute).sort((p, q) => (p.faellig < q.faellig ? -1 : 1));
    const zeile = (x) => ({ pfad: x.pfad, titel: x.titel, ...(x.faellig ? { faellig: x.faellig } : {}) });
    a = { neu: neu.length, erledigt: erledigt.length, ueberfaellig: ueber.length, neuListe: kurz(neu, zeile), erledigtListe: kurz(erledigt, zeile), ueberfaelligListe: kurz(ueber, zeile) };
  }

  let ki = null;
  if (Array.isArray(ereignisse)) {
    const im = ereignisse.filter((e) => nach(e.zeit));
    const abgelegt = im.filter((e) => e.art === "ablage-aufgabe" || e.art === "ablage-notiz");
    const abgewiesen = im.filter((e) => e.art === "abweisung");
    const neueste = (l) => l.slice().sort((p, q) => (p.zeit < q.zeit ? 1 : -1));
    const zeile = (e) => ({ id: e.id, art: e.art, zeit: e.zeit, text: e.text || "", ...(Array.isArray(e.pfade) && e.pfade[0] ? { pfad: e.pfade[0] } : {}), ...(e.programm ? { programm: e.programm } : {}) });
    ki = { abgelegt: abgelegt.length, abgewiesen: abgewiesen.length, abgelegtListe: kurz(neueste(abgelegt), zeile), abgewiesenListe: kurz(neueste(abgewiesen), zeile) };
  }

  const sync = syncZustand(git);

  let inbox = null;
  if (Array.isArray(notizen)) {
    const im = notizen.filter((x) => x.bereich === "inbox" && !x.generiert);
    const spaeter = im.filter((x) => heute && spaeterBis(x) && spaeterBis(x) > heute).length;
    inbox = { anzahl: im.length - spaeter, zurueckgestellt: spaeter };
  }

  const leer = !((n && (n.neu || n.geaendert)) || (a && (a.neu || a.erledigt)) || (ki && (ki.abgelegt || ki.abgewiesen)));
  return { seit: new Date(seitMs).toISOString(), bis: new Date(bis).toISOString(), notizen: n, aufgaben: a, ki, sync, inbox, leer };
}

/** Kurztext für den MCP-Server (brain_neuigkeiten): wenige Zeilen, ohne Inhalte der Notizen. */
export function neuigkeitenText(r) {
  const z = [];
  const dat = (iso) => String(iso).slice(0, 16).replace("T", " ");
  z.push(`Neuigkeiten seit ${dat(r.seit)} (UTC)`);
  if (r.notizen) z.push(`Notizen: ${r.notizen.neu} neu, ${r.notizen.geaendert} geändert${r.notizen.neuListe.length ? ` · neu: ${r.notizen.neuListe.map((x) => `${x.titel} (${x.pfad})`).join("; ")}` : ""}`);
  if (r.aufgaben) z.push(`Aufgaben: ${r.aufgaben.neu} neu, ${r.aufgaben.erledigt} erledigt, ${r.aufgaben.ueberfaellig} überfällig${r.aufgaben.ueberfaelligListe.length ? ` · überfällig: ${r.aufgaben.ueberfaelligListe.map((x) => `${x.titel} (fällig ${x.faellig})`).join("; ")}` : ""}`);
  if (r.ki) z.push(`KI-Aktivität: ${r.ki.abgelegt} abgelegt, ${r.ki.abgewiesen} abgewiesen`);
  z.push(`Abgleich: ${r.sync.text}`);
  if (r.inbox) z.push(`Posteingang: ${r.inbox.anzahl} offen${r.inbox.zurueckgestellt ? `, ${r.inbox.zurueckgestellt} zurückgestellt` : ""}`);
  return z.join("\n");
}
