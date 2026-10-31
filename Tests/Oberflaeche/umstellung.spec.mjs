// „Vault umstellen“ in der Oberfläche (P7c): Befund in vier Gruppen, Entscheidungen, Probelauf (rot/grün), Umstellen nur nach grünem Probelauf, Rückweg, Protokoll, „Kopie jetzt löschen“,
// Hinweis-Banner und Einstellungen, nicht vertraut. Die Antworten der Umstellungs-Routen sind Attrappen (mocks-umstellung.mjs); der Rest läuft gegen die echte Werkstatt.
// UI_SHOTS=<Ordner>: legt die Bildschirmfotos dort ab (sonst screenshots/, ignoriert).
import { test, expect } from "./basis.mjs";
import { join } from "node:path";
import { baueVault } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { mockeV2, mockeVertrauen, vertrauenAntwort } from "./mocks.mjs";
import { mockeUmstellung, befundAntwort, probeAntwort, phaseAAntwort, phaseAFehler, standLeer, standFertig, FUNDE, PROFILE } from "./mocks-umstellung.mjs";

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

// Der Dialog blendet 180 ms ein: Bildschirmfotos erst danach (sonst halbdurchsichtig)
const ruhig = (page) => page.waitForTimeout(350);
const shot = (name) => join(process.env.UI_SHOTS || "screenshots", `umstellung-${name}.png`);
const NOTIZ = "10_notizen/Reise nach Lissabon.md";
const dlg = (page) => page.locator('.dialog[data-dialog="umstellung"]');
const aktionen = (page, name) => page.evaluate((n) => window.__aktionen.filter((a) => a.aktion === n), name);
const gruenerStand = (z) => { z.stand.probelauf = { zeit: "2026-10-30T08:55:00.000Z", ampel: "gruen", gueltig: true }; };
const probeGruen = (_b, _n, z) => { gruenerStand(z); return probeAntwort(); };
const fertigStellen = (z) => { Object.assign(z.stand, standFertig()); };

// opt = Optionen für mockeUmstellung; vertrauen = true: info.vertrauen aus mockeVertrauen (nicht vertraut)
async function start(page, opt = {}, { vertrauen = null, oeffnen = true } = {}) {
  await page.addInitScript(() => { window.__aktionen = []; window.webkit = { messageHandlers: { aktion: { postMessage: (m) => { window.__aktionen.push(m); } } } }; });
  await mockeV2(page, vault);
  const vstand = vertrauen ? await mockeVertrauen(page, { vertrauen }) : null;
  const z = await mockeUmstellung(page, opt);
  z.vertrauen = vstand;
  await page.goto(server.url + "?pfad=" + encodeURIComponent(NOTIZ));
  await page.waitForSelector(".cm-content .cm-line");
  if (vertrauen) { await page.click('.dialog [data-aktion="vertrauen-spaeter"]'); await expect(page.locator('.dialog[data-dialog="vertrauen"]')).toHaveCount(0); }
  if (oeffnen) {
    await page.click('[data-aktion="umstellung-banner-oeffnen"]');
    await expect(dlg(page)).toBeVisible();
    await expect(dlg(page).locator('[data-um="befund"] [data-umstellung^="gruppe-"], [data-um="umstellen"] [data-um="fertig"]').first()).toBeVisible();
  }
  return z;
}
const probeKnopf = (page) => page.locator('[data-aktion="umstellung-probelauf"]');
const umstellKnopf = (page) => page.locator('[data-aktion="umstellung-umstellen"]');

