// Konflikt-Ansicht (Abgleich mit zwei Geräten) im echten Studio: Banner, Mitteilung und Statusleiste „Konflikt in N Notizen“, Liste links, zwei Fassungen nebeneinander,
// Entscheidungen 1–4 (diese · andere · beide · selbst zusammenführen), „KI fragen“ nur mit passendem KI-Konto, Abschluss mit ⌘↩ und Ablaufanzeige, Erfolg, Rückgängig,
// Später. Teil 1: Daten und Werkstatt-Antworten sind festgelegt (page.route) · Teil 2: Ende zu Ende gegen den echten Kern mit zwei Klonen und einem Remote in Temp.
// Bilder (hell/dunkel) entstehen nur, wenn KONFLIKT_BILDER auf einen Ordner zeigt.
import { test, expect } from "./basis.mjs";
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { baueVault, git } from "./vault.mjs";
import { starteServer } from "./start.mjs";
import { pathToFileURL } from "node:url";

// Das Ziel gilt als vom Nutzer bestätigt (Assistent „Sicherung“): nur dorthin sendet das Lösen
async function bestaetige(vault, remote, support) { const m = await import(pathToFileURL(join(process.cwd(), "..", "..", "Ressourcen/gemeinsam/sicherungsmerker.mjs")).href); m.merkeRemoteBestaetigt(vault, remote, { support }); }

const BILDER = process.env.KONFLIKT_BILDER || null;
if (BILDER) mkdirSync(BILDER, { recursive: true });
const bild = async (page, name, schema) => { if (BILDER) await page.screenshot({ path: join(BILDER, `${name}-${schema}.png`) }); };
const vorMin = (n) => new Date(Date.now() - n * 60000).toISOString();
const kz = (s) => s.trim().split("\n");

const KICKOFF_MEINE = kz(`## Ziel
Bis Ende Q1 steht eine erste Version der Karten-App, die auch ohne Netz funktioniert. Rahmen gibt der Zeitplan Q4.
Grundlage ist die Recherche zu den Kartenanbietern.
## Nächste Schritte
- [x] Projektordner anlegen und Team einladen
- [ ] Rollen im Team festlegen
- [ ] Budget mit Finanzen 2026 abgleichen
- [ ] Workshop-Raum für den 12. November buchen
## Entscheidungen
- Wir starten mit einem Kartendienst und halten den Wechsel offen.
- Datenschutz-Freigabe vor dem ersten Test mit echten Daten.
- Kartendienst: Entscheidung bis 20. November.
## Hintergrund
Atlas ersetzt die alte Kartenansicht im Außendienst.
Die Nutzer arbeiten oft ohne Netz, deshalb zählt Offline zuerst.
Erste Rückmeldungen kommen aus dem Pilot im Oktober.`);
const KICKOFF_ANDERE = kz(`## Ziel
Bis Ende Q1 steht eine erste Version der Karten-App, die auch ohne Netz funktioniert.
Grundlage ist die Recherche zu den Kartenanbietern.
## Nächste Schritte
- [x] Projektordner anlegen und Team einladen
- [x] Rollen im Team festlegen
- [ ] Budget mit Finanzen 2026 abgleichen
- [ ] Workshop-Raum für den 12. November buchen (Raum B, 10 Uhr)
- [ ] Lea wegen der Zahlen erinnern
## Entscheidungen
- Wir starten mit einem Kartendienst und halten den Wechsel offen.
- Datenschutz-Freigabe vor dem ersten Test mit echten Daten.
- Das Budget kommt erst ab Dezember.
## Hintergrund
Atlas ersetzt die alte Kartenansicht im Außendienst.
Die Nutzer arbeiten oft ohne Netz, deshalb zählt Offline zuerst.
Erste Rückmeldungen kommen aus dem Pilot im Oktober.`);
const ZEIT_MEINE = "## Meilensteine bis Jahresende\n- 14. Nov: Datenschutz-Freigabe\n- 28. Nov: Design-Abnahme\n- 12. Dez: Erster Test mit echten Daten\n- 19. Dez: Übergabe an Finanzen\n## Beteiligte\n- Lea (Finanzen)\n- Jonas (Design)\n";
const ZEIT_ANDERE = "## Meilensteine bis Jahresende\n- 14. Nov: Datenschutz-Freigabe\n- 5. Dez: Design-Abnahme\n- 12. Dez: Erster Test mit echten Daten\n- 19. Dez: Übergabe an Finanzen\n## Beteiligte\n- Lea (Finanzen)\n- Jonas (Design)\n";
const IDEEN_MEINE = "- Offline-Modus\n- Geteilte Listen\n- Export als PDF für die Geschäftsführung\n- Widget für den Sperrbildschirm\n- Kartenansicht mit Fotos von der Baustelle\n";
const CHECK_ANDERE = "- [x] Raum B reservieren\n- [x] Beamer und Adapter prüfen\n- [ ] Verpflegung für 8 Personen bestellen\n- [ ] Namensschilder drucken\n";

