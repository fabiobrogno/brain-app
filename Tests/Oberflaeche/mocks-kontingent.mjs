// Attrappe für die Routen des Kontingents (Paket P7): GET /api/ki/kontingent[?neu=1] und POST /api/ki/kontingent/statuszeile. Antwortformen wie werkstatt/kontingent.mjs (stand):
// { jetzt, takt, konten: [{ id, programm, name, standard, quelle, status, session, weekly, aktualisiert, … }] }.
// Zustand und Anfragen stehen im zurückgegebenen Objekt: z.anfragen = [{ methode, pfad, body }]. Die Uhr ist fest (z.jetzt), damit Rücksetzzeiten in Bildern und Tests gleich bleiben.
export const JETZT = Date.parse("2026-10-31T12:00:00.000Z"); // 13:00 in Berlin (Samstag)
const min = (n) => n * 60_000, std = (n) => n * 3_600_000;

// Fenster: p = Prozent, in = ms bis zur Rücksetzung
export const fenster = (p, inMs, minuten = 300) => ({ usedPercent: p, windowMinutes: minuten, resetsAt: JETZT + inMs });
export const sitzung = (p, inMs = std(2) + min(14)) => fenster(p, inMs, 300);
export const woche = (p, inMs = std(30) + min(0)) => fenster(p, inMs, 10080);

// Fertige Zustände (ohne id/name/programm; die setzt mockeKontingent aus der Kontenliste)
export const ZUSTAND = {
  claudeOk: (s, w, extra = {}) => ({ quelle: "statuszeile", verwaltet: false, bestaetigungNoetig: true, eingetragen: true, kette: false, status: "ok", session: s === null ? null : sitzung(s), weekly: w === null ? null : woche(w), aktualisiert: new Date(JETZT - min(1)).toISOString(), ...extra }),
  claudeVeraltet: (s, w) => ({ quelle: "statuszeile", verwaltet: false, bestaetigungNoetig: true, eingetragen: true, status: "veraltet", session: sitzung(s, std(1)), weekly: woche(w), aktualisiert: new Date(JETZT - min(95)).toISOString() }),
  nichtEingerichtet: (extra = {}) => ({ quelle: "statuszeile", verwaltet: false, bestaetigungNoetig: true, status: "nicht-eingerichtet", ...extra }),
  keineWerte: () => ({ quelle: "statuszeile", verwaltet: false, bestaetigungNoetig: true, eingetragen: true, status: "keine-werte" }),
  ohneKontingent: () => ({ quelle: "statuszeile", verwaltet: false, bestaetigungNoetig: true, eingetragen: true, status: "ohne-kontingent", aktualisiert: new Date(JETZT - min(3)).toISOString() }),
  geaendert: () => ({ quelle: "statuszeile", verwaltet: false, bestaetigungNoetig: true, status: "geaendert", fremdeStatuszeile: true }),
  defekt: () => ({ quelle: "statuszeile", verwaltet: false, bestaetigungNoetig: true, status: "einstellungen-defekt" }),
  codexOk: (s, w) => ({ quelle: "codex", status: "ok", session: s === null ? null : sitzung(s, std(4) + min(2)), weekly: w === null ? null : woche(w, std(43)), aktualisiert: new Date(JETZT - min(4)).toISOString(), abgefragt: new Date(JETZT - min(4)).toISOString(), neuAb: new Date(JETZT + min(1)).toISOString() }),
  codexAlt: (s, w) => ({ quelle: "codex", status: "ok", session: sitzung(s), weekly: woche(w), aktualisiert: new Date(JETZT - min(8)).toISOString(), abgefragt: new Date(JETZT - min(8)).toISOString(), neuAb: new Date(JETZT - min(3)).toISOString() }),
  codexFehler: (art) => ({ quelle: "codex", status: "fehler", fehlerArt: art, abgefragt: new Date(JETZT - min(1)).toISOString(), neuAb: new Date(JETZT + min(4)).toISOString() }),
  codexLaedt: () => ({ quelle: "codex", status: "laedt", abgefragt: new Date(JETZT).toISOString() }),
  nichtAbrufbar: (programmName) => ({ quelle: null, status: "nicht-abrufbar", programmName }),
};

// opt.konten: [{ id, programm, name, standard, verwaltet? }] · opt.werte: { <konto>: Zustand } · opt.jetzt · opt.fehler: GET schlägt fehl (Text)
export async function mockeKontingent(page, { konten, werte = {}, jetzt = JETZT, fehler = null, schalterFehler = null } = {}) {
  const z = { konten, werte: { ...werte }, jetzt, anfragen: [], fehler, schalterFehler };
  // stufe: die Stufe des Kontos im offenen Vault (wie die Werkstatt sie aus der Liste der Konten liest); ohne Angabe: verbundene Konten „posteingang“, übrige „gesperrt“ (wie mockeKonten)
  const liste = () => z.konten.map((k) => ({ id: k.id, programm: k.programm, name: k.name, standard: k.standard === true, stufe: k.stufe || (k.verbunden ? "posteingang" : "gesperrt"), ...(z.werte[k.id] || ZUSTAND.nichtAbrufbar()), ...(k.verwaltet ? { verwaltet: true, bestaetigungNoetig: false } : {}) }));
  const stand = () => ({ jetzt: new Date(z.jetzt).toISOString(), takt: { abfrageMs: 900_000, neuFruehestensMs: 300_000, veraltetMs: 1_800_000 }, konten: liste() });
  await page.route(/\/api\/ki\/kontingent(\?.*)?$/, (route) => {
    z.anfragen.push({ methode: route.request().method(), pfad: "/api/ki/kontingent", body: { neu: new URL(route.request().url()).searchParams.get("neu") } });
    if (z.fehler) return route.fulfill({ status: 500, json: { fehler: z.fehler } });
    return route.fulfill({ json: stand() });
  });
  await page.route("**/api/ki/kontingent/statuszeile", (route) => {
    let b = {}; try { b = JSON.parse(route.request().postData() || "{}"); } catch { /* leer */ }
    z.anfragen.push({ methode: "POST", pfad: "/api/ki/kontingent/statuszeile", body: b });
    const k = z.konten.find((x) => x.id === b.konto);
    if (z.schalterFehler) return route.fulfill({ status: 409, json: { fehler: z.schalterFehler, art: "einstellungen-defekt" } });
    if (!k) return route.fulfill({ status: 404, json: { fehler: "Dieses Konto kennt Kortex nicht (mehr)." } });
    if (b.einwilligung !== true) return route.fulfill({ status: 409, json: { fehler: "Kortex ändert die Einstellungen von Claude Code nur nach deinem Klick.", art: "einwilligung" } });
    if (b.an && !k.verwaltet && b.bestaetigt !== true) return route.fulfill({ status: 409, json: { fehler: "Dieses Konto liegt außerhalb von Kortex. Bestätige es auf der Seite.", art: "bestaetigung" } });
    const fremd = z.werte[k.id]?.fremdeStatuszeile === true;
    z.werte[k.id] = b.an ? ZUSTAND.keineWerte() : ZUSTAND.nichtEingerichtet();
    return route.fulfill({ json: { ok: true, aktion: b.an ? "eingetragen" : "entfernt", exakt: true, kette: b.an && fremd, stand: stand() } });
  });
  z.log = (methode) => z.anfragen.filter((a) => !methode || a.methode === methode);
  return z;
}