test("Befund in vier Gruppen: umstellen, entscheiden, nur Info, vorher lösen – mit Zahl, kurzen Sätzen und aufklappbaren Details", async ({ page }) => {
  await start(page);
  const d = dlg(page);
  await expect(d.locator(".um-titel")).toHaveText("Vault umstellen");
  await expect(d.locator('[data-um="intro"]')).toContainText("Dieser Vault stammt aus der Zeit vor Kortex");
  await expect(d.locator('[data-umstellung="gruppe-auto"] h3')).toHaveText("Stellt Kortex für dich um");
  await expect(d.locator('[data-umstellung="gruppe-frage"] h3')).toHaveText("Braucht deine Entscheidung");
  await expect(d.locator('[data-umstellung="gruppe-hinweis"] h3')).toHaveText("Nur zur Info");
  await expect(d.locator('[data-umstellung="gruppe-blocker"] h3')).toHaveText("Muss vorher gelöst werden");
  await expect(d.locator('[data-zahl="auto"]')).toHaveText("3");
  await expect(d.locator('[data-zahl="frage"]')).toHaveText("3");
  await expect(d.locator('[data-zahl="hinweis"]')).toHaveText("2");        // die Frage ohne Auswahl (kit-ungesichert) steht bei den Infos
  await expect(d.locator('[data-zahl="blocker"]')).toHaveText("0");
  await expect(d.locator('[data-umstellung="gruppe-blocker"]')).toContainText("Nichts steht im Weg.");
  await expect(d.locator('[data-fund="claude-hooks"]')).toContainText("Claude Code ruft Kortex noch über den alten Werkzeug-Ordner auf (8 Stellen).");
  await expect(d.locator('[data-fund="kit-ungesichert"]')).toContainText("Dafür gibt es hier keine Auswahl");
  // Entscheidungen: je Frage eine Auswahl, empfohlene Wahl vorbelegt, Satz zum Rückweg
  await expect(d.locator('[data-wahl="gitSchluessel"] input[value="ja"]')).toBeChecked();
  await expect(d.locator('[data-wahl="gitSchluessel"]')).toContainText("Rückweg: Kortex stellt sie wieder her.");
  await expect(d.locator('[data-wahl="remoteBestaetigen"] input[value="nein"]')).toBeChecked();
  await expect(d.locator('[data-wahl="weitereMacs"] input:checked')).toHaveCount(0);
  // Technische Details zugeklappt, nur dort stehen Kennungen
  await expect(d.locator('[data-fund="git-schluessel"] .um-details')).not.toHaveAttribute("open", "");
  await expect(d.locator('[data-fund="git-schluessel"] pre')).toBeHidden();
  await d.locator('[data-fund="git-schluessel"] summary').click();
  await expect(d.locator('[data-fund="git-schluessel"] pre')).toContainText("E10 · git-schluessel");
  await expect(d).not.toContainText("Brain");
  await expect(d).not.toContainText(".tools");
  await ruhig(page); await page.screenshot({ path: shot("befund-hell") });
  await d.locator(".um-rumpf").evaluate((e) => { e.scrollTop = e.scrollHeight; });
  await ruhig(page); await page.screenshot({ path: shot("schritte-hell") });
});

test("Blocker sperren den Weiter-Knopf: Gruppe zuerst, Probelauf und Umstellen gesperrt, Hinweis mit Anleitung; Blocker nur fürs spätere Aufräumen sperren nicht", async ({ page }) => {
  const z = await start(page, { befund: befundAntwort({ funde: [FUNDE.hooks, FUNDE.blocker, FUNDE.blockerSpaeter] }) });
  const d = dlg(page);
  await expect(d.locator(".um-gruppe").first()).toHaveAttribute("data-art", "blocker");     // das Wichtigste steht oben
  await expect(d.locator('[data-zahl="blocker"]')).toHaveText("1");
  await expect(d.locator('[data-fund="ordnername-ungueltig"]')).toContainText("Der Wiki-Ordner ist in den Einstellungen als Pfad angegeben");
  await expect(d.locator('[data-fund="kit-prozesse"]')).toContainText("Betrifft erst das spätere Aufräumen");
  await expect(d.locator('[data-umstellung="gruppe-hinweis"] [data-fund="kit-prozesse"]')).toBeVisible();
  await expect(probeKnopf(page)).toBeDisabled();
  await expect(d.locator('[data-um="sperre"]')).toContainText("Der Probelauf ist erst möglich");
  await expect(d.locator('[data-um="probe"]')).toContainText("Löse zuerst die Punkte unter „Muss vorher gelöst werden“");
  await expect(umstellKnopf(page)).toBeDisabled();
  expect(z.posts.probelauf).toHaveLength(0);
  await ruhig(page); await page.screenshot({ path: shot("blocker-hell") });
});

test("Ein Blocker, der nur das spätere Aufräumen betrifft, sperrt die Umstellung nicht", async ({ page }) => {
  await start(page, { befund: befundAntwort({ funde: [FUNDE.hooks, FUNDE.blockerSpaeter] }) });
  await expect(probeKnopf(page)).toBeEnabled();
  await expect(dlg(page).locator('[data-zahl="blocker"]')).toHaveText("0");
  await expect(dlg(page).locator('[data-um="sperre"]')).toHaveCount(0);
});