const seite = (pfad, titel, meine, andere, extra = {}) => ({ pfad, titel, art: "beide", typ: "text", meine: { vorhanden: true, text: meine, zeit: vorMin(3), geraet: null }, andere: { vorhanden: true, text: andere, zeit: vorMin(12), geraet: "iPhone" }, ...extra });
const DATEN = {
  standard: () => ({ ok: true, aktiv: true, modus: "offen", meine: "a".repeat(40), andere: "b".repeat(40), eigen: "Mac", geraet: "iPhone", seit: new Date(new Date().setHours(14, 2, 0, 0)).toISOString(), versteckt: 0, rueckgaengig: { moeglich: false, anzahl: 0 },
    dateien: [seite("10_notizen/Kickoff Projekt Atlas.md", "Kickoff Projekt Atlas", KICKOFF_MEINE.join("\n") + "\n", KICKOFF_ANDERE.join("\n") + "\n"),
      seite("10_notizen/Zeitplan Q4.md", "Zeitplan Q4", ZEIT_MEINE, ZEIT_ANDERE, { andere: { vorhanden: true, text: ZEIT_ANDERE, zeit: vorMin(60), geraet: "MacBook Air" } })] }),
  geloescht: () => ({ ...DATEN.standard(), dateien: [
    { pfad: "10_notizen/Ideen-Sammlung.md", titel: "Ideen-Sammlung", art: "andere-geloescht", typ: "geloescht", wer: "andere", neueZeilen: ["- Widget für den Sperrbildschirm", "- Kartenansicht mit Fotos von der Baustelle"], meine: { vorhanden: true, text: IDEEN_MEINE, zeit: vorMin(20), geraet: null }, andere: { vorhanden: false, text: null, zeit: vorMin(34), geraet: "iPhone" } },
    { pfad: "10_notizen/Checkliste Workshop.md", titel: "Checkliste Workshop", art: "meine-geloescht", typ: "geloescht", wer: "meine", neueZeilen: ["- [ ] Verpflegung für 8 Personen bestellen", "- [ ] Namensschilder drucken"], meine: { vorhanden: false, text: null, zeit: vorMin(40), geraet: null }, andere: { vorhanden: true, text: CHECK_ANDERE, zeit: vorMin(6), geraet: "iPhone" } }] }),
  board: () => ({ ...DATEN.standard(), dateien: [DATEN.standard().dateien[0],
    { pfad: "05_aufgaben/Budget mit Finanzen 2026 abgleichen.md", titel: "Budget mit Finanzen 2026 abgleichen", art: "beide", typ: "board", meine: { vorhanden: true, text: "---\ntyp: aufgabe\n---\n", zeit: vorMin(9), geraet: null }, andere: { vorhanden: true, text: "---\ntyp: aufgabe\n---\n", zeit: vorMin(5), geraet: "iPhone" },
      karte: { meine: { spalte: "in-arbeit", faellig: "2026-11-14" }, andere: { spalte: "warten", faellig: "2026-11-21" }, vorher: "offen" } }] }),
};
const BASIS_STATUS = { repo: true, zweig: "main", upstream: "origin/main", vor: 0, zurueck: 0, geaendert: [], remote: true, letzterSync: vorMin(2) };
const statusMit = (daten) => ({ ...BASIS_STATUS, konflikt: { dateien: daten.dateien.map((d) => ({ pfad: d.pfad, art: d.art })), versteckt: 0 } });

let vault, server;
test.beforeEach(async () => { ({ vault } = baueVault()); server = await starteServer(vault); });
test.afterEach(() => server?.stopp());

// Werkstatt-Antworten festlegen. opt: { ki: true|false, loesenMs, kiAntwort }
async function mocke(page, daten, opt = {}) {
  const gesendet = { loesen: [], abbrechen: 0, rueckgaengig: 0, ki: [] };
  let aktiv = true;
  await page.route(/\/api\/git\/status$/, (r) => r.fulfill({ json: aktiv ? statusMit(daten) : BASIS_STATUS }));
  await page.route(/\/api\/git\/nachsehen$/, (r) => r.fulfill({ json: aktiv ? statusMit(daten) : BASIS_STATUS }));
  await page.route(/\/api\/git\/konflikt$/, (r) => r.fulfill({ json: aktiv ? { ...daten, rueckgaengig: { moeglich: !aktiv } } : { ok: true, aktiv: false, dateien: [] } }));
  await page.route(/\/api\/git\/konflikt\/loesen$/, async (r) => {
    gesendet.loesen.push(r.request().postDataJSON());
    await new Promise((ok) => setTimeout(ok, opt.loesenMs ?? 50));
    aktiv = false;
    r.fulfill({ json: { ok: true, merge: "m", eintraege: [], kopien: [], versteckteBehalten: [], abgleich: opt.abgleich || { art: "gesendet", ok: true, text: "Online gesichert." } } });
  });
  await page.route(/\/api\/git\/konflikt\/abbrechen$/, (r) => { gesendet.abbrechen++; r.fulfill({ json: { ok: true, offen: true } }); });
  await page.route(/\/api\/git\/konflikt\/rueckgaengig$/, (r) => { gesendet.rueckgaengig++; aktiv = true; r.fulfill({ json: { ok: true, commit: "u", dateien: daten.dateien.map((d) => d.pfad), } }); });
  await page.route(/\/api\/frage\/bereit$/, (r) => r.fulfill({ json: opt.ki === false ? { vertraut: true, claude: true, konten: [], kontenDefekt: false } : { vertraut: true, claude: true, kontenDefekt: false, konten: [{ id: "k1", name: "Standard", erlaubt: true, programm: "claude-code", stufe: "lesen" }] } }));
  await page.route(/\/api\/frage\/start$/, (r) => { gesendet.ki.push(r.request().postDataJSON()); r.fulfill({ json: { id: "f1" } }); });
  await page.route(/\/api\/frage\/stand/, async (r) => {
    await new Promise((ok) => setTimeout(ok, opt.kiMs ?? 100));
    const text = opt.kiAntwort || "EMPFEHLUNG: beide\nBEGRUENDUNG: Die beiden Fassungen ergänzen sich, nichts widerspricht sich.\nPUNKTE:\n- Rollen: Abgehakt, wie auf dem iPhone.\n- Workshop-Raum: Mit Raum und Uhrzeit.\n";
    r.fulfill({ json: { epoche: 0, text, textAb: text.length, n: 1, ereignisse: [], quellen: [], verweise: {}, unbekannt: 0, fertig: true, ergebnis: { ok: true } } });
  });
  return gesendet;
}
async function start(page, daten, opt = {}, { schema = "hell", breite = 1440 } = {}) {
  page.on("pageerror", (e) => console.log("SEITENFEHLER", e.message));
  await page.setViewportSize({ width: breite, height: 900 });
  await page.emulateMedia({ colorScheme: schema === "hell" ? "light" : "dark", reducedMotion: "reduce" });
  const g = await mocke(page, daten, opt);
  await page.goto(server.url);
  await page.waitForSelector('[data-st="sync"]');
  return g;
}
const oeffne = async (page) => { await page.locator('[data-aktion="konflikt-ansehen"]').click(); await expect(page.locator("#konflikt .k-item")).not.toHaveCount(0); };
const item = (page, i) => page.locator("#konflikt .k-item").nth(i);
// zwei Einträge nacheinander entscheiden (nach der ersten Taste springt die Ansicht erst zum nächsten offenen Eintrag)
async function entscheide(page, a, b) { await page.keyboard.press(a); await expect(item(page, 1)).toHaveAttribute("aria-current", "true"); await page.keyboard.press(b); }

