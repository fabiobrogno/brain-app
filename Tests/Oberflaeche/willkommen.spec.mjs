// Einstieg ohne Vault: Willkommen-Karte, Name/Ort, Klonen, Versionsverlauf-Rückfrage, KI verbinden.
// Die Vault-Routen gibt es im Backend noch nicht überall: alle /api/-Aufrufe werden gemockt, app.js wird durch ein leeres Modul ersetzt.
import { test, expect } from "./basis.mjs";
import { mkdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const BILDER = fileURLToPath(new URL("./screenshots/", import.meta.url));
const STUDIO = fileURLToPath(new URL("../../Ressourcen/studio/", import.meta.url));
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2" };

// Statische Dateien der Oberfläche; alle /api/-Aufrufe werden im Test gemockt, das Backend läuft nicht (und muss nicht fertig sein).
function starteStatisch() {
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
let server;
test.beforeAll(async () => { server = await starteStatisch(); mkdirSync(BILDER, { recursive: true }); });
test.afterAll(() => server?.stopp());

const AGENTEN = [
  { id: "claude", name: "Claude Code", version: "2.1.310 (Claude Code)", pfad: "/usr/local/bin/claude" },
  { id: "codex", name: "Codex", version: "codex-cli 0.162.1", pfad: "/usr/local/bin/codex" },
  { id: "gemini", name: "Gemini", version: null, pfad: null },
  { id: "cursor-agent", name: "Cursor Agent", version: null, pfad: null },
  { id: "opencode", name: "OpenCode", version: null, pfad: null },
];
const NOTIZEN = [{ pfad: "09_wiki/wissen/Kaffee.md", titel: "Kaffee" }, { pfad: "10_notizen/Reise.md", titel: "Reise nach Lissabon" }];
const TREFFER = [
  { pfad: "09_wiki/wissen/Kaffee.md", titel: "Kaffee" }, { pfad: "09_wiki/wissen/Espresso.md", titel: "Espresso" },
  { pfad: "09_wiki/wissen/Mühle.md", titel: "Mühle" }, { pfad: "10_notizen/Reise.md", titel: "Reise nach Lissabon" },
];
const BEFEHL = "claude mcp add -s user brain -- node /Applications/Brain.app/Contents/Resources/mcp.mjs";
// Der 504-Satz der Werkstatt beim Einschalten (gemeinsam/vaults.mjs, ZEIT_EINSCHALTEN): er sagt „nicht in der Liste eingetragen“, die Karte darf ihn nicht zeigen
const ZEIT_EINSCHALTEN = "Das Einschalten des Versionsverlaufs hat zu lange gedauert und wurde abgebrochen. Dein Ordner ist unverändert und nicht in der Liste eingetragen — bitte später noch einmal versuchen.";
// Der eigene Satz der Karte (texte-willkommen.js, TW.git.zeit)
const GIT_ZEIT = "Das Einschalten des Versionsverlaufs hat zu lange gedauert. Dein Ordner ist geöffnet, der Verlauf aber nicht eingeschaltet. Versuche es noch einmal oder arbeite ohne Verlauf weiter.";

// Mock-Rahmen: Zustandsobjekt + Aufzeichnung aller Anfragen.
async function rahmen(page, o = {}) {
  const z = { vault: null, git: true, anfragen: [], seitenfehler: [], ...o };
  page.on("pageerror", (e) => z.seitenfehler.push(String(e)));
  await page.route("**/app.js", (r) => r.fulfill({ contentType: "text/javascript", body: "" }));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const pfad = new URL(req.url()).pathname;
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    z.anfragen.push({ methode: req.method(), pfad, body });
    const json = (status, wert) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(wert) });
    const warte = (ms) => new Promise((ok) => setTimeout(ok, ms));
    switch (pfad) {
      case "/api/info": if (z.infoAbbruch) return route.abort("failed");
        return json(200, z.vault
        ? { vault: z.vault, name: z.vault.split("/").pop(), appVersion: "0.2.0", git: z.git, kit: z.kit ?? { vorhanden: false, vertraut: false }, mcpBefehl: BEFEHL }
        : { vault: null, name: null, appVersion: "0.2.0", git: false, kit: null, mcpBefehl: null });
      case "/api/vaults/neu":
        await warte(z.verzoegerung ?? 150);
        if (z.neuFehler) return json(z.neuFehler.status, { fehler: z.neuFehler.fehler });
        z.vault = `/Users/test/Brain/${body.name}`;
        return json(200, { pfad: z.vault });
      case "/api/vaults/oeffnen":
        await warte(z.oeffnenVerzoegerung ?? 100);
        if (z.oeffnenFehler) return json(z.oeffnenFehler.status, { fehler: z.oeffnenFehler.fehler });
        z.vault = body.pfad;
        // Spec §5a: der Schlüssel heißt gitEinschalten; z.gitEinschaltenFehlt = Werkstatt schaltet nicht ein und meldet git:false
        if (body.gitEinschalten) {
          // z.gitEinschaltenAusgang = Liste, je „Einschalten“-Klick ein Eintrag: "zeit" = die Werkstatt reißt ihre Frist und nimmt zurück (504, Verlauf bleibt aus),
          // "abbruch" = die Brücke gibt auf (status 0), "zeit-doch" = 504, aber der Verlauf ist inzwischen da, "zeit-anderer" = 504, und die Werkstatt hat einen anderen Vault offen
          const aus = z.gitEinschaltenAusgang?.shift();
          if (aus === "abbruch") return route.abort("failed");
          if (aus === "zeit-doch") z.git = true;
          if (aus === "zeit-anderer") { z.vault = "/Users/test/Anderer"; z.git = true; }
          if (aus?.startsWith("zeit")) return json(504, { fehler: ZEIT_EINSCHALTEN });
          z.git = !z.gitEinschaltenFehlt;
        } else z.git = z.gitBeimOeffnen ?? true;
        return json(200, { pfad: body.pfad, git: z.git });
      case "/api/vaults/klonen":
        await warte(z.verzoegerung ?? 700);
        // Zeitüberschreitung der Brücke: die Anfrage reißt ab (status 0). „trotzdem“ = die Werkstatt hat den Vault inzwischen doch geöffnet
        if (z.klonenAbbruch) { const m = z.klonenAbbruch; z.klonenAbbruch = null; if (m === "trotzdem") z.vault = "/Users/test/Brain/vault"; return route.abort("failed"); }
        { const f = z.klonenFehler?.shift(); if (f) return json(f.status, { fehler: f.fehler }); }
        z.vault = "/Users/test/Brain/vault";
        return json(200, { pfad: z.vault });
      case "/api/ki/erkennen": return json(200, { agenten: z.agenten ?? AGENTEN, ...(z.cursorDa !== undefined ? { cursorDa: z.cursorDa } : {}), ...(z.programme ? { programme: z.programme } : {}) });
      case "/api/notizen": return json(200, { notizen: z.notizen ?? NOTIZEN });
      case "/api/mcp/verbinden":
        if (z.mcp === "befehl") return json(404, { fehler: "Claude Code wurde nicht gefunden. Kopiere den Befehl und führe ihn im Terminal aus.", befehl: BEFEHL });
        if (z.mcp === "fehler") return json(500, { fehler: "Die Konfiguration von Claude konnte nicht geschrieben werden." });
        if (z.mcp === "anders" && !body?.umstellen) return json(409, { fehler: "In Claude gibt es schon einen Server brain.", art: "anders" });
        if (z.mcp === "schon") return json(200, { ok: true, schonVerbunden: true });
        return json(200, { ok: true });
      case "/api/mcp/selbsttest":
        if (z.selbsttestVerzoegerung) await warte(z.selbsttestVerzoegerung);
        if (z.selbsttest === "fehler") return json(502, { fehler: "Der MCP-Server hat nicht geantwortet — die KI würde deinen Vault so nicht finden.", art: "mcp" });
        return json(200, { ok: true, werkzeuge: ["brain_suchen", "brain_lesen"], treffer: 1 });
      case "/api/kit/hooks":
        if (z.hooks === "fehlt") return json(404, { fehler: "nicht gefunden" });
        return json(200, { ok: true });
      case "/api/probe": return json(200, { treffer: z.treffer ?? TREFFER });
      default: return json(404, { fehler: "nicht gefunden" });
    }
  });
  return z;
}

// App-Simulation: nativer Kanal "aktion" mit Antwort (ordner-waehlen → {pfad} | null).
async function appKanal(page, antwort) {
  await page.addInitScript((a) => {
    window.__aktionen = []; window.__ordnerAntwort = a;
    window.webkit = { messageHandlers: { aktion: { postMessage: async (m) => { window.__aktionen.push(m); if (m.aktion === "ordner-waehlen") return window.__ordnerAntwort; return undefined; } } } };
  }, antwort);
}