test("Probelauf rot: Ampel der 9 Kriterien, was zu tun ist, Original unberührt; Umstellen bleibt gesperrt; Kopie jetzt löschen", async ({ page }) => {
  const z = await start(page, {
    probe: (_b, _n, zz) => { zz.stand.kopien = 1; return probeAntwort({ rot: ["git-sicher", "original"], kopieBehalten: true }); },
    kopie: (_b, _n, zz) => { zz.stand.kopien = 0; return { ok: true, geloescht: 1, uebrig: 0 }; },
  });
  const d = dlg(page);
  await expect(d.locator('[data-um="probe"]')).toContainText("Original bleibt dabei unberührt");
  await expect(d.locator('[data-um="probe"]')).toContainText("braucht etwa so viel Platz");
  await probeKnopf(page).click();
  const erg = d.locator('[data-um="probe-ergebnis"]');
  await expect(erg).toHaveAttribute("data-ampel", "rot");
  await expect(erg).toContainText("Hier hat etwas nicht geklappt. Am Original wurde nichts geändert.");
  await expect(d.locator("[data-kriterium]")).toHaveCount(9);
  await expect(d.locator('[data-kriterium="git-sicher"]')).toContainText("Nicht in Ordnung");
  await expect(d.locator('[data-kriterium="git-sicher"] [data-um="rot-hilfe"]')).toContainText("Der Versionsverlauf ist für Kortex gesperrt");
  await expect(d.locator('[data-kriterium="original"] [data-um="rot-hilfe"]')).toContainText("Am Original hat sich während des Probelaufs etwas verändert");
  await expect(d.locator('[data-kriterium="suche"]')).toContainText("In Ordnung");
  await expect(d.locator('[data-um="probe"]')).toContainText("Was du jetzt tun kannst");
  await expect(umstellKnopf(page)).toBeDisabled();
  await expect(probeKnopf(page)).toHaveText("Probelauf wiederholen");
  expect(z.posts["phase-a"]).toHaveLength(0);
  // die Kopie des roten Probelaufs bleibt liegen: Hinweis und Knopf
  await expect(d.locator('[data-um="kopie-karte"]')).toContainText("Von einem Probelauf liegt noch eine Kopie bereit");
  await d.locator("[data-um='probe']").scrollIntoViewIfNeeded();
  await ruhig(page); await page.screenshot({ path: shot("probe-rot-hell") });
  await d.locator('[data-aktion="umstellung-kopie-loeschen"]').click();
  await expect(page.locator(".toast")).toContainText("Die Kopie ist gelöscht.");
  await expect(d.locator('[data-um="kopie-karte"]')).toHaveCount(0);
  expect(z.posts["kopie-loeschen"]).toEqual([{ bestaetigt: true }]);
});

test("Probelauf grün → Umstellen mit deutlicher Bestätigung (Abbrechen schreibt nichts), Fortschritt je Schritt, Ergebnis, Rückweg-Liste; dieselben Entscheidungen in beiden Aufrufen", async ({ page }) => {
  const z = await start(page, { probe: probeGruen, phaseA: (_b, _n, zz) => { fertigStellen(zz); return phaseAAntwort(); } });
  const d = dlg(page);
  await expect(umstellKnopf(page)).toBeDisabled();
  await expect(d.locator('[data-um="umstellen-gesperrt"]')).toContainText("Das geht erst nach einem grünen Probelauf mit denselben Entscheidungen.");
  await probeKnopf(page).click();
  await expect(d.locator('[data-um="probe-ergebnis"]')).toHaveAttribute("data-ampel", "gruen");
  await expect(d.locator('[data-um="probe-ergebnis"]')).toContainText("Der Probelauf ist in Ordnung. Am Original wurde nichts geändert.");
  await expect(d.locator("[data-kriterium][data-status='gruen']")).toHaveCount(9);
  await expect(umstellKnopf(page)).toBeEnabled();
  await ruhig(page); await page.screenshot({ path: shot("probe-gruen-hell") });
  // Bestätigung: erst fragen, „Abbrechen“ tut nichts
  await umstellKnopf(page).click();
  const frage = d.locator('[data-um="bestaetigung"]');
  await expect(frage).toBeVisible();
  await expect(frage).toContainText("Jetzt wirklich umstellen?");
  await expect(frage).toContainText("Deine Notizen bleiben unverändert");
  await expect(d.locator('[data-aktion="umstellung-abbrechen"]')).toBeFocused();
  await ruhig(page); await page.screenshot({ path: shot("bestaetigung-hell") });
  await d.locator('[data-aktion="umstellung-abbrechen"]').click();
  await expect(frage).toHaveCount(0);
  expect(z.posts["phase-a"]).toHaveLength(0);
  await umstellKnopf(page).click();
  await d.locator('[data-aktion="umstellung-bestaetigen"]').click();
  await expect(d.locator('[data-um="fertig"]')).toContainText("Fertig. Kortex arbeitet jetzt mit deinem Vault.");
  await expect(d.locator('[data-um="fertig"]')).toContainText("Starte offene Claude-Sitzungen neu");
  expect(z.posts["phase-a"]).toHaveLength(1);
  expect(z.posts["phase-a"][0].bestaetigt).toBe(true);
  expect(z.posts["phase-a"][0].entscheidungen).toEqual(z.posts.probelauf[0].entscheidungen);    // dieselben Entscheidungen
  expect(z.posts.probelauf[0].entscheidungen.gitSchluessel).toBe(true);
  // Rückweg-Liste und Meldung an die App (Vertrauen/Status neu lesen)
  await expect(d.locator("[data-rueckweg]")).toHaveCount(9);
  expect(await aktionen(page, "vertrauen-geaendert")).not.toHaveLength(0);
  await expect(d.locator('[data-um="intro"]')).toContainText("Dieser Vault ist auf Kortex umgestellt");
  await expect(page.locator('[data-banner="umstellung"]')).toHaveCount(0);       // nach Phase A kein Hinweis mehr
  await ruhig(page); await page.screenshot({ path: shot("fertig-hell") });
});

