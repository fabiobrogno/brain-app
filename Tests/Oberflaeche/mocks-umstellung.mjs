// Attrappen für die Umstellungs-Routen der Werkstatt (P7): GET hinweis|befund|stand|protokoll, POST probelauf|phase-a|rueckweg|kopie-loeschen.
// Die Antwortformen sind die der echten Routen (werkstatt/umstellung.mjs, Kern umstellung/*): Befund-Funde mit { id, kategorie, schwere, ort, anzahl, aktion, phase, text }, Probelauf
// { ok, ampel, kriterien: [{ nr, id, titel, status, grund? }], kopieBehalten }, Phase A { ok, phase, schritte, a9, mitWarnungen? } bzw. { ok: false, fehlerBei, grund, zurueckgenommen },
// Rückweg { plan: true, schritte: [{ id, titel, status, hatRueckweg }] } bzw. { ok, alles, schritte: [{ id, titel, status, hinweise }], hinweise }.
// Abschluss (P7d): POST phase-b ohne bestaetigt = Plan + Freigabe-Tor { ok, plan: true, tor: { frei, offen, probelauf, bedingungen: [{ id, titel, erfuellt, art, grund?, text, details? }] }, schritte },
// mit probelauf + bestaetigt = Probelauf wie oben, mit bestaetigt = Aufräumen { ok, phaseB, archiv, schritte, b4 } bzw. { ok: false, fehlerBei, grund, schritte, zurueckgenommen };
// GET/POST aufraeumen = Angebote { id: verwaist|archiv|sicherungen|bundles, name?, titel, text, anzahl, bytes?, tage?, ab?, faellig }.

const fund = (id, kategorie, schwere, aktion, text, extra = {}) => ({ id, kategorie, schwere, ort: "Vault", anzahl: 1, aktion, phase: "A", text, ...extra });

export const FUNDE = {
  hooks: fund("E14", "claude-hooks", "auto", "claude-hooks-umstellen", "Claude Code ruft Kortex noch über den alten Werkzeug-Ordner auf (8 Stellen).", { ort: "Claude Code (Profil Standard)", anzahl: 8 }),
  hookspfad: fund("E9", "hookspfad-alt", "auto", "hooks-umstellen", "Die Passwort-Prüfung vor dem Speichern zeigt noch auf den alten Ordner.", { ort: "Versionsverlauf des Vaults" }),
  dienst: fund("E20", "dienst-alt", "auto", "dienst-umstellen", "Der Hintergrunddienst startet noch das alte Programm.", { ort: "Hintergrunddienst" }),
  gitSchluessel: fund("E10", "git-schluessel", "frage", "git-schluessel-verschieben", "Im Versionsverlauf dieses Vaults ist eine persönliche Einstellung eingetragen, die Kortex aus Sicherheitsgründen sperrt. Kortex kann sie in deine persönlichen Einstellungen verschieben – sie gilt dann weiter nur für diesen Vault.", { ort: "Versionsverlauf des Vaults" }),
  sicherungZiel: fund("E25", "sicherung-ziel", "frage", "sicherung-bestaetigen", "Die Online-Sicherung geht an ein Ziel (per https), das du in Kortex noch nicht bestätigt hast.", { ort: "Online-Sicherung" }),
  weitereMacs: fund("E26", "weitere-macs", "frage", "weitere-macs-fragen", "Nutzt du diesen Vault auch auf einem anderen Mac? Dann stellt Kortex auf jedem Mac einzeln um."),
  kitUngesichert: fund("E2", "kit-ungesichert", "frage", "kit-archivieren", "Im alten Werkzeug-Ordner liegt eine Datei mit Änderungen, die noch nicht im Versionsverlauf gesichert ist.", { phase: "B" }),
  anweisung: fund("E18", "claude-anweisung", "hinweis", "info", "In deiner Anweisungsdatei für Claude steht noch ein Befehl aus dem alten Werkzeug-Ordner. Ersatz zum Kopieren steht im Protokoll.", { ort: "Claude Code (Profil Standard)" }),
  blocker: fund("E7", "ordnername-ungueltig", "blocker", "ordnername-beheben", "Der Wiki-Ordner ist in den Einstellungen als Pfad angegeben. Kortex kennt nur einfache Ordnernamen und würde sonst einen neuen, leeren Wiki-Ordner anlegen."),
  blockerSpaeter: fund("E3", "kit-prozesse", "blocker", "sitzungen-beenden", "Es läuft noch ein Programm aus dem alten Werkzeug-Ordner (zum Beispiel in einer offenen Claude-Sitzung).", { blockiertPhase: "B", phase: "B" }),
  mcpAnders: fund("E19", "mcp-anders", "frage", "mcp-umstellen-fragen", "Bei Codex ist unter dem Namen „brain“ ein anderer Server eingetragen als der von Kortex. Möchtest du ihn auf Kortex umstellen?", { ort: "Codex" }),
};

