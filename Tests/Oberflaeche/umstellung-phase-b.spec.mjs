// „Vault umstellen“, Abschluss (P7d): der alte Werkzeug-Ordner wird aufgeräumt. Freigabe-Tor als Ampel mit Kästchen, Probelauf an einer Kopie, Aufräumen nur bei offenem Tor und nur nach
// eigener Bestätigung, Fortschritt B0–B4, Ergebnis (fertig, mit Warnungen, Fehler), Rückweg, Angebote „Aufräumen nach der Umstellung“ (Papierkorb statt Löschen), hell/dunkel, schmales Fenster.
// Die Antworten der Umstellungs-Routen sind Attrappen (mocks-umstellung.mjs); der Rest läuft gegen die echte Werkstatt.
// UI_SHOTS=<Ordner>: legt die Bildschirmfotos dort ab (sonst screenshots/, ignoriert).
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2 } from "./mocks.mjs";
import { mockeUmstellung, befundAntwort, probeAntwort, phaseBAntwort, phaseBFehler, phaseBTorZu, torAntwort, angebot, standFertig, standAufgeraeumt, phaseBLeer, FUNDE } from "./mocks-umstellung.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

const ruhig = (page) => page.waitForTimeout(350);
const shot = (name) => join(process.env.UI_SHOTS || "screenshots", `umstellung-b-${name}.png`);
const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const dlg = (page) => page.locator('.dialog[data-dialog="umstellung"]');
const pb = (page) => dlg(page).locator('[data-um="phase-b"]');
const probeKnopf = (page) => page.locator('[data-aktion="umstellung-b-probelauf"]');
const aufraeumKnopf = (page) => page.locator('[data-aktion="umstellung-aufraeumen"]');
// Anfragen an phase-b: Tor (nur lesend, ohne bestaetigt) · Probelauf · Aufräumen am Original
const torPosts = (z) => z.posts["phase-b"].filter((b) => b.bestaetigt !== true);
const probePosts = (z) => z.posts["phase-b"].filter((b) => b.probelauf === true);
const aufPosts = (z) => z.posts["phase-b"].filter((b) => b.bestaetigt === true && b.probelauf !== true);
const echteRueckweg = (z) => z.posts.rueckweg.filter((b) => b.bestaetigt);
const probeGruenB = (_b, _n, z) => { z.stand.phaseB.probelauf = { vorhanden: true, ergebnis: "gruen", gueltig: true, zeit: "2026-10-30T10:00:00.000Z" }; return probeAntwort(); };
const aufgeraeumt = (status = "fertig") => (z) => { Object.assign(z.stand, standAufgeraeumt(status)); };

// Schon umgestellt (Phase A fertig): der Dialog kommt über den Menübefehl der App
async function start(page, opt = {}, { breite = null } = {}) {
  await page.addInitScript(() => { window.__aktionen = []; window.webkit = { messageHandlers: { aktion: { postMessage: (m) => { window.__aktionen.push(m); } } } }; });
  if (breite) await page.setViewportSize({ width: breite, height: 900 });
  await mockeV2(page, vault);
  const z = await mockeUmstellung(page, { stand: standFertig(), ...opt });
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await page.evaluate(() => window.studio.befehl("umstellung"));
  await expect(dlg(page)).toBeVisible();
  await expect(pb(page).locator('[data-schritt="b-tor"], [data-schritt="b-fertig"]').first()).toBeVisible();
  return z;
}
// Tor ist gelesen, wenn die Bedingungen da sind und nicht mehr „aktualisiert“ wird
const torDa = async (page) => { await expect(pb(page).locator('[data-um="b-tor"]')).toBeVisible(); await expect(pb(page).locator('[data-um="b-tor"]')).not.toHaveAttribute("aria-busy", "true"); };
const bed = (page, id) => pb(page).locator(`[data-bedingung="${id}"]`);

test("Tor rot: neun Bedingungen als Ampel mit ihrem Satz, offene mit Grund; Probelauf und Aufräumen gesperrt, am Original wird nichts geschrieben", async ({ page }) => {
  const z = await start(page, { torOffen: ["wartezeit", "prozesse"] });
  const d = dlg(page);
  await torDa(page);
  await expect(pb(page).locator("h3").first()).toHaveText("Abschluss: alten Werkzeug-Ordner aufräumen");
  await expect(pb(page).locator("[data-bedingung]")).toHaveCount(9);
  expect(await pb(page).locator("[data-bedingung]").evaluateAll((l) => l.map((e) => e.dataset.bedingung))).toEqual(["phase-a", "release", "wartezeit", "macs", "bestaetigung", "prozesse", "restverweise", "befund", "probelauf"]);
  await expect(bed(page, "phase-a")).toHaveAttribute("data-status", "gruen");
  await expect(bed(page, "wartezeit")).toHaveAttribute("data-status", "rot");
  await expect(bed(page, "wartezeit")).toContainText("Kortex wartet 7 Tage nach der Umstellung, damit sich Probleme zeigen können (noch 3 Tage).");
  await expect(bed(page, "wartezeit")).toContainText("Noch offen");
  await expect(bed(page, "prozesse")).toContainText("Es läuft noch ein Programm aus dem alten Werkzeug-Ordner");
  await expect(bed(page, "phase-a")).toContainText("In Ordnung");
  await expect(bed(page, "bestaetigung")).toHaveAttribute("data-status", "rot");
  await expect(bed(page, "restverweise")).toHaveAttribute("data-status", "rot");
  await expect(bed(page, "probelauf")).toHaveAttribute("data-status", "rot");
  await expect(pb(page).locator('[data-um="b-tor-status"]')).toContainText("Noch nicht alles ist bereit");
  // Probelauf und Aufräumen gesperrt, mit Grund
  await expect(probeKnopf(page)).toBeDisabled();
  await expect(pb(page).locator('[data-um="b-probe-gesperrt"]')).toContainText("Der Probelauf ist erst möglich");
  await expect(aufraeumKnopf(page)).toBeDisabled();
  await expect(pb(page).locator('[data-um="b-aufraeumen-gesperrt"]')).toContainText("Aufräumen geht erst, wenn jeder Punkt oben in Ordnung ist");
  // Kennungen nur unter „Technische Details“
  await expect(bed(page, "wartezeit").locator("pre")).toBeHidden();
  expect(await pb(page).evaluate((e) => e.innerText)).not.toContain("wartezeit");
  // nur lesende Abfragen: das Tor mit den Entscheidungen, nie bestaetigt
  expect(torPosts(z).length).toBeGreaterThan(0);
  expect(torPosts(z)[0]).toEqual({ entscheidungen: { keineAltenMacs: false, bewusst: [], nachbarkopie: false } });
  expect(probePosts(z)).toHaveLength(0);
  expect(aufPosts(z)).toHaveLength(0);
  await expect(d.locator('[data-um="angebote"]')).toBeHidden();                       // ohne Angebote kein Bereich
  await pb(page).scrollIntoViewIfNeeded();
  await ruhig(page); await page.screenshot({ path: shot("tor-rot-hell") });
});