test("Umstellen nur nach grünem Probelauf DERSELBEN Entscheidungen: wer danach anders wählt, muss den Probelauf wiederholen", async ({ page }) => {
  const z = await start(page, { probe: probeGruen });
  const d = dlg(page);
  await probeKnopf(page).click();
  await expect(umstellKnopf(page)).toBeEnabled();
  await d.locator('[data-wahl="gitSchluessel"] input[value="nein"]').check();
  await expect(umstellKnopf(page)).toBeDisabled();
  await expect(d.locator('[data-um="probe-veraltet"]').first()).toContainText("Du hast eine Entscheidung geändert");
  await expect(d.locator('[data-um="umstellen-gesperrt"]')).toContainText("Du hast eine Entscheidung geändert");
  expect(z.posts["phase-a"]).toHaveLength(0);
  await d.locator('[data-wahl="gitSchluessel"] input[value="ja"]').check();           // zurück auf die geprüfte Wahl
  await expect(umstellKnopf(page)).toBeEnabled();
  await d.locator('[data-wahl="gitSchluessel"] input[value="nein"]').check();
  await probeKnopf(page).click();
  await expect(umstellKnopf(page)).toBeEnabled();
  expect(z.posts.probelauf).toHaveLength(2);
  expect(z.posts.probelauf[1].entscheidungen.gitSchluessel).toBe(false);
});

test("Entscheidungen gehen genau so an die Werkstatt (Whitelist-Schlüssel); mehrere Claude-Profile sind wählbar", async ({ page }) => {
  const z = await start(page, { probe: probeGruen, befund: befundAntwort({ profile: PROFILE, funde: [FUNDE.hooks, FUNDE.gitSchluessel, FUNDE.sicherungZiel, FUNDE.weitereMacs, FUNDE.mcpAnders] }) });
  const d = dlg(page);
  await d.locator('[data-wahl="remoteBestaetigen"] input[value="ja"]').check();
  await d.locator('[data-wahl="mcpAnders"] input[value="ja"]').check();
  await d.locator('[data-wahl="weitereMacs"] input[value="ja"]').check();
  await expect(d.locator('[data-um="weitere-macs-hinweis"]')).toContainText("Dann stellst du jeden Mac einzeln um");
  await d.locator('[data-profil="/Users/test/.claude-privat"]').uncheck();
  await probeKnopf(page).click();
  await expect(umstellKnopf(page)).toBeEnabled();
  expect(z.posts.probelauf[0]).toEqual({
    bestaetigt: true,
    entscheidungen: { gitSchluessel: true, verweiseAufloesen: false, remoteEntfernen: false, remoteBestaetigen: true, hooksErsetzen: false, mcpAnders: true, dienstAnderer: false, nachbarkopie: false, weitereMacs: "ja", profile: ["/Users/test/.claude"] },
  });
});

