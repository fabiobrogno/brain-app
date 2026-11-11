// Rückgängig überall (R4-4): der Stapel der Vorgänge dieser Sitzung (Papierkorb, Verschieben, Umbenennen, Tag umbenennen, Verlinken).
// ⌘Z außerhalb des Editors nimmt den obersten zurück, ⇧⌘Z stellt den zuletzt zurückgenommenen wieder her. Im Editor gilt weiter der Stapel des Editors (CodeMirror).
// Die Arbeit macht die Werkstatt (Journal: POST /api/aktivitaet/rueckgaengig bzw. /wiederherstellen); hier steht nur die Reihenfolge.
// Regel: nie über einen Vault-Wechsel hinweg (ein Eintrag gehört zu genau einem Vault), eine neue Aktion leert die Wiederholen-Liste.
const MAX = 50;
let fertig = [];   // neueste zuletzt: { id, art, vault }
let zurueck = [];  // zurückgenommen, neueste zuletzt
let unterwegs = null; // der Eintrag, den nimmFertig/nimmZurueck gerade herausgegeben hat (er kommt mit markiere… auf die andere Seite)

const lies = (vault) => { if (fertig.concat(zurueck).some((e) => e.vault !== vault)) { fertig = []; zurueck = []; } };

// Ein neuer Vorgang ist erledigt. `rueck` ist optional (Weg mit eigener Oberflächenpflege, z. B. Tags); ohne ihn geht der allgemeine Weg.
export function merke({ id, art, vault, rueck = null }) {
  if (!id) return;
  lies(vault);
  fertig = fertig.filter((e) => e.id !== id).concat({ id, art, vault, rueck }).slice(-MAX);
  zurueck = [];
}
// Nimmt den obersten Eintrag heraus (er kommt über markiereZurueck auf die andere Seite, sobald es geklappt hat).
export function nimmFertig(vault) { lies(vault); unterwegs = fertig.pop() || null; return unterwegs; }
export function nimmZurueck(vault) { lies(vault); unterwegs = zurueck.pop() || null; return unterwegs; }
const hole = (id) => (unterwegs?.id === id ? unterwegs : null);
export function markiereZurueck(id, vault, art) {
  const e = fertig.find((x) => x.id === id) || hole(id) || { id, art, vault, rueck: null };
  fertig = fertig.filter((x) => x.id !== id);
  zurueck = zurueck.filter((x) => x.id !== id).concat(e);
}
export function markiereWieder(id) {
  const e = zurueck.find((x) => x.id === id) || hole(id);
  zurueck = zurueck.filter((x) => x.id !== id);
  if (e) fertig = fertig.filter((x) => x.id !== id).concat(e);
}
// Ein Schritt ist nicht gelungen (Abgleich läuft, Netz weg, „Abbrechen“ im Dialog …): der Eintrag kommt oben zurück, der nächste Druck versucht denselben Vorgang noch einmal.
export function legeZurueck(e, wieder = false) {
  if (!e) return;
  unterwegs = null;
  if (wieder) zurueck = zurueck.filter((x) => x.id !== e.id).concat(e); else fertig = fertig.filter((x) => x.id !== e.id).concat(e);
}
// Fehler, nach denen es nie mehr geht: der Eintrag ist wirklich weg (alles andere kann beim nächsten Versuch klappen)
export const istEndgueltig = (e) => e?.status === 404 || (e?.status === 409 && ["schon-zurueck", "nicht-zurueck", "keine-kopie"].includes(e?.daten?.art));
export function verwirf(id) { fertig = fertig.filter((e) => e.id !== id); zurueck = zurueck.filter((e) => e.id !== id); }
export const leeren = () => { fertig = []; zurueck = []; };
export const stand = () => ({ fertig: fertig.length, zurueck: zurueck.length });
