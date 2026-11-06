// Aktives Konto je Programm (Einstellungen → KI & Konten → Konten), Seite des Studios.
// Das aktive Konto steht in ki-konten.json (Werkstatt, PUT /api/ki/aktiv), nicht im Browser. Früher merkte sich das Studio die Wahl für Frag je Vault in localStorage
// (`brain-studio.frage.konto@<Vault>`); diese Wahl wird EINMAL übernommen und danach aus dem Speicher gelöscht. Die Planung (planeUebernahme) ist eine reine Funktion ohne DOM.

export const LOKAL_PRAEFIX = "brain-studio.frage.konto@";
export const MARKE = "brain-studio.konten.aktiv-uebernommen";

// eintraege: [{ vault, konto }] aus dem lokalen Speicher · konten: [{ id, programm }] aus der Liste · aktiv: { programm: kontoId } aus der Liste · vault: der offene Vault (seine Wahl gilt zuerst)
// → { setze: [{ programm, konto }] (nur wo noch kein aktives Konto gilt), loesche: alle Vault-Schlüssel }
export function planeUebernahme({ eintraege = [], konten = [], aktiv = {}, vault = null } = {}) {
  const bekannt = new Map((Array.isArray(konten) ? konten : []).map((k) => [k.id, k]));
  const liste = [...eintraege].sort((a, b) => (a.vault === vault ? 0 : 1) - (b.vault === vault ? 0 : 1));
  const setze = [], schon = new Set(Object.keys(aktiv || {}).filter((p) => aktiv[p]));
  for (const e of liste) {
    const k = bekannt.get(e.konto);
    if (!k || schon.has(k.programm)) continue;
    schon.add(k.programm);
    setze.push({ programm: k.programm, konto: k.id });
  }
  return { setze, loesche: eintraege.map((e) => e.vault) };
}

const lies = () => {
  const r = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(LOKAL_PRAEFIX)) continue;
      let w = null; try { w = JSON.parse(localStorage.getItem(k)); } catch { /* kaputt: wird nur gelöscht */ }
      r.push({ vault: k.slice(LOKAL_PRAEFIX.length), konto: typeof w === "string" ? w : null });
    }
  } catch { /* ohne Speicher */ }
  return r;
};

let laeuft = null;
// Einmalig: übernimmt die frühere Wahl in ki-konten.json. stand = Antwort von GET /api/ki/konten (oder eines schreibenden Aufrufs). → true, wenn etwas gesetzt wurde.
// Scheitert das Schreiben, bleibt der lokale Wert liegen (der nächste Start versucht es noch einmal); die Marke setzt erst der erfolgreiche Lauf.
export function uebernehmeLokaleWahl(api, stand, { vault = null } = {}) {
  if (laeuft) return laeuft;
  try { if (localStorage.getItem(MARKE)) return Promise.resolve(false); } catch { return Promise.resolve(false); }
  if (!stand || stand.zustand !== "ok" || !Array.isArray(stand.konten)) return Promise.resolve(false); // ohne lesbare Liste nichts übernehmen und nichts löschen
  const eintraege = lies();
  laeuft = (async () => {
    let geaendert = false;
    try {
      const plan = planeUebernahme({ eintraege, konten: stand.konten, aktiv: stand.aktiv || {}, vault });
      for (const s of plan.setze) { await api.kiAktiv(s.programm, s.konto); geaendert = true; }
      try { for (const v of plan.loesche) localStorage.removeItem(LOKAL_PRAEFIX + v); localStorage.setItem(MARKE, "1"); } catch { /* ohne Speicher */ }
    } catch { /* der lokale Wert bleibt */ }
    finally { laeuft = null; }
    if (geaendert) { try { window.dispatchEvent(new CustomEvent("kortex-konten")); } catch { /* egal */ } }
    return geaendert;
  })();
  return laeuft;
}

// Beim Start des Studios (mit offenem Vault): gibt es eine frühere Wahl im lokalen Speicher, wird sie übernommen; gibt es keine, geschieht nichts (auch kein Abruf). Höchstens einmal je Fenster.
let beimStart = false;
export function uebernehmeBeimStart(api, { vault = null } = {}) {
  if (beimStart) return;
  beimStart = true;
  try { if (localStorage.getItem(MARKE)) return; if (!lies().length) { localStorage.setItem(MARKE, "1"); return; } } catch { return; }
  Promise.resolve(api.kiKonten()).then((s) => uebernehmeLokaleWahl(api, s, { vault })).catch(() => { beimStart = false; });
}