test("Ergebnis „mit Warnungen“ und Abbruch bei einem Schritt: verständlich, mit Weg zurück", async ({ page }) => {
  let nr = 0;
  const z = await start(page, { probe: probeGruen, phaseA: () => (++nr === 1 ? phaseAAntwort({ warnungen: true }) : phaseAFehler) });
  const d = dlg(page);
  await probeKnopf(page).click();
  await umstellKnopf(page).click();
  await d.locator('[data-aktion="umstellung-bestaetigen"]').click();
  const w = d.locator('[data-um="umstellen-warnungen"]');
  await expect(w).toContainText("Fertig, aber mit Warnungen.");
  await expect(w).toContainText("Die Prüfung zum Schluss hat etwas gefunden");
  await expect(w.locator('[data-kriterium="hooks"]')).toContainText("Nicht in Ordnung");
  await expect(d.locator('[data-schritt="A9"]')).toContainText("Warnung");
  await expect(d.locator('[data-um="fertig"]')).toHaveCount(0);          // noch nicht abgeschlossen
  await ruhig(page); await page.screenshot({ path: shot("warnungen-hell") });
  // zweiter Versuch: Schritt A4 klappt nicht
  await umstellKnopf(page).click();
  await d.locator('[data-aktion="umstellung-bestaetigen"]').click();
  const f = d.locator('[data-um="umstellen-fehler"]');
  await expect(f).toContainText("Schritt A4 (Claude Code einklinken) hat nicht geklappt.");
  await expect(f).toContainText("Dieser Schritt wurde zurückgenommen");
  await expect(d.locator('[data-schritt="A4"][data-status="fehler"]')).toContainText("Hat nicht geklappt");
  await expect(umstellKnopf(page)).toHaveText("Weitermachen");
  expect(z.posts["phase-a"]).toHaveLength(2);
});

test("Fortschritt je Schritt A0–A9 mit verständlichen Namen, während die Umstellung läuft", async ({ page }) => {
  let los; const halte = new Promise((r) => { los = r; });
  const z = await start(page, { probe: probeGruen, halte: { phaseA: halte }, phaseA: (_b, _n, zz) => { fertigStellen(zz); return phaseAAntwort(); } });
  const d = dlg(page);
  await probeKnopf(page).click();
  await umstellKnopf(page).click();
  await d.locator('[data-aktion="umstellung-bestaetigen"]').click();
  await expect(d.locator('[data-um="umstellen-laeuft"]')).toContainText("Kortex stellt um …");
  z.stand.schritte = { A0: { status: "ok" }, A1: { status: "ok" }, A2: { status: "laeuft" } };
  await expect(d.locator('[data-schritt="A1"][data-status="ok"]')).toContainText("Online-Sicherung übernehmen");
  await expect(d.locator('[data-schritt="A2"][data-status="laeuft"]')).toContainText("Persönliche Einstellungen des Versionsverlaufs verschieben");
  await expect(d.locator('[data-schritt="A2"]')).toContainText("Läuft …");
  await expect(d.locator('[data-schritt="A4"]')).toContainText("Claude Code einklinken");
  await expect(d.locator('[data-schritt="A4"]')).toContainText("Wartet");
  await expect(d.locator('[data-schritt="A9"]')).toContainText("Zum Schluss alles prüfen");
  await expect(d.locator('[data-aktion="umstellung-umstellen"]')).toHaveCount(0);        // während des Laufs kein zweiter Start
  await ruhig(page); await page.screenshot({ path: shot("laeuft-hell") });
  los();
  await expect(d.locator('[data-um="fertig"]')).toBeVisible();
});

