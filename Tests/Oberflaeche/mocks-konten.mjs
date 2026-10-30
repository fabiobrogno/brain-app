// Attrappe für die Routen der KI-Konten (Paket P2): GET /api/ki/konten, POST /api/ki/konten, PUT /api/ki/zugriff, PUT /api/ki/standard, POST /api/ki/schutz, POST /api/ki/hinweis,
// POST /api/ki/vorher. Antwortformen wie werkstatt/konten.mjs (stand): { zustand, hinweis?, vorherDa?, stufen, konten: [{ id, programm, programmName, name, standard, ordner, vorhanden,
// verbunden, schutz: { moeglich, strenger?, strengerAktiv?, vaults? } }], vaults: [{ pfad, name, neueKonten, schluessel }], zugriff: { <konto>: { <vault>: <stufe> } } }.
// Zustand und Anfragen stehen im zurückgegebenen Objekt: z.anfragen = [{ methode, pfad, body }].

export const STUFEN = ["gesperrt", "lesen", "posteingang", "erweitert"];

export const KONTEN = [
  { id: "k_aaaa0001", programm: "claude", programmName: "Claude Code", name: "Claude Code", standard: true, ordner: "~/.claude", vorhanden: true, verbunden: true },
  { id: "k_aaaa0002", programm: "claude", programmName: "Claude Code", name: "Claude Code · privat", standard: false, ordner: "~/.claude-privat", vorhanden: true, verbunden: false },
  { id: "k_aaaa0003", programm: "codex", programmName: "Codex", name: "Codex", standard: true, ordner: "~/.codex", vorhanden: true, verbunden: true },
];