async function oeffneSeite(page) { await page.goto(server.url); await page.waitForSelector("#willkommen-host", { state: "attached" }); }
async function zeigeWillkommen(page, modus = "start") {
  await page.evaluate(async (m) => {
    window.__fertig = null; window.__abbruch = false;
    const mod = await import("/willkommen.js");
    await mod.zeigeWillkommen({ modus: m, beiFertig: (a) => { window.__fertig = a; }, beiAbbruch: () => { window.__abbruch = true; } });
  }, modus);
}
// Sichtbar UND wirklich deckend (Einblend-Elemente täuschen toBeVisible): Produkt der Deckkraft aller Vorfahren.
async function deckend(loc) {
  await expect(loc).toBeVisible();
  await expect.poll(() => loc.evaluate((e) => { let o = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; }), { timeout: 4000 }).toBeGreaterThan(0.99);
}
const karte = (page) => page.locator("#willkommen-host .w-karte");
const schritt = (page, name) => page.locator(`#willkommen-host .w-karte[data-schritt="${name}"]`);
const knopf = (page, aktion) => page.locator(`#willkommen-host [data-aktion="${aktion}"]`);
const weg = (page, id) => page.locator(`#willkommen-host [data-weg="${id}"]`);
const aufgezeichnet = (z, pfad) => z.anfragen.filter((a) => a.pfad === pfad);
const aktivesWeg = (page) => page.evaluate(() => document.activeElement?.dataset?.weg ?? null);

test("Karte zeigt die vier Wege, die erste Zeile ist vorfokussiert", async ({ page }) => {
  await rahmen(page);
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(schritt(page, "wahl"));
  await expect(page.locator("#willkommen-host h1")).toHaveText("Willkommen bei Kortex");
  await expect(page.locator("#willkommen-host [data-weg]")).toHaveCount(4);
  await expect(page.locator("#willkommen-host .w-weg-titel")).toHaveText([
    "Mit der Kortex-Vorlage loslegen", "Leeren Vault anlegen", "Vorhandenen Ordner öffnen", "Von GitHub klonen"]);
  await expect(page.locator("#willkommen-host .w-weg-text2").first()).toHaveText("Ein neuer Vault mit Posteingang, Wiki und Beispielseiten.");
  await expect(page.locator("#willkommen-host .w-fuss-text")).toContainText("kein Konto und keine Cloud von uns");
  for (const id of ["vorlage", "leer", "ordner", "klonen"]) await deckend(weg(page, id));
  await expect.poll(() => aktivesWeg(page)).toBe("vorlage");
  // Hintergrund ist für Tastatur und Vorlesen gesperrt, Fokus bleibt in der Karte
  expect(await page.evaluate(() => document.getElementById("app").inert)).toBe(true);
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.getElementById("willkommen-host").contains(document.activeElement))).toBe(true);
  // modus "start": kein Abbrechen, Escape tut nichts
  await expect(knopf(page, "abbrechen")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(schritt(page, "wahl")).toBeVisible();
});

test("Tastatur: Pfeile wechseln die Zeile, Enter öffnet sie", async ({ page }) => {
  await rahmen(page);
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "vorlage"));
  await expect.poll(() => aktivesWeg(page)).toBe("vorlage");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  expect(await aktivesWeg(page)).toBe("ordner");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
  expect(await aktivesWeg(page)).toBe("vorlage"); // wickelt um
  await page.keyboard.press("ArrowUp");
  expect(await aktivesWeg(page)).toBe("klonen");
  await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp");
  expect(await aktivesWeg(page)).toBe("leer");
  await page.keyboard.press("Enter");
  await deckend(schritt(page, "name"));
  await expect(page.locator("#willkommen-host h2")).toHaveText("Leeren Vault anlegen");
  await expect(page.locator('[data-feld="name"]')).toBeFocused();
  await expect(page.locator('[data-feld="name"]')).toHaveValue("Kortex");
  // Escape geht einen Schritt zurück und fokussiert wieder eine Zeile
  await page.keyboard.press("Escape");
  await deckend(schritt(page, "wahl"));
  await expect.poll(() => aktivesWeg(page)).toBe("vorlage");
});

test("Leerer Vault: POST /api/vaults/neu mit art und name, ohne ordner; Fortschritt, dann KI-Schritt", async ({ page }) => {
  const z = await rahmen(page, { verzoegerung: 600 });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await deckend(schritt(page, "name"));
  await expect(page.locator(".w-ort-text")).toHaveText("Wird angelegt in ~/Kortex");
  await expect(page.locator("#willkommen-host .mini")).toHaveText("In deinem Benutzerordner braucht die App keine zusätzliche Freigabe.");
  await page.locator('[data-feld="name"]').fill("Privat");
  await knopf(page, "anlegen").click();
  const meldung = page.locator("#willkommen-host .w-meldung");
  await expect(meldung).toContainText("Der Ordner wird angelegt …");
  await expect(meldung).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#willkommen-host .w-karte")).toHaveAttribute("aria-busy", "true");
  await deckend(schritt(page, "ki"));
  const neu = aufgezeichnet(z, "/api/vaults/neu");
  expect(neu).toHaveLength(1);
  expect(neu[0].body).toEqual({ art: "leer", name: "Privat" }); // kein ordner-Schlüssel
});

test("Vorlage: art \"vorlage\", leerer Name und Schrägstrich werden freundlich abgelehnt", async ({ page }) => {
  const z = await rahmen(page);
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "vorlage"));
  await weg(page, "vorlage").click();
  await deckend(schritt(page, "name"));
  await expect(page.locator("#willkommen-host h2")).toHaveText("Kortex-Vorlage anlegen");
  await page.locator('[data-feld="name"]').fill("  ");
  await knopf(page, "anlegen").click();
  await expect(page.locator("#willkommen-host .fehlertext")).toHaveText("Gib deinem Vault einen Namen.");
  await page.locator('[data-feld="name"]').fill("a/b");
  await page.keyboard.press("Enter");
  await expect(page.locator("#willkommen-host .fehlertext")).toHaveText("Der Name darf keinen Schrägstrich enthalten.");
  expect(aufgezeichnet(z, "/api/vaults/neu")).toHaveLength(0);
  await page.locator('[data-feld="name"]').fill("Wissen");
  await page.keyboard.press("Enter");
  await deckend(schritt(page, "ki"));
  expect(aufgezeichnet(z, "/api/vaults/neu")[0].body).toEqual({ art: "vorlage", name: "Wissen" });
});

test("Anderen Ordner wählen (App-Simulation): Pfad wird angezeigt und gesendet; Abbruch bleibt still", async ({ page }) => {
  const z = await rahmen(page);
  await appKanal(page, { pfad: "/Users/test/Notizen" });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await deckend(schritt(page, "name"));
  await knopf(page, "ordner-wechseln").click();
  await expect(page.locator(".w-ort-text")).toHaveText("Wird angelegt in ~/Notizen");
  expect(await page.evaluate(() => window.__aktionen)).toEqual([{ aktion: "ordner-waehlen" }]);
  await expect(page.locator("#willkommen-host .mini")).toBeHidden(); // Freigabe-Hinweis gilt nur für den Standardordner
  // Abbruch (null) lässt den Pfad unverändert
  await page.evaluate(() => { window.__ordnerAntwort = null; });
  await knopf(page, "ordner-wechseln").click();
  await expect(page.locator(".w-ort-text")).toHaveText("Wird angelegt in ~/Notizen");
  await knopf(page, "anlegen").click();
  await deckend(schritt(page, "ki"));
  expect(aufgezeichnet(z, "/api/vaults/neu")[0].body).toEqual({ art: "leer", name: "Kortex", ordner: "/Users/test/Notizen" });
});

test("Browser-Ausweg: Textfeld „Pfad zum Ordner“ mit Prüfung", async ({ page }) => {
  const z = await rahmen(page);
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await deckend(schritt(page, "name"));
  await knopf(page, "ordner-wechseln").click();
  const dlg = page.locator('.w-modal[data-schritt="pfad"]');
  await deckend(dlg);
  await expect(dlg.locator("h2")).toHaveText("Ordner für deinen Vault wählen");
  await expect(dlg.locator("input")).toBeFocused();
  await dlg.locator("input").fill("Dokumente/Notizen");
  await page.keyboard.press("Enter");
  await expect(dlg.locator(".fehlertext")).toHaveText("Der Pfad muss mit / oder ~ beginnen.");
  await dlg.locator("input").fill("");
  await page.locator('[data-aktion="pfad-uebernehmen"]').click();
  await expect(dlg.locator(".fehlertext")).toHaveText("Gib den Pfad des Ordners ein.");
  await dlg.locator("input").fill("/Users/test/Notizen");
  await page.keyboard.press("Enter");
  await expect(dlg).toHaveCount(0);
  await expect(page.locator(".w-ort-text")).toHaveText("Wird angelegt in ~/Notizen");
  // Escape schließt nur den Dialog, nicht die Karte
  await knopf(page, "ordner-wechseln").click();
  await deckend(dlg);
  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await expect(schritt(page, "name")).toBeVisible();
  expect(aufgezeichnet(z, "/api/vaults/neu")).toHaveLength(0);
});

test("Ordner öffnen ohne Git: Rückfrage, „Einschalten“ ruft erneut mit git:true", async ({ page }) => {
  const z = await rahmen(page, { gitBeimOeffnen: false });
  await appKanal(page, { pfad: "/Users/test/Alt" });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "ordner"));
  await weg(page, "ordner").click();
  await deckend(schritt(page, "git"));
  await expect(page.locator("#willkommen-host h2")).toHaveText("Versionsverlauf einschalten?");
  await expect(page.locator("#willkommen-host .w-untertitel")).toHaveText("In diesem Ordner gibt es noch keinen Versionsverlauf. Einschalten?");
  await expect(knopf(page, "git-einschalten")).toBeFocused();
  await knopf(page, "git-einschalten").click();
  await deckend(schritt(page, "ki"));
  const offen = aufgezeichnet(z, "/api/vaults/oeffnen");
  expect(offen.map((a) => a.body)).toEqual([{ pfad: "/Users/test/Alt" }, { pfad: "/Users/test/Alt", gitEinschalten: true }]); // Spec §5a: gitEinschalten, nicht git
});