test("Rückweg: umgestellte Schritte einzeln oder alles zurücknehmen; nicht saubere Rückwege werden in Alltagssprache gemeldet", async ({ page }) => {
  const z = await start(page, {
    stand: standFertig(),
    rueckweg: (b, _n, zz) => {
      if (b.alles) { Object.assign(zz.stand, standLeer()); return { ok: true, alles: true, schritte: ["A8", "A4"].map((id) => ({ id, titel: id, status: "zurueck", hinweise: [] })), hinweise: [] }; }
      return { ok: true, alles: false, schritte: [{ id: "A4", titel: "Claude Code einklinken", status: "zurueck", hinweise: ["settings-geaendert"] }], hinweise: ["A4:settings-geaendert"] };
    },
  }, { oeffnen: false });
  await expect(page.locator('[data-banner="umstellung"]')).toHaveCount(0);                // schon umgestellt: kein Hinweis …
  await page.click('[data-st="einstellungen"]');
  await expect(page.locator('[data-menue="umstellen"]')).toContainText("Umstellung ansehen …");   // … aber der Weg in die Ansicht
  await page.click('[data-menue="umstellen"]');
  const d = dlg(page);
  await expect(d.locator('[data-um="fertig"]')).toContainText("Fertig. Kortex arbeitet jetzt mit deinem Vault.");
  await expect(d.locator('[data-um="rueckweg"]')).toContainText("Dinge, die du inzwischen selbst geändert hast, überschreibt Kortex nicht.");
  await expect(d.locator("[data-rueckweg]")).toHaveCount(9);
  await expect(d.locator('[data-rueckweg="A4"]')).toContainText("Claude Code einklinken");
  await expect(d.locator('[data-rueckweg="A4"]')).toContainText("Umgestellt");
  await expect(d.locator('[data-um="probe"]')).toBeHidden();                              // nach Phase A kein Probelauf mehr
  await ruhig(page); await page.screenshot({ path: shot("rueckweg-hell") });
  await d.locator('[data-aktion="umstellung-rueckweg-schritt"][data-schritt="A4"]').click();
  await expect(d.locator('[data-um="rueckweg-ergebnis"]')).toContainText("Der Schritt wurde zurückgenommen.");
  const hin = d.locator('[data-um="rueckweg-hinweise"]');
  await expect(hin).toContainText("Nicht alles ging sauber zurück");
  await expect(hin).toContainText("Die Einstellungen von Claude Code wurden inzwischen geändert. Kortex hat nur seine eigenen Einträge entfernt.");
  await expect(hin).toContainText("Die Sicherungen liegen im Support-Ordner von Kortex");
  expect(z.posts.rueckweg.filter((b) => b.bestaetigt)).toEqual([{ bestaetigt: true, schritte: ["A4"] }]);
  await ruhig(page); await page.screenshot({ path: shot("rueckweg-hinweise-hell") });
  // alles: erst fragen
  await d.locator('[data-aktion="umstellung-rueckweg-alles"]').click();
  const frage = d.locator('[data-um="rueckweg-bestaetigung"]');
  await expect(frage).toContainText("Alles zurücknehmen?");
  await d.locator('[data-aktion="umstellung-rueckweg-nein"]').click();
  await expect(frage).toHaveCount(0);
  expect(z.posts.rueckweg.filter((b) => b.alles)).toHaveLength(0);
  await d.locator('[data-aktion="umstellung-rueckweg-alles"]').click();
  await d.locator('[data-aktion="umstellung-rueckweg-alles-ja"]').click();
  await expect(d.locator('[data-um="rueckweg-ergebnis"]')).toContainText("Alles ist zurückgenommen.");
  expect(z.posts.rueckweg.filter((b) => b.alles)).toEqual([{ bestaetigt: true, alles: true }]);
  // danach wieder „noch nicht umgestellt“: der Probelauf ist wieder da
  await expect(d.locator('[data-um="probe"]')).toBeVisible();
  await expect(d.locator('[data-um="intro"]')).toContainText("Dieser Vault stammt aus der Zeit vor Kortex");
  expect(await aktionen(page, "vertrauen-geaendert")).not.toHaveLength(0);
});

test("Nicht vertraut: freundlicher Hinweis statt Fehler, Weg zur Vertrauensfrage; nichts wurde verändert", async ({ page }) => {
  // Fehler vom Probelauf (409, art nicht-vertraut) – der Vault galt beim Öffnen als vertraut
  const z = await start(page, { probe: { status: 409, json: { fehler: "Dieser Vault ist in Kortex noch nicht als deiner bestätigt. Bestätige ihn zuerst („Diesem Vault vertrauen“), dann geht die Umstellung. Es wurde nichts verändert.", art: "nicht-vertraut", code: "nicht-vertraut" } } });
  const d = dlg(page);
  await probeKnopf(page).click();
  const n = d.locator('[data-um="nicht-vertraut"]');
  await expect(n).toContainText("Zuerst bestätigen, dass dieser Vault von dir ist");
  await expect(n).toContainText("Es wurde nichts verändert.");
  await expect(d.locator(".fehlertext")).toHaveCount(0);           // kein roher Fehlertext
  await expect(probeKnopf(page)).toBeDisabled();
  await expect(umstellKnopf(page)).toBeDisabled();
  await ruhig(page); await page.screenshot({ path: shot("nicht-vertraut-hell") });
  expect(z.posts["phase-a"]).toHaveLength(0);
});

test("Nicht vertraut von Anfang an (Info der Werkstatt): Hinweis sofort, Knopf führt zur Vertrauensfrage der App", async ({ page }) => {
  const z = await start(page, {}, { vertrauen: vertrauenAntwort() });
  const d = dlg(page);
  await expect(d.locator('[data-um="nicht-vertraut"]')).toBeVisible();
  await expect(probeKnopf(page)).toBeDisabled();
  await d.locator('[data-aktion="umstellung-vertrauen"]').click();
  await expect(d).toHaveCount(0);
  await expect(page.locator('.dialog[data-dialog="vertrauen"]')).toBeVisible();
  expect(z.posts.probelauf).toHaveLength(0);
});

