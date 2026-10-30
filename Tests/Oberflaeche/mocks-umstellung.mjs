// Attrappen für die Umstellungs-Routen der Werkstatt (P7): GET hinweis|befund|stand|protokoll, POST probelauf|phase-a|rueckweg|kopie-loeschen.
// Die Antwortformen sind die der echten Routen (werkstatt/umstellung.mjs, Kern umstellung/*): Befund-Funde mit { id, kategorie, schwere, ort, anzahl, aktion, phase, text }, Probelauf
// { ok, ampel, kriterien: [{ nr, id, titel, status, grund? }], kopieBehalten }, Phase A { ok, phase, schritte, a9, mitWarnungen? } bzw. { ok: false, fehlerBei, grund, zurueckgenommen },
// Rückweg { plan: true, schritte: [{ id, titel, status, hatRueckweg }] } bzw. { ok, alles, schritte: [{ id, titel, status, hinweise }], hinweise }.

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

export const standLeer = () => ({ phase: null, kernVersion: null, schritte: {}, laeuft: false, unterbrochen: false, probelauf: null, a9: null, bundle: false, kopien: 0 });
export const standFertig = () => ({
  phase: "A", kernVersion: "1.0.0", schritte: Object.fromEntries(IDS.map((id) => [id, { status: "ok", zeit: "2026-10-30T09:00:00.000Z", anzahl: 1 }])), laeuft: false, unterbrochen: false,
  probelauf: { zeit: "2026-10-30T08:55:00.000Z", ampel: "gruen", gueltig: false }, a9: { ampel: "gruen" }, bundle: true, kopien: 0,
});
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
// opt.halte: { probelauf?: Promise, phaseA?: Promise } hält die Antwort zurück, bis das Promise erfüllt ist (Fortschritt prüfen)
// Zurück: Zustand mit posts (Anfragen je Route), gets (Zähler), befund/stand veränderlich
export async function mockeUmstellung(page, opt = {}) {
  const z = {
    befund: opt.befund || befundAntwort(), stand: opt.stand || standLeer(), altesWerkzeug: opt.altesWerkzeug !== false,
    posts: { probelauf: [], "phase-a": [], rueckweg: [], "kopie-loeschen": [] }, gets: { hinweis: 0, befund: 0, stand: 0, protokoll: 0 },
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
    if (name === "kopie-loeschen") return antwort(route, wert(opt.kopie ?? { ok: true, geloescht: 1, uebrig: 0 }));
    return route.fulfill({ status: 404, json: { fehler: "unbekannt" } });
  });
  return z;
}