export const PROFILE = [{ name: "Standard", pfad: "/Users/test/.claude", standard: true }, { name: "Privat", pfad: "/Users/test/.claude-privat", standard: false }];

export function befundAntwort({ funde = [FUNDE.hooks, FUNDE.hookspfad, FUNDE.dienst, FUNDE.gitSchluessel, FUNDE.sicherungZiel, FUNDE.weitereMacs, FUNDE.kitUngesichert, FUNDE.anweisung], profile = [PROFILE[0]], kitZeit = true } = {}) {
  const zaehlung = { auto: 0, frage: 0, hinweis: 0, blocker: 0, blockerPhaseA: 0 };
  for (const f of funde) { zaehlung[f.schwere]++; if (f.schwere === "blocker" && (f.blockiertPhase || "A") === "A") zaehlung.blockerPhaseA++; }
  return { version: 1, kernVersion: "1.0.0", kitZeit, umstellbar: zaehlung.blockerPhaseA === 0, zaehlung, profile, funde };
}

const KRIT = [
  [1, "kern-status", "Kortex findet deinen Vault, die Einstellungen sind in Ordnung"], [2, "suche", "Die Suche findet deine Notizen"],
  [3, "git-sicher", "Der Versionsverlauf funktioniert, die Passwort-Prüfung vor dem Speichern läuft"], [4, "hooks", "Claude Code ruft Kortex auf"],
  [5, "mcp", "Die KI-Programme sind mit Kortex verbunden"], [6, "dienst", "Der Hintergrunddienst startet Kortex"], [7, "sicherung", "Die Sicherung ist übernommen"],
  [8, "phase-b-probe", "Auch ohne den alten Werkzeug-Ordner funktioniert alles"], [9, "original", "Dein Original wurde nicht verändert"],
];
export function probeAntwort({ rot = [], kopieBehalten = false, uebersprungen = [] } = {}) {
  const kriterien = KRIT.map(([nr, id, titel]) => ({ nr, id, titel, status: rot.includes(id) ? "rot" : uebersprungen.includes(id) ? "uebersprungen" : "gruen", ...(rot.includes(id) ? { grund: "test" } : {}) }));
  const ok = rot.length === 0;
  return { ok, ampel: ok ? "gruen" : "rot", kopieArt: "klon", kriterien, schritte: [], merker: ok, kopieBehalten: kopieBehalten ? { wurzel: "/tmp/x", kopie: "/tmp/x/vault" } : null };
}

const IDS = ["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"];
const TITEL = { A0: "Sicherung anlegen", A1: "Sicherungsziel übernehmen", A2: "Persönliche git-Einstellungen verschieben", A3: "Prüfung vor dem Speichern auf den Kern umstellen", A4: "Claude Code einklinken", A5: "KI-Programme mit Kortex verbinden", A6: "Hintergrunddienst umstellen", A7: "Anweisungsdatei für KI-Programme erneuern", A8: "Gerät im Vault vermerken" };
export function phaseAAntwort({ warnungen = false } = {}) {
  const schritte = [...IDS.map((id) => ({ id, titel: TITEL[id], status: "ok", anzahl: 1 })), { id: "A9", titel: "Prüfung am Original", status: warnungen ? "rot" : "ok" }];
  const a9 = { ampel: warnungen ? "rot" : "gruen", kriterien: KRIT.slice(0, 7).map(([nr, id, titel]) => ({ nr, id, titel, status: warnungen && id === "hooks" ? "rot" : "gruen" })) };
  return { ok: true, phase: warnungen ? null : "A", schritte, a9, ...(warnungen ? { mitWarnungen: true, hinweis: "pruefung-rot" } : {}) };
}
export const phaseAFehler = { ok: false, fehlerBei: "A4", grund: "nachpruefung-fehlgeschlagen", schritte: [{ id: "A0", titel: TITEL.A0, status: "ok" }, { id: "A4", titel: TITEL.A4, status: "fehler", grund: "nachpruefung-fehlgeschlagen" }], zurueckgenommen: true };