test("Ordner öffnen ohne Git: antwortet die Werkstatt nach „Einschalten“ mit git:false, ist das ein Fehlschlag (nicht still weiter zum KI-Schritt)", async ({ page }) => {
  const z = await rahmen(page, { gitBeimOeffnen: false, gitEinschaltenFehlt: true });
  await appKanal(page, { pfad: "/Users/test/Alt" });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "ordner"));
  await weg(page, "ordner").click();
  await deckend(schritt(page, "git"));
  await knopf(page, "git-einschalten").click();
  const fehler = page.locator("#willkommen-host .w-fehlerbox");
  await expect(fehler).toHaveText("Der Versionsverlauf ließ sich nicht einschalten. Du kannst trotzdem ohne Verlauf weiterarbeiten.");
  await expect(fehler).toHaveAttribute("role", "alert");
  await expect(schritt(page, "git")).toBeVisible();
  await expect(schritt(page, "ki")).toHaveCount(0);
  expect(aufgezeichnet(z, "/api/vaults/oeffnen").map((a) => a.body)).toEqual([{ pfad: "/Users/test/Alt" }, { pfad: "/Users/test/Alt", gitEinschalten: true }]);
  // bewusst ohne Verlauf weiter geht weiterhin
  await knopf(page, "git-ohne").click();
  await deckend(schritt(page, "ki"));
});

test("Ordner öffnen ohne Git: „Ohne Verlauf weiter“ und Escape fragen nicht erneut", async ({ page }) => {
  const z = await rahmen(page, { gitBeimOeffnen: false });
  await appKanal(page, { pfad: "/Users/test/Alt" });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "ordner"));
  await weg(page, "ordner").click();
  await deckend(schritt(page, "git"));
  await knopf(page, "git-ohne").click();
  await deckend(schritt(page, "ki"));
  expect(aufgezeichnet(z, "/api/vaults/oeffnen")).toHaveLength(1);
});

// ---------------------------------------------------------------- UI-2: Zeitüberschreitung beim Einschalten des Versionsverlaufs
// Der Ordner ist durch den ersten Schritt schon offen und aktiv: dass die Werkstatt „einen Vault hat, den die App noch nicht kennt“, sagt hier nichts.
// Wie in der App meldet beiStandNeu darum true, sobald die Werkstatt einen Vault hat — im Git-Schritt darf das nie als Erfolg gelten.
async function zeigeWieApp(page) {
  await page.evaluate(async () => {
    window.__fertig = null; window.__stand = 0;
    const mod = await import("/willkommen.js");
    await mod.zeigeWillkommen({ modus: "start", beiFertig: (a) => { window.__fertig = a; }, beiStandNeu: async (st) => { window.__stand++; return !!st.info?.vault; } });
  });
}
// Ordner wählen (App-Simulation) bis zur Rückfrage „Versionsverlauf einschalten?“
async function bisGitSchritt(page) {
  await deckend(weg(page, "ordner"));
  await weg(page, "ordner").click();
  await deckend(schritt(page, "git"));
}
const ALT = "/Users/test/Alt";
const fehlerBox = (page) => page.locator("#willkommen-host .w-fehlerbox");

test("UI-2: „Einschalten“ läuft in die Frist der Werkstatt (504): kein Erfolg, eigener Satz, Schritt bleibt, Wiederholen geht", async ({ page }) => {
  const z = await rahmen(page, { gitBeimOeffnen: false, gitEinschaltenAusgang: ["zeit"] });
  await appKanal(page, { pfad: ALT });
  await oeffneSeite(page);
  await zeigeWieApp(page);
  await bisGitSchritt(page);
  await knopf(page, "git-einschalten").click();
  await expect(fehlerBox(page)).toHaveText(GIT_ZEIT);
  await expect(fehlerBox(page)).not.toContainText("nicht in der Liste eingetragen"); // der Satz der Werkstatt wäre falsch: der Ordner ist ja eingetragen
  await expect(fehlerBox(page)).toHaveAttribute("role", "alert");
  // kein Erfolg: der Schritt bleibt, der KI-Schritt kommt nicht, die App hört nicht „fertig“
  await expect(schritt(page, "git")).toBeVisible();
  await expect(schritt(page, "ki")).toHaveCount(0);
  expect(await page.evaluate(() => window.__fertig)).toBeNull();
  expect(aufgezeichnet(z, "/api/info").length).toBeGreaterThan(1); // der Stand wurde neu gelesen: erst die Info sagt, ob der Verlauf da ist
  // nichts bleibt gesperrt: noch einmal versuchen geht, diesmal klappt es
  await expect(knopf(page, "git-einschalten")).toBeEnabled();
  await expect(knopf(page, "git-ohne")).toBeEnabled();
  await knopf(page, "git-einschalten").click();
  await deckend(schritt(page, "ki"));
  expect(aufgezeichnet(z, "/api/vaults/oeffnen").map((a) => a.body)).toEqual([{ pfad: ALT }, { pfad: ALT, gitEinschalten: true }, { pfad: ALT, gitEinschalten: true }]);
  expect(await page.evaluate(() => window.__fertig)).toBeNull(); // fertig wird erst nach dem KI-Schritt gemeldet
});

test("UI-2: reißt die Brücke beim Einschalten ab (status 0) und der Verlauf ist aus, ist auch das kein Erfolg; „Ohne Verlauf weiter“ geht", async ({ page }) => {
  await rahmen(page, { gitBeimOeffnen: false, gitEinschaltenAusgang: ["abbruch"] });
  await appKanal(page, { pfad: ALT });
  await oeffneSeite(page);
  await zeigeWieApp(page);
  await bisGitSchritt(page);
  await knopf(page, "git-einschalten").click();
  await expect(fehlerBox(page)).toHaveText(GIT_ZEIT);
  await expect(schritt(page, "git")).toBeVisible();
  await expect(schritt(page, "ki")).toHaveCount(0);
  expect(await page.evaluate(() => window.__fertig)).toBeNull();
  await knopf(page, "git-ohne").click(); // bewusst ohne Verlauf: das war immer erlaubt
  await deckend(schritt(page, "ki"));
});

test("UI-2: kam die Antwort zu spät, der Verlauf ist aber da: die Karte macht weiter wie nach Erfolg", async ({ page }) => {
  await rahmen(page, { gitBeimOeffnen: false, gitEinschaltenAusgang: ["zeit-doch"] });
  await appKanal(page, { pfad: ALT });
  await oeffneSeite(page);
  await zeigeWieApp(page);
  await bisGitSchritt(page);
  await knopf(page, "git-einschalten").click();
  await deckend(schritt(page, "ki"));
  await expect(fehlerBox(page)).toHaveCount(0);
});

test("UI-2: hat die Werkstatt inzwischen einen ANDEREN Vault (mit Verlauf) offen, zählt das nicht für diesen Ordner", async ({ page }) => {
  await rahmen(page, { gitBeimOeffnen: false, gitEinschaltenAusgang: ["zeit-anderer"] });
  await appKanal(page, { pfad: ALT });
  await oeffneSeite(page);
  await zeigeWieApp(page);
  await bisGitSchritt(page);
  await knopf(page, "git-einschalten").click();
  await expect(fehlerBox(page)).toHaveText(GIT_ZEIT);
  await expect(schritt(page, "ki")).toHaveCount(0);
  expect(await page.evaluate(() => window.__fertig)).toBeNull();
});

test("UI-2: antwortet die Werkstatt danach gar nicht mehr: status 0 bleibt die Verbindungsmeldung, 504 der Zeit-Satz", async ({ page }) => {
  const z = await rahmen(page, { gitBeimOeffnen: false, gitEinschaltenAusgang: ["abbruch", "zeit"] });
  await appKanal(page, { pfad: ALT });
  await oeffneSeite(page);
  await zeigeWieApp(page);
  await bisGitSchritt(page);
  z.infoAbbruch = true; // ab jetzt antwortet auch /api/info nicht mehr
  await knopf(page, "git-einschalten").click();
  await expect(fehlerBox(page)).toHaveText("Die Verbindung zum Hintergrunddienst ist abgebrochen. Starte die App neu, falls das bleibt.");
  await expect(knopf(page, "git-einschalten")).toBeEnabled();
  await knopf(page, "git-einschalten").click();
  await expect(fehlerBox(page)).toHaveText(GIT_ZEIT); // nicht der Satz der Werkstatt („nicht in der Liste eingetragen“)
  await expect(schritt(page, "ki")).toHaveCount(0);
  expect(await page.evaluate(() => window.__fertig)).toBeNull();
});

// ---------------------------------------------------------------- UI-3: das Schließen nennt die laufende Arbeit beim Namen
test("UI-3: Ordner öffnen meldet „oeffnen“ (nicht den Abgleich) und gibt danach wieder frei", async ({ page }) => {
  await rahmen(page, { oeffnenVerzoegerung: 900 });
  await appKanal(page, { pfad: ALT });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  const arbeiten = () => page.evaluate(async () => (await import("/hilfen.js")).laufendeArbeiten());
  await deckend(weg(page, "ordner"));
  await weg(page, "ordner").click();
  await expect(page.locator("#willkommen-host .w-arbeit")).toBeVisible();
  expect(await arbeiten()).toEqual(["oeffnen"]);
  expect(await page.evaluate(async () => (await import("/texte.js")).T.laeuft.oeffnen)).toBe("Das Öffnen des Ordners läuft noch. Wenn du jetzt schließt, wird es abgebrochen.");
  await deckend(schritt(page, "ki"));
  expect(await arbeiten()).toEqual([]);
});