for (const schema of ["hell", "dunkel"]) {
  test.describe(`Konflikt-Ansicht (${schema})`, () => {
    test(`Einstieg: Banner, Mitteilung und Statusleiste nennen „Konflikt in 2 Notizen“`, async ({ page }) => {
      await start(page, DATEN.standard(), {}, { schema });
      const banner = page.locator('[data-banner="abgleich"]');
      await expect(banner).toBeVisible();
      await expect(banner).toContainText("Konflikt in 2 Notizen.");
      await expect(banner).toContainText("Der Abgleich wartet auf dich.");
      await expect(page.locator('[data-st="sync"]')).toHaveAttribute("data-zustand", "konflikt");
      await expect(page.locator('[data-st="sync"]')).toContainText("Konflikt in 2 Notizen");
      await expect(page.locator(".toast")).toContainText("Abgleich wartet. Konflikt in 2 Notizen.");
      await expect(page.locator(".toast a")).toHaveText("Fassungen ansehen");
      await bild(page, "k1-banner", schema);
      await page.locator('[data-aktion="konflikt-banner-spaeter"]').click();
      await expect(banner).toHaveCount(0);
      await page.locator(".toast a").click(); // die Mitteilung führt in die Ansicht
      await expect(page.locator("#konflikt")).toBeVisible();
    });

    test("Ansicht: Liste links, zwei Fassungen nebeneinander, gleiche Zeilen eingeklappt, Pfad „Abgleich › Konflikt in 2 Notizen“", async ({ page }) => {
      await start(page, DATEN.standard(), {}, { schema });
      await oeffne(page);
      await expect(page.locator("#app")).toHaveAttribute("data-modus", "konflikt");
      await expect(page.locator("#pfad")).toContainText("Abgleich");
      await expect(page.locator("#pfad")).toContainText("Konflikt in 2 Notizen");
      await expect(page.locator("#konflikt .k-item")).toHaveCount(2);
      await expect(item(page, 0)).toContainText("Kickoff Projekt Atlas");
      await expect(item(page, 0)).toContainText("Dieser Mac und iPhone · 4 Unterschiede");
      await expect(item(page, 1)).toContainText("Dieser Mac und MacBook Air");
      await expect(item(page, 0)).toContainText("Offen");
      await expect(page.locator(".k-kopf h1")).toContainText("Kickoff Projekt Atlas");
      await expect(page.locator(".k-kopf h1")).toContainText("Auf beiden Geräten geändert");
      await expect(page.locator(".k-erkl")).toContainText("hier und auf iPhone geändert");
      // zwei Spalten mit Namen und Zeit
      await expect(page.locator(".k-dk.l")).toContainText("Dieser Mac");
      await expect(page.locator(".k-dk.l")).toContainText("vor 3 Min gespeichert");
      await expect(page.locator(".k-dk.l .k-badge")).toHaveText("Deine Fassung");
      await expect(page.locator(".k-dk:not(.l)")).toContainText("iPhone");
      await expect(page.locator(".k-dk:not(.l)")).toContainText("vor 12 Min gespeichert");
      await page.mouse.move(700, 30);
      await bild(page, "k3-vergleich", schema);
      // markierte Wörter, gleiche Zeilen eingeklappt
      await expect(page.locator(".k-diff mark.w").first()).toBeVisible();
      const aus = page.locator(".k-ausg button").first();
      await expect(aus).toContainText("gleiche Zeilen ausgeblendet");
      const vorher = await page.locator(".k-diff .k-c").count();
      await aus.click();
      expect(await page.locator(".k-diff .k-c").count()).toBeGreaterThan(vorher);
      // Aktionen 1-4 mit Tastenkürzeln, KI fragen mit K
      for (const [a, t, k] of [["meine", "Diese behalten", "1"], ["andere", "Andere behalten", "2"], ["beide", "Beide behalten", "3"], ["zusammen", "Selbst zusammenführen", "4"]]) {
        const b = page.locator(`.k-akt [data-a="${a}"]`);
        await expect(b).toContainText(t); await expect(b.locator("kbd")).toHaveText(k);
      }
      await expect(page.locator('.k-kopf [data-a="ki"]')).toContainText("KI fragen");
      await expect(page.locator(".k-fuss")).toContainText("0 von 2 gelöst · noch 2 offen");
      await expect(page.locator('[data-aktion="konflikt-abgleichen"]')).toBeDisabled();
    });

    test("Hover erklärt die Folge, Tasten 1–3 entscheiden und springen zum nächsten offenen Eintrag; ⌘↩ gleicht ab (Ablauf, Erfolg)", async ({ page }) => {
      const g = await start(page, DATEN.standard(), { loesenMs: 700 }, { schema });
      await oeffne(page);
      await page.locator('.k-akt [data-a="beide"]').hover();
      await expect(page.locator("#k-folge")).toContainText("wird als Kopie „Kickoff Projekt Atlas (iPhone)“ daneben abgelegt");
      await page.keyboard.press("2");
      await expect(item(page, 0)).toContainText("iPhone behalten");
      await expect(item(page, 1)).toHaveAttribute("aria-current", "true"); // springt weiter
      await expect(page.locator(".k-fuss")).toContainText("1 von 2 gelöst · noch 1 offen");
      await page.keyboard.press("3");
      await expect(item(page, 1)).toContainText("Beide behalten, Kopie");
      await expect(page.locator(".k-fuss")).toContainText("Alles gelöst");
      await expect(page.locator('[data-aktion="konflikt-abgleichen"]')).toBeEnabled();
      await bild(page, "k9-alles-geloest", schema);
      await page.keyboard.press("Meta+Enter");
      await expect(page.locator("[data-konflikt-sync]")).toBeVisible();
      await expect(page.locator(".k-mitte h2")).toHaveText("Wird abgeglichen …");
      await expect(page.locator("#k-schritte li")).toHaveText(["Entscheidungen festhalten", "Mit iPhone abgleichen", "Online sichern"]);
      await bild(page, "k15-abgleich-laeuft", schema);
      await expect(page.locator("[data-konflikt-fertig]")).toBeVisible({ timeout: 8000 });
      await expect(page.locator(".k-mitte h2")).toHaveText("Alles abgeglichen");
      await expect(page.locator(".k-zus li")).toHaveCount(2);
      await expect(page.locator(".k-zus")).toContainText("Die Fassung von iPhone gilt. Deine liegt im Verlauf.");
      await expect(page.locator(".k-zus")).toContainText("Beide Fassungen bleiben, von MacBook Air als Kopie „Zeitplan Q4 (MacBook Air)“.");
      expect(g.loesen).toHaveLength(1);
      expect(g.loesen[0].auswahl).toEqual([{ pfad: "10_notizen/Kickoff Projekt Atlas.md", wahl: "andere" }, { pfad: "10_notizen/Zeitplan Q4.md", wahl: "beide" }]);
      await expect(page.locator(".toast").last()).toContainText("Abgleich fertig");
      await expect(page.locator(".toast a").last()).toHaveText("Rückgängig");
      await bild(page, "k16-erfolg", schema);
      await page.keyboard.press("Escape");
      await expect(page.locator("#konflikt")).toHaveCount(0);
      await expect(page.locator("#app")).not.toHaveAttribute("data-modus", "konflikt");
      await expect(page.locator('[data-st="sync"]')).not.toContainText("Konflikt");
    });

    test("Selbst zusammenführen: Abschnitt für Abschnitt, Live-Ergebnis, eigener Text, Ergebnis übernehmen (⌘↩) schickt den Text", async ({ page }) => {
      const g = await start(page, DATEN.standard(), {}, { schema });
      await oeffne(page);
      await page.keyboard.press("4");
      await expect(page.locator(".k-merge")).toBeVisible();
      await expect(page.locator(".k-blk")).toHaveCount(4);
      await expect(page.locator(".k-erg-kopf")).toContainText("0/4");
      await expect(page.locator(".k-erg .k-er.offen")).toHaveCount(4);
      await expect(page.locator('[data-k="uebernehmen"]')).toBeDisabled();
      await expect(page.locator("#k-merge-z")).toHaveText("0 von 4 Abschnitten gewählt.");
      const wahl = ["meine", "anderes", "beide"];
      for (let i = 0; i < 3; i++) await page.locator(`#k-b${i} .k-opt[data-w="${wahl[i] === "beide" ? "meine" : wahl[i]}"]`).first().click();
      await page.locator('#k-b2 [data-w="beide"]').click(); // Abschnitt 3: beide
      await expect(page.locator("#k-b2 .z")).toContainText("Beide");
      // Abschnitt 4 selbst schreiben
      await page.locator('#k-b3 [data-w="eigen"]').click();
      const feld = page.locator('[data-eigen="3"] textarea');
      await expect(feld).toBeFocused();
      await feld.fill("- Das Budget kommt erst ab Dezember, Kartendienst bis 20. November.");
      await expect(page.locator(".k-erg")).toContainText("Das Budget kommt erst ab Dezember, Kartendienst bis 20. November.");
      await expect(page.locator(".k-erg-kopf")).toContainText("4/4");
      await expect(page.locator(".k-erg .k-er.offen")).toHaveCount(0);
      await expect(page.locator("#k-merge-z")).toHaveText("Alle Abschnitte gewählt.");
      await page.mouse.move(700, 30);
      await bild(page, "k5-zusammenfuehren", schema);
      await page.locator(".k-erg-kopf").click(); // Fokus aus dem Feld (Esc würde das Zusammenführen verlassen)
      await page.locator('[data-k="uebernehmen"]').click();
      await expect(item(page, 0)).toContainText("Selbst zusammengeführt");
      await expect(item(page, 1)).toHaveAttribute("aria-current", "true");
      await page.keyboard.press("1");
      await page.keyboard.press("Meta+Enter");
      await expect(page.locator("[data-konflikt-fertig]")).toBeVisible({ timeout: 8000 });
      const a = g.loesen[0].auswahl;
      expect(a[0].wahl).toBe("text");
      expect(a[0].text).toContain("Rahmen gibt der Zeitplan Q4.");
      expect(a[0].text).toContain("- [x] Rollen im Team festlegen");
      expect(a[0].text).toContain("Workshop-Raum für den 12. November buchen\n- [ ] Workshop-Raum für den 12. November buchen (Raum B, 10 Uhr)");
      expect(a[0].text).toContain("- Das Budget kommt erst ab Dezember, Kartendienst bis 20. November.");
      expect(a[0].text).not.toContain("- Kartendienst: Entscheidung bis 20. November.");
      expect(a[1]).toEqual({ pfad: "10_notizen/Zeitplan Q4.md", wahl: "meine" });
    });

    test("KI fragen: Vorschlag als Karte; ein zusammengeführter Text wird nie ungesehen übernommen (erst „Text ansehen“, dort übernehmen)", async ({ page }) => {
      const text = KICKOFF_MEINE.join("\n") + "\n- Lea wegen der Zahlen erinnern\n";
      const g = await start(page, DATEN.standard(), { kiAntwort: "EMPFEHLUNG: zusammen\nBEGRUENDUNG: Die beiden Fassungen ergänzen sich, nichts widerspricht sich.\nPUNKTE:\n- Rollen: Abgehakt, wie auf dem iPhone.\n- Entscheidungen: Beide neuen Punkte stehen drin.\nTEXT:\n" + text }, { schema });
      await oeffne(page);
      await page.keyboard.press("k");
      await expect(page.locator('[data-ki="denkt"]')).toBeVisible();
      await expect(page.locator('[data-ki="denkt"]')).toContainText("Vergleicht die Fassungen");
      await bild(page, "k19-ki-denkt", schema);
      await expect(page.locator('[data-ki="da"]')).toBeVisible();
      expect(g.ki).toHaveLength(1);
      expect(g.ki[0].konto).toBe("k1");
      expect(g.ki[0].frage).toContain("brain_lesen");
      expect(g.ki[0].frage).toContain("ohne Quellenangaben");
      await expect(page.locator('[data-ki="da"]')).toContainText("Vorschlag von Claude Code");
      await expect(page.locator('[data-ki="da"]')).toContainText("Die beiden Fassungen ergänzen sich");
      await expect(page.locator('[data-ki="da"] li')).toHaveCount(2);
      await expect(page.locator('[data-ki="da"]')).toContainText("noch nicht übernommen");
      await expect(page.locator('[data-ki="da"]')).toContainText("Darf hier: Lesen. Liest nur diese beiden Fassungen und ändert nichts, bis du übernimmst.");
      await expect(page.locator('[data-k="ki-ja"]')).toHaveCount(0);
      await bild(page, "k7-ki-vorschlag", schema);
      await page.locator('[data-k="ki-nein"]').click();
      await expect(page.locator("[data-ki]")).toHaveCount(0);
      await expect(item(page, 0)).toContainText("Offen");
      await page.keyboard.press("k");
      await page.locator('[data-k="ki-anpassen"]').click();
      await expect(item(page, 0)).toContainText("Offen"); // noch nichts entschieden
      const feld = page.locator(".k-frei textarea");
      await expect(feld).toHaveValue(text);
      await page.locator('[data-k="uebernehmen"]').click();
      await expect(item(page, 0)).toContainText("Mit KI zusammengeführt");
      await expect(page.locator("#k-folge")).toContainText("Mit der KI gelöst.");
      await expect(page.locator("#k-folge")).toContainText("noch einmal ansehen");
    });

    test("KI-Text, der nicht zu den Fassungen passt (Konfliktmarken, zu kurz, fremde Verweise), wird nicht angeboten", async ({ page }) => {
      const text = KICKOFF_MEINE.join("\n") + "\n";
      for (const antwort of ["TEXT:\n## Ziel\nZusammengesetzt.\n", "TEXT:\n<<<<<<< Mac\n" + text + "=======\n>>>>>>> iPhone\n", "TEXT:\n" + text + "\nQuelle: [[09_wiki/etwas-anderes.md]]\n"]) {
        const kopf = "EMPFEHLUNG: zusammen\nBEGRUENDUNG: x\nPUNKTE:\n- a: b\n";
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await start(page, DATEN.standard(), { kiAntwort: kopf + antwort }, { schema });
        await oeffne(page);
        await page.keyboard.press("k");
        await expect(page.locator('[data-ki="fehler"]')).toBeVisible();
        await expect(page.locator('[data-ki="fehler"]')).toContainText("nicht lesbar");
        await expect(page.locator('[data-k="ki-anpassen"]')).toHaveCount(0);
      }
    });

    test("KI fragen fehlt ganz, wenn es kein KI-Konto mit Recht „lesen“ für diesen Vault gibt", async ({ page }) => {
      await start(page, DATEN.standard(), { ki: false }, { schema });
      await oeffne(page);
      await expect(page.locator('.k-kopf [data-a="ki"]')).toHaveCount(0);
      await page.keyboard.press("k");
      await expect(page.locator("[data-ki]")).toHaveCount(0);
    });

    test("Gelöscht ↔ geändert: zwei Karten, Aktionen „Notiz behalten“ und „Löschung übernehmen“, kein „Beide“", async ({ page }) => {
      const g = await start(page, DATEN.geloescht(), {}, { schema });
      await expect(page.locator('[data-banner="abgleich"]')).toContainText("Konflikt in 2 Notizen.");
      await oeffne(page);
      await expect(item(page, 0)).toContainText("Auf iPhone gelöscht, hier geändert");
      await expect(item(page, 1)).toContainText("Hier gelöscht, auf iPhone geändert");
      await expect(page.locator(".k-kopf h1")).toContainText("Auf iPhone gelöscht");
      await expect(page.locator(".k-akt .k-a")).toHaveCount(2);
      await expect(page.locator('.k-akt [data-a="meine"]')).toContainText("Notiz behalten");
      await expect(page.locator('.k-akt [data-a="andere"]')).toContainText("Löschung übernehmen");
      await expect(page.locator(".k-weg")).toContainText("Auf iPhone gelöscht");
      await expect(page.locator(".k-fl")).toContainText("Widget für den Sperrbildschirm");
      await expect(page.locator(".k-zl.neu")).toHaveCount(2);
      await expect(page.locator(".k-legende")).toContainText("Seit dem Löschen dazugekommen");
      await page.mouse.move(700, 30);
      await bild(page, "k11-geloescht", schema);
      await page.keyboard.press("3"); // „Beide“ gibt es hier nicht
      await expect(item(page, 0)).toContainText("Offen");
      await page.keyboard.press("1");
      await expect(item(page, 0)).toContainText("Notiz bleibt");
      await expect(item(page, 1)).toHaveAttribute("aria-current", "true");
      await expect(page.locator('.k-akt [data-a="meine"]')).toContainText("Gelöscht lassen");
      await expect(page.locator(".k-weg")).toContainText("Hier gelöscht");
      await page.keyboard.press("2");
      await expect(item(page, 1)).toContainText("Notiz bleibt");
      await page.keyboard.press("Meta+Enter");
      await expect(page.locator("[data-konflikt-fertig]")).toBeVisible({ timeout: 8000 });
      expect(g.loesen[0].auswahl.map((x) => x.wahl)).toEqual(["meine", "andere"]);
    });

    test("Aufgaben-Karte in zwei Spalten: Vergleich der Karte, Folge nennt Spalte und Datum", async ({ page }) => {
      const g = await start(page, DATEN.board(), {}, { schema });
      await expect(page.locator('[data-st="sync"]')).toContainText("Konflikt in 1 Notiz und 1 Aufgabe");
      await oeffne(page);
      await expect(item(page, 1)).toContainText("Auf beiden Geräten verschoben");
      await item(page, 1).click();
      await expect(page.locator(".k-akt .k-a")).toHaveCount(2);
      await expect(page.locator(".k-kz.an")).toHaveCount(4); // Spalte und Fällig je Seite
      await expect(page.locator('[data-spalte="in-arbeit"]')).toBeVisible();
      await expect(page.locator('[data-spalte="warten"]')).toBeVisible();
      await expect(page.locator(".k-kv").first()).toContainText("14. Nov");
      await expect(page.locator(".k-kv").nth(1)).toContainText("21. Nov");
      await expect(page.locator(".k-legende")).toContainText("Die Karte lag vorher in „Offen“");
      await page.locator('.k-akt [data-a="andere"]').hover();
      await expect(page.locator("#k-folge")).toContainText("Die Karte steht in „Wartet“, fällig 21. Nov. Deine Änderung wird nicht übernommen.");
      await page.mouse.move(700, 30);
      await bild(page, "k13-board", schema);
      await page.keyboard.press("4"); // keine Zusammenführung bei Karten
      await expect(page.locator(".k-merge")).toHaveCount(0);
      await page.keyboard.press("2");
      await expect(item(page, 1)).toContainText("Kommt nach „Wartet“");
      void g;
    });

    test("Später (Esc): die Zusammenführung wird zurückgenommen, die Entscheidungen bleiben für das nächste Öffnen", async ({ page }) => {
      const g = await start(page, DATEN.standard(), {}, { schema });
      await oeffne(page);
      await page.keyboard.press("1");
      await expect(item(page, 0)).toContainText("Dieser Mac behalten");
      await page.keyboard.press("Escape");
      await expect(page.locator("#konflikt")).toHaveCount(0);
      await expect.poll(() => g.abbrechen).toBe(1);
      await expect(page.locator('[data-st="sync"]')).toContainText("Konflikt in 2 Notizen");
      await page.locator('[data-aktion="konflikt-ansehen"]').click();
      await expect(item(page, 0)).toContainText("Dieser Mac behalten");
      await expect(page.locator(".k-fuss")).toContainText("1 von 2 gelöst");
    });

    test("Rückgängig (Knopf im Erfolg): Ansicht ist wieder da, Entscheidungen sind noch da, der nächste Abschluss schickt den gemerkten Stand mit", async ({ page }) => {
      const g = await start(page, DATEN.standard(), {}, { schema });
      await oeffne(page);
      await entscheide(page, "1", "2");
      await page.keyboard.press("Meta+Enter");
      await expect(page.locator("[data-konflikt-fertig]")).toBeVisible({ timeout: 8000 });
      await bild(page, "k20-erfolg-toast", schema);
      await page.locator('[data-aktion="konflikt-rueckgaengig"]').click();
      await expect.poll(() => g.rueckgaengig).toBe(1);
      await expect(page.locator(".toast").last()).toContainText("Abgleich zurückgenommen. Deine Entscheidungen sind noch da.");
      await expect(page.locator("#konflikt .k-item")).toHaveCount(2);
      await expect(item(page, 0)).toContainText("Dieser Mac behalten");
      await expect(page.locator(".k-fuss")).toContainText("Alles gelöst");
      await page.keyboard.press("Meta+Enter");
      await expect(page.locator("[data-konflikt-fertig]")).toBeVisible({ timeout: 8000 });
      expect(g.loesen).toHaveLength(2);
      expect(g.loesen[1].basis).toBeUndefined(); // die Oberfläche schickt nie einen Stand, nur das Gesehene
      expect(g.loesen[1].gesehen).toEqual({ meine: "a".repeat(40), andere: "b".repeat(40) });
    });

    test("Fehler beim Abschließen: ruhiger Satz, Ansicht und Entscheidungen bleiben", async ({ page }) => {
      await start(page, DATEN.standard(), {}, { schema });
      await page.route(/\/api\/git\/konflikt\/loesen$/, (r) => r.fulfill({ status: 500, json: { fehler: "Der Abgleich ist fehlgeschlagen." } }));
      await oeffne(page);
      await entscheide(page, "1", "1");
      await page.keyboard.press("Meta+Enter");
      await expect(page.locator(".toast.fehler")).toContainText("Der Abgleich ist fehlgeschlagen.");
      await expect(page.locator("#konflikt .k-item")).toHaveCount(2);
      await expect(page.locator(".k-fuss")).toContainText("Alles gelöst");
    });
  });
}

