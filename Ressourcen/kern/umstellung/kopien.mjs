// umstellung/kopien.mjs — Probekopien und Protokoll für die Oberfläche (Paket P7c). Der Probelauf legt seine Kopie in $TMPDIR/kortex-probelauf-<Kennung>-… an (bei Zustimmung auch als Nachbarordner
// des Vaults) und behält sie nach einem roten Ergebnis 7 Tage. Hier: sie finden (nur lesend), „Kopie jetzt löschen“ und das Protokoll ohne Werte zeigen.
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";
import { kennung, raeumeWeg, ordnerGroesseGrob } from "./ziele.mjs";
import { ablageOrdner, liesProtokoll, protokolliere } from "./protokoll.mjs";

const praefix = (z) => `kortex-probelauf-${kennung(z.vault)}-`;
const echt = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

// → [{ ort, nachbar }] – echte Ordner (keine Verweise) mit dem Namen dieses Vaults im Temp-Ordner und neben dem Vault; der Vault selbst nie
export function probekopien(z, { tmp = tmpdir() } = {}) {
  const treffer = [];
  const eigener = echt(z.vault);
  for (const [basis, nachbar] of [[tmp, false], [dirname(z.vault), true]]) {
    let namen = [];
    try { namen = readdirSync(basis); } catch { continue; }
    for (const name of namen) {
      if (!name.startsWith(praefix(z))) continue;
      const ort = join(basis, name);
      let l;
      try { l = lstatSync(ort); } catch { continue; }
      if (l.isSymbolicLink() || !l.isDirectory() || echt(ort) === eigener) continue;
      if (!treffer.some((t) => t.ort === ort)) treffer.push({ ort, nachbar });
    }
  }
  return treffer;
}

// Löscht alle Probekopien dieses Vaults (nie das Original, nie etwas anderes). → { geloescht, uebrig }
export function loescheProbekopien(z, { tmp = tmpdir() } = {}) {
  const liste = probekopien(z, { tmp });
  for (const k of liste) raeumeWeg(k.ort);
  const uebrig = probekopien(z, { tmp }).length;
  protokolliere(z, { lauf: "original", schritt: "Kopie", ereignis: uebrig ? "fehler" : "ok", anzahl: liste.length - uebrig, grund: uebrig ? "kopie-nicht-entfernbar" : "kopie-geloescht" });
  return { geloescht: liste.length - uebrig, uebrig };
}

// Plan (ohne Bestätigung): was liegt da, wie groß ungefähr
export function planKopienLoeschen(z, { tmp = tmpdir() } = {}) {
  const liste = probekopien(z, { tmp });
  return { anzahl: liste.length, groesseGrob: liste.reduce((a, k) => a + ordnerGroesseGrob(k.ort), 0) };
}

const ZEILEN_MAX = 200;
const kurzPfad = (p) => { const h = homedir(); return p === h ? "~" : p.startsWith(h + "/") ? "~" + p.slice(h.length) : p; };

// Protokoll für die Oberfläche: Ablageort im Support-Ordner und die letzten Zeilen – nur Zeit, Lauf, Schritt, Ereignis, Anzahl und der feste Grund-Code, nie Pfade der Sicherungen, Hashes oder Werte.
export function protokollAnsicht(z) {
  const alle = liesProtokoll(z);
  const zeilen = alle.slice(-ZEILEN_MAX).map((e) => {
    const o = {};
    for (const k of ["zeit", "lauf", "schritt", "ereignis", "anzahl", "grund"]) if (e[k] !== undefined && e[k] !== null) o[k] = typeof e[k] === "string" ? e[k].slice(0, 120) : e[k];
    return o;
  });
  return { ok: true, ordner: kurzPfad(ablageOrdner(z)), datei: "protokoll.jsonl", zeilen, gekuerzt: alle.length > zeilen.length, gesamt: alle.length };
}