export const phaseBLeer = () => ({ status: null, zeit: null, archiv: null, probelauf: { vorhanden: false, gueltig: false, grund: "fehlt" }, schritte: {}, b4: null });
export const standLeer = () => ({ phase: null, kernVersion: null, schritte: {}, laeuft: false, unterbrochen: false, probelauf: null, a9: null, bundle: false, kopien: 0 });
export const standFertig = () => ({
  phase: "A", kernVersion: "1.0.0", schritte: Object.fromEntries(IDS.map((id) => [id, { status: "ok", zeit: "2026-10-30T09:00:00.000Z", anzahl: 1 }])), laeuft: false, unterbrochen: false,
  probelauf: { zeit: "2026-10-30T08:55:00.000Z", ampel: "gruen", gueltig: false }, a9: { ampel: "gruen" }, bundle: true, kopien: 0,
  phaseA: { zeit: "2026-10-30T09:00:00.000Z", kernVersion: "1.0.0" }, phaseB: phaseBLeer(), angebote: [],
});
// Stand nach dem Aufräumen: status "fertig" | "mitWarnungen" | "begonnen" | "unterbrochen"
export const standAufgeraeumt = (status = "fertig") => ({
  ...standFertig(),
  phaseB: { status, zeit: "2026-10-30T10:00:00.000Z", archiv: "kit-2026-10-30", probelauf: { vorhanden: true, ergebnis: "gruen", gueltig: true, zeit: "2026-10-30T09:50:00.000Z" },
    schritte: Object.fromEntries(B_IDS.map((id) => [id, { status: "ok", zeit: "2026-10-30T10:00:00.000Z", anzahl: 1 }])), b4: { zeit: "2026-10-30T10:00:05.000Z", ampel: status === "mitWarnungen" ? "rot" : "gruen", kriterien: b4Kriterien(status === "mitWarnungen") } },
});
const B_IDS = ["B0", "B1", "B2", "B3", "B4"];
const B_TITEL = { B0: "Sicherung angelegt", B1: "Alter Werkzeug-Ordner im Archiv", B2: "Einstellungen bereinigt", B3: "Änderung im Versionsverlauf gespeichert", B4: "Prüfung am Ende" };
const b4Kriterien = (rot = false) => KRIT.slice(0, 4).map(([nr, id, titel]) => ({ nr, id, titel, status: rot && id === "hooks" ? "rot" : "gruen" }));