test("UI-3: Vault anlegen meldet „neu“, nicht den Abgleich", async ({ page }) => {
  await rahmen(page, { verzoegerung: 900 });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await deckend(schritt(page, "name"));
  await page.locator('[data-feld="name"]').fill("Privat");
  await knopf(page, "anlegen").click();
  await expect(page.locator("#willkommen-host .w-arbeit")).toBeVisible();
  expect(await page.evaluate(async () => (await import("/hilfen.js")).laufendeArbeiten())).toEqual(["neu"]);
  expect(await page.evaluate(async () => (await import("/texte.js")).T.laeuft.neu)).toBe("Das Anlegen des Vaults läuft noch. Wenn du jetzt schließt, wird es abgebrochen.");
  await deckend(schritt(page, "ki"));
  expect(await page.evaluate(async () => (await import("/hilfen.js")).laufendeArbeiten())).toEqual([]);
});

test("Ordner öffnen: Abbruch im Ordner-Dialog (null) bleibt still, Fehler erscheint in der Karte", async ({ page }) => {
  const z = await rahmen(page, { oeffnenFehler: { status: 400, fehler: "Dieser Ordner lässt sich nicht öffnen." } });
  await appKanal(page, null);
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "ordner"));
  await weg(page, "ordner").click();
  await page.waitForTimeout(250);
  expect(aufgezeichnet(z, "/api/vaults/oeffnen")).toHaveLength(0);
  await expect(schritt(page, "wahl")).toBeVisible();
  await expect.poll(() => aktivesWeg(page)).toBe("ordner");
  // jetzt mit Pfad, aber das Backend lehnt ab
  await page.evaluate(() => { window.__ordnerAntwort = { pfad: "/Users/test/Kaputt" }; });
  await weg(page, "ordner").click();
  await expect(page.locator("#willkommen-host .w-fehlerbox")).toHaveText("Dieser Ordner lässt sich nicht öffnen.");
  await expect(page.locator("#willkommen-host .w-fehlerbox")).toHaveAttribute("role", "alert");
  await expect(schritt(page, "wahl")).toBeVisible();
});

test("Klonen: Fortschritt, Fehler in Alltagssprache mit Anmelde-Hinweis, Eingaben bleiben, dann Erfolg", async ({ page }) => {
  const z = await rahmen(page, { klonenFehler: [{ status: 502, fehler: "Das Repository ist nicht erreichbar. Prüfe die Adresse und deine Verbindung." }] });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "klonen"));
  await weg(page, "klonen").click();
  await deckend(schritt(page, "klonen"));
  await expect(page.locator("#willkommen-host h2")).toHaveText("Von GitHub klonen");
  await expect(page.locator("#willkommen-host .w-hilfe")).toHaveText("Anmeldung läuft über deine normale Git-Anmeldung (SSH-Schlüssel oder macOS-Schlüsselbund). Die App speichert keine Passwörter.");
  await expect(page.locator('[data-feld="url"]')).toBeFocused();
  // leere und unpassende Adresse
  await knopf(page, "klonen").click();
  await expect(page.locator("#willkommen-host .fehlertext")).toHaveText("Gib die Adresse des Repositories ein.");
  await page.locator('[data-feld="url"]').fill("einfach so");
  await knopf(page, "klonen").click();
  await expect(page.locator("#willkommen-host .fehlertext")).toHaveText("Die Adresse sollte mit https://, ssh:// oder git@ beginnen.");
  expect(aufgezeichnet(z, "/api/vaults/klonen")).toHaveLength(0);
  // erster Versuch: Fortschritt, dann Fehler
  await page.locator('[data-feld="url"]').fill("git@github.com:name/vault.git");
  await knopf(page, "klonen").click();
  await expect(page.locator("#willkommen-host .w-arbeit")).toHaveText("Wird geklont … das kann einige Minuten dauern.");
  await expect(knopf(page, "klonen")).toBeDisabled();
  const fehler = page.locator("#willkommen-host .w-fehlerbox");
  await expect(fehler).toHaveText("Das Repository ist nicht erreichbar. Prüfe die Adresse und deine Verbindung.");
  await deckend(fehler);
  await expect(page.locator('[data-feld="url"]')).toHaveValue("git@github.com:name/vault.git"); // Eingaben bleiben
  await expect(knopf(page, "klonen")).toBeEnabled();
  await expect(page.locator("#willkommen-host .w-hilfe")).toBeVisible();
  // zweiter Versuch klappt
  await knopf(page, "klonen").click();
  await deckend(schritt(page, "ki"));
  const k = aufgezeichnet(z, "/api/vaults/klonen");
  expect(k.map((a) => a.body)).toEqual([{ url: "git@github.com:name/vault.git" }, { url: "git@github.com:name/vault.git" }]);
});

// Zeitüberschreitung der Brücke = die Anfrage reißt ab (status 0). Danach: Info, Vault-Liste und Git-Status neu laden und ehrlich melden.
const DAUERT = "Das dauert länger als erwartet. Ich habe den Stand neu geladen – prüfe bitte, ob es geklappt hat.";
test("Klonen: Zeitüberschreitung lädt Info, Vault-Liste und Git-Status neu und sagt, dass der Ausgang unklar ist; Eingaben bleiben", async ({ page }) => {
  const z = await rahmen(page, { klonenAbbruch: "ja", verzoegerung: 100 });
  await oeffneSeite(page);
  await page.evaluate(async () => { const mod = await import("/willkommen.js"); window.__stand = null; mod.zeigeWillkommen({ modus: "start", beiFertig: (a) => { window.__fertig = a; }, beiStandNeu: (st) => { window.__stand = { ok: st.ok, vault: st.info?.vault ?? null }; return false; } }); });
  await deckend(weg(page, "klonen"));
  await weg(page, "klonen").click();
  await deckend(schritt(page, "klonen"));
  await page.locator('[data-feld="url"]').fill("git@github.com:name/vault.git");
  await knopf(page, "klonen").click();
  const fehler = page.locator("#willkommen-host .w-fehlerbox");
  await expect(fehler).toHaveText(DAUERT);
  await expect(page.locator('[data-feld="url"]')).toHaveValue("git@github.com:name/vault.git");
  await expect(knopf(page, "klonen")).toBeEnabled();
  for (const pfad of ["/api/info", "/api/vaults", "/api/git/status"]) expect(aufgezeichnet(z, pfad).length, pfad).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__stand)).toEqual({ ok: true, vault: null });
  expect(await page.evaluate(() => window.__fertig)).toBeUndefined();
});

test("Klonen: reißt die Brücke ab und antwortet auch die Werkstatt nicht, bleibt es bei der Verbindungsmeldung", async ({ page }) => {
  const z = await rahmen(page, { klonenAbbruch: "ja", verzoegerung: 100, infoAbbruch: true });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await weg(page, "klonen").click();
  await deckend(schritt(page, "klonen"));
  await page.locator('[data-feld="url"]').fill("git@github.com:name/vault.git");
  await knopf(page, "klonen").click();
  await expect(page.locator("#willkommen-host .w-fehlerbox")).toHaveText("Die Verbindung zum Hintergrunddienst ist abgebrochen. Starte die App neu, falls das bleibt.");
  expect(aufgezeichnet(z, "/api/vaults/klonen")).toHaveLength(1);
});

test("Klonen: hat die Werkstatt den Vault trotz Zeitüberschreitung geöffnet, macht die Karte wie nach Erfolg weiter", async ({ page }) => {
  await rahmen(page, { klonenAbbruch: "trotzdem", verzoegerung: 100 });
  await oeffneSeite(page);
  await page.evaluate(async () => { const mod = await import("/willkommen.js"); window.__fertig = null; mod.zeigeWillkommen({ modus: "start", beiFertig: (a) => { window.__fertig = a; }, beiStandNeu: async (st) => !!st.info?.vault }); });
  await weg(page, "klonen").click();
  await deckend(schritt(page, "klonen"));
  await page.locator('[data-feld="url"]').fill("git@github.com:name/vault.git");
  await knopf(page, "klonen").click();
  await expect(page.locator("#willkommen-host")).toBeHidden();
  expect(await page.evaluate(() => window.__fertig)).toEqual({ pfad: "/Users/test/Brain/vault" });
  expect(await page.evaluate(() => document.getElementById("app").inert)).toBe(false);
});

test("Arbeit läuft: Klonen wird für vorSchliessen gemeldet und danach wieder freigegeben", async ({ page }) => {
  await rahmen(page, { verzoegerung: 900 });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await weg(page, "klonen").click();
  await deckend(schritt(page, "klonen"));
  await page.locator('[data-feld="url"]').fill("git@github.com:name/vault.git");
  await knopf(page, "klonen").click();
  await expect(page.locator("#willkommen-host .w-arbeit")).toBeVisible();
  expect(await page.evaluate(async () => (await import("/hilfen.js")).laufendeArbeiten())).toEqual(["klonen"]);
  await deckend(schritt(page, "ki"));
  expect(await page.evaluate(async () => (await import("/hilfen.js")).laufendeArbeiten())).toEqual([]);
});

