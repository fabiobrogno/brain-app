// Entwurfs-Journal (Absturzschutz), Seite des Studios. Ungespeicherter Text wird alle paar Sekunden und beim Verlassen des Fensters über die Werkstatt in den
// Support-Ordner geschrieben (gemeinsam/entwurf.mjs) und nach jedem erfolgreichen Speichern gelöscht. Es ist ein Zusatzschutz: der Text liegt sonst nur im Speicher der WebView.
// Das Journal schreibt nur, wenn der Text wirklich ungespeichert ist — im Normalfall (Speichern nach 0,8 s) kommt es nie zum Zug.
// Das Journal gehört zu EINEM Vault: gemerkt wird nach Vault und Pfad, und beim Vault-Wechsel (zuruecksetzen) endet alles, was noch in der Reihe steht — sonst ginge ein
// Schreiben oder Löschen an den falschen Vault (die Werkstatt kennt immer nur den gerade geöffneten).
//
// ctx: { api, lies: () => { pfad, text, basisHash, dirty } | null, vault: () => string (Kennung des geöffneten Vaults), intervallMs }
// Schlüssel (Pfad im Journal) für den Entwurf einer neuen Notiz ohne Datei; gemeinsam/entwurf.mjs kennt ihn als Präfix `entwurf:`
export const entwurfSchluessel = (id) => `entwurf:${id}`;

export function erzeugeJournal({ api, lies, vault = () => "", intervallMs = 5000 }) {
  let timer = null;
  let generation = 0;              // zählt Vault-Wechsel: Aufträge aus einer früheren Generation laufen nicht mehr
  const geschrieben = new Map();   // Vault + Pfad → zuletzt geschriebener Text (nur was wir selbst geschrieben haben, wird wieder gelöscht)
  let laeuft = Promise.resolve();
  const schluessel = (v, pfad) => `${v}\0${pfad}`;
  const reihe = (fn) => { const g = generation; laeuft = laeuft.then(() => (g === generation ? fn() : undefined)); return laeuft; };

  // erzwingen: auch dann schreiben, wenn derselbe Text schon im Journal steht — der Entwurf bekommt eine frische Zeit (er soll NEUER sein als die Datei, wenn die sich von außen geändert hat)
  function schreibeJetzt(erzwingen = false) {
    clearTimeout(timer); timer = null;
    const s = lies();
    if (!s || !s.pfad || !s.dirty) return laeuft;
    const k = schluessel(vault(), s.pfad);
    if (!erzwingen && geschrieben.get(k) === s.text) return laeuft;
    geschrieben.set(k, s.text); // schon beim Einreihen merken: ein Löschen nach dem Speichern kommt in der Reihe NACH diesem Schreiben
    const g = generation;
    return reihe(async () => {
      try { await api.entwurfSchreiben(s.pfad, s.basisHash ?? null, s.text); }
      catch { if (g === generation && geschrieben.get(k) === s.text) geschrieben.delete(k); plane(); } // Werkstatt weg: beim nächsten Anlauf erneut
    });
  }
  // Solange ungespeichert getippt wird, höchstens alle intervallMs ein Eintrag (nicht bei jedem Tastendruck; der Zeitgeber wird nicht neu gestartet)
  function plane() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; const s = lies(); schreibeJetzt(); if (s && s.dirty) plane(); }, intervallMs);
  }
  // Text ist gespeichert: Entwurf (falls wir einen geschrieben haben) wieder löschen
  function nachSpeichern(pfad) {
    clearTimeout(timer); timer = null;
    const k = schluessel(vault(), pfad);
    if (!geschrieben.has(k)) return laeuft;
    geschrieben.delete(k);
    return reihe(() => api.entwurfLoeschen(pfad).catch(() => {}));
  }
  // Der Entwurf ist erledigt (wiederhergestellt oder verworfen): löschen, auch wenn dieses Fenster ihn nicht geschrieben hat
  function loesche(pfad) {
    geschrieben.delete(schluessel(vault(), pfad));
    return reihe(() => api.entwurfLoeschen(pfad).catch(() => {}));
  }
  // Eine Notiz (oder ein Ordner) wurde umbenannt/verschoben: die Werkstatt zieht die Entwürfe mit, hier folgen die gemerkten Schlüssel (sonst bliebe nach dem Speichern ein Entwurf am neuen Pfad liegen)
  function verschiebe(von, nach) {
    const v = vault(), pre = schluessel(v, von);
    for (const [k, t] of [...geschrieben]) {
      if (k === pre || k.startsWith(pre + "/")) { geschrieben.delete(k); geschrieben.set(schluessel(v, nach) + k.slice(pre.length), t); }
    }
    return reihe(() => api.entwurfVerschieben(von, nach).catch(() => {}));
  }
  const stopp = () => { clearTimeout(timer); timer = null; };
  // Vault-Wechsel: nichts aus dem alten Vault darf mehr in den neuen schreiben oder dort löschen
  function zuruecksetzen() { stopp(); generation++; geschrieben.clear(); laeuft = Promise.resolve(); }
  return { plane, schreibeJetzt, nachSpeichern, loesche, verschiebe, stopp, zuruecksetzen, warte: () => laeuft };
}