test("Erst nach Phase A: ohne abgeschlossene Umstellung gibt es den Bereich nicht und keine Abfrage des Tors", async ({ page }) => {
  await page.addInitScript(() => { window.__aktionen = []; window.webkit = { messageHandlers: { aktion: { postMessage: (m) => { window.__aktionen.push(m); } } } }; });
  await mockeV2(page, vault);
  const z = await mockeUmstellung(page, { befund: befundAntwort() });
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  await page.click('[data-aktion="umstellung-banner-oeffnen"]');
  await expect(dlg(page).locator('[data-umstellung="gruppe-auto"]')).toBeVisible();
  await expect(pb(page)).toBeHidden();
  await expect(dlg(page).locator('[data-um="angebote"]')).toBeHidden();
  await page.waitForTimeout(300);
  expect(z.posts["phase-b"]).toHaveLength(0);
});

test("Kästchen schalten Bedingungen grün: „Kein anderer Mac“ und „Ist mir bewusst“ je Restverweis; das Tor wird bei jeder Änderung neu gefragt", async ({ page }) => {
  const z = await start(page);
  const d = dlg(page);
  await torDa(page);
  const n0 = torPosts(z).length;
  await expect(d.locator('[data-pb-ent="keineAltenMacs"]')).not.toBeChecked();
  await expect(bed(page, "bestaetigung")).toContainText("Auf keinem anderen Mac läuft dieser Vault noch mit den alten Werkzeugen.");
  await expect(bed(page, "restverweise")).toContainText("Ein eigenes Skript von dir ruft noch ein Programm aus dem alten Werkzeug-Ordner auf (2 Stellen).");
  await expect(d.locator('[data-restverweis="E24"] [data-bewusst="E24"]')).not.toBeChecked();
  await expect(d.locator('[data-restverweis="E24"]')).toContainText("Ist mir bewusst");
  // 1) Bestätigung
  await d.locator('[data-pb-ent="keineAltenMacs"]').check();
  await expect(bed(page, "bestaetigung")).toHaveAttribute("data-status", "gruen");
  await expect(bed(page, "bestaetigung")).toContainText("Du hast bestätigt");
  await expect(d.locator('[data-pb-ent="keineAltenMacs"]')).toBeFocused();            // Fokus bleibt beim Neuzeichnen
  expect(torPosts(z).length).toBeGreaterThan(n0);
  expect(torPosts(z).at(-1)).toEqual({ entscheidungen: { keineAltenMacs: true, bewusst: [], nachbarkopie: false } });
  await expect(bed(page, "restverweise")).toHaveAttribute("data-status", "rot");
  // 2) Restverweis
  await d.locator('[data-bewusst="E24"]').check();
  await expect(bed(page, "restverweise")).toHaveAttribute("data-status", "gruen");
  await expect(d.locator('[data-bewusst="E24"]')).toBeChecked();
  expect(torPosts(z).at(-1)).toEqual({ entscheidungen: { keineAltenMacs: true, bewusst: ["E24"], nachbarkopie: false } });
  // zurück: wieder rot
  await d.locator('[data-bewusst="E24"]').uncheck();
  await expect(bed(page, "restverweise")).toHaveAttribute("data-status", "rot");
  expect(torPosts(z).at(-1).entscheidungen.bewusst).toEqual([]);
  // nur Tor-Abfragen, nichts geschrieben; ohne Probelauf bleibt der Aufräumen-Knopf zu
  expect(z.posts["phase-b"].every((b) => b.bestaetigt !== true)).toBe(true);
  await expect(aufraeumKnopf(page)).toBeDisabled();
  // alle automatischen Bedingungen erfüllt → Probelauf möglich
  await expect(probeKnopf(page)).toBeEnabled();
  await expect(pb(page).locator('[data-um="b-probe-gesperrt"]')).toHaveCount(0);
});