// ----- Freigabe-Tor: die neun Bedingungen in fester Reihenfolge. Was der Nutzer ankreuzt (bestaetigung, restverweise) und der Probelauf rechnet die Attrappe aus dem Body bzw. dem Stand;
// alles andere steht in `offen` (Liste der Bedingungs-IDs, die rot bleiben).
export const RESTVERWEIS = { id: "E24", kategorie: "skript-alt", anzahl: 2, text: "Ein eigenes Skript von dir ruft noch ein Programm aus dem alten Werkzeug-Ordner auf (2 Stellen).", quittiert: false };
const BED = [
  ["phase-a", "Die Umstellung ist abgeschlossen", "automatisch", "Die Umstellung ist fertig und ohne Fehler im Protokoll.", "Die Umstellung ist noch nicht abgeschlossen."],
  ["release", "Kortex ist neuer als bei der Umstellung", "automatisch", "Kortex wurde seit der Umstellung aktualisiert.", "Kortex ist noch dieselbe Version wie bei der Umstellung. Warte auf das nächste Update."],
  ["wartezeit", "Die Wartezeit ist um", "automatisch", "Die Wartezeit von 7 Tagen ist um, ohne Fehler im Protokoll.", "Kortex wartet 7 Tage nach der Umstellung, damit sich Probleme zeigen können (noch 3 Tage)."],
  ["macs", "Alle Macs sind umgestellt", "automatisch", "Alle bekannten Macs sind umgestellt.", "Ein anderer Mac hat diesen Vault noch nicht umgestellt."],
  ["bestaetigung", "Kein anderer Mac nutzt die alten Werkzeuge", "bestaetigung", "Du hast bestätigt, dass kein anderer Mac die alten Werkzeuge nutzt.", "Bestätige, dass auf keinem anderen Mac dieser Vault noch mit den alten Werkzeugen läuft."],
  ["prozesse", "Es läuft nichts aus dem alten Ordner", "automatisch", "Es läuft kein Programm aus dem alten Werkzeug-Ordner.", "Es läuft noch ein Programm aus dem alten Werkzeug-Ordner. Beende offene Claude-Sitzungen."],
  ["restverweise", "Keine Verweise auf den alten Ordner mehr", "bestaetigung", "Es zeigt nichts mehr auf den alten Werkzeug-Ordner, oder du hast es bestätigt.", "Es zeigt noch etwas auf den alten Werkzeug-Ordner. Behebe es oder bestätige es mit „Ist mir bewusst“."],
  ["befund", "Der Befund ist sauber", "automatisch", "Kortex hat nichts Offenes gefunden.", "Kortex hat noch etwas Offenes gefunden."],
  ["probelauf", "Der Probelauf war in Ordnung", "probelauf", "Der Probelauf an einer Kopie war in Ordnung.", "Mache zuerst den Probelauf an einer Kopie."],
];
export function torAntwort(body = {}, z = null, { offen = [], restverweise = [RESTVERWEIS] } = {}) {
  const ent = body.entscheidungen || {};
  const pb = z?.stand?.phaseB?.probelauf;
  const probeOk = !!pb && pb.vorhanden && pb.ergebnis === "gruen" && pb.gueltig === true;
  const bedingungen = BED.map(([id, titel, art, ok, nein]) => {
    let erfuellt = !offen.includes(id);
    if (id === "bestaetigung") erfuellt = ent.keineAltenMacs === true;
    if (id === "restverweise") erfuellt = restverweise.every((r) => (ent.bewusst || []).includes(r.id));
    if (id === "probelauf") erfuellt = probeOk;
    const b = { id, titel, erfuellt, art, text: erfuellt ? ok : nein, ...(erfuellt ? {} : { grund: id === "probelauf" ? (pb?.grund || "fehlt") : "offen" }) };
    if (id === "restverweise") b.details = { liste: restverweise.map((r) => ({ ...r, quittiert: (ent.bewusst || []).includes(r.id) })) };
    return b;
  });
  const offene = bedingungen.filter((b) => !b.erfuellt).map((b) => b.id);
  return {
    ok: true, plan: true, bestaetigt: false,
    tor: { frei: offene.length === 0, offen: offene, probelauf: pb || { vorhanden: false, gueltig: false, grund: "fehlt" }, bedingungen },
    schritte: B_IDS.map((id) => ({ id, titel: B_TITEL[id], noetig: true, text: `${B_TITEL[id]}.` })),
  };
}
// Aufräumen am Original: ok → { ok, phaseB: "fertig" | "mitWarnungen", archiv, schritte, b4 }
export function phaseBAntwort({ warnungen = false } = {}) {
  return { ok: true, phaseB: warnungen ? "mitWarnungen" : "fertig", archiv: "kit-2026-10-30", schritte: B_IDS.map((id) => ({ id, titel: B_TITEL[id], status: id === "B4" && warnungen ? "rot" : "ok", anzahl: 1 })),
    b4: { ampel: warnungen ? "rot" : "gruen", kriterien: b4Kriterien(warnungen) }, sichernAngebot: true, ...(warnungen ? { mitWarnungen: true } : {}) };
}
export const phaseBFehler = { ok: false, fehlerBei: "B1", grund: "archiv-fehlgeschlagen", schritte: [{ id: "B0", titel: B_TITEL.B0, status: "ok" }, { id: "B1", titel: B_TITEL.B1, status: "rot", grund: "archiv-fehlgeschlagen" }], zurueckgenommen: true };
export const phaseBTorZu = { status: 409, json: { fehler: "Das Aufräumen ist noch nicht freigegeben. Es wurde nichts verändert.", art: "vorbedingung", code: "tor-zu" } };

