// Attrappen für den Einrichtungs-Assistenten (einrichtung.html): ein statischer Server für die Dateien der Oberfläche, alle /api/-Aufrufe gemockt, und
// optional eine Attrappe der App (window.webkit.messageHandlers.aktion) mit den Aktionen git-pruefen, git-installieren, ordner-waehlen, extern, kopieren, einrichtung-ende.
// Nichts davon berührt echte Nutzerorte: es gibt weder Dateien noch Prozesse.
import { readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const STUDIO = fileURLToPath(new URL("../../Ressourcen/studio/", import.meta.url));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" };

export function starteStatisch() {
  return new Promise((ok) => {
    const srv = createServer((req, res) => {
      const pfad = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
      const datei = normalize(join(STUDIO, pfad === "/" ? "index.html" : pfad));
      if (!datei.startsWith(STUDIO) || !existsSync(datei) || !statSync(datei).isFile()) { res.writeHead(404, { "Content-Type": "application/json" }); return res.end('{"fehler":"nicht gefunden"}'); }
      res.writeHead(200, { "Content-Type": MIME[extname(datei)] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(readFileSync(datei));
    });
    srv.listen(0, "127.0.0.1", () => ok({ url: `http://127.0.0.1:${srv.address().port}/`, stopp: () => srv.close() }));
  });
}

const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
export const KONTEN = [
  { id: "k_claude_privat", programm: "claude", programmName: "Claude Code", name: "Privat", standard: true, ordner: "~/.claude", vorhanden: true, verbunden: false },
  { id: "k_claude_firma", programm: "claude", programmName: "Claude Code", name: "Firma", standard: false, ordner: "~/.claude-firma", vorhanden: true, verbunden: false },
  { id: "k_cursor", programm: "cursor", programmName: "Cursor", name: "Standard", standard: true, ordner: "~/.cursor", vorhanden: true, verbunden: false },
  { id: "k_codex", programm: "codex", programmName: "Codex", name: "Standard", standard: true, ordner: "~/.codex", vorhanden: true, verbunden: false },
];
const AGENTEN = {
  drei: [{ id: "claude", name: "Claude Code", version: "2.1.310 (Claude Code)", pfad: "/usr/local/bin/claude" }, { id: "codex", name: "Codex", version: "codex-cli 0.48.0", pfad: "/usr/local/bin/codex" }, { id: "cursor-agent", name: "Cursor Agent", version: "1.7.2", pfad: "/usr/local/bin/cursor-agent" }],
  eine: [{ id: "claude", name: "Claude Code", version: "2.1.310 (Claude Code)", pfad: "/usr/local/bin/claude" }],
  keine: [],
};

// Optionen: git ("vorhanden"|"fehlt"|"defekt"), app (Attrappe der App-Aktionen), ki ("drei"|"eine"|"keine"), github { verfuegbar, angemeldet, login }, vault (schon aktiv: { pfad, name }),
// ordner (Antwort von ordner-waehlen), neuFehler/klonFehler ({ status, fehler }), gesichert (Vault hat schon ein Remote), verbindenFehler ({ <ziel>: { status, fehler, art, befehl } })
export async function mockeEinrichtung(page, o = {}) {
  const z = {
    git: "vorhanden", app: true, ki: "drei", github: { verfuegbar: true, angemeldet: false, login: null }, vault: null, ordner: { pfad: "/Users/test/Dokumente/Notizen", notizen: 128, ordner: 9 },
    anfragen: [], aktionen: [], seitenfehler: [], codeZustand: "wartet", gesichert: false, verbindenFehler: {}, probeTreffer: [{ pfad: "09_wiki/wissen/Willkommen.md", titel: "Willkommen" }, { pfad: "00_inbox/Idee.md", titel: "Posteingang" }],
    verzoegerung: 150, ...o,
  };
  page.on("pageerror", (e) => z.seitenfehler.push(String(e)));
  if (z.app) {
    await page.exposeFunction("__aktionAttrappe", async (m) => {
      z.aktionen.push(m);
      switch (m.aktion) {
        case "git-pruefen": return z.git === "vorhanden" ? { stand: "vorhanden", version: "2.39.5" } : z.git === "defekt" ? { stand: "defekt", meldung: "Die Xcode-Lizenz ist noch nicht akzeptiert." } : { stand: z.git };
        case "git-installieren": z.git = z.installationFertig ? "vorhanden" : "installiert"; return { ok: true, stand: z.git };
        case "ordner-waehlen": return z.ordnerAbbruch ? null : z.ordner;
        case "kopieren": z.zwischenablage = m.wert; return { ok: true };
        case "extern": return { ok: true };
        case "einrichtung-ende": z.ende = m.wert; return { ok: true };
        default: return { ok: true };
      }
    });
    await page.addInitScript(() => { window.webkit = { messageHandlers: { aktion: { postMessage: (m) => window.__aktionAttrappe(m) } } }; });
  }
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const pfad = url.pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    z.anfragen.push({ methode: req.method(), pfad, body });
    const json = (status, wert) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(wert) });
    const aktiv = () => (z.vault ? { vault: z.vault.pfad, name: z.vault.name, appVersion: "0.2.0", git: true, kit: { vorhanden: true }, mcpBefehl: null } : { vault: null, name: null, appVersion: "0.2.0", git: false, kit: null, mcpBefehl: null });
    switch (pfad) {
      case "/api/info": if (z.infoFehler) return route.abort("failed"); return json(200, aktiv());
      case "/api/vaults/neu": {
        await warte(z.verzoegerung);
        if (z.neuFehler) return json(z.neuFehler.status, { fehler: z.neuFehler.fehler });
        if (z.belegt?.includes(body.ordner)) return json(409, { fehler: "Der Ordner ist nicht leer." });
        z.vault = { pfad: body.ordner.replace(/^~/, "/Users/test"), name: body.name };
        return json(200, { pfad: z.vault.pfad });
      }
      case "/api/vaults/oeffnen": {
        await warte(z.verzoegerung);
        if (z.oeffnenFehler) return json(z.oeffnenFehler.status, { fehler: z.oeffnenFehler.fehler });
        z.vault = { pfad: body.pfad, name: body.pfad.split("/").pop() };
        return json(200, { pfad: z.vault.pfad, git: !!body.gitEinschalten });
      }
      case "/api/vaults/klonen": {
        await warte(z.verzoegerung);
        if (z.klonFehler && !(z.klonFehler.nurOhneKonto && z.github.angemeldet)) return json(z.klonFehler.status, { fehler: z.klonFehler.fehler });
        z.vault = { pfad: body.ordner.replace(/^~/, "/Users/test"), name: body.ordner.split("/").pop() };
        return json(200, { pfad: z.vault.pfad });
      }
      case "/api/vertrauen": return json(200, { ok: true });
      case "/api/github/konto": return json(200, z.github.verfuegbar ? { verfuegbar: true, angemeldet: z.github.angemeldet, ...(z.github.login ? { login: z.github.login } : {}) } : { verfuegbar: false, angemeldet: false });
      case "/api/github/anmelden":
        if (req.method() === "POST") {
          if (z.anmeldenFehler) return json(z.anmeldenFehler.status, { fehler: z.anmeldenFehler.fehler, art: z.anmeldenFehler.art });
          z.anmeldungen = (z.anmeldungen || 0) + 1; z.codeZustand = "wartet";
          return json(200, { code: "WDJB-MJHT", url: z.anmeldeUrl || "https://github.com/login/device", ablauf: new Date(Date.now() + (z.ablaufSekunden ?? 899) * 1000).toISOString() });
        }
        if (z.codeZustand === "fertig") { z.github = { ...z.github, angemeldet: true, login: z.github.login || "fabiobrogno" }; return json(200, { zustand: "fertig", login: z.github.login }); }
        return json(200, z.codeZustand === "wartet" ? { zustand: "wartet", code: "WDJB-MJHT", url: "https://github.com/login/device" } : { zustand: z.codeZustand, ...(z.codeGrund ? { grund: z.codeGrund } : {}) });
      case "/api/github/abbrechen": z.codeZustand = "keiner"; return json(200, { ok: true });
      case "/api/github/repo-anlegen":
        if (z.repoVergeben === body.name) return json(409, { fehler: "Du hast schon ein Repository mit diesem Namen.", art: "name" });
        z.repo = { name: body.name, besitzer: z.github.login || "fabiobrogno", privat: true }; return json(200, z.repo);
      case "/api/sicherung/bereit": return json(200, z.sicherungBlockiert ? { zustand: "blockiert", text: "Der Vault hat noch keine Version." } : { zustand: z.gesichert ? "gesichert" : "bereit" });
      case "/api/sicherung/verbinden": if (z.verbindenRepoFehler) return json(z.verbindenRepoFehler.status, { fehler: z.verbindenRepoFehler.fehler }); z.gesichert = true; z.verbunden = body; return json(200, { ergebnis: "verbunden" });
      case "/api/ki/erkennen": return json(200, { agenten: AGENTEN[z.ki], cursorDa: z.ki === "drei", programme: z.programme || [] });
      case "/api/ki/konten": return json(200, { zustand: "ok", konten: KONTEN.filter((k) => z.ki === "keine" ? false : z.ki === "eine" ? k.programm === "claude" : true),
        vaults: z.vault ? [{ pfad: z.vault.pfad, name: z.vault.name, schluessel: z.vault.pfad }] : [], zugriff: z.zugriff || {} });
      case "/api/mcp/verbinden": {
        await warte(z.verzoegerung);
        const f = z.verbindenFehler[body.ziel];
        if (f && !(f.art === "anders" && body.umstellen)) return json(f.status, { fehler: f.fehler, ...(f.art ? { art: f.art } : {}), ...(f.befehl ? { befehl: f.befehl } : {}) });
        z.verbunden = [...(z.verbunden || []), body];
        // der Assistent darf ein vom Nutzer gesperrtes Konto nie still öffnen: ohne ausdrückliche Wahl bleibt es gesperrt (wie werkstatt/konten.mjs)
        if (body.zugriff && body.zugriff !== "gesperrt" && z.gesperrteKonten?.includes(body.konto) && body.zugriffAusdruecklich !== true) return json(200, { ok: true, zugriffGesetzt: false, zugriffGrund: "vom-nutzer-gesperrt" });
        return json(200, { ok: true, zugriffGesetzt: true });
      }
      case "/api/ki/pflege":
        if (req.method() === "GET") return json(200, { vault: url.searchParams.get("vault"), dienst: { eingerichtet: !!z.dienstFuerVault, fuerVault: !!z.dienstFuerVault } });
        z.pflege = body; return json(200, { ok: true });
      case "/api/mcp/trennen": z.getrennt = [...(z.getrennt || []), body]; return json(200, { ok: true });
      case "/api/mcp/konfiguration": return json(200, { json: '{\n  "mcpServers": { "brain": { "command": "node" } }\n}' });
      case "/api/kern/stand": z.kern ||= { starter: { vorhanden: true }, profile: [{ pfad: "/Users/test/.claude", name: ".claude", standard: true }], claude: { profile: { "/Users/test/.claude": { aktiv: false } } }, git: { moeglich: true, aktiv: false, fremder: false }, dienst: { verfuegbar: true, eingerichtet: false } };
        return json(200, z.kern);
      case "/api/kern/verdrahten": {
        z.verdrahtet = [...(z.verdrahtet || []), body];
        z.kern ||= { starter: { vorhanden: true }, profile: [{ pfad: "/Users/test/.claude", name: ".claude", standard: true }], claude: { profile: { "/Users/test/.claude": { aktiv: false } } }, git: { moeglich: true, aktiv: false, fremder: false }, dienst: { verfuegbar: true, eingerichtet: false } };
        if (body.was === "git" && body.an && z.gitFremd && !body.ersetzen) return json(409, { fehler: "anders", art: "anders" });
        if (body.was === "claude") for (const p of body.profile || []) z.kern.claude.profile[p] = { aktiv: body.an };
        else z.kern[body.was === "git" ? "git" : "dienst"][body.was === "git" ? "aktiv" : "eingerichtet"] = body.an;
        return json(200, { ok: true, stand: z.kern });
      }
      case "/api/probe": await warte(z.verzoegerung); if (z.probeFehler) return json(500, { fehler: z.probeFehler }); return json(200, { treffer: z.probeTreffer });
      default: return json(404, { fehler: "nicht gefunden" });
    }
  });
  return z;
}