test("Probelauf rot: Ampel je Kriterium, „Am Original wurde nichts geändert“, Aufräumen bleibt gesperrt; die Entscheidungen gehen mit", async ({ page }) => {
  const z = await start(page, { phaseBProbe: probeAntwort({ rot: ["suche", "original"], kopieBehalten: true }) });
  const d = dlg(page);
  await torDa(page);
  await d.locator('[data-pb-ent="keineAltenMacs"]').check();
  await expect(probeKnopf(page)).toBeEnabled();
  await probeKnopf(page).click();
  const erg = pb(page).locator('[data-um="b-probe-ergebnis"]');
  await expect(erg).toHaveAttribute("data-ampel", "rot");
  await expect(erg).toContainText("Hier hat etwas nicht geklappt. Am Original wurde nichts geändert.");
  await expect(pb(page).locator("[data-kriterium]")).toHaveCount(9);
  await expect(pb(page).locator('[data-kriterium="suche"]')).toContainText("Nicht in Ordnung");
  await expect(pb(page).locator('[data-kriterium="kern-status"]')).toContainText("In Ordnung");
  await expect(pb(page).locator('[data-kriterium="original"] [data-um="rot-hilfe"]')).toContainText("Am Original hat sich während des Probelaufs etwas verändert");
  await expect(pb(page)).toContainText("Was du jetzt tun kannst");
  await expect(aufraeumKnopf(page)).toBeDisabled();
  await expect(probeKnopf(page)).toHaveText("Probelauf wiederholen");
  expect(probePosts(z)).toEqual([{ probelauf: true, bestaetigt: true, entscheidungen: { keineAltenMacs: true, bewusst: [], nachbarkopie: false } }]);
  expect(aufPosts(z)).toHaveLength(0);
  await erg.scrollIntoViewIfNeeded();
  await ruhig(page); await page.screenshot({ path: shot("probe-rot-hell") });
});

test("Probelauf braucht Platz: Fehler wird verständlich, die Kopie neben dem Vault ist wählbar und geht als nachbarkopie mit", async ({ page }) => {
  const z = await start(page, { phaseBProbe: { status: 409, json: { fehler: "x", art: "vorbedingung", code: "zu-wenig-platz" } } });
  const d = dlg(page);
  await torDa(page);
  await probeKnopf(page).click();
  await expect(pb(page).locator('[data-um="b-probe-fehler"]')).toContainText("Für die Kopie ist nicht genug freier Platz da. Am Original wurde nichts geändert.");
  await d.locator('[data-pb-ent="nachbarkopie"]').check();
  await expect.poll(() => torPosts(z).at(-1)?.entscheidungen.nachbarkopie).toBe(true);
  await probeKnopf(page).click();
  await expect.poll(() => probePosts(z).length).toBe(2);
  expect(probePosts(z)[1].entscheidungen.nachbarkopie).toBe(true);
});