// Weitere Programme mit Einstellungsdatei: nur erkannte stehen in der Auswahl, ihr Ziel geht unverändert an die Werkstatt
test("KI verbinden: erkannte weitere Programme erscheinen in der Auswahl (mit Logo) und schicken ihr Ziel; nicht erkannte fehlen", async ({ page }) => {
  const z = await rahmen(page, { vault: "/Users/test/Brain/Privat", programme: [
    { id: "claude-desktop", name: "Claude Desktop", gefunden: true, version: "1.4.2", quelle: "app" },
    { id: "gemini", name: "Gemini CLI", gefunden: false, version: null, quelle: null },
    { id: "zed", name: "Zed", gefunden: true, version: null, quelle: "app" },
  ] });
  const d = await oeffneKi(page);
  const wahl = d.locator('[data-bereich="ziel-wahl"]');
  await expect(wahl.locator("[data-ziel]")).toHaveText(["Claude", "Codex", "Cursor", "Claude Desktop", "Zed"]);
  await expect(wahl.locator('[data-ziel="zed"] [data-ki-logo="zed"] svg path')).toHaveCount(1);
  await expect(d.locator('[data-liste="agenten"] [data-agent="zed"] [data-ki-logo="zed"]')).toHaveCount(1);
  await expect(d.locator('[data-liste="agenten"] [data-agent="gemini"]')).toHaveCount(0);
  await expect(wahl.locator('[data-ziel="claude-desktop"] [data-ki-logo="claude-desktop"] svg path')).toHaveCount(1);
  await wahl.locator('[data-ziel="zed"]').click();
  const knopf = d.locator('[data-aktion="claude-verbinden"]');
  await expect(knopf).toHaveText("Mit Zed verbinden");
  await knopf.click();
  await expect(d.locator('[data-zeile="verbinden"] .w-ok')).toContainText("Starte Zed neu");
  expect(z.anfragen.filter((a) => a.pfad === "/api/mcp/verbinden").map((a) => a.body)).toEqual([{ ziel: "zed" }]);
});

test("KI verbinden: bei einem fremden Eintrag in Zed fragt der Dialog erst, dann mit „umstellen“", async ({ page }) => {
  const z = await rahmen(page, { vault: "/Users/test/Brain/Privat", mcp: "anders", programme: [{ id: "zed", name: "Zed", gefunden: true, version: null, quelle: "app" }] });
  const d = await oeffneKi(page);
  await d.locator('[data-ziel="zed"]').click();
  await d.locator('[data-aktion="claude-verbinden"]').click();
  await expect(d.locator('[data-bereich="umstellen"]')).toContainText("In Zed gibt es schon einen Eintrag");
  await d.locator('[data-aktion="umstellen"]').click();
  await expect(d.locator('[data-zeile="verbinden"] .w-ok')).toContainText("Starte Zed neu");
  expect(z.anfragen.filter((a) => a.pfad === "/api/mcp/verbinden").map((a) => a.body)).toEqual([{ ziel: "zed" }, { ziel: "zed", umstellen: true }]);
});

// FBL-70: Auswahl Claude / Codex / Cursor, danach Selbsttest
async function oeffneKi(page) {
  await oeffneSeite(page);
  await page.evaluate(async () => { window.__verbunden = 0; await (await import("/willkommen.js")).oeffneKiDialog({ beiVerbunden: () => { window.__verbunden++; } }); });
  const d = page.locator("#dialog-host .dialog");
  await deckend(d);
  return d;
}
test("KI verbinden: Auswahl Claude/Codex/Cursor schickt das gewählte Ziel, danach Selbsttest mit ehrlichem Text", async ({ page }) => {
  const z = await rahmen(page, { vault: "/Users/test/Brain/Privat" });
  const d = await oeffneKi(page);
  const wahl = d.locator('[data-bereich="ziel-wahl"]');
  await expect(wahl.locator("[data-ziel]")).toHaveText(["Claude", "Codex", "Cursor"]);
  await expect(wahl.locator('[data-ziel="claude"]')).toHaveAttribute("aria-checked", "true");
  await wahl.locator('[data-ziel="codex"]').click();
  await expect(wahl.locator('[data-ziel="codex"]')).toHaveAttribute("aria-checked", "true");
  await expect(wahl.locator('[data-ziel="claude"]')).toHaveAttribute("aria-checked", "false");
  const knopf = d.locator('[data-aktion="claude-verbinden"]');
  await expect(knopf).toHaveText("Mit Codex verbinden");
  await knopf.click();
  const test = d.locator('[data-bereich="selbsttest"]');
  await expect(test).toContainText("Verbindung steht");
  await expect(test).toContainText("Starte Codex neu");
  await expect(d.locator('[data-zeile="verbinden"] .w-ok')).toContainText("Starte Codex neu");
  expect(aufgezeichnet(z, "/api/mcp/verbinden").map((a) => a.body)).toEqual([{ ziel: "codex" }]);
  expect(aufgezeichnet(z, "/api/mcp/selbsttest")).toHaveLength(1);
  expect(await page.evaluate(() => window.__verbunden), "Status „Claude verbunden“ nur bei Claude").toBe(0);
});

test("KI verbinden: Cursor — Selbsttest-Fehler wird benannt; Claude bleibt Standard und löst beiVerbunden aus", async ({ page }) => {
  const z = await rahmen(page, { vault: "/Users/test/Brain/Privat", selbsttest: "fehler" });
  const d = await oeffneKi(page);
  await d.locator('[data-ziel="cursor"]').click();
  await d.locator('[data-aktion="claude-verbinden"]').click();
  await expect(d.locator('[data-bereich="selbsttest"]')).toContainText("Der Selbsttest ist fehlgeschlagen: Der MCP-Server hat nicht geantwortet");
  expect(aufgezeichnet(z, "/api/mcp/verbinden").map((a) => a.body)).toEqual([{ ziel: "cursor" }]);
});

test("KI verbinden: Cursor mit kaputter Datei → Fehlertext und Eintrag zum Kopieren", async ({ page }) => {
  await rahmen(page, { vault: "/Users/test/Brain/Privat" });
  await page.route("**/api/mcp/verbinden", (r) => r.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ fehler: "Die Datei ~/.cursor/mcp.json ist kein gültiges JSON in der erwarteten Form.", art: "kaputt", befehl: '{ "mcpServers": {} }' }) }));
  const d = await oeffneKi(page);
  await d.locator('[data-ziel="cursor"]').click();
  await d.locator('[data-aktion="claude-verbinden"]').click();
  await expect(d.locator('[data-zeile="verbinden"]')).toContainText("kein gültiges JSON");
  await expect(d.locator('[data-bereich="befehl"] code')).toHaveText('{ "mcpServers": {} }');
  await expect(d.locator('[data-bereich="selbsttest"]')).toHaveCount(0);
});

test("KI verbinden: Während des Selbsttests ist die Auswahl gesperrt, das Ergebnis nennt die App, die verbunden wurde", async ({ page }) => {
  await rahmen(page, { vault: "/Users/test/Brain/Privat", selbsttestVerzoegerung: 900 });
  const d = await oeffneKi(page);
  const wahl = d.locator('[data-bereich="ziel-wahl"]');
  await wahl.locator('[data-ziel="codex"]').click();
  await d.locator('[data-aktion="claude-verbinden"]').click();
  await expect(d.locator('[data-zeile="verbinden"] .w-arbeit')).toBeVisible();
  await expect(wahl.locator('[data-ziel="cursor"]')).toBeDisabled();
  await wahl.locator('[data-ziel="cursor"]').dispatchEvent("click"); // auch ein erzwungener Klick ändert nichts
  await expect(wahl.locator('[data-ziel="codex"]')).toHaveAttribute("aria-checked", "true");
  await expect(d.locator('[data-bereich="selbsttest"]')).toContainText("Starte Codex neu");
  await expect(d.locator('[data-bereich="selbsttest"]')).not.toContainText("Cursor");
  await expect(wahl.locator('[data-ziel="cursor"]')).toBeEnabled(); // danach wieder frei
});

test("KI verbinden: Cursor wird auch ohne cursor-agent angeboten, wenn die App oder ~/.cursor da ist (cursorDa)", async ({ page }) => {
  await rahmen(page, { vault: "/Users/test/Brain/Privat", agenten: [], cursorDa: true });
  let d = await oeffneKi(page);
  await expect(d.locator('[data-zeile="verbinden"]')).toBeVisible();
  await expect(d.locator('[data-ziel="cursor"]')).toHaveAttribute("aria-checked", "true");
  await expect(d.locator('[data-aktion="claude-verbinden"]')).toHaveText("Mit Cursor verbinden");
});

test("KI verbinden: ohne jede erkannte KI und ohne Cursor gibt es keine Verbinden-Zeile", async ({ page }) => {
  await rahmen(page, { vault: "/Users/test/Brain/Privat", agenten: [], cursorDa: false });
  const d = await oeffneKi(page);
  await expect(d.locator(".w-laedt")).toHaveCount(0); // Suche ist fertig
  await expect(d.locator('[data-zeile="verbinden"]')).toHaveCount(0);
});