test("Texte ohne Git-Wörter: Banner, Ansicht, Erfolg", async ({ page }) => {
  await start(page, DATEN.standard(), {});
  await oeffne(page);
  await entscheide(page, "1", "3");
  await page.keyboard.press("Meta+Enter");
  await expect(page.locator("[data-konflikt-fertig]")).toBeVisible({ timeout: 8000 });
  const text = await page.locator("#haupt, #status, #toast-host").evaluateAll((els) => els.map((e) => e.innerText).join("\n"));
  expect(text).not.toMatch(/\b(merge|commit|branch|HEAD|ours|theirs|rebase|fetch|push|pull|conflict)\b/i);
  expect(text).toMatch(/Alles abgeglichen/);
});

test("schmales Fenster (1180 px): nichts läuft über, Liste und Detail bleiben bedienbar", async ({ page }) => {
  await start(page, DATEN.standard(), {}, { breite: 1180 });
  await oeffne(page);
  const breiter = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(breiter).toBe(false);
  await bild(page, "k21-schmal-1180", "hell");
  await page.keyboard.press("4");
  await expect(page.locator(".k-merge")).toBeVisible();
});


// ---------------------------------------------------------------- Review: Umbenennung, fremde Zusammenführung, veralteter Stand, merkende Entscheidungen, Zeilenenden, Sicherung, Editor gesperrt
const mitBlobs = (daten) => { for (const d of daten.dateien) for (const k of ["meine", "andere"]) d[k].blob = d[k].vorhanden ? `${k[0]}-${d.pfad}` : null; return daten; };
const umbenanntDaten = () => ({ ...DATEN.standard(), dateien: [{ pfad: "10_notizen/Kickoff-mac.md", pfadAndere: "10_notizen/Kickoff-iphone.md", basisPfad: "10_notizen/Kickoff.md", titel: "Kickoff Projekt Atlas", art: "umbenannt", typ: "umbenannt",
  meine: { vorhanden: true, text: KICKOFF_MEINE.join("\n") + "\n", zeit: vorMin(3), geraet: null }, andere: { vorhanden: true, text: KICKOFF_ANDERE.join("\n") + "\n", zeit: vorMin(12), geraet: "iPhone" } }] });