test("Probelauf grün macht das Tor frei; Aufräumen erst nach eigener Bestätigung (Abbrechen schreibt nichts), Fortschritt B0–B4, Ergebnis mit Archiv und Rückweg", async ({ page }) => {
  let los; const halte = new Promise((r) => { los = r; });
  const z = await start(page, { phaseBProbe: probeGruenB, halte: { phaseB: halte }, phaseB: (_b, _n, zz) => { aufgeraeumt("fertig")(zz); return phaseBAntwort(); } });
  const d = dlg(page);
  await torDa(page);
  await d.locator('[data-pb-ent="keineAltenMacs"]').check();
  await d.locator('[data-bewusst="E24"]').check();
  await expect(aufraeumKnopf(page)).toBeDisabled();
  await probeKnopf(page).click();
  const erg = pb(page).locator('[data-um="b-probe-ergebnis"]');
  await expect(erg).toHaveAttribute("data-ampel", "gruen");
  await expect(erg).toContainText("Der Probelauf ist in Ordnung. Am Original wurde nichts geändert.");
  await expect(pb(page).locator("[data-kriterium][data-status='gruen']")).toHaveCount(9);
  // das Tor wurde nach dem Probelauf neu gelesen: Probelauf-Bedingung grün, alles frei
  await expect(bed(page, "probelauf")).toHaveAttribute("data-status", "gruen");
  await expect(pb(page).locator('[data-um="b-tor-status"]')).toContainText("Alles ist bereit");
  await expect(pb(page).locator('[data-um="b-tor"]')).toHaveAttribute("data-frei", "true");
  await expect(aufraeumKnopf(page)).toBeEnabled();
  await expect(pb(page).locator('[data-um="b-aufraeumen-gesperrt"]')).toHaveCount(0);
  expect(aufPosts(z)).toHaveLength(0);                                           // bis hierher nichts am Original
  await ruhig(page); await page.screenshot({ path: shot("tor-frei-hell") });
  // eigene Bestätigung: Text, Abbrechen tut nichts
  await aufraeumKnopf(page).click();
  const frage = pb(page).locator('[data-um="b-bestaetigung"]');
  await expect(frage).toBeVisible();
  await expect(frage).toContainText("Jetzt wirklich aufräumen?");
  await expect(frage).toContainText("Der alte Werkzeug-Ordner liegt danach 30 Tage im Archiv und kann zurückgeholt werden.");
  await expect(d.locator('[data-aktion="umstellung-b-abbrechen"]')).toBeFocused();
  expect(aufPosts(z)).toHaveLength(0);
  await ruhig(page); await page.screenshot({ path: shot("bestaetigung-hell") });
  await d.locator('[data-aktion="umstellung-b-abbrechen"]').click();
  await expect(frage).toHaveCount(0);
  expect(aufPosts(z)).toHaveLength(0);
  await aufraeumKnopf(page).click();
  expect(aufPosts(z)).toHaveLength(0);                                           // schon das Öffnen der Frage schreibt nichts
  await d.locator('[data-aktion="umstellung-b-bestaetigen"]').click();
  // Fortschritt B0–B4 mit Namen in Alltagssprache (Poll des Stands)
  await expect(pb(page).locator('[data-um="b-aufraeumen-laeuft"]')).toContainText("Kortex räumt auf …");
  z.stand.phaseB.schritte = { B0: { status: "ok" }, B1: { status: "laeuft" } };
  await expect(pb(page).locator('[data-schritt="B0"][data-status="ok"]')).toContainText("Sicherung angelegt");
  await expect(pb(page).locator('[data-schritt="B1"][data-status="laeuft"]')).toContainText("Alter Werkzeug-Ordner im Archiv");
  await expect(pb(page).locator('[data-schritt="B1"]')).toContainText("Läuft …");
  await expect(pb(page).locator('[data-schritt="B2"]')).toContainText("Einstellungen bereinigt");
  await expect(pb(page).locator('[data-schritt="B2"]')).toContainText("Wartet");
  await expect(pb(page).locator('[data-schritt="B3"]')).toContainText("Änderung im Versionsverlauf gespeichert");
  await expect(pb(page).locator('[data-schritt="B4"]')).toContainText("Prüfung am Ende");
  await expect(aufraeumKnopf(page)).toHaveCount(0);                              // während des Laufs kein zweiter Start
  await ruhig(page); await page.screenshot({ path: shot("laeuft-hell") });
  los();
  const fertig = pb(page).locator('[data-um="b-fertig"]');
  await expect(fertig).toContainText("Der alte Werkzeug-Ordner liegt jetzt im Archiv und ist aus deinem Vault verschwunden. Er bleibt 30 Tage dort, danach bietet Kortex an, ihn in den Papierkorb zu legen. Sichere deinen Vault jetzt einmal.");
  await expect(pb(page).locator('[data-um="b-archiv"]')).toContainText("kit-2026-10-30");
  await expect(pb(page).locator('[data-um="b-tor"]')).toHaveCount(0);            // Stand statt Tor
  await expect(pb(page).locator('[data-schritt="B4"][data-status="ok"]')).toContainText("Prüfung am Ende");
  await expect(pb(page).locator('[data-schritt="b-rueckweg"]')).toBeVisible();   // Rückweg jetzt sichtbar
  // genau ein Aufräumen am Original, mit denselben Entscheidungen wie Tor und Probelauf
  expect(aufPosts(z)).toHaveLength(1);
  expect(aufPosts(z)[0]).toEqual({ bestaetigt: true, entscheidungen: { keineAltenMacs: true, bewusst: ["E24"], nachbarkopie: false } });
  expect(probePosts(z)[0].entscheidungen).toEqual(aufPosts(z)[0].entscheidungen);
  expect(await page.evaluate(() => window.__aktionen.filter((a) => a.aktion === "vertrauen-geaendert"))).not.toHaveLength(0);
  await ruhig(page); await page.screenshot({ path: shot("fertig-hell") });
});

test("Aufräumen nur bei offenem Tor: sagt die Werkstatt „Tor zu“ (409), erscheint der Satz, nichts ist passiert und das Tor wird neu gelesen", async ({ page }) => {
  // Das Tor sagt zuerst „frei“, die Werkstatt lehnt trotzdem ab (zwischendurch hat sich etwas geändert)
  let torNr = 0;
  const z = await start(page, {
    tor: (b, _n, zz) => { torNr++; const t = torAntwort(b, zz); if (torNr === 1) { t.tor.frei = true; t.tor.offen = []; t.tor.bedingungen.forEach((c) => { c.erfuellt = true; }); } return t; },
    phaseB: phaseBTorZu,
  });
  const d = dlg(page);
  await expect(aufraeumKnopf(page)).toBeEnabled();
  await aufraeumKnopf(page).click();
  await d.locator('[data-aktion="umstellung-b-bestaetigen"]').click();
  await expect(pb(page).locator('[data-um="b-aufraeumen-fehler"]')).toContainText("Das Aufräumen ist noch nicht freigegeben. Es wurde nichts verändert.");
  expect(aufPosts(z)).toHaveLength(1);
  await expect(aufraeumKnopf(page)).toBeDisabled();                               // das neu gelesene Tor ist zu
  await expect(pb(page).locator('[data-um="b-tor-status"]')).toContainText("Noch nicht alles ist bereit");
});