const ANGEBOTE = {
  verwaist: { id: "verwaist", titel: "Verwaiste Einträge aufräumen", text: "2 Einträge in deinen persönlichen Einstellungen des Versionsverlaufs gehören zu Vaults, die es nicht mehr gibt. Kortex kann sie entfernen; das lässt sich zurücknehmen.", anzahl: 2, faellig: true },
  archiv: { id: "archiv", name: "kit-2026-10-30", titel: "Archiv des alten Werkzeug-Ordners in den Papierkorb legen", text: "Der alte Werkzeug-Ordner liegt seit 31 Tagen im Archiv. Wenn alles läuft, kannst du ihn in den Papierkorb legen (Zurücklegen bleibt im Finder möglich).", anzahl: 1, bytes: 52_428_800, tage: 31, ab: 30, faellig: true },
  sicherungen: { id: "sicherungen", titel: "Sicherungskopien der Umstellung in den Papierkorb legen", text: "Die Sicherungskopien der Umstellung können Zugangsdaten enthalten und werden nicht mehr gebraucht, wenn alles läuft. Danach lässt sich die Umstellung nicht mehr zurücknehmen.", anzahl: 3, bytes: 20_480, tage: 31, ab: 30, faellig: true },
  bundles: { id: "bundles", titel: "Sicherungen des Versionsverlaufs in den Papierkorb legen", text: "Die Sicherungen des Versionsverlaufs (2 Dateien) bleiben 30 Tage nach dem Aufräumen liegen.", anzahl: 2, bytes: 3_145_728, tage: 10, ab: 30, faellig: false },
};
export const angebot = (id, extra = {}) => ({ ...ANGEBOTE[id], ...extra });
export const rueckwegListe = (hat = IDS) => ({ ok: true, plan: true, bestaetigt: false, schritte: IDS.map((id) => ({ id, titel: TITEL[id], status: "ok", hatRueckweg: hat.includes(id) })) });

export const protokollAntwort = () => ({
  ok: true, ordner: "~/Library/Application Support/Kortex/umstellung/0a1b2c3d4e5f6a7b", datei: "protokoll.jsonl", gekuerzt: false, gesamt: 5,
  zeilen: [
    { zeit: "2026-10-30T08:50:00.000Z", lauf: "probe", schritt: "A0", ereignis: "ok", anzahl: 1 },
    { zeit: "2026-10-30T08:50:01.000Z", lauf: "probe", schritt: "K9", ereignis: "ok" },
    { zeit: "2026-10-30T09:00:00.000Z", lauf: "original", schritt: "A0", ereignis: "start" },
    { zeit: "2026-10-30T09:00:03.000Z", lauf: "original", schritt: "A4", ereignis: "fehler", grund: "nachpruefung-fehlgeschlagen" },
    { zeit: "2026-10-30T09:00:04.000Z", lauf: "original", schritt: "A4", ereignis: "rueckweg", grund: "nach-fehler" },
  ],
});