test("Umbenennung auf beiden Seiten: ein Eintrag mit beiden Namen statt zwei „gelöscht“; Namen wählen oder beide behalten", async ({ page }) => {
  const g = await start(page, umbenanntDaten(), {});
  await expect(page.locator('[data-st="sync"]')).toContainText("Konflikt in 1 Notiz");
  await oeffne(page);
  await expect(item(page, 0)).toContainText("Umbenannt: Kickoff-mac und Kickoff-iphone");
  await expect(page.locator(".k-kopf h1")).toContainText("Auf beiden Geräten umbenannt");
  await expect(page.locator(".k-erkl")).toContainText("„Kickoff-mac“, auf iPhone „Kickoff-iphone“");
  await expect(page.locator('.k-akt [data-a="meine"]')).toContainText("Diesen Namen behalten");
  await expect(page.locator('.k-akt [data-a="andere"]')).toContainText("Anderen Namen nehmen");
  await expect(page.locator('.k-akt [data-a="beide"]')).toContainText("Beide behalten");
  await page.locator('.k-akt [data-a="beide"]').hover();
  await expect(page.locator("#k-folge")).toContainText("unter beiden Namen: „Kickoff-mac“ und „Kickoff-iphone“");
  await page.keyboard.press("2");
  await expect(item(page, 0)).toContainText("Name von iPhone");
  await page.keyboard.press("Meta+Enter");
  await expect(page.locator("[data-konflikt-fertig]")).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".k-zus")).toContainText("Die Notiz heißt „Kickoff-iphone“.");
  expect(g.loesen[0].auswahl).toEqual([{ pfad: "10_notizen/Kickoff-mac.md", wahl: "andere" }]);
});