test("Ergebnis „mit Warnungen“: Prüfung am Ende zeigt, was offen ist, mit Archiv und Rückweg-Knopf; bei Fehler in B1 steht der Schritt, was zurückgenommen wurde und wie es weitergeht", async ({ page }) => {
  // erster Versuch mit Warnungen
  const z = await start(page, { phaseBProbe: probeGruenB, phaseB: (_b, _n, zz) => { aufgeraeumt("mitWarnungen")(zz); return phaseBAntwort({ warnungen: true }); } });
  const d = dlg(page);
  await torDa(page);
  await d.locator('[data-pb-ent="keineAltenMacs"]').check();
  await d.locator('[data-bewusst="E24"]').check();
  await probeKnopf(page).click();
  await expect(aufraeumKnopf(page)).toBeEnabled();
  await aufraeumKnopf(page).click();
  await d.locator('[data-aktion="umstellung-b-bestaetigen"]').click();
  const w = pb(page).locator('[data-um="b-fertig"]');
  await expect(w).toHaveAttribute("data-ampel", "warn");
  await expect(w).toContainText("Aufgeräumt, aber mit Warnungen.");
  await expect(w).toContainText("Die Prüfung am Ende hat etwas gefunden");
  await expect(w.locator('[data-kriterium="hooks"]')).toContainText("Nicht in Ordnung");
  await expect(pb(page).locator('[data-um="b-archiv"]')).toContainText("kit-2026-10-30");
  await expect(pb(page).locator('[data-schritt="B4"]')).toContainText("Warnung");
  await expect(pb(page).locator('[data-aktion="umstellung-b-rueckweg"]')).toBeVisible();
  await expect(pb(page).locator('[data-um="b-tor"]')).toHaveCount(0);
  await ruhig(page); await page.screenshot({ path: shot("warnungen-hell") });
  expect(aufPosts(z)).toHaveLength(1);
});

test("Fehler in einem Schritt: verständlich, mit „Aufräumen fortsetzen“ und Rückweg, wenn nicht alles zurückgenommen werden konnte", async ({ page }) => {
  let nr = 0;
  const z = await start(page, {
    phaseBProbe: probeGruenB,
    phaseB: (_b, _n, zz) => { nr++; zz.stand.phaseB = { ...phaseBLeer(), status: "unterbrochen", zeit: "2026-10-30T10:00:00.000Z", probelauf: zz.stand.phaseB.probelauf }; return nr === 1 ? phaseBFehler : { ...phaseBFehler, zurueckgenommen: false }; },
  });
  const d = dlg(page);
  await torDa(page);
  await d.locator('[data-pb-ent="keineAltenMacs"]').check();
  await d.locator('[data-bewusst="E24"]').check();
  await probeKnopf(page).click();
  await expect(aufraeumKnopf(page)).toBeEnabled();
  await aufraeumKnopf(page).click();
  await d.locator('[data-aktion="umstellung-b-bestaetigen"]').click();
  const f = pb(page).locator('[data-um="b-fehler"]');
  await expect(f).toContainText("Schritt B1 (Alter Werkzeug-Ordner im Archiv) hat nicht geklappt.");
  await expect(f).toContainText("Kortex hat die Schritte davor zurückgenommen.");
  await expect(pb(page).locator('[data-schritt="B1"][data-status="rot"]')).toContainText("Warnung");
  await expect(pb(page).locator('[data-um="b-unterbrochen"]')).toContainText("Das Aufräumen wurde nicht zu Ende geführt");
  await expect(aufraeumKnopf(page)).toHaveText("Aufräumen fortsetzen …");
  await expect(pb(page).locator('[data-aktion="umstellung-b-rueckweg"]')).toBeVisible();
  await ruhig(page); await page.screenshot({ path: shot("fehler-hell") });
  // zweiter Versuch: ließ sich nicht ganz zurücknehmen
  await aufraeumKnopf(page).click();
  await d.locator('[data-aktion="umstellung-b-bestaetigen"]').click();
  await expect(pb(page).locator('[data-um="b-fehler"]')).toContainText("Die Schritte davor ließen sich nicht ganz zurücknehmen.");
  expect(aufPosts(z)).toHaveLength(2);
});

test("Tor nicht lesbar: freundlicher Satz mit „Nochmal prüfen“", async ({ page }) => {
  let nr = 0;
  const z = await start(page, { tor: (b, _n, zz) => (++nr === 1 ? { status: 502, json: { fehler: "Die Prüfung hat nicht geklappt. Es wurde nichts verändert." } } : torAntwort(b, zz)) });
  await expect(pb(page).locator('[data-um="b-tor-fehler"]')).toContainText("Die Prüfung hat nicht geklappt. Es wurde nichts verändert.");
  await expect(aufraeumKnopf(page)).toBeDisabled();
  await pb(page).locator('[data-aktion="umstellung-b-tor-nochmal"]').click();
  await expect(pb(page).locator('[data-um="b-tor"]')).toBeVisible();
  await expect(pb(page).locator('[data-um="b-tor-fehler"]')).toHaveCount(0);
  expect(torPosts(z)).toHaveLength(2);
});