// opt.befund, opt.stand (veränderlich: stand.stand), opt.probe (Objekt oder Funktion (body, nr) → Antwort | { status, json }), opt.phaseA, opt.rueckweg (Funktion (body) → Antwort), opt.altesWerkzeug
// opt.halte: { probelauf?: Promise, phaseA?: Promise, phaseBProbe?: Promise, phaseB?: Promise } hält die Antwort zurück, bis das Promise erfüllt ist (Fortschritt prüfen)
// Abschluss: opt.tor (Funktion (body, nr, z) → Antwort; Standard torAntwort(body, z, { offen: opt.torOffen })), opt.torOffen (IDs, die rot bleiben; veränderlich: z.torOffen), opt.phaseBProbe, opt.phaseB, opt.angebote (Liste, veränderlich: z.angebote),
// opt.aufraeumen (Funktion (body, nr, z) → Antwort für POST aufraeumen)
// Zurück: Zustand mit posts (Anfragen je Route), gets (Zähler), befund/stand veränderlich
export async function mockeUmstellung(page, opt = {}) {
  const z = {
    befund: opt.befund || befundAntwort(), stand: opt.stand || standLeer(), altesWerkzeug: opt.altesWerkzeug !== false,
    posts: { probelauf: [], "phase-a": [], rueckweg: [], "kopie-loeschen": [], "phase-b": [], aufraeumen: [] }, gets: { hinweis: 0, befund: 0, stand: 0, protokoll: 0, aufraeumen: 0 },
    angebote: opt.angebote || [], torOffen: opt.torOffen || [],
    protokoll: opt.protokoll || protokollAntwort(), befundFehler: opt.befundFehler || null,
  };
  const antwort = (route, a) => (a && typeof a === "object" && "status" in a && "json" in a ? route.fulfill({ status: a.status, json: a.json }) : route.fulfill({ json: a }));
  await page.route(/\/api\/umstellung\/[a-z-]+(\?|$)/, async (route) => {
    const req = route.request();
    const name = new URL(req.url()).pathname.split("/").pop();
    if (req.method() === "GET") {
      z.gets[name] = (z.gets[name] || 0) + 1;
      if (name === "hinweis") return route.fulfill({ json: { altesWerkzeug: z.altesWerkzeug } });
      if (name === "befund") return z.befundFehler ? antwort(route, z.befundFehler) : route.fulfill({ json: z.befund });
      if (name === "stand") return route.fulfill({ json: z.stand });
      if (name === "protokoll") return route.fulfill({ json: z.protokoll });
      if (name === "aufraeumen") return route.fulfill({ json: { ok: true, angebote: z.angebote } });
      return route.fulfill({ status: 404, json: { fehler: "unbekannt" } });
    }
    const body = req.postDataJSON() || {};
    const liste = z.posts[name];
    if (!liste) return route.fulfill({ status: 404, json: { fehler: "unbekannt" } });
    liste.push(body);
    const nr = liste.length;
    const wert = (v, ...args) => (typeof v === "function" ? v(body, nr, z, ...args) : v);
    if (name === "probelauf") { if (opt.halte?.probelauf) await opt.halte.probelauf; return antwort(route, wert(opt.probe ?? probeAntwort())); }
    if (name === "phase-a") { if (opt.halte?.phaseA) await opt.halte.phaseA; return antwort(route, wert(opt.phaseA ?? phaseAAntwort())); }
    if (name === "rueckweg") {
      if (body.bestaetigt !== true) return route.fulfill({ json: rueckwegListe() });
      return antwort(route, wert(opt.rueckweg ?? { ok: true, alles: !!body.alles, schritte: (body.alles ? IDS : body.schritte).map((id) => ({ id, titel: TITEL[id], status: "zurueck", hinweise: [] })), hinweise: [] }));
    }
    if (name === "phase-b") {
      if (body.probelauf === true && body.bestaetigt === true) { if (opt.halte?.phaseBProbe) await opt.halte.phaseBProbe; return antwort(route, wert(opt.phaseBProbe ?? probeAntwort())); }
      if (body.bestaetigt === true) { if (opt.halte?.phaseB) await opt.halte.phaseB; return antwort(route, wert(opt.phaseB ?? phaseBAntwort())); }
      return antwort(route, wert(opt.tor ?? ((b, _n, zz) => torAntwort(b, zz, { offen: zz.torOffen }))));
    }
    if (name === "aufraeumen") return antwort(route, wert(opt.aufraeumen ?? { ok: true, was: body.was, anzahl: 1 }));
    if (name === "kopie-loeschen") return antwort(route, wert(opt.kopie ?? { ok: true, geloescht: 1, uebrig: 0 }));
    return route.fulfill({ status: 404, json: { fehler: "unbekannt" } });
  });
  return z;
}
