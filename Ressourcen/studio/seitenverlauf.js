// Zurück und Vor wie im Browser: die Liste der geöffneten Notizen mit einer aktuellen Stelle. Reines Modell ohne Oberfläche (wird auch in Node getestet).
// Jeder Eintrag merkt Cursor und Scrollposition (zustand), damit „Zurück“ dort weitermacht, wo man aufgehört hat.
// Eine neue Notiz (nicht über Zurück/Vor geöffnet) schneidet alles hinter der aktuellen Stelle ab — wie im Browser. Ein Entwurf (neue Notiz ohne Datei) ist kein
// Eintrag: „Zurück“ führt aus ihm zur Notiz, von der man kam. Einträge, die es nicht mehr gibt, fallen beim Springen lautlos weg.

export function erzeugeSeitenverlauf({ max = 100 } = {}) {
  let liste = []; // [{ pfad, zustand }]
  let idx = -1;
  let entwurf = false; // man steht in einem Entwurf: die aktuelle Stelle bleibt liste[idx], der Entwurf liegt „dahinter“

  const eintrag = (pfad) => ({ pfad, zustand: null });
  const aktuell = () => liste[idx] ?? null;

  // Eine Notiz wurde (neu) geöffnet.
  function betreten(pfad) {
    entwurf = false;
    if (!pfad) return;
    if (aktuell()?.pfad === pfad) return;
    liste = liste.slice(0, idx + 1);
    liste.push(eintrag(pfad));
    while (liste.length > max) liste.shift();
    idx = liste.length - 1;
  }
  // Ein Entwurf wurde geöffnet: nichts dahinter bleibt als „Vor“ stehen.
  function betreteEntwurf() { entwurf = true; liste = liste.slice(0, idx + 1); }
  // Die offene Notiz verlassen: Cursor und Scrollposition der aktuellen Stelle merken (nur wenn sie zur offenen Notiz gehört).
  function verlassen(pfad, zustand) { const a = aktuell(); if (a && pfad && a.pfad === pfad && zustand) a.zustand = { ...zustand }; }

  const kannZurueck = () => (entwurf ? idx >= 0 : idx > 0);
  const kannVor = () => !entwurf && idx < liste.length - 1;
  const richtungOk = (r) => (r < 0 ? kannZurueck() : kannVor());

  // Der nächste Eintrag in Richtung r (−1 zurück, +1 vor), ohne sich zu bewegen.
  function naechster(r) {
    if (!richtungOk(r)) return null;
    return r < 0 ? (entwurf ? liste[idx] : liste[idx - 1]) : liste[idx + 1];
  }

  // Springt in Richtung r zum nächsten Eintrag, den `gibtEs(pfad)` für vorhanden hält; Tote davor werden entfernt.
  // → { pfad, zustand } (die Stelle ist schon dort) oder null (nichts mehr in dieser Richtung).
  function gehe(r, gibtEs = () => true) {
    for (;;) {
      if (!richtungOk(r)) return null;
      const ziel = r < 0 ? (entwurf ? idx : idx - 1) : idx + 1;
      const e = liste[ziel];
      if (gibtEs(e.pfad)) { idx = ziel; entwurf = false; return e; }
      liste.splice(ziel, 1);
      if (ziel <= idx) idx -= 1; // lag der Tote vor (oder auf) der aktuellen Stelle, rutscht sie mit; dahinter bleibt sie
    }
  }
  // Direkt zu Stelle i (Liste „Zurück“/„Vor“ im Menü); tote Einträge zählen hier nicht anders: der Aufrufer prüft vorher.
  function springe(i, gibtEs = () => true) {
    if (i < 0 || i >= liste.length) return null;
    const e = liste[i];
    if (!gibtEs(e.pfad)) { entferne(e.pfad); return null; }
    idx = i; entwurf = false;
    return e;
  }

  function umbenannt(alt, neu) { for (const e of liste) if (e.pfad === alt) e.pfad = neu; }
  // Ordner umbenannt oder verschoben: alle Pfade darunter folgen
  function ordnerUmbenannt(alt, neu) { for (const e of liste) if (e.pfad.startsWith(alt + "/")) e.pfad = neu + e.pfad.slice(alt.length); }
  function entferne(pfad) {
    const vor = liste.length;
    const behalten = [];
    let neuerIdx = -1;
    liste.forEach((e, i) => { if (e.pfad === pfad) return; behalten.push(e); if (i <= idx) neuerIdx = behalten.length - 1; });
    liste = behalten; idx = neuerIdx;
    for (let i = liste.length - 1; i > 0; i--) if (liste[i].pfad === liste[i - 1].pfad) { liste.splice(i, 1); if (idx >= i) idx -= 1; } // doppelte Nachbarn (A, A) zusammenlegen
    return vor !== liste.length;
  }

  // Für die Liste im Menü: neueste zuerst. richtung −1 = die Einträge hinter uns, +1 = die vor uns. → [{ i, pfad }]
  function aufzaehlen(r) {
    const aus = [];
    if (r < 0) { for (let i = (entwurf ? idx : idx - 1); i >= 0; i--) aus.push({ i, pfad: liste[i].pfad }); }
    else if (!entwurf) { for (let i = idx + 1; i < liste.length; i++) aus.push({ i, pfad: liste[i].pfad }); }
    return aus;
  }

  function leeren() { liste = []; idx = -1; entwurf = false; }

  return {
    leeren, betreten, betreteEntwurf, verlassen, kannZurueck, kannVor, naechster, gehe, springe, umbenannt, ordnerUmbenannt, entferne, aufzaehlen,
    aktuell, bei: (i) => liste[i] ?? null, zustandJetzt: () => ({ liste: liste.map((e) => e.pfad), idx, entwurf }),
  };
}