test("Fertig aus dem Stand: oben der Stand (Archiv-Name, Datum) statt des Tors; Rückweg „Aufräumen rückgängig machen“ erst nach eigener Frage, mit B3, B2, B1", async ({ page }) => {
  const z = await start(page, {
    stand: standAufgeraeumt("fertig"),
    rueckweg: (b, _n, zz) => { zz.stand.phaseB = phaseBLeer(); return { ok: true, alles: false, schritte: b.schritte.map((id) => ({ id, titel: id, status: "zurueck", hinweise: [] })), hinweise: [] }; },
  });
  const d = dlg(page);
  await expect(pb(page).locator('[data-schritt="b-fertig"]')).toContainText("Aufgeräumt");
  await expect(pb(page).locator('[data-um="b-archiv"]')).toHaveText("Archiv: kit-2026-10-30, seit 30.10.2026");
  await expect(pb(page).locator('[data-um="b-fertig"]')).toContainText("Sichere deinen Vault jetzt einmal.");
  await expect(pb(page).locator('[data-um="b-tor"]')).toHaveCount(0);
  await expect(pb(page).locator('[data-aktion="umstellung-probelauf"], [data-aktion="umstellung-b-probelauf"]')).toHaveCount(0);
  expect(z.posts["phase-b"]).toHaveLength(0);                                    // fertig: das Tor wird nicht mehr gefragt
  await expect(pb(page).locator('[data-schritt="b-rueckweg"] h3')).toHaveText("Aufräumen rückgängig machen");
  await pb(page).locator('[data-schritt="b-rueckweg"]').scrollIntoViewIfNeeded();
  await ruhig(page); await page.screenshot({ path: shot("stand-fertig-hell") });
  // erst fragen, Abbrechen tut nichts
  await d.locator('[data-aktion="umstellung-b-rueckweg"]').click();
  const frage = pb(page).locator('[data-um="b-rueckweg-bestaetigung"]');
  await expect(frage).toContainText("Aufräumen wirklich rückgängig machen?");
  await expect(frage).toContainText("Kortex holt den alten Werkzeug-Ordner aus dem Archiv zurück");
  await expect(d.locator('[data-aktion="umstellung-b-rueckweg-nein"]')).toBeFocused();
  await d.locator('[data-aktion="umstellung-b-rueckweg-nein"]').click();
  await expect(frage).toHaveCount(0);
  expect(echteRueckweg(z)).toHaveLength(0);
  await d.locator('[data-aktion="umstellung-b-rueckweg"]').click();
  await d.locator('[data-aktion="umstellung-b-rueckweg-ja"]').click();
  await expect(pb(page).locator('[data-um="b-rueckweg-ergebnis"]')).toContainText("Fertig. Der alte Werkzeug-Ordner ist wieder da, der Vault ist wie vor dem Aufräumen.");
  expect(echteRueckweg(z)).toEqual([{ bestaetigt: true, schritte: ["B3", "B2", "B1"] }]);
  // danach ist das Tor wieder da (Stand ohne Aufräumen)
  await expect(pb(page).locator('[data-um="b-tor"]')).toBeVisible();
  await expect(pb(page).locator('[data-um="b-fertig"]')).toHaveCount(0);
  expect(torPosts(z).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__aktionen.filter((a) => a.aktion === "vertrauen-geaendert"))).not.toHaveLength(0);
});

test("Rückweg-Fehler: Satz in Alltagssprache, Hinweise zu Dingen, die Kortex nicht überschrieben hat", async ({ page }) => {
  await start(page, {
    stand: standAufgeraeumt("fertig"),
    rueckweg: { ok: true, alles: false, schritte: [{ id: "B3", status: "zurueck", hinweise: [] }, { id: "B2", status: "zurueck", hinweise: ["config-geaendert"] }, { id: "B1", status: "fehler", hinweise: [] }], hinweise: ["B2:config-geaendert"] },
  });
  const d = dlg(page);
  await d.locator('[data-aktion="umstellung-b-rueckweg"]').click();
  await d.locator('[data-aktion="umstellung-b-rueckweg-ja"]').click();
  const e = pb(page).locator('[data-um="b-rueckweg-ergebnis"]');
  await expect(e).toContainText("Das Rückgängigmachen hat nicht ganz geklappt.");
  await expect(e).toContainText("Die Einstellungsdatei des Vaults wurde inzwischen geändert und bleibt, wie sie ist.");
});

test("Angebote: fällige mit „In den Papierkorb legen“ und eigener Bestätigung (Text des Angebots), nicht fällige nur als Hinweis „noch N Tage“; gesendet wird {was, name, bestaetigt}", async ({ page }) => {
  const liste = [angebot("archiv"), angebot("sicherungen"), angebot("bundles")];
  const z = await start(page, {
    stand: standAufgeraeumt("fertig"), angebote: liste,
    aufraeumen: (b, _n, zz) => { zz.angebote = zz.angebote.filter((a) => a.id !== b.was); return { ok: true, was: b.was, anzahl: 1 }; },
  });
  const d = dlg(page);
  const sek = d.locator('[data-um="angebote"]');
  await expect(sek.locator("h3")).toHaveText("Aufräumen nach der Umstellung");
  await expect(sek.locator("[data-angebot]")).toHaveCount(3);
  await expect(sek.locator('[data-angebot="archiv"]')).toContainText("Archiv des alten Werkzeug-Ordners");
  await expect(sek.locator('[data-angebot="archiv"] [data-um="angebot-umfang"]')).toContainText("kit-2026-10-30");
  await expect(sek.locator('[data-angebot="archiv"] [data-um="angebot-umfang"]')).toContainText("52 MB");
  await expect(sek.locator('[data-angebot="archiv"] [data-faellig], [data-angebot="archiv"]').first()).toHaveAttribute("data-faellig", "true");
  await expect(sek.locator('[data-angebot="archiv"] [data-aktion="umstellung-angebot"]')).toHaveText("In den Papierkorb legen");
  // nicht fällig: nur der Hinweis, kein Knopf
  const spaeter = sek.locator('[data-angebot="bundles"]');
  await expect(spaeter).toHaveAttribute("data-faellig", "false");
  await expect(spaeter.locator('[data-um="angebot-spaeter"]')).toHaveText("Kortex bietet das nach 30 Tagen an (noch 20 Tage).");
  await expect(spaeter.locator("button")).toHaveCount(0);
  await sek.scrollIntoViewIfNeeded();
  await ruhig(page); await page.screenshot({ path: shot("angebote-hell") });
  // Bestätigung mit dem Text des Angebots; Abbrechen schreibt nichts
  await sek.locator('[data-angebot="archiv"] [data-aktion="umstellung-angebot"]').click();
  const frage = sek.locator('[data-um="angebot-bestaetigung"]');
  await expect(frage).toContainText("Wirklich in den Papierkorb legen?");
  await expect(frage).toContainText("Der alte Werkzeug-Ordner liegt seit 31 Tagen im Archiv.");
  await expect(d.locator('[data-aktion="umstellung-angebot-nein"]')).toBeFocused();
  expect(z.posts.aufraeumen).toHaveLength(0);
  await d.locator('[data-aktion="umstellung-angebot-nein"]').click();
  await expect(frage).toHaveCount(0);
  expect(z.posts.aufraeumen).toHaveLength(0);
  await sek.locator('[data-angebot="archiv"] [data-aktion="umstellung-angebot"]').click();
  await ruhig(page); await page.screenshot({ path: shot("angebot-frage-hell") });
  await d.locator('[data-aktion="umstellung-angebot-ja"]').click();
  await expect(sek.locator('[data-um="angebot-ergebnis"]')).toContainText("Der Archiv-Ordner liegt jetzt im Papierkorb.");
  expect(z.posts.aufraeumen).toEqual([{ was: "archiv", name: "kit-2026-10-30", bestaetigt: true }]);
  await expect(sek.locator('[data-angebot="archiv"]')).toHaveCount(0);            // Liste neu gelesen
  // Sicherungskopien: der Satz „nicht mehr zurücknehmen“ steht in der Frage
  await sek.locator('[data-angebot="sicherungen"] [data-aktion="umstellung-angebot"]').click();
  await expect(sek.locator('[data-um="angebot-bestaetigung"]')).toContainText("Danach lässt sich die Umstellung nicht mehr zurücknehmen.");
  await d.locator('[data-aktion="umstellung-angebot-ja"]').click();
  await expect.poll(() => z.posts.aufraeumen.length).toBe(2);
  expect(z.posts.aufraeumen[1]).toEqual({ was: "sicherungen", bestaetigt: true });
});