test("Zusammenführung, die Kortex nicht begonnen hat: nur ansehen — Hinweis, Entscheidungen und Abschluss gesperrt", async ({ page }) => {
  await start(page, { ...DATEN.standard(), fremd: true }, {});
  await oeffne(page);
  await expect(page.locator("[data-fremd]")).toContainText("nicht Kortex begonnen");
  await expect(page.locator('[data-aktion="konflikt-abgleichen"]')).toBeDisabled();
  await page.keyboard.press("1");
  await expect(item(page, 0)).toContainText("Offen");
  await page.keyboard.press("Meta+Enter");
  await expect(page.locator("[data-konflikt-sync]")).toHaveCount(0);
});

test("Der Konflikt hat sich geändert (409 „veraltet“): ruhiger Satz, die Ansicht wird neu geladen, nichts wird abgeschlossen", async ({ page }) => {
  const g = await start(page, DATEN.standard(), {});
  await page.route(/\/api\/git\/konflikt\/loesen$/, (r) => r.fulfill({ status: 409, json: { fehler: "Der Konflikt hat sich seit deiner Ansicht geändert. Öffne den Abgleich noch einmal.", art: "veraltet" } }));
  await oeffne(page);
  await entscheide(page, "1", "1");
  await page.keyboard.press("Meta+Enter");
  await expect(page.locator(".toast.fehler")).toContainText("Der Konflikt hat sich geändert");
  await expect.poll(() => g.abbrechen).toBe(1);
  await expect(page.locator("#konflikt .k-item")).toHaveCount(2); // neu geöffnet
  await expect(page.locator("[data-konflikt-fertig]")).toHaveCount(0);
});