// opt.vaults = [{ pfad, name }] · opt.konten · opt.zugriff (Standard: verbundene posteingang, übrige gesperrt) · opt.hinweis ("defekt-neu") · opt.vorherDa
// opt.fehlerClaude: Text → PUT /api/ki/zugriff meldet, dass die Einstellungen von Claude Code nicht geändert werden konnten
export async function mockeKonten(page, { vaults, konten = KONTEN, zugriff = null, hinweis = null, hinweisGrund = "defekt", vorherDa = false, fehlerClaude = null, leer = false, altform = {}, warnungen = [], pflege = {}, letzter = null, schalter = "an", naechster = { art: "sitzungsstart" }, pflegeHinweise = [], pflegePlist = null } = {}) {
  const z = {
    konten: leer ? [] : konten.map((k) => ({ ...k })), vaults: vaults.map((v) => ({ neueKonten: "gesperrt", ...v })), hinweis, hinweisGrund, vorherDa, anfragen: [], altform: { ...altform }, warnungen, sperren: {}, streng: {}, fehlerClaude, wartet: null, pflege: { ...pflege }, letzter, schalter, naechster, pflegeHinweise: [...pflegeHinweise], pflegePlist,
  };
  z.zugriff = zugriff || Object.fromEntries(z.konten.map((k) => [k.id, Object.fromEntries(z.vaults.map((v) => [v.pfad, k.verbunden ? "posteingang" : "gesperrt"]))]));
  const stand = () => ({
    zustand: "ok", ...(z.hinweis ? { hinweis: z.hinweis, hinweisGrund: z.hinweisGrund, hinweisSeit: "2026-10-30T10:00:00.000Z", vorherDa: z.vorherDa } : {}), stufen: STUFEN,
    konten: z.konten.map((k) => ({
      ...k, altform: z.altform[k.id] || { mcp: false, hooks: false },
      schutz: k.programm !== "claude" ? { moeglich: false } : {
        moeglich: true, strenger: !!z.streng[k.id], strengerAktiv: !!z.streng[k.id], warnungen: z.streng[k.id] ? z.warnungen : [],
        vaults: Object.fromEntries(z.vaults.filter((v) => z.zugriff[k.id]?.[v.pfad] === "gesperrt").map((v) => [v.pfad, z.sperren[`${k.id}|${v.pfad}`] ? "aktiv" : "aus"])),
      },
    })),
    vaults: z.vaults.map((v) => ({ pfad: v.pfad, name: v.name, neueKonten: v.neueKonten, ohneKonto: "gesperrt", schluessel: v.pfad, pflege: pflegeStand(v.pfad) })),
    zugriff: z.zugriff, ...(z.pflegeHinweise.length ? { pflegeHinweise: z.pflegeHinweise } : {}), ...(z.pflegePlist ? { pflegePlist: z.pflegePlist } : {}),
  });
  // Pflege je Vault wie werkstatt/konten.mjs: gesetzt, wirksam (konto | aus | alt), bewusst, problem
  const pflegeStand = (pfad) => {
    const p = z.pflege[pfad];
    if (!p) return { gesetzt: false, wirksam: "alt" };
    const problem = p.stufe === "aus" ? null : !p.konto ? "kein-konto" : z.zugriff[p.konto]?.[pfad] !== "erweitert" ? "stufe" : null;
    return { gesetzt: true, konto: p.konto, stufe: p.stufe, wirksam: p.stufe === "aus" || problem ? "aus" : "konto", bewusst: p.stufe === "aus", ...(problem ? { problem } : {}) };
  };
  const body = (route) => { try { return JSON.parse(route.request().postData() || "{}"); } catch { return {}; } };
  const fehler = (route, status, text, extra = {}) => route.fulfill({ status, json: { fehler: text, ...extra } });
  await page.route("**/api/ki/konten", async (route) => {
    const m = route.request().method();
    if (m === "GET") { z.anfragen.push({ methode: m, pfad: "/api/ki/konten" }); if (z.wartet) await z.wartet; return route.fulfill({ json: stand() }); }
    const b = body(route); z.anfragen.push({ methode: m, pfad: "/api/ki/konten", body: b });
    const k = z.konten.find((x) => x.id === b.id);
    if (!k) return fehler(route, 404, "Dieses KI-Konto gibt es nicht (mehr).");
    if (typeof b.name !== "string" || !b.name.trim() || b.name.length > 40) return fehler(route, 400, "Der Name braucht 1 bis 40 Zeichen.");
    k.name = b.name.trim();
    return route.fulfill({ json: stand() });
  });
  await page.route("**/api/ki/zugriff", async (route) => {
    const b = body(route); z.anfragen.push({ methode: route.request().method(), pfad: "/api/ki/zugriff", body: b });
    if (!z.zugriff[b.konto] || !z.vaults.some((v) => v.pfad === b.vault) || !STUFEN.includes(b.stufe)) return fehler(route, 400, "Eingabe ungültig.");
    z.zugriff[b.konto][b.vault] = b.stufe;
    const claude = { aktion: "nichts" };
    const k = z.konten.find((x) => x.id === b.konto);
    if (k.programm === "claude") {
      if (b.stufe === "gesperrt" && b.claudeSperre === true) {
        if (z.fehlerClaude) { claude.aktion = "fehler"; claude.fehler = z.fehlerClaude; } else { z.sperren[`${b.konto}|${b.vault}`] = true; claude.aktion = "eingetragen"; }
      } else if (b.stufe !== "gesperrt" || b.claudeSperre === false) { if (z.sperren[`${b.konto}|${b.vault}`]) { delete z.sperren[`${b.konto}|${b.vault}`]; claude.aktion = "entfernt"; } }
    }
    return route.fulfill({ json: { ...stand(), claude } });
  });
  await page.route("**/api/ki/standard", async (route) => {
    const b = body(route); z.anfragen.push({ methode: route.request().method(), pfad: "/api/ki/standard", body: b });
    const v = z.vaults.find((x) => x.pfad === b.vault);
    if (!v || !["gesperrt", "lesen", "posteingang"].includes(b.stufe)) return fehler(route, 400, "Eingabe ungültig.");
    v.neueKonten = b.stufe;
    return route.fulfill({ json: stand() });
  });
  await page.route("**/api/ki/schutz", async (route) => {
    const b = body(route); z.anfragen.push({ methode: route.request().method(), pfad: "/api/ki/schutz", body: b });
    if (b.sandbox === true && b.bestaetigt !== true) return fehler(route, 400, "Bestätigung fehlt.", { art: "bestaetigung" });
    if (b.sandbox) z.streng[b.konto] = true; else delete z.streng[b.konto];
    return route.fulfill({ json: stand() });
  });
  await page.route("**/api/ki/neu-verbinden", async (route) => {
    const b = body(route); z.anfragen.push({ methode: route.request().method(), pfad: "/api/ki/neu-verbinden", body: b });
    delete z.altform[b.konto];
    return route.fulfill({ json: { ok: true, mcp: { ok: true }, hooks: null, stand: stand() } });
  });
  await page.route("**/api/ki/hinweis", async (route) => { z.anfragen.push({ methode: route.request().method(), pfad: "/api/ki/hinweis" }); z.hinweis = null; return route.fulfill({ json: stand() }); });
  await page.route("**/api/ki/vorher", async (route) => {
    const b = body(route); z.anfragen.push({ methode: route.request().method(), pfad: "/api/ki/vorher", body: b });
    if (b.bestaetigt !== true) return fehler(route, 400, "Bestätigung fehlt.", { art: "bestaetigung" });
    z.hinweis = null; z.vorherDa = false;
    return route.fulfill({ json: stand() });
  });
  // Pflege: GET Stand (letzter/nächster Lauf) · POST Konto und Stufe · POST jetzt
  await page.route(/\/api\/ki\/pflege(\?.*)?$/, async (route) => {
    const m = route.request().method();
    if (m === "GET") {
      const vault = new URL(route.request().url()).searchParams.get("vault");
      z.anfragen.push({ methode: m, pfad: "/api/ki/pflege", body: { vault } });
      if (!z.vaults.some((v) => v.pfad === vault)) return fehler(route, 404, "Diesen Vault kennt Kortex nicht (mehr).");
      return route.fulfill({ json: { vault, schalter: z.schalter, letzter: z.letzter, naechster: z.naechster, dienst: { eingerichtet: false, fuerVault: false, profilAlt: false } } });
    }
    const b = body(route); z.anfragen.push({ methode: m, pfad: "/api/ki/pflege", body: b });
    if (!z.vaults.some((v) => v.pfad === b.vault) || !["klein", "mittel", "aus"].includes(b.stufe)) return fehler(route, 400, "Eingabe ungültig.");
    if (b.konto && z.zugriff[b.konto]?.[b.vault] !== "erweitert" && b.stufe !== "aus") return fehler(route, 409, "Dieses Konto darf den Vault noch nicht pflegen. Gib ihm unter „Wer darf diesen Vault sehen?“ die Stufe „Erweitert“, dann kannst du es hier wählen.", { art: "stufe" });
    z.pflege[b.vault] = { konto: b.konto ?? null, stufe: b.stufe };
    z.pflegeHinweise = z.pflegeHinweise.filter((x) => x.vault !== b.vault);
    return route.fulfill({ json: stand() });
  });
  await page.route("**/api/ki/pflege/jetzt", async (route) => {
    z.anfragen.push({ methode: route.request().method(), pfad: "/api/ki/pflege/jetzt" });
    return route.fulfill({ json: { ok: true, gestartet: true } });
  });
  z.stand = stand;
  z.log = (pfad, methode) => z.anfragen.filter((a) => a.pfad === pfad && (!methode || a.methode === methode));
  return z;
}