test("Verwaiste Einträge: Aufräumen mit Frage, danach „Zurücknehmen“ (Rückweg V1); der Befund-Fund E29 verlinkt auf das Angebot", async ({ page }) => {
  const e29 = { id: "E29", kategorie: "include-verwaist", schwere: "frage", ort: "Versionsverlauf", anzahl: 2, aktion: "info", phase: "B", text: "In deinen persönlichen Einstellungen stehen Einträge für Vaults, die es nicht mehr gibt." };
  const z = await start(page, {
    stand: standAufgeraeumt("fertig"), angebote: [angebot("verwaist")], befund: befundAntwort({ funde: [FUNDE.anweisung, e29] }),
    aufraeumen: (_b, _n, zz) => { zz.angebote = []; return { ok: true, was: "verwaist", anzahl: 2 }; },
    rueckweg: (b, _n, zz) => { zz.angebote = [angebot("verwaist")]; return { ok: true, alles: false, schritte: b.schritte.map((id) => ({ id, status: "zurueck", hinweise: [] })), hinweise: [] }; },
  });
  const d = dlg(page);
  const sek = d.locator('[data-um="angebote"]');
  await expect(sek.locator('[data-um="angebot-befund"]')).toContainText("In deinen persönlichen Einstellungen stehen Einträge für Vaults, die es nicht mehr gibt.");
  await expect(sek.locator('[data-angebot="verwaist"] [data-aktion="umstellung-angebot"]')).toHaveText("Aufräumen");
  await sek.locator('[data-aktion="umstellung-zum-angebot"]').click();
  await sek.locator('[data-angebot="verwaist"] [data-aktion="umstellung-angebot"]').click();
  await expect(sek.locator('[data-um="angebot-bestaetigung"]')).toContainText("Wirklich aufräumen?");
  await d.locator('[data-aktion="umstellung-angebot-ja"]').click();
  await expect(sek.locator('[data-um="angebot-ergebnis"]')).toContainText("Die Einträge sind aufgeräumt.");
  expect(z.posts.aufraeumen).toEqual([{ was: "verwaist", bestaetigt: true }]);
  await sek.locator('[data-aktion="umstellung-angebot-zurueck"]').click();
  await expect(sek.locator('[data-um="angebot-ergebnis"]')).toContainText("Die Einträge sind wieder da.");
  expect(echteRueckweg(z)).toEqual([{ bestaetigt: true, schritte: ["V1"] }]);
  await expect(sek.locator('[data-angebot="verwaist"]')).toBeVisible();
});

test("Angebot nicht lesbar oder abgelehnt: Satz statt Absturz, nichts verändert", async ({ page }) => {
  const z = await start(page, {
    stand: standAufgeraeumt("fertig"), angebote: [angebot("archiv")],
    aufraeumen: { status: 409, json: { fehler: "Dieses Angebot gibt es nicht mehr. Es wurde nichts verändert.", art: "vorbedingung" } },
  });
  const d = dlg(page);
  await d.locator('[data-angebot="archiv"] [data-aktion="umstellung-angebot"]').click();
  await d.locator('[data-aktion="umstellung-angebot-ja"]').click();
  await expect(d.locator('[data-um="angebot-fehler"]')).toContainText("Dieses Angebot gibt es nicht mehr. Es wurde nichts verändert.");
  expect(z.posts.aufraeumen).toHaveLength(1);
});