// W4: „verbunden“ erst nach Erfolg
test("KI-Dialog: beiVerbunden kommt nur nach geglücktem Verbinden, nicht beim Schließen; Umstellen fragt nach", async ({ page }) => {
  await rahmen(page, { vault: "/Users/test/Brain/Privat", mcp: "anders" });
  await oeffneSeite(page);
  await page.evaluate(async () => { window.__zu = 0; window.__verbunden = 0; await (await import("/willkommen.js")).oeffneKiDialog({ beiFertig: () => { window.__zu++; }, beiVerbunden: () => { window.__verbunden++; } }); });
  const d = page.locator("#dialog-host .dialog");
  await deckend(d);
  await d.locator('[data-aktion="claude-verbinden"]').click();
  const frage = d.locator('[data-bereich="umstellen"]');
  await expect(frage).toContainText("In Claude gibt es schon einen Eintrag „brain“, der woanders hinzeigt. Auf diesen Vault umstellen?");
  await frage.locator('[data-aktion="nicht-umstellen"]').click();
  await d.locator('[data-aktion="ki-fertig"]').click(); // schließen, ohne verbunden zu sein
  await expect(d).toHaveCount(0);
  expect(await page.evaluate(() => [window.__zu, window.__verbunden])).toEqual([1, 0]);
});

test("Umstellen: zweiter Aufruf mit umstellen:true, danach Erfolg und beiVerbunden", async ({ page }) => {
  const z = await rahmen(page, { vault: "/Users/test/Brain/Privat", mcp: "anders" });
  await oeffneSeite(page);
  await page.evaluate(async () => { window.__verbunden = 0; await (await import("/willkommen.js")).oeffneKiDialog({ beiVerbunden: () => { window.__verbunden++; } }); });
  const d = page.locator("#dialog-host .dialog");
  await deckend(d);
  await d.locator('[data-aktion="claude-verbinden"]').click();
  await d.locator('[data-aktion="umstellen"]').click();
  await expect(d.locator('[data-zeile="verbinden"] .w-ok')).toHaveText("Verbunden. Claude kann jetzt auf dein Wissen zugreifen.");
  expect(aufgezeichnet(z, "/api/mcp/verbinden").map((a) => a.body)).toEqual([{ ziel: "claude" }, { ziel: "claude", umstellen: true }]);
  expect(await page.evaluate(() => window.__verbunden)).toBe(1);
});

test("{ schonVerbunden: true } gilt als Erfolg", async ({ page }) => {
  await rahmen(page, { vault: "/Users/test/Brain/Privat", mcp: "schon" });
  await oeffneSeite(page);
  await page.evaluate(async () => { window.__verbunden = 0; await (await import("/willkommen.js")).oeffneKiDialog({ beiVerbunden: () => { window.__verbunden++; } }); });
  const d = page.locator("#dialog-host .dialog");
  await deckend(d);
  await d.locator('[data-aktion="claude-verbinden"]').click();
  await expect(d.locator('[data-zeile="verbinden"] .w-ok')).toBeVisible();
  expect(await page.evaluate(() => window.__verbunden)).toBe(1);
});

test("Weg gibt es im Backend noch nicht (404): freundlicher Satz statt roher Meldung", async ({ page }) => {
  await rahmen(page, { neuFehler: { status: 404, fehler: "nicht gefunden" } });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await deckend(schritt(page, "name"));
  await knopf(page, "anlegen").click();
  await expect(page.locator("#willkommen-host .w-fehlerbox")).toHaveText("Das geht in dieser Version noch nicht.");
});

test("KI-Schritt: erkannte Agenten mit Version, nicht gefundene fehlen", async ({ page }) => {
  await rahmen(page);
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await knopf(page, "anlegen").click();
  await deckend(schritt(page, "ki"));
  await expect(page.locator("#willkommen-host h2")).toHaveText("Deine KI kann mitlesen");
  await expect(page.locator(".w-abschnitt").first()).toHaveText("Auf diesem Computer erkannt");
  const zeilen = page.locator(".w-agent");
  await expect(zeilen).toHaveCount(2);
  await expect(zeilen.nth(0).locator(".w-agent-name")).toHaveText("Claude Code");
  await expect(zeilen.nth(0).locator(".w-agent-version")).toHaveText("Version 2.1.310 (Claude Code)");
  await expect(zeilen.nth(1).locator(".w-agent-name")).toHaveText("Codex");
  await expect(zeilen.nth(1).locator(".w-agent-version")).toHaveText("Version codex-cli 0.162.1");
  await expect(page.locator(".w-pille")).toHaveText(["Installiert", "Installiert"]);
  await deckend(zeilen.nth(1));
  await expect(page.locator(".w-agent[data-agent='gemini']")).toHaveCount(0);
  await expect(knopf(page, "claude-verbinden")).toHaveText("Mit Claude verbinden");
  // ohne Kit kein zweiter Knopf
  await expect(knopf(page, "hinweise-einschalten")).toHaveCount(0);
});

test("KI-Schritt ohne gefundene Agenten: optional, nur Weiter", async ({ page }) => {
  await rahmen(page, { agenten: AGENTEN.map((a) => ({ ...a, version: null, pfad: null })) });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await knopf(page, "anlegen").click();
  await deckend(schritt(page, "ki"));
  await expect(page.locator("#willkommen-host h2")).toHaveText("KI verbinden ist optional");
  await expect(page.locator(".w-untertitel")).toHaveText("Auf diesem Computer wurde keine KI-App gefunden. Du kannst das jederzeit später einrichten.");
  await expect(page.locator(".w-agent")).toHaveCount(0);
  await expect(knopf(page, "claude-verbinden")).toHaveCount(0);
  await expect(knopf(page, "ki-weiter")).toBeVisible();
});

test("Mit Claude verbinden: Erfolg zeigt Häkchen und Satz", async ({ page }) => {
  const z = await rahmen(page);
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await knopf(page, "anlegen").click();
  await deckend(schritt(page, "ki"));
  await knopf(page, "claude-verbinden").click();
  const ok = page.locator('[data-zeile="verbinden"] .w-ok');
  await expect(ok).toHaveText("Verbunden. Claude kann jetzt auf dein Wissen zugreifen.");
  await deckend(ok);
  await expect(knopf(page, "claude-verbinden")).toHaveText("Verbunden");
  expect(aufgezeichnet(z, "/api/mcp/verbinden")).toHaveLength(1);
});

test("Mit Claude verbinden: 404 mit Befehl zeigt den Befehl und „Befehl kopieren“", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  await rahmen(page, { mcp: "befehl" });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await knopf(page, "anlegen").click();
  await deckend(schritt(page, "ki"));
  await knopf(page, "claude-verbinden").click();
  const block = page.locator('[data-bereich="befehl"]');
  await deckend(block);
  await expect(block.locator("code")).toHaveText(BEFEHL);
  await expect(block).toContainText("Führe diesen Befehl im Terminal aus");
  await knopf(page, "befehl-kopieren").click();
  await expect(block.locator(".mini")).toHaveText(/Befehl kopiert\.|Kopieren war nicht möglich/);
  await expect(knopf(page, "claude-verbinden")).toBeEnabled();
});

test("Mit Claude verbinden: anderer Fehler erscheint in Alltagssprache", async ({ page }) => {
  await rahmen(page, { mcp: "fehler" });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await knopf(page, "anlegen").click();
  await deckend(schritt(page, "ki"));
  await knopf(page, "claude-verbinden").click();
  await expect(page.locator('[data-zeile="verbinden"] .w-fehlerbox')).toHaveText("Die Konfiguration von Claude konnte nicht geschrieben werden.");
});

test("Probe: Beispielfrage aus der ersten Notiz, Ergebnis mit bis zu drei Titeln", async ({ page }) => {
  const z = await rahmen(page);
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await knopf(page, "anlegen").click();
  await deckend(schritt(page, "ki"));
  await expect(page.locator('[data-zeile="probe"] .w-aktion-text')).toContainText("Suche nach „Kaffee“ — so, wie Claude es tun würde.");
  await knopf(page, "probe").click();
  const erg = page.locator('[data-bereich="probe-ergebnis"]');
  await expect(erg.locator(".w-ergebnis-titel")).toHaveText("Claude findet deinen Vault: 4 Treffer");
  await deckend(erg);
  await expect(erg.locator("li")).toHaveText(["Kaffee", "Espresso", "Mühle"]);
  expect(aufgezeichnet(z, "/api/probe")[0].body).toEqual({ frage: "Kaffee" });
});

test("Probe bei leerem Vault: Hinweis, keine Suche", async ({ page }) => {
  const z = await rahmen(page, { notizen: [] });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await knopf(page, "anlegen").click();
  await deckend(schritt(page, "ki"));
  await expect(page.locator('[data-zeile="probe"] .w-aktion-text')).toContainText("Suche nach „Willkommen“");
  await knopf(page, "probe").click();
  await expect(page.locator('[data-bereich="probe-ergebnis"]')).toHaveText("Dein Vault ist noch leer — probiere es nach der ersten Notiz.");
  expect(aufgezeichnet(z, "/api/probe")).toHaveLength(0);
});

test("Kortex-Hinweise einschalten: der Knopf bleibt aus, solange es /api/kit/hooks nicht gibt (auch mit Kit)", async ({ page }) => {
  const z = await rahmen(page, { kit: { vorhanden: true, vertraut: true }, hooks: "fehlt" });
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await knopf(page, "anlegen").click();
  await deckend(schritt(page, "ki"));
  await expect(knopf(page, "claude-verbinden")).toBeVisible(); // die übrigen Zeilen sind da
  await expect(page.locator('[data-zeile="probe"]')).toBeVisible();
  await expect(knopf(page, "hinweise-einschalten")).toHaveCount(0);
  await expect(page.locator('[data-zeile="hinweise"]')).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(aufgezeichnet(z, "/api/kit/hooks")).toHaveLength(0);
});