test("Hinweis-Banner: erscheint bei Altlasten, lässt sich wegklicken, öffnet die Ansicht; Einstellungen bieten „Vault umstellen …“", async ({ page }) => {
  await start(page, {}, { oeffnen: false });
  const b = page.locator('[data-banner="umstellung"]');
  await expect(b).toBeVisible();
  await expect(b).toContainText("Dein Vault kann auf Kortex umgestellt werden");
  await expect(b).toContainText("an deinen Notizen ändert sich nichts");
  await ruhig(page); await page.screenshot({ path: shot("banner-hell") });
  await page.click('[data-st="einstellungen"]');
  await expect(page.locator('[data-menue="umstellen"]')).toContainText("Vault umstellen …");
  await page.keyboard.press("Escape");
  await page.click('[data-aktion="umstellung-banner-zu"]');
  await expect(b).toHaveCount(0);
  // der Menübefehl der App (Menüleiste „Vault umstellen …“) öffnet dieselbe Ansicht
  await page.evaluate(() => window.studio.befehl("umstellung"));
  await expect(dlg(page)).toBeVisible();
  await expect(dlg(page).locator('[data-umstellung="gruppe-auto"]')).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg(page)).toHaveCount(0);
  await expect(b).toHaveCount(0);                                        // weggeklickt bleibt weg
});

test("Kein Banner und kein Menüeintrag, wenn nichts umzustellen ist (kein alter Werkzeug-Ordner; Befund ohne Altlasten)", async ({ page }) => {
  const z = await start(page, { altesWerkzeug: false }, { oeffnen: false });
  await page.waitForTimeout(500);
  await expect(page.locator('[data-banner="umstellung"]')).toHaveCount(0);
  await page.click('[data-st="einstellungen"]');
  await expect(page.locator('[data-menue="umstellen"]')).toHaveCount(0);
  expect(z.gets.befund).toBe(0);                                          // ohne alten Ordner läuft kein Befund
  await page.keyboard.press("Escape");
  // alter Ordner da, aber der Befund meldet keine Kit-Zeit-Altlast
  z.altesWerkzeug = true; z.befund = befundAntwort({ funde: [], kitZeit: false });
  await page.reload();
  await page.waitForSelector(".cm-content .cm-line");
  await expect.poll(() => z.gets.befund).toBeGreaterThan(0);
  await expect(page.locator('[data-banner="umstellung"]')).toHaveCount(0);
});

test("Protokoll zeigen: Ablageort im Support-Ordner und Zeilen ohne Werte, Zurück zur Umstellung", async ({ page }) => {
  await start(page);
  const d = dlg(page);
  await d.locator('[data-aktion="umstellung-protokoll"]').click();
  await expect(d.locator('[data-um="protokoll-ort"]')).toHaveText("~/Library/Application Support/Kortex/umstellung/0a1b2c3d4e5f6a7b/protokoll.jsonl");
  await expect(d.locator("[data-ereignis]")).toHaveCount(5);
  await expect(d.locator('[data-ereignis="fehler"]')).toContainText("Claude Code einklinken");
  await expect(d.locator('[data-ereignis="fehler"]')).toContainText("nicht geklappt");
  await expect(d.locator('[data-um="befund"]')).toBeHidden();
  await ruhig(page); await page.screenshot({ path: shot("protokoll-hell") });
  await d.locator('[data-aktion="umstellung-schliessen"]').click();
  await expect(dlg(page)).toBeVisible();
  await expect(d.locator('[data-um="befund"]')).toBeVisible();
});

test("Ausgang unklar (Verbindung weg): Hinweis statt Absturz, Stand wird neu gelesen", async ({ page }) => {
  const z = await start(page, { probe: { status: 504, json: { fehler: "Das hat zu lange gedauert und wurde abgebrochen." } } });
  const d = dlg(page);
  await probeKnopf(page).click();
  await expect(d.locator('[data-um="probe-fehler"]')).toContainText("Die Verbindung wurde unterbrochen");
  expect(z.gets.stand).toBeGreaterThan(1);
  await expect(probeKnopf(page)).toBeEnabled();
});

test("Befund-Fehler: freundlicher Satz mit „Nochmal versuchen“", async ({ page }) => {
  const z = await start(page, { befundFehler: { status: 502, json: { fehler: "Die Suche nach Altlasten hat nicht geklappt. Es wurde nichts verändert." } } }, { oeffnen: false });
  // der Hinweis schweigt bei Fehlern; die Ansicht aus den Einstellungen zeigt sie
  await expect(page.locator('[data-banner="umstellung"]')).toHaveCount(0);
  await page.evaluate(() => window.studio.befehl("umstellung"));
  await expect(dlg(page).locator('[data-um="fehler"]')).toContainText("Die Suche nach Altlasten hat nicht geklappt. Es wurde nichts verändert.");
  z.befundFehler = null;
  await dlg(page).locator('[data-aktion="umstellung-nochmal"]').click();
  await expect(dlg(page).locator('[data-umstellung="gruppe-auto"]')).toBeVisible();
});