test("Sichtbare Sprache im Abschluss und bei den Angeboten: Kortex und Vault, keine Fachwörter", async ({ page }) => {
  await start(page, { torOffen: ["wartezeit"], angebote: [angebot("verwaist"), angebot("archiv"), angebot("bundles")] });
  const d = dlg(page);
  await torDa(page);
  await expect(d.locator(".um-titel")).toHaveText("Vault umstellen");
  await expect(d.locator('[data-um="intro"]')).toContainText("Kortex");
  await expect(d.locator('[data-um="intro"]')).toContainText("Vault");
  const text = await d.locator('[data-um="phase-b"], [data-um="angebote"]').evaluateAll((l) => l.map((e) => e.innerText).join("\n"));
  expect(text).toContain("Kortex");
  expect(text).toContain("Vault");
  expect(text).not.toMatch(/\b(git|brain|hooks?|pre-commit|mcp|bundles?|rename|plist|launchd|\.tools)\b/i);
  expect(text).not.toMatch(/Phase [AB]\b/);
  expect(text).not.toMatch(/\bE\d{1,2}\b/);                       // Kennungen stehen nur unter „Technische Details“
});

// Kein waagerechter Balken im Dialog: weder im Rumpf noch am Dialog, und der Dialog liegt ganz im Fenster (die Studio-Seite dahinter hat ihre eigene Mindestbreite)
const seitwaerts = (page) => page.evaluate(() => {
  const r = document.querySelector(".um-rumpf"), b = document.querySelector(".um-dialog");
  const box = b.getBoundingClientRect();
  return { rumpf: r.scrollWidth - r.clientWidth, dialog: b.scrollWidth - b.clientWidth, rechts: box.right - innerWidth, links: -box.left };
});
test("Schmal (400 px): kein waagerechter Balken im Tor, bei der Bestätigung, beim Stand und bei den Angeboten", async ({ page }) => {
  const z = await start(page, { torOffen: ["wartezeit", "prozesse"], angebote: [angebot("verwaist"), angebot("archiv"), angebot("sicherungen"), angebot("bundles")], phaseBProbe: probeAntwort({ rot: ["original"] }) }, { breite: 400 });
  const d = dlg(page);
  await torDa(page);
  const ok = async (name) => { const s = await seitwaerts(page); for (const [k, v] of Object.entries(s)) expect(v, `${name}: ${k}`).toBeLessThanOrEqual(1); };
  await ok("Tor");
  await d.locator('[data-pb-ent="keineAltenMacs"]').check();
  await d.locator('[data-bewusst="E24"]').check();
  await ok("Kästchen");
  await d.locator('[data-bedingung="wartezeit"] summary').click();
  await ok("Details");
  await d.locator('[data-um="angebote"]').scrollIntoViewIfNeeded();
  await d.locator('[data-angebot="archiv"] [data-aktion="umstellung-angebot"]').click();
  await ok("Angebot-Frage");
  await d.locator('[data-aktion="umstellung-angebot-nein"]').click();
  await ruhig(page); await page.screenshot({ path: shot("schmal-hell") });
  await ok("Angebote");
  // Stand „fertig“ mit Rückweg-Frage
  Object.assign(z.stand, standAufgeraeumt("mitWarnungen"));
  // erst den alten Dialog schließen, dann den neuen öffnen (der Befehl lädt das Modul asynchron: ein zweiter Befehl vor dem Esc ließ je nach Tempo zwei Dialoge stehen)
  await page.keyboard.press("Escape");
  await expect(dlg(page)).toHaveCount(0);
  await page.evaluate(() => window.studio.befehl("umstellung"));
  await expect(dlg(page)).toBeVisible();
  await expect(pb(page).locator('[data-um="b-fertig"]')).toBeVisible();
  await ok("Stand");
  await d.locator('[data-aktion="umstellung-b-rueckweg"]').click();
  await ok("Rückweg-Frage");
  await ruhig(page); await page.screenshot({ path: shot("schmal-stand-hell") });
});

test("Dunkel: Tor, Probelauf, Stand und Angebote lesbar (Bildschirmfotos)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const z = await start(page, { torOffen: ["wartezeit"], phaseBProbe: probeAntwort({ rot: ["suche"] }), angebote: [angebot("archiv"), angebot("bundles")] });
  const d = dlg(page);
  await torDa(page);
  await d.locator('[data-pb-ent="keineAltenMacs"]').check();
  await expect(bed(page, "bestaetigung")).toHaveAttribute("data-status", "gruen");
  await ruhig(page); await page.screenshot({ path: shot("tor-dunkel") });
  z.torOffen = [];
  await d.locator('[data-um="angebote"]').scrollIntoViewIfNeeded();
  await ruhig(page); await page.screenshot({ path: shot("angebote-dunkel") });
  await d.locator('[data-angebot="archiv"] [data-aktion="umstellung-angebot"]').click();
  await ruhig(page); await page.screenshot({ path: shot("angebot-frage-dunkel") });
  await d.locator('[data-aktion="umstellung-angebot-nein"]').click();
  // Stand fertig und mit Warnungen
  Object.assign(z.stand, standAufgeraeumt("mitWarnungen"));
  await page.keyboard.press("Escape");
  await expect(dlg(page)).toHaveCount(0);
  await page.evaluate(() => window.studio.befehl("umstellung"));
  await expect(pb(page).locator('[data-um="b-fertig"]')).toHaveAttribute("data-ampel", "warn");
  await ruhig(page); await page.screenshot({ path: shot("stand-warnungen-dunkel") });
});
