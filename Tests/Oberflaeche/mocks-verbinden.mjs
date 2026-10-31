// Attrappe für „KI verbinden“ (ki-verbinden.js): GET /api/ki/erkennen, POST /api/mcp/verbinden, POST /api/mcp/pruefen, dazu die Konten (mocks-konten.mjs) und das Kontingent (mocks-kontingent.mjs).
// Nichts davon berührt echte Nutzerorte: es gibt weder Dateien noch Prozesse (kein claude, kein codex, kein Terminal).
// Verhalten wie die Werkstatt: Verbinden setzt `verbunden` am Konto und die Stufe im offenen Vault (eine gesperrte Stufe bleibt, wenn sie nicht ausdrücklich gewählt wurde: zugriffGrund „vom-nutzer-gesperrt“);
// Prüfen antwortet 409 kein-zugriff, wenn das Konto den offenen Vault nicht sehen darf.
import { mockeKonten } from "./mocks-konten.mjs";
import { mockeKontingent, ZUSTAND } from "./mocks-kontingent.mjs";

export const FUNDE = {
  claude: { name: "Claude Code", version: "2.1.30" }, codex: { name: "Codex", version: "0.48.0" }, cursor: { name: "Cursor", version: "1.7.2" }, gemini: { name: "Gemini CLI", version: "0.9.0" },
};

// opt.vault: Pfad des offenen Vaults · opt.vaults: Liste für mockeKonten · opt.konten/zugriff/login: wie mockeKonten · opt.erkannt: ids der gefundenen Programme
// opt.mcp: null | "anders" | "befehl" | "fehler" | "schon" (Antwort von /api/mcp/verbinden) · opt.pruefen: null | "fehler" | "ohne-antwort" (Antwort von /api/mcp/pruefen) · opt.verzoegerung: ms für Prüfen
// opt.kontingent: { werte } → mockeKontingent (sonst gibt es kein Kontingent: der Aufruf liefert die Konten ohne Werte)
export async function mockeVerbinden(page, opt = {}) {
  const { vault, vaults, erkannt = ["claude", "codex", "cursor", "gemini"], mcp = null, pruefen = null, verzoegerung = 0, erkennenVerzoegerung = 0, kontingent = null } = opt;
  const kz = await mockeKonten(page, { vaults, ...(opt.konten ? { konten: opt.konten } : {}), ...(opt.zugriff ? { zugriff: opt.zugriff } : {}), ...(opt.login ? { login: opt.login } : {}), ...(opt.programme ? { programme: opt.programme } : {}),
    ...(opt.zuletzt ? { zuletzt: opt.zuletzt } : {}), ...(opt.pflege ? { pflege: opt.pflege } : {}), ...(opt.anmeldenFehler ? { anmeldenFehler: opt.anmeldenFehler } : {}), ...(opt.neuKonten ? { neuKonten: opt.neuKonten } : {}), ...(opt.leer ? { leer: true } : {}) });
  const z = { anfragen: [], erkannt: [...erkannt], mcp, pruefen, verzoegerung, kz, kt: null };
  const log = (methode, pfad, body) => z.anfragen.push({ methode, pfad, body });
  const body = (route) => { try { return JSON.parse(route.request().postData() || "{}"); } catch { return {}; } };
  const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
  await page.route("**/api/ki/erkennen**", async (route) => {
    log("GET", "/api/ki/erkennen", { neu: new URL(route.request().url()).searchParams.get("neu") });
    if (erkennenVerzoegerung) await warte(erkennenVerzoegerung);
    return route.fulfill({ json: {
      agenten: z.erkannt.filter((id) => FUNDE[id]).map((id) => ({ id: id === "cursor" ? "cursor-agent" : id, name: FUNDE[id].name, version: FUNDE[id].version, pfad: "/usr/local/bin/" + id })),
      katalog: z.erkannt.map((id) => ({ id, gefunden: true, version: FUNDE[id]?.version || "1", quelle: "cli" })), cursorDa: z.erkannt.includes("cursor"), programme: [] } });
  });
  await page.route("**/api/mcp/verbinden", (route) => {
    const b = body(route); log("POST", "/api/mcp/verbinden", b);
    if (z.mcp === "befehl") return route.fulfill({ status: 404, json: { fehler: `${FUNDE[b.ziel]?.name || b.ziel} wurde nicht gefunden. Kopiere den Befehl und führe ihn im Terminal aus.`, befehl: `${b.ziel} mcp add brain -- node /opt/kortex/brain-mcp.mjs` } });
    if (z.mcp === "fehler") return route.fulfill({ status: 502, json: { fehler: "Claude Code hat den Eintrag abgelehnt. Versuche es noch einmal." } });
    if (z.mcp === "anders" && !b.umstellen) return route.fulfill({ status: 409, json: { fehler: "Es gibt schon einen Eintrag „brain“.", art: "anders" } });
    const k = kz.konten.find((x) => x.id === b.konto) || kz.konten.find((x) => x.programm === b.ziel && x.standard) || kz.konten.find((x) => x.programm === b.ziel);
    let zugriffGrund = null;
    if (k) {
      k.verbunden = true;
      const alt = kz.zugriff[k.id]?.[vault];
      if (b.zugriff && vault) {
        if (alt === "gesperrt" && b.zugriffAusdruecklich !== true) zugriffGrund = "vom-nutzer-gesperrt";
        else { kz.zugriff[k.id] = { ...(kz.zugriff[k.id] || {}), [vault]: b.zugriff }; }
      }
    }
    return route.fulfill({ json: z.mcp === "schon" ? { ok: true, schonVerbunden: true } : { ok: true, ...(zugriffGrund ? { zugriffGrund } : {}) } });
  });
  await page.route("**/api/mcp/pruefen", async (route) => {
    const b = body(route); log("POST", "/api/mcp/pruefen", b);
    if (z.verzoegerung) await warte(z.verzoegerung);
    if (z.pruefen === "fehler") return route.fulfill({ status: 502, json: { fehler: "Der MCP-Server hat nicht geantwortet — die KI würde deinen Vault so nicht finden.", art: "mcp" } });
    const stufe = b.konto ? kz.zugriff[b.konto]?.[vault] : null;
    if (b.konto && (!stufe || stufe === "gesperrt")) return route.fulfill({ status: 409, json: { fehler: "Dieses Konto darf den Vault nicht sehen — die KI würde ihn so nicht finden. Gib ihm unter „KI & Konten“ mindestens die Stufe „Lesen“.", art: "kein-zugriff" } });
    return route.fulfill({ json: { ok: true, vault: (vaults.find((v) => v.pfad === vault) || vaults[0]).name, werkzeuge: 7, konto: b.konto || null } });
  });
  if (kontingent) z.kt = await mockeKontingent(page, { konten: kz.konten.map((k) => ({ ...k, stufe: kz.zugriff[k.id]?.[vault] })), ...kontingent });
  // opt.kontingentVerzoegerung: GET /api/ki/kontingent antwortet erst nach n ms (Statusleiste im Ladezustand)
  if (opt.kontingentVerzoegerung) await page.route(/\/api\/ki\/kontingent(\?.*)?$/, async (route) => { await warte(opt.kontingentVerzoegerung); return route.fallback(); });
  z.log = (pfad, methode) => z.anfragen.filter((a) => a.pfad === pfad && (!methode || a.methode === methode));
  return z;
}
export { ZUSTAND };