test("Dunkel: Befund, Probelauf rot und Rückweg lesbar (Bildschirmfotos)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await start(page, { probe: probeAntwort({ rot: ["hooks", "dienst"], kopieBehalten: true }) });
  const d = dlg(page);
  await expect(d).toBeVisible();
  await ruhig(page); await page.screenshot({ path: shot("befund-dunkel") });
  await probeKnopf(page).click();
  await expect(d.locator('[data-um="probe-ergebnis"]')).toHaveAttribute("data-ampel", "rot");
  await d.locator('[data-um="probe"]').scrollIntoViewIfNeeded();
  await ruhig(page); await page.screenshot({ path: shot("probe-rot-dunkel") });
  await d.locator('[data-aktion="umstellung-protokoll"]').click();
  await ruhig(page); await page.screenshot({ path: shot("protokoll-dunkel") });
});

// ---------------------------------------------------------------- Nur ein Dialog (dialogEinmalig in hilfen.js)
test("Zweiter Aufruf per Befehl oder Menü stapelt keinen zweiten Dialog: der offene bekommt den Fokus", async ({ page }) => {
  await start(page);
  await expect(page.locator("#dialog-host .schleier")).toHaveCount(1);
  // Fokus weg aus dem Dialog (wie nach einem Klick ins Menü), dann zweimal kurz hintereinander derselbe Befehl
  await page.evaluate(() => { document.activeElement?.blur?.(); });
  await page.evaluate(() => { window.studio.befehl("umstellung"); window.studio.befehl("umstellung"); });
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest?.('[data-dialog="umstellung"]'))).toBe(true);
  await ruhig(page); // der Befehl lädt das Modul asynchron: erst danach wäre ein zweiter Dialog sichtbar
  await expect(page.locator("#dialog-host .schleier")).toHaveCount(1);
  await expect(dlg(page)).toHaveCount(1);
  // Schließen gibt die Art wieder frei: der nächste Aufruf öffnet normal
  await page.keyboard.press("Escape");
  await expect(dlg(page)).toHaveCount(0);
  await page.evaluate(() => window.studio.befehl("umstellung"));
  await expect(dlg(page)).toHaveCount(1);
});

test("dialogEinmalig: je Art ein Dialog; derselbe Rückgabewert; Fokus nur, wenn nichts anderes darüber liegt", async ({ page }) => {
  await start(page, {}, { oeffnen: false });
  const r = await page.evaluate(async () => {
    const m = await import("/hilfen.js");
    const mach = (titel) => () => m.dialog({ titel, rumpf: [m.h("input", { type: "text", "data-feld": titel })], knoepfe: [] });
    const a1 = m.dialogEinmalig("test-a", mach("A"));
    const a2 = m.dialogEinmalig("test-a", mach("A zweimal"));
    const nachA = document.querySelectorAll("#dialog-host .schleier").length;
    const b = m.dialogEinmalig("test-b", mach("B")); // andere Art: eigener Dialog, liegt oben
    document.activeElement?.blur?.();
    const a3 = m.dialogEinmalig("test-a", mach("A dreimal")); // A liegt unter B: kein Fokusraub
    const fokusInA3 = !!document.activeElement?.closest?.("[data-feld='A']");
    const anzahl = document.querySelectorAll("#dialog-host .schleier").length;
    b.schliessen();
    document.activeElement?.blur?.();
    m.dialogEinmalig("test-a", mach("A viertens")); // jetzt oben: bekommt den Fokus
    const fokusInA = !!document.activeElement?.closest?.("[data-feld='A']");
    a1.schliessen();
    const nachZu = document.querySelectorAll("#dialog-host .schleier").length;
    const neu = m.dialogEinmalig("test-a", mach("A neu"));
    return { gleich: a1 === a2 && a2 === a3, nachA, anzahl, fokusInA3, fokusInA, nachZu, neuAnders: neu !== a1, nachNeu: document.querySelectorAll("#dialog-host .schleier").length };
  });
  expect(r).toEqual({ gleich: true, nachA: 1, anzahl: 2, fokusInA3: false, fokusInA: true, nachZu: 0, neuAnders: true, nachNeu: 1 });
});