test("Weiter und Später schließen die Karte und rufen beiFertig mit dem Pfad", async ({ page }) => {
  const z = await rahmen(page);
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await page.locator('[data-feld="name"]').fill("Privat");
  await knopf(page, "anlegen").click();
  await deckend(schritt(page, "ki"));
  expect(await page.evaluate(() => window.__fertig)).toBeNull();
  await knopf(page, "ki-weiter").click();
  await expect(page.locator("#willkommen-host")).toBeHidden();
  expect(await page.evaluate(() => window.__fertig)).toEqual({ pfad: "/Users/test/Brain/Privat" });
  expect(await page.evaluate(() => document.getElementById("app").inert)).toBe(false);
  // zweiter Durchlauf mit „Später“
  await page.evaluate(() => { window.__fertig = null; });
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").click();
  await knopf(page, "anlegen").click();
  await deckend(schritt(page, "ki"));
  await knopf(page, "ki-spaeter").click();
  await expect(page.locator("#willkommen-host")).toBeHidden();
  expect((await page.evaluate(() => window.__fertig)).pfad).toContain("/Users/test/Brain/");
  expect(z.seitenfehler).toEqual([]); // keine ungefangenen Fehler im ganzen Ablauf
});

test("Modus neu: Abbrechen oben rechts und Escape rufen beiAbbruch", async ({ page }) => {
  await rahmen(page);
  await oeffneSeite(page);
  await zeigeWillkommen(page, "neu");
  await deckend(schritt(page, "wahl"));
  await expect(knopf(page, "abbrechen")).toHaveText("Abbrechen");
  await knopf(page, "abbrechen").click();
  await expect(page.locator("#willkommen-host")).toBeHidden();
  expect(await page.evaluate(() => window.__abbruch)).toBe(true);
  expect(await page.evaluate(() => document.getElementById("app").inert)).toBe(false);
  // Escape
  await page.evaluate(() => { window.__abbruch = false; });
  await zeigeWillkommen(page, "neu");
  await deckend(schritt(page, "wahl"));
  await page.keyboard.press("Escape");
  await expect(page.locator("#willkommen-host")).toBeHidden();
  expect(await page.evaluate(() => window.__abbruch)).toBe(true);
});

test("oeffneOrdnerFlow aus dem Wechsler: Ordner wählen, öffnen, beiFertig", async ({ page }) => {
  const z = await rahmen(page);
  await appKanal(page, { pfad: "/Users/test/Notizen" });
  await oeffneSeite(page);
  const ergebnis = await page.evaluate(async () => {
    const mod = await import("/willkommen.js");
    window.__fertig = null;
    const r = await mod.oeffneOrdnerFlow({ beiFertig: (a) => { window.__fertig = a; } });
    return r;
  });
  expect(ergebnis).toEqual({ pfad: "/Users/test/Notizen" });
  expect(await page.evaluate(() => window.__fertig)).toEqual({ pfad: "/Users/test/Notizen" });
  expect(aufgezeichnet(z, "/api/vaults/oeffnen")[0].body).toEqual({ pfad: "/Users/test/Notizen" });
  await expect(page.locator("#willkommen-host")).toBeHidden();
});

test("oeffneOrdnerFlow ohne Git stellt die Rückfrage; Abbruch im Ordner-Dialog tut nichts", async ({ page }) => {
  const z = await rahmen(page, { gitBeimOeffnen: false });
  await appKanal(page, null);
  await oeffneSeite(page);
  const abgebrochen = await page.evaluate(async () => (await import("/willkommen.js")).oeffneOrdnerFlow({ beiFertig: () => { window.__fertig = "falsch"; } }));
  expect(abgebrochen).toBeNull();
  expect(aufgezeichnet(z, "/api/vaults/oeffnen")).toHaveLength(0);
  await page.evaluate(() => { window.__ordnerAntwort = { pfad: "/Users/test/Alt" }; window.__fertig = null; window.__flow = import("/willkommen.js").then((m) => m.oeffneOrdnerFlow({ beiFertig: (a) => { window.__fertig = a; } })); });
  await deckend(schritt(page, "git"));
  await page.keyboard.press("Escape"); // Escape = ohne Verlauf weiter
  await expect(page.locator("#willkommen-host")).toBeHidden();
  expect(await page.evaluate(() => window.__fertig)).toEqual({ pfad: "/Users/test/Alt" });
  expect(aufgezeichnet(z, "/api/vaults/oeffnen")).toHaveLength(1);
});

test("oeffneKiDialog zeigt dieselben Inhalte im Dialog und ruft beim Schließen beiFertig", async ({ page }) => {
  await rahmen(page, { vault: "/Users/test/Brain/Privat", kit: { vorhanden: true, vertraut: true } });
  await oeffneSeite(page);
  await page.evaluate(async () => { window.__zu = false; await (await import("/willkommen.js")).oeffneKiDialog({ beiFertig: () => { window.__zu = true; } }); });
  const d = page.locator("#dialog-host .dialog");
  await deckend(d);
  await expect(d.locator(".dialog-kopf")).toHaveText("KI verbinden");
  await expect(d.locator(".w-agent")).toHaveCount(2);
  await expect(d.locator('[data-aktion="claude-verbinden"]')).toBeVisible();
  await expect(d.locator('[data-aktion="hinweise-einschalten"]')).toHaveCount(0); // Route /api/kit/hooks fehlt noch
  await expect(d.locator('[data-aktion="ki-weiter"]')).toHaveCount(0);
  await expect(d.locator('[data-aktion="ki-spaeter"]')).toHaveCount(0);
  await d.locator('[data-aktion="ki-fertig"]').click();
  await expect(d).toHaveCount(0);
  expect(await page.evaluate(() => window.__zu)).toBe(true);
});

test("Doppelklick auf einen Weg löst im nächsten Schritt nichts aus", async ({ page }) => {
  const z = await rahmen(page);
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await deckend(weg(page, "leer"));
  await weg(page, "leer").dblclick();
  await deckend(schritt(page, "name"));
  await page.waitForTimeout(400);
  expect(aufgezeichnet(z, "/api/vaults/neu")).toHaveLength(0);
  await expect(schritt(page, "name")).toBeVisible();
});

test("Bewegung reduzieren: keine Animationen, Karte sofort deckend", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await rahmen(page);
  await oeffneSeite(page);
  await zeigeWillkommen(page);
  await expect(schritt(page, "wahl")).toBeVisible();
  const m = await page.evaluate(() => {
    const k = document.querySelector(".w-karte"), host = document.getElementById("willkommen-host");
    return { karte: getComputedStyle(k).animationName, host: getComputedStyle(host).animationName, opazitaet: parseFloat(getComputedStyle(k).opacity) * parseFloat(getComputedStyle(host).opacity) };
  });
  expect(m).toEqual({ karte: "none", host: "none", opazitaet: 1 });
});

test("oeffneOrdnerFlow: Fehler erscheint in der Karte, „Schließen“ beendet den Ablauf", async ({ page }) => {
  await rahmen(page, { oeffnenFehler: { status: 400, fehler: "Dieser Ordner lässt sich nicht öffnen." } });
  await appKanal(page, { pfad: "/Users/test/Kaputt" });
  await oeffneSeite(page);
  await page.evaluate(() => { window.__fertig = null; window.__flow = import("/willkommen.js").then((m) => m.oeffneOrdnerFlow({ beiFertig: (a) => { window.__fertig = a; } })); });
  await deckend(schritt(page, "fehler"));
  await expect(page.locator("#willkommen-host h2")).toHaveText("Das hat nicht geklappt");
  await expect(page.locator("#willkommen-host .w-fehlerbox")).toHaveText("Dieser Ordner lässt sich nicht öffnen.");
  await knopf(page, "schliessen").click();
  await expect(page.locator("#willkommen-host")).toBeHidden();
  expect(await page.evaluate(() => window.__flow)).toBeNull();
  expect(await page.evaluate(() => window.__fertig)).toBeNull();
});

for (const [breite, hoehe] of [[1440, 900], [1100, 720]]) {
  test(`Karte wird bei ${breite}×${hoehe} nie abgeschnitten (alles erreichbar)`, async ({ page }) => {
    await rahmen(page);
    await page.setViewportSize({ width: breite, height: hoehe });
    await oeffneSeite(page);
    await zeigeWillkommen(page);
    await deckend(schritt(page, "wahl"));
    await page.waitForTimeout(400);
    const m = await page.evaluate(() => {
      const k = document.querySelector(".w-karte").getBoundingClientRect(), host = document.getElementById("willkommen-host");
      return { oben: k.top, unten: k.bottom, links: k.left, rechts: k.right, breite: k.width, hoehe: innerHeight, scrollbar: host.scrollHeight > host.clientHeight, kopfZeilen: document.querySelectorAll("[data-weg]").length };
    });
    expect(m.oben).toBeGreaterThanOrEqual(0);
    expect(m.links).toBeGreaterThanOrEqual(0);
    expect(m.rechts).toBeLessThanOrEqual(breite);
    expect(m.breite).toBeLessThanOrEqual(561);
    expect(m, "Willkommen-Karte passt ohne Scrollen ins Fenster").toMatchObject({ scrollbar: false }); // 4 Wege passen auch bei 1100×720
    expect(m.unten).toBeLessThanOrEqual(m.hoehe);
    // jede Zeile ist erreichbar (scrollbar im Host, wenn zu hoch)
    await weg(page, "klonen").scrollIntoViewIfNeeded();
    await expect(weg(page, "klonen")).toBeInViewport();
    expect(m.kopfZeilen).toBe(4);
  });
}