test("Gemerkte Entscheidungen gelten nur, wo beide Fassungen noch dieselben sind (Blob-Kennung): geänderte Notizen sind wieder offen", async ({ page }) => {
  const daten = mitBlobs(DATEN.standard());
  await start(page, daten, {});
  await oeffne(page);
  await entscheide(page, "1", "2");
  await page.keyboard.press("Escape"); // Später
  await expect(page.locator("#konflikt")).toHaveCount(0);
  daten.dateien[1].andere.blob = "a-geaendert"; // die zweite Notiz wurde inzwischen auf dem anderen Gerät noch einmal geändert
  await page.locator('[data-aktion="konflikt-ansehen"]').click();
  await expect(item(page, 0)).toContainText("Dieser Mac behalten");
  await expect(item(page, 1)).toContainText("Offen");
  await expect(page.locator(".k-fuss")).toContainText("1 von 2 gelöst");
});

test("Selbst zusammenführen behält die Zeilenenden: CRLF bleibt CRLF, auch bei eigenem Text", async ({ page }) => {
  const crlf = (t) => t.replace(/\n/g, "\r\n");
  const d = DATEN.standard();
  d.dateien[0].meine.text = crlf(d.dateien[0].meine.text); d.dateien[0].andere.text = crlf(d.dateien[0].andere.text);
  const g = await start(page, d, {});
  await oeffne(page);
  await page.keyboard.press("4");
  await page.locator('[data-alle="meine"]').click();
  await page.locator('#k-b3 [data-w="eigen"]').click();
  await page.locator('[data-eigen="3"] textarea').fill("- Zeile eins\n- Zeile zwei");
  await page.locator(".k-erg-kopf").click();
  await page.locator('[data-k="uebernehmen"]').click();
  await expect(item(page, 0)).toContainText("Selbst zusammengeführt");
  await expect(item(page, 1)).toHaveAttribute("aria-current", "true");
  await page.keyboard.press("1");
  await page.keyboard.press("Meta+Enter");
  await expect(page.locator("[data-konflikt-fertig]")).toBeVisible({ timeout: 8000 });
  const t = g.loesen[0].auswahl[0].text;
  expect(t).toContain("\r\n- Zeile eins\r\n- Zeile zwei\r\n");
  expect(t.replace(/\r\n/g, "")).not.toContain("\n");
  expect(t.endsWith("\r\n")).toBe(true);
});

test("Später nennt, wo eine Sicherung von Hand Bearbeitetem liegt; scheitert das Zurücknehmen, steht der Satz (mit Pfad) im Fenster — nie still", async ({ page }) => {
  const g = await start(page, DATEN.standard(), {});
  await page.route(/\/api\/git\/konflikt\/abbrechen$/, (r) => { g.abbrechen++; r.fulfill({ json: { ok: true, offen: true, sicherung: { ordner: "/Vault/.git/brain-sicherung/2026-10-31T10-00-00-000Z", dateien: ["10_notizen/Zeitplan Q4.md"], blobs: [] } } }); });
  await oeffne(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".toast").last()).toContainText("Deine Bearbeitungen liegen gesichert in: /Vault/.git/brain-sicherung/2026-10-31T10-00-00-000Z");
  await page.route(/\/api\/git\/konflikt\/abbrechen$/, (r) => r.fulfill({ status: 409, json: { fehler: "Eine zusammengeführte Datei wurde seit dem Abgleich noch einmal geändert. Eine Kopie liegt gesichert in: /Vault/.git/brain-sicherung/x", art: "geaendert" } }));
  await page.locator('[data-aktion="konflikt-ansehen"]').click();
  await expect(item(page, 0)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".toast.fehler")).toContainText("Eine Kopie liegt gesichert in: /Vault/.git/brain-sicherung/x");
});

test("Dateien in einer offenen Zusammenführung sind im Editor schreibgeschützt (Konfliktmarken)", async ({ page }) => {
  const daten = DATEN.standard();
  daten.dateien[0].pfad = "10_notizen/Reise nach Lissabon.md";
  await page.setViewportSize({ width: 1440, height: 900 });
  await mocke(page, daten, {});
  await page.goto(server.url + "?pfad=" + encodeURIComponent("10_notizen/Reise nach Lissabon.md"));
  await expect(page.locator('[data-banner="schutz"]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('[data-banner="abgleich"]')).toBeVisible();
});

// ---------------------------------------------------------------- Ende zu Ende: echter Kern, zwei Klone, ein Remote (Temp)
function aufbauEchterKonflikt() {
  const { dir, vault: v } = baueVault();
  const handy = join(dir, "handy");
  git(dir, "clone", "-q", join(dir, "remote.git"), handy);
  const gAls = (cwd, mail, ...a) => execFileSync("git", a, { cwd, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "H", GIT_AUTHOR_EMAIL: mail, GIT_COMMITTER_NAME: "H", GIT_COMMITTER_EMAIL: mail } });
  const schreibe = (w, rel, t) => { mkdirSync(join(w, rel, ".."), { recursive: true }); writeFileSync(join(w, rel), t); };
  const MAIL = "nutzer@Fabios-iPhone.local";
  schreibe(handy, "10_notizen/Reise nach Lissabon.md", "# Reise nach Lissabon\n\nFlug im Juni.\nHotel in der Alfama. Mietwagen nicht nötig.\n");
  schreibe(handy, "10_notizen/crlf.md", "# CRLF-Datei\n\nvom Handy geändert\n");
  gAls(handy, MAIL, "add", "--", "."); gAls(handy, MAIL, "commit", "-q", "-m", "Handy");
  gAls(handy, MAIL, "push", "-q");
  schreibe(v, "10_notizen/Reise nach Lissabon.md", "# Reise nach Lissabon\n\nFlug im Mai.\nHotel in der Alfama. Mietwagen nicht nötig.\n");
  schreibe(v, "10_notizen/crlf.md", "# CRLF-Datei\n\nvom Mac geändert\n");
  git(v, "add", "--", "."); git(v, "commit", "-q", "-m", "Mac");
  return { dir, vault: v, handy, remote: join(dir, "remote.git") };
}
test("Ende zu Ende: Abgleichen öffnet die Ansicht mit echten Fassungen; entscheiden, abgleichen, Rückgängig — der Remote hat danach denselben Stand", async ({ page }) => {
  const e = aufbauEchterKonflikt();
  server?.stopp();
  server = await starteServer(e.vault);
  await bestaetige(e.vault, e.remote, server.support);
  page.on("response", async (r) => { if (r.status() >= 400) console.log("ANTWORT", r.status(), r.url(), (await r.text().catch(() => "")).slice(0, 300)); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(server.url);
  await page.waitForSelector('[data-st="sync"]');
  // das Nachsehen beim Start hält kurz die Sperre im Prozess (409 „läuft schon“): dann noch einmal klicken
  await expect(async () => { if (!(await page.locator("#konflikt .k-item").count())) await page.locator('[data-st="sync"]').click(); await expect(page.locator("#konflikt .k-item")).toHaveCount(2, { timeout: 4000 }); }).toPass({ timeout: 60000 });
  await expect(page.locator('[data-st="sync"]')).toContainText("Konflikt in 2 Notizen");
  await expect(item(page, 0)).toContainText("Dieser Mac und Fabios iPhone");
  await expect(page.locator(".k-dk:not(.l)").first()).toContainText("Fabios iPhone");
  await expect(page.locator(".k-diff mark.w").first()).toBeVisible();
  // Reise: beide behalten, CRLF-Datei: andere (der Reihe nach, je nach gewähltem Eintrag)
  for (let n = 0; n < 2; n++) {
    const pfad = await page.locator(".k-item[aria-current=true]").getAttribute("data-pfad");
    await page.keyboard.press(pfad.includes("Reise") ? "3" : "2");
    if (n === 0) await expect(page.locator(".k-item[aria-current=true]")).not.toHaveAttribute("data-pfad", pfad);
  }
  await expect(page.locator(".k-fuss")).toContainText("Alles gelöst");
  await page.keyboard.press("Meta+Enter");
  await expect(page.locator("[data-konflikt-fertig]")).toBeVisible({ timeout: 40000 });
  await expect(page.locator(".k-orte")).toContainText("Fabios iPhone");
  const kopf = git(e.vault, "rev-parse", "HEAD").toString().trim();
  expect(git(e.remote, "rev-parse", "refs/heads/main").toString().trim()).toBe(kopf);
  expect(existsSync(join(e.vault, "10_notizen/Reise nach Lissabon (Fabios iPhone).md"))).toBe(true);
  expect(readFileSync(join(e.vault, "10_notizen/crlf.md"), "utf8")).toContain("vom Handy geändert");
  expect(git(e.vault, "log", "-4", "--format=%s").toString()).toContain("Konflikt gelöst: ");
  expect(git(e.vault, "status", "--porcelain").toString().trim()).toBe("");
  await expect(page.locator('[data-st="sync"]')).not.toContainText("Konflikt");
  // Rückgängig
  await page.locator('[data-aktion="konflikt-rueckgaengig"]').click();
  await expect(page.locator("#konflikt .k-item")).toHaveCount(2, { timeout: 45000 });
  await expect(page.locator(".k-fuss")).toContainText("Alles gelöst");
  expect(existsSync(join(e.vault, "10_notizen/Reise nach Lissabon (Fabios iPhone).md"))).toBe(false);
  expect(readFileSync(join(e.vault, "10_notizen/crlf.md"), "utf8")).toContain("vom Mac geändert");
  // neu entscheiden: alles „diese“
  await page.keyboard.press("1"); await page.keyboard.press("ArrowDown"); await expect(item(page, 1)).toHaveAttribute("aria-current", "true"); await page.keyboard.press("1");
  await page.keyboard.press("Meta+Enter");
  await expect(page.locator("[data-konflikt-fertig]")).toBeVisible({ timeout: 40000 });
  expect(readFileSync(join(e.vault, "10_notizen/crlf.md"), "utf8")).toContain("vom Mac geändert");
  expect(git(e.remote, "rev-parse", "refs/heads/main").toString().trim()).toBe(git(e.vault, "rev-parse", "HEAD").toString().trim());
});

test("Ende zu Ende: „Später“ nimmt die Zusammenführung zurück — keine Konfliktmarken im Vault, der Konflikt bleibt in der Statusleiste", async ({ page }) => {
  const e = aufbauEchterKonflikt();
  server?.stopp();
  server = await starteServer(e.vault);
  await bestaetige(e.vault, e.remote, server.support);
  await page.goto(server.url);
  await page.waitForSelector('[data-st="sync"]');
  // das Nachsehen beim Start hält kurz die Sperre im Prozess (409 „läuft schon“): dann noch einmal klicken
  await expect(async () => { if (!(await page.locator("#konflikt .k-item").count())) await page.locator('[data-st="sync"]').click(); await expect(page.locator("#konflikt .k-item")).toHaveCount(2, { timeout: 4000 }); }).toPass({ timeout: 60000 });
  expect(existsSync(join(e.vault, ".git/MERGE_HEAD"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator("#konflikt")).toHaveCount(0);
  await expect.poll(() => existsSync(join(e.vault, ".git/MERGE_HEAD")), { timeout: 45000 }).toBe(false);
  expect(readFileSync(join(e.vault, "10_notizen/crlf.md"), "utf8")).not.toContain("<<<<<<<");
  await expect(page.locator('[data-st="sync"]')).toContainText("Konflikt in 2 Notizen", { timeout: 45000 });
});