// ---------------------------------------------------------------- Screenshots (Hell und Dunkel, 1440×900, @2x)
test.describe("Screenshots", () => {
  test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  for (const schema of ["hell", "dunkel"]) {
    test(`Willkommen und KI verbinden (${schema})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark", reducedMotion: "no-preference" });
      await rahmen(page, { kit: { vorhanden: true, vertraut: true } });
      await oeffneSeite(page);
      await zeigeWillkommen(page);
      await deckend(schritt(page, "wahl"));
      await deckend(weg(page, "klonen"));
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${BILDER}v2-willkommen-${schema}.png` });
      // Name-Schritt (zur Kontrolle)
      await weg(page, "vorlage").click();
      await deckend(schritt(page, "name"));
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${BILDER}v2-willkommen-name-${schema}.png` });
      await knopf(page, "zurueck").click();
      await deckend(schritt(page, "wahl"));
      await weg(page, "klonen").click();
      await deckend(schritt(page, "klonen"));
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${BILDER}v2-willkommen-klonen-${schema}.png` });
      await knopf(page, "zurueck").click();
      await weg(page, "leer").click();
      await knopf(page, "anlegen").click();
      await deckend(schritt(page, "ki"));
      await deckend(page.locator(".w-agent").nth(1));
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${BILDER}v2-ki-verbinden-${schema}.png` });
      await knopf(page, "claude-verbinden").click();
      await expect(page.locator('[data-zeile="verbinden"] .w-ok')).toBeVisible();
      await knopf(page, "probe").click();
      await expect(page.locator('[data-bereich="probe-ergebnis"]')).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${BILDER}v2-ki-verbinden-verbunden-${schema}.png` });
    });

    test(`Zusatzbilder: Git-Rückfrage, Klon-Fehler, KI-Dialog (${schema})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark", reducedMotion: "no-preference" });
      await rahmen(page, { gitBeimOeffnen: false, kit: { vorhanden: true, vertraut: true }, vault: null, klonenFehler: [{ status: 502, fehler: "Das Repository ist nicht erreichbar. Prüfe die Adresse und deine Verbindung." }] });
      await appKanal(page, { pfad: "/Users/test/Notizen" });
      await oeffneSeite(page);
      await zeigeWillkommen(page, "neu");
      await deckend(schritt(page, "wahl"));
      // Klonen mit Fehler
      await weg(page, "klonen").click();
      await deckend(schritt(page, "klonen"));
      await page.locator('[data-feld="url"]').fill("git@github.com:name/vault.git");
      await knopf(page, "klonen").click();
      await deckend(page.locator("#willkommen-host .w-fehlerbox"));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${BILDER}v2-willkommen-klonen-fehler-${schema}.png` });
      await knopf(page, "zurueck").click();
      await deckend(schritt(page, "wahl"));
      // Ordner öffnen ohne Git
      await weg(page, "ordner").click();
      await deckend(schritt(page, "git"));
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${BILDER}v2-willkommen-git-${schema}.png` });
      await page.evaluate(() => window.dispatchEvent(new Event("resize")));
      await knopf(page, "git-ohne").click();
      await deckend(schritt(page, "ki"));
      await knopf(page, "ki-spaeter").click();
      await expect(page.locator("#willkommen-host")).toBeHidden();
      // KI-Dialog aus der Statusleiste
      await page.evaluate(async () => { await (await import("/willkommen.js")).oeffneKiDialog({}); });
      const d = page.locator("#dialog-host .dialog");
      await deckend(d);
      await deckend(d.locator(".w-agent").nth(1));
      await page.waitForTimeout(350);
      await page.screenshot({ path: `${BILDER}v2-ki-verbinden-dialog-${schema}.png` });
    });
  }
});

// ---------------------------------------------------------------- KI-Logos (ki-logos.js)
// Claude und Cursor zeigen das echte Logo (Ressourcen/logos), Codex nur die Initiale; jedes Logo hat title und Namen für Screenreader.
test("KI-Logos: erkannte Apps und Auswahl zeigen Logos mit title und Namen", async ({ page }) => {
  await rahmen(page, { vault: "/Users/test/Brain/Privat" });
  const d = await oeffneKi(page);
  const liste = d.locator('[data-liste="agenten"]');
  for (const [id, name] of [["claude", "Claude"], ["codex", "Codex"]]) {
    const logo = liste.locator(`[data-agent="${id}"] [data-ki-logo="${id}"]`);
    await expect(logo).toHaveCount(1);
    await expect(logo).toHaveAttribute("title", name);
  }
  const wahl = d.locator('[data-bereich="ziel-wahl"]');
  for (const [id, name] of [["claude", "Claude"], ["codex", "Codex"], ["cursor", "Cursor"]]) {
    const logo = wahl.locator(`[data-ziel="${id}"] [data-ki-logo="${id}"]`);
    await expect(logo).toHaveAttribute("title", name);
    await expect(logo).toBeVisible();
  }
  // Claude und Cursor sind echte Vektor-Logos, Codex die Initiale ohne Text im DOM
  await expect(wahl.locator('[data-ki-logo="claude"] svg path')).toHaveCount(1);
  await expect(wahl.locator('[data-ki-logo="cursor"] svg path')).toHaveCount(1);
  await expect(wahl.locator('[data-ki-logo="codex"] svg')).toHaveCount(0);
  await expect(wahl.locator('[data-ki-logo="codex"]')).toHaveText("");
  expect(await wahl.locator('[data-ki-logo="codex"]').evaluate((e) => getComputedStyle(e, "::before").content)).toBe('"C"');
  // neben dem sichtbaren Namen nur dekorativ (kein doppeltes Vorlesen), Namen der Knöpfe unverändert
  await expect(wahl.locator("[data-ki-logo]").first()).toHaveAttribute("aria-hidden", "true");
  await expect(wahl.locator("[data-ziel]")).toHaveText(["Claude", "Codex", "Cursor"]);
  // Cursor folgt der Textfarbe, Claude behält die Markenfarbe
  const farbe = (sel) => wahl.locator(sel).evaluate((e) => getComputedStyle(e).color);
  expect(await farbe('[data-ki-logo="claude"]')).toBe("rgb(217, 119, 87)");
  expect(await farbe('[data-ki-logo="cursor"]')).not.toBe("rgb(217, 119, 87)");
});

test("KI-Logos: eigenständiges Logo ist ein Bild mit aria-label, unbekannte KI liefert nichts", async ({ page }) => {
  await rahmen(page, { vault: "/Users/test/Brain/Privat" });
  await oeffneSeite(page);
  const r = await page.evaluate(async () => {
    const m = await import("/ki-logos.js");
    const e = m.kiLogo("claude", 20);
    return { rolle: e.getAttribute("role"), label: e.getAttribute("aria-label"), titel: e.title, hatSvg: !!e.querySelector("svg"),
      alias: m.kiLogo("cursor-agent", 16)?.dataset.kiLogo, unbekannt: m.kiLogo("windsurf"), markup: m.kiLogoMarkup("codex"),
      gemini: m.kiLogo("gemini")?.getAttribute("aria-label"), desktop: m.kiLogoMarkup("claude-desktop") === m.kiLogoMarkup("claude") };
  });
  expect(r).toEqual({ rolle: "img", label: "Claude", titel: "Claude", hatSvg: true, alias: "cursor", unbekannt: null, markup: null, gemini: "Gemini CLI", desktop: true });
});

// Optional: Bilder für die visuelle Kontrolle (KI_LOGO_BILDER=/Ordner/ npx playwright test -g "KI-Logos Bilder")
test.describe("KI-Logos Bilder", () => {
  test.skip(!process.env.KI_LOGO_BILDER, "nur mit KI_LOGO_BILDER");
  test.use({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
  for (const schema of ["hell", "dunkel"]) {
    test(`KI verbinden mit Logos (${schema})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark", reducedMotion: "no-preference" });
      await rahmen(page, { vault: "/Users/test/Brain/Privat" });
      const d = await oeffneKi(page);
      await expect(d.locator('[data-ki-logo="cursor"]')).toBeVisible();
      await page.waitForTimeout(400);
      mkdirSync(process.env.KI_LOGO_BILDER, { recursive: true });
      await page.screenshot({ path: `${process.env.KI_LOGO_BILDER}ki-verbinden-${schema}.png` });
    });
    test(`KI verbinden mit weiteren Programmen (${schema})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark", reducedMotion: "no-preference" });
      await rahmen(page, { vault: "/Users/test/Brain/Privat", programme: [
        { id: "claude-desktop", name: "Claude Desktop", gefunden: true, version: "1.4.2", quelle: "app" },
        { id: "gemini", name: "Gemini CLI", gefunden: true, version: "0.12.3", quelle: "cli" },
        { id: "copilot", name: "GitHub Copilot", gefunden: true, version: null, quelle: "cli" },
        { id: "zed", name: "Zed", gefunden: true, version: "0.230.1", quelle: "app" },
        { id: "opencode", name: "OpenCode", gefunden: true, version: null, quelle: "cli" },
        { id: "warp", name: "Warp", gefunden: true, version: null, quelle: "app" },
      ] });
      const d = await oeffneKi(page);
      await expect(d.locator('[data-ziel="warp"] [data-ki-logo="warp"]')).toBeVisible();
      await page.waitForTimeout(400);
      mkdirSync(process.env.KI_LOGO_BILDER, { recursive: true });
      await page.screenshot({ path: `${process.env.KI_LOGO_BILDER}ki-verbinden-weitere-${schema}.png` });
    });
  }
});
