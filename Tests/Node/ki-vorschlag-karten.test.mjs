// Vorschlagskarten im Posteingang (K3): jede Art über den echten Weg (Journal, Rückgängig), Token 404/409, `ki: nein` nie im Paket, lokale Vorschläge ohne KI, „Für alle“ (höchstens 10, Abbruch stoppt sofort).
// Nie das echte `claude`: die Attrappe Tests/Kern/fake-claude-vorschlag.mjs (Szenario „arten“) prüft bei jedem Aufruf die Schutzgeländer.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pfad, schreibe } from "./hilfe.mjs";
import { szenarioV, EINTRAG, EINTRAG_TEXT, frei, bis, warte } from "./ki-vorschlag-hilfe.mjs";

const { beendeAlleProzesse } = await import(pfad("gemeinsam", "prozess.mjs"));
after(() => { beendeAlleProzesse(); });

const anwenden = (s, v, extra = {}) => s.api("POST", "/api/ki/vorschlag/anwenden", { id: v.id, token: v.token, ...extra });
const zurueck = (s, v) => s.api("POST", "/api/ki/vorschlag/zurueck", { id: v.id });
const lesen = (s, rel) => readFileSync(join(s.vault, rel), "utf8");
const eintraege = (s) => s.api("GET", "/api/aktivitaet?art=datei-aktion").then((l) => l.j.ereignisse.filter((x) => x.art === "datei-aktion"));
// Der Erwähnungs-Index baut im Hintergrund auf: warten, bis er den Eintrag kennt (sonst hängt Kortex den Link an, statt die Stelle zu verlinken)
async function warmeIndex(s, rel = EINTRAG, text = EINTRAG_TEXT) {
  await bis(async () => { const r = await s.api("POST", "/api/erwaehnungen/aus", { pfad: rel, text }); return r.status === 200 && r.j.aufbau && r.j.aufbau.index && r.j.aufbau.namen; }, 15000, "Erwähnungs-Index");
}
async function arten(s, liste, extra = {}, eingabe = { funktion: "posteingang", pfad: EINTRAG }) {
  s.szen({ szenario: "arten", arten: liste, ...extra });
  const { stand } = await s.anfrage(eingabe);
  assert.equal(stand.ergebnis.ok, true, JSON.stringify(stand.ergebnis));
  return stand.ergebnis.vorschlaege;
}
const ohneStelle = "# Plan\n\nTermine und Planung für das nächste Projekt besprechen.\n";

test("Verlinken mit Stelle: genau diese Stelle wird verlinkt (Erwähnungen-Weg mit Vorschau-Token), Journal, Protokolleintrag, Rückgängig stellt den Text her", async () => {
  const s = szenarioV();
  await warmeIndex(s);
  const [vs] = await arten(s, ["verlinken"], { kandidatTitel: "Atlas" });
  assert.equal(vs.beschriftung, "Verlinkt mit „Atlas“", "die Stelle im Text ist gefunden");
  assert.equal(vs.quelle, "ki"); assert.deepEqual(vs.ziel, { art: "notiz", pfad: "10_projekte/Atlas.md", titel: "Atlas" });
  assert.equal(vs.warum.treffer, vs.beleg.trim(), "der Beleg steht wörtlich im Eintrag (für „Warum?“ hervorgehoben)");
  assert.ok(vs.warum.nach.startsWith(" das Atlas"), JSON.stringify(vs.warum));
  const r = await anwenden(s, vs, { pfad: "/etc/passwd", ziel: "../x", art: "loeschen" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.art, "verlinken"); assert.ok(r.j.vorgang && r.j.aktivitaetId && r.j.rueckgaengig);
  const neu = lesen(s, EINTRAG);
  assert.match(neu, /das \[\[Atlas\]\] Projekt/, "die Stelle im Satz ist verlinkt");
  assert.equal(neu.replace("[[Atlas]]", "Atlas"), EINTRAG_TEXT, "sonst nichts geändert");
  const e = (await eintraege(s)).filter((x) => x.rueckgaengigMoeglich);
  assert.equal(e.length, 1, JSON.stringify(e));
  assert.ok(!JSON.stringify(e).includes("Test: Begründung"), "kein KI-Text im Protokoll");
  assert.equal((await s.api("POST", "/api/aktivitaet/rueckgaengig", { id: e[0].id })).status, 200);
  assert.equal(lesen(s, EINTRAG), EINTRAG_TEXT);
  assert.equal((await anwenden(s, vs)).status, 404, "nach der Übernahme ist der Vorschlag verbraucht");
});

test("Verlinken ohne Stelle im Text: Kortex hängt „Siehe auch: [[…]]“ an (ein Journal-Eintrag, Rückgängig), Beschriftung sagt es vorher", async () => {
  const s = szenarioV();
  schreibe(s.vault, "00_inbox/Plan.md", ohneStelle);
  await warmeIndex(s, "00_inbox/Plan.md", ohneStelle);
  const [vs] = await arten(s, ["verlinken"], { kandidatTitel: "Atlas", beleg: "Termine und Planung" }, { funktion: "posteingang", pfad: "00_inbox/Plan.md" });
  assert.equal(vs.beschriftung, "Hängt einen Link auf „Atlas“ an den Eintrag");
  const r = await anwenden(s, vs);
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(lesen(s, "00_inbox/Plan.md"), `${ohneStelle}\nSiehe auch: [[Atlas]]\n`);
  const z = await zurueck(s, vs);
  assert.equal(z.status, 200, JSON.stringify(z.j));
  assert.equal(lesen(s, "00_inbox/Plan.md"), ohneStelle, "Rückgängig über das Journal");
  assert.equal((await zurueck(s, vs)).status, 409, "nur einmal");
});

test("Tags: im Kopf ergänzt (Kopf neu oder erweitert), Journal, Rückgängig; vorhandene Tags nie doppelt; ein nicht lesbarer Kopf ändert nichts", async () => {
  const s = szenarioV();
  const [vs] = await arten(s, ["tags"], { tags: ["atlas", "Neu-Test", "atlas"] });
  assert.deepEqual(vs.tags, ["atlas", "Neu-Test"], "Duplikate der KI fallen weg");
  assert.equal(vs.beschriftung, "Setzt die Tags #atlas, #Neu-Test");
  const r = await anwenden(s, vs);
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(lesen(s, EINTRAG), `---\ntags: [atlas, Neu-Test]\n---\n${EINTRAG_TEXT}`);
  const e = (await eintraege(s)).filter((x) => x.rueckgaengigMoeglich);
  assert.equal(e.length, 1); assert.equal(e[0].text, "KI-Vorschlag übernommen: Tags gesetzt", "nie die Tag-Namen der KI im Protokoll");
  assert.equal((await s.api("POST", "/api/aktivitaet/rueckgaengig", { id: e[0].id })).status, 200);
  assert.equal(lesen(s, EINTRAG), EINTRAG_TEXT);
  // erweitert einen vorhandenen Kopf, ohne Vorhandenes zu verdoppeln; Zeilenenden bleiben
  const crlf = "---\r\ntitel: x\r\ntags: [atlas]\r\n---\r\n# Atlas Idee\r\n\r\nWir sollten das Atlas Projekt besprechen. #kaffee\r\n";
  writeFileSync(join(s.vault, EINTRAG), crlf);
  const [v2] = await arten(s, ["tags"], { tags: ["atlas", "kaffee", "neu-test"], beleg: "Atlas Projekt besprechen" });
  assert.equal((await anwenden(s, v2)).status, 200);
  assert.equal(lesen(s, EINTRAG), crlf.replace("tags: [atlas]", "tags: [atlas, neu-test]"));
  // nur schon vorhandene Tags: nichts zu tun, nichts geschrieben
  const [v3] = await arten(s, ["tags"], { tags: ["atlas", "kaffee"], beleg: "Atlas Projekt besprechen" });
  const vorher = s.abbild(s.vault);
  const r3 = await anwenden(s, v3);
  assert.equal(r3.status, 409); assert.equal(r3.j.art, "nichts-zu-tun");
  assert.deepEqual(s.abbild(s.vault), vorher);
  // ein offener, nie geschlossener Kopf wird nicht „repariert“
  writeFileSync(join(s.vault, EINTRAG), "---\ntitel: x\n# Atlas Idee\n\nWir sollten das Atlas Projekt besprechen.\n");
  const [v4] = await arten(s, ["tags"], { tags: ["x-tag"], beleg: "Atlas Projekt besprechen" });
  const vorher4 = s.abbild(s.vault);
  const r4 = await anwenden(s, v4);
  assert.equal(r4.status, 422); assert.equal(r4.j.art, "kopf");
  assert.deepEqual(s.abbild(s.vault), vorher4);
});

test("Duplikat: „Als Duplikat ablegen“ geht über den Posteingang (Archiv, nichts gelöscht), Protokolleintrag ohne Inhalt, Rückgängig legt den Eintrag zurück", async () => {
  const s = szenarioV();
  const [vs] = await arten(s, ["duplikat"], { kandidatTitel: "Atlas", beleg: "Atlas Projekt" });
  assert.equal(vs.beschriftung, "Legt den Eintrag als Duplikat von „Atlas“ ab");
  const r = await anwenden(s, vs);
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.match(r.j.archiv, /^90_archiv\/verworfen\/Atlas-Idee\.md$/);
  assert.equal(existsSync(join(s.vault, EINTRAG)), false);
  assert.equal(lesen(s, r.j.archiv), EINTRAG_TEXT, "unverändert im Archiv");
  const e = await eintraege(s);
  assert.ok(e.some((x) => x.text === "KI-Vorschlag übernommen: als Duplikat abgelegt"), JSON.stringify(e));
  const z = await zurueck(s, vs);
  assert.equal(z.status, 200, JSON.stringify(z.j));
  assert.equal(lesen(s, EINTRAG), EINTRAG_TEXT);
  assert.equal(existsSync(join(s.vault, r.j.archiv)), false);
});

test("Aufgabe: über die Aufgaben-API (Quelle „mensch“); Rückgängig legt sie in den Papierkorb (wiederherstellbar), nichts anderes wird gelöscht", async () => {
  const s = szenarioV();
  const [vs] = await arten(s, ["aufgabe"]);
  assert.deepEqual(vs.aufgabe, { text: "Angebot schicken", faellig: "2026-11-14" });
  const r = await anwenden(s, vs);
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.rueckgaengig, true);
  assert.match(lesen(s, r.j.pfad), /Angebot schicken/);
  const z = await zurueck(s, vs);
  assert.equal(z.status, 200, JSON.stringify(z.j));
  assert.equal(existsSync(join(s.vault, r.j.pfad)), false, "die Aufgabe ist weg …");
  const korb = await s.api("GET", "/api/papierkorb");
  assert.equal(korb.status, 200); assert.ok(JSON.stringify(korb.j).includes("Angebot"), "… liegt aber im Papierkorb");
  assert.equal(existsSync(join(s.vault, EINTRAG)), true, "der Eintrag bleibt");
});

test("Verschieben: Journal, Rückgängig über „zurueck“ und über das Protokoll", async () => {
  const s = szenarioV();
  const [vs] = await arten(s, ["verschieben"], { ordnerName: "10_projekte" });
  assert.equal(vs.beschriftung, "Verschiebt nach „10_projekte“");
  const r = await anwenden(s, vs);
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.nach, "10_projekte/Atlas-Idee.md");
  assert.equal((await zurueck(s, vs)).status, 200);
  assert.equal(lesen(s, EINTRAG), EINTRAG_TEXT); assert.equal(existsSync(join(s.vault, "10_projekte/Atlas-Idee.md")), false);
});

test("Token: fremder Vault 404, geänderter Eintrag 409 (für jede Art nichts geschrieben), falsches Token 403, Zusatzfelder ändern nichts", async () => {
  const s = szenarioV();
  const alle = await arten(s, ["tags", "duplikat", "aufgabe"], { kandidatTitel: "Atlas", beleg: "Atlas Projekt" });
  const mehr = await arten(s, ["verlinken", "verschieben"], { kandidatTitel: "Atlas", ordnerName: "10_projekte", beleg: "Atlas Projekt" });
  const liste = [...alle, ...mehr];
  assert.deepEqual(liste.map((x) => x.art).sort(), ["aufgabe", "duplikat", "tags", "verlinken", "verschieben"]);
  assert.equal((await s.api("POST", "/api/ki/vorschlag/anwenden", { id: liste[0].id, token: "0".repeat(64) })).status, 403);
  writeFileSync(join(s.vault, EINTRAG), EINTRAG_TEXT + "\nEine Zeile mehr.\n");
  const vorher = s.abbild(s.vault);
  for (const v of liste) {
    const r = await anwenden(s, v);
    assert.equal(r.status, 409, `${v.art}: ${JSON.stringify(r.j)}`); assert.equal(r.j.art, "veraltet");
  }
  assert.deepEqual(s.abbild(s.vault), vorher, "nichts wurde geschrieben");
  // Ziel verändert: auch das ist veraltet
  writeFileSync(join(s.vault, EINTRAG), EINTRAG_TEXT);
  const [vl] = await arten(s, ["verlinken"], { kandidatTitel: "Atlas" });
  writeFileSync(join(s.vault, "10_projekte/Atlas.md"), "# Atlas\n\nGeändert.\n");
  assert.equal((await anwenden(s, vl)).status, 409);
  // Vault-Wechsel: alles verworfen, nichts bekannt
  writeFileSync(join(s.vault, "10_projekte/Atlas.md"), "# Atlas\n\nProjekt Atlas, Planung und Termine.\n");
  const [vf] = await arten(s, ["tags"]);
  assert.equal((await s.api("POST", "/api/vaults/aktiv", { pfad: s.anderer })).status, 200);
  assert.equal((await anwenden(s, vf)).status, 404, "im fremden Vault ist der Vorschlag unbekannt");
  assert.equal((await zurueck(s, vf)).status, 404);
  assert.equal((await s.api("POST", "/api/vaults/aktiv", { pfad: s.vault })).status, 200);
  assert.equal((await anwenden(s, vf)).status, 404, "auch zurück im alten Vault ist er verworfen");
  assert.equal(lesen(s, EINTRAG), EINTRAG_TEXT);
});

test("Nach einer Änderung des Eintrags durch Kortex bleiben die anderen Vorschläge gültig (neue Token); ein zweiter Klick auf denselben Vorschlag geht nicht", async () => {
  const s = szenarioV();
  await warmeIndex(s);
  const [t, vl] = await arten(s, ["tags", "verlinken"], { kandidatTitel: "Atlas", beleg: "Atlas Projekt" });
  const r = await anwenden(s, t);
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.geschwister.length, 1); assert.equal(r.j.geschwister[0].id, vl.id);
  assert.notEqual(r.j.geschwister[0].token, vl.token, "neuer Token zum neuen Inhalts-Hash");
  assert.equal((await anwenden(s, vl)).status, 403, "der alte Token gilt nicht mehr");
  const r2 = await anwenden(s, { id: vl.id, token: r.j.geschwister[0].token });
  assert.equal(r2.status, 200, JSON.stringify(r2.j));
  const text = lesen(s, EINTRAG);
  assert.match(text, /^---\ntags: \[atlas, neu-test\]\n---\n/); assert.match(text, /\[\[Atlas\]\]/);
  assert.equal(s.aufrufe().length, 1, "eine Anfrage, mehr nicht: die Übernahmen rufen keine KI");
});

test("`ki: nein`: nie als Kandidat, nie Titel, Ordner oder Tag im Paket (auch nicht als Zahl); ein Eintrag mit `ki: nein` geht nie hinaus", async () => {
  const s = szenarioV();
  schreibe(s.vault, "30_nurgeheim/Streng.md", "---\nki: nein\ntags: [geheimtag]\n---\n# Atlas Kaffeemaschine Rechnung Streng\n\nAtlas Kaffeemaschine Rechnung GEHEIMER-INHALT.\n");
  schreibe(s.vault, "40_offen/Atlas offen.md", "---\ntags: [offentag, atlas]\n---\n# Atlas offen\n\nAtlas Kaffeemaschine ist offen.\n");
  await arten(s, ["verlinken"]);
  const a = s.aufrufe().at(-1);
  const paket = JSON.parse(a.stdin);
  const roh = a.stdin;
  for (const verboten of ["geheimtag", "30_nurgeheim", "Streng", "GEHEIMER-INHALT", "GEHEIMER", "Geheim.md"]) assert.ok(!roh.includes(verboten), `„${verboten}“ darf nie im Paket stehen`);
  assert.ok(paket.daten.tags.includes("offentag") && paket.daten.tags.includes("atlas"), `Tags ähnlicher Notizen kommen vor: ${JSON.stringify(paket.daten.tags)}`);
  assert.ok(paket.daten.ordner.some((o) => o.name === "40_offen"), "Ordner mit offenen Notizen kommen vor");
  assert.ok(paket.daten.tags.length <= 40);
  // Eintrag mit „ki: nein“
  const r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: "00_inbox/Nein.md", konto: "k_aaaaaaaa" });
  assert.equal(r.status, 409); assert.equal(r.j.art, "ki-nein");
  assert.equal(s.aufrufe().length, 1);
});

test("Lokale Vorschläge ohne KI: gleicher Titel → Duplikat, Titel im Text → Verlinken, Tag = Ordnername → Verschieben; ohne Konto und ohne Einwilligung; kein Aufruf; Übernahme geht", async () => {
  const s = szenarioV({ stufeA: "gesperrt", einwilligung: false });
  schreibe(s.vault, "10_projekte/Atlas Idee.md", "# Atlas Idee\n\nDie ältere Fassung.\n");
  schreibe(s.vault, "00_inbox/Mit-Tag.md", "# Rechnung\n\nSiehe #20_finanzen und Kaffeemaschine.\n");
  await warmeIndex(s);
  const r = await s.api("POST", "/api/ki/vorschlag/lokal", { pfade: [EINTRAG, "00_inbox/Mit-Tag.md", "00_inbox/gibt-es-nicht.md", "10_projekte/Atlas.md"] });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const a = r.j.eintraege[EINTRAG];
  assert.ok(a.some((x) => x.art === "duplikat" && x.ziel.pfad === "10_projekte/Atlas Idee.md" && x.quelle === "lokal"), JSON.stringify(a));
  assert.ok(a.some((x) => x.art === "verlinken" && x.ziel.pfad === "10_projekte/Atlas.md" && x.sicherheit === "hoch"), JSON.stringify(a));
  assert.ok(a.length <= 3);
  const b = r.j.eintraege["00_inbox/Mit-Tag.md"];
  assert.ok(b.some((x) => x.art === "verschieben" && x.beschriftung === "Verschiebt nach „20_finanzen“"), JSON.stringify(b));
  assert.equal(r.j.eintraege["00_inbox/gibt-es-nicht.md"], undefined); assert.equal(r.j.eintraege["10_projekte/Atlas.md"], undefined, "nur Einträge des Posteingangs");
  assert.deepEqual(s.aufrufe(), [], "kein KI-Aufruf");
  assert.equal((await s.api("POST", "/api/ki/vorschlag/lokal", { pfade: [] })).status, 400);
  assert.equal((await s.api("POST", "/api/ki/vorschlag/lokal", { pfade: Array.from({ length: 41 }, (_, i) => `00_inbox/${i}.md`) })).status, 400);
  // ein zweiter Abruf ersetzt den ersten (keine Haufen alter Vorschläge); die Übernahme läuft ohne KI-Konto
  const r2 = await s.api("POST", "/api/ki/vorschlag/lokal", { pfade: [EINTRAG] });
  assert.equal((await anwenden(s, a[0])).status, 404, "der alte Stand ist ersetzt");
  const dup = r2.j.eintraege[EINTRAG].find((x) => x.art === "duplikat");
  const ok = await anwenden(s, dup);
  assert.equal(ok.status, 200, JSON.stringify(ok.j));
  assert.equal(existsSync(join(s.vault, EINTRAG)), false);
  assert.equal((await zurueck(s, dup)).status, 200);
  assert.equal(lesen(s, EINTRAG), EINTRAG_TEXT);
  assert.equal((await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: EINTRAG, konto: "k_aaaaaaaa" })).status, 409, "mit KI geht es ohne Einwilligung weiterhin nicht");
});

// ---------- „Für alle“ ----------
async function folgeStapel(s, id, { ms = 20000 } = {}) {
  let v = -1, st;
  const ende = Date.now() + ms;
  while (Date.now() < ende) {
    const r = await s.api("GET", `/api/ki/vorschlag/stand?id=${id}&v=${v}`);
    assert.equal(r.status, 200, JSON.stringify(r.j));
    st = r.j; v = st.version;
    if (st.fertig) return st;
  }
  assert.fail("Stapel wird nicht fertig");
}
const viele = (s, n) => Array.from({ length: n }, (_, i) => { const p = `00_inbox/Viel-${String(i + 1).padStart(2, "0")}.md`; schreibe(s.vault, p, `# Viel ${i + 1}\n\nAtlas Projekt Nummer ${i + 1} mit der Kaffeemaschine.\n`); return p; });

test("Für alle: höchstens 10 Einträge (mehr → 400, kein Aufruf), nacheinander, `ki: nein` übersprungen und gezählt, Ergebnisse je Eintrag mit Token", async () => {
  const s = szenarioV();
  const pfade = viele(s, 11);
  s.szen({ szenario: "ok" });
  const zuviel = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfade, konto: "k_aaaaaaaa" });
  assert.equal(zuviel.status, 400); assert.equal(zuviel.j.art, "zu-viele"); assert.deepEqual(s.aufrufe(), []);
  const zehn = [...pfade.slice(0, 3), "00_inbox/Nein.md", ...pfade.slice(3, 10)].slice(0, 10);
  const r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfade: zehn, konto: "k_aaaaaaaa" });
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.stapel, true); assert.equal(r.j.von, 10);
  assert.equal((await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfad: pfade[10], konto: "k_aaaaaaaa" })).status, 409, "währenddessen keine zweite Anfrage");
  const st = await folgeStapel(s, r.j.id);
  assert.equal(st.abgebrochen, false); assert.equal(st.ausgenommen, 1);
  assert.equal(Object.keys(st.eintraege).length, 10);
  assert.equal(s.aufrufe().length, 9, "neun Aufrufe: der Eintrag mit „ki: nein“ ging nie hinaus");
  assert.equal(st.eintraege["00_inbox/Nein.md"].ausgenommen, true);
  for (const p of pfade.slice(0, 3)) { assert.equal(st.eintraege[p].ok, true); assert.ok(st.eintraege[p].vorschlaege[0].token); }
  assert.ok(!s.aufrufe().some((a) => a.stdin.includes("Dieser Eintrag geht nie an eine KI")), "Inhalt des `ki: nein`-Eintrags nie gesendet");
  // ein Vorschlag aus dem Stapel lässt sich übernehmen wie jeder andere
  const v = st.eintraege[pfade[0]].vorschlaege[0];
  assert.equal((await anwenden(s, v)).status, 200);
});

test("Für alle: Abbruch stoppt sofort (Prozess beendet, kein weiterer Start), Kontingent 100 % und fehlende Einwilligung scheitern vorher", async () => {
  const s = szenarioV();
  const pfade = viele(s, 4);
  s.szen({ szenario: "abbruch" });
  const r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfade, konto: "k_aaaaaaaa" });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  await bis(() => existsSync(join(s.bin, "wartet")), 10000, "der erste Lauf wartet");
  const pid = Number(readFileSync(join(s.bin, "wartet"), "utf8"));
  assert.equal((await s.api("POST", "/api/ki/vorschlag/abbrechen", { id: r.j.id })).status, 200);
  const st = await folgeStapel(s, r.j.id, { ms: 12000 });
  assert.equal(st.abgebrochen, true);
  await bis(() => frei(pid), 8000, "Prozess beendet");
  await warte(400);
  assert.equal(s.aufrufe().length, 1, "nach dem Abbruch startet nichts mehr");
  assert.equal(Object.keys(st.eintraege).length, 1);
  assert.equal(st.eintraege[pfade[0]].abgebrochen, true);
  // danach läuft wieder eine Anfrage
  s.szen({ szenario: "ok" });
  const n = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfade: pfade.slice(0, 2), konto: "k_aaaaaaaa" });
  assert.equal(n.status, 200, JSON.stringify(n.j));
  assert.equal((await folgeStapel(s, n.j.id)).erledigt, 2);
  // Kontingent erschöpft: kein Start
  const jetzt = Date.now();
  const k = szenarioV({ kontingent: () => ({ status: "ok", session: { usedPercent: 100, resetsAt: jetzt + 3_600_000 }, weekly: null }) });
  const p2 = viele(k, 2);
  const kr = await k.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfade: p2, konto: "k_aaaaaaaa" });
  assert.equal(kr.status, 409); assert.equal(kr.j.art, "kontingent"); assert.deepEqual(k.aufrufe(), []);
  const ohne = szenarioV({ einwilligung: false });
  const p3 = viele(ohne, 2);
  const er = await ohne.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfade: p3, konto: "k_aaaaaaaa" });
  assert.equal(er.status, 409); assert.equal(er.j.art, "einwilligung"); assert.deepEqual(ohne.aufrufe(), []);
});

test("Für alle: Vault-Wechsel beendet den Stapel und verwirft alles; ein Fehler der Verbindung hält ihn an (nicht neun Mal scheitern)", async () => {
  const s = szenarioV();
  const pfade = viele(s, 4);
  s.szen({ szenario: "offline" });
  const r = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfade, konto: "k_aaaaaaaa" });
  const st = await folgeStapel(s, r.j.id);
  assert.equal(s.aufrufe().length, 1, "offline: nach dem ersten Fehler Schluss");
  assert.match(st.gestoppt, /Keine Verbindung/);
  s.szen({ szenario: "abbruch" });
  const r2 = await s.api("POST", "/api/ki/vorschlag/start", { funktion: "posteingang", pfade, konto: "k_aaaaaaaa" });
  await bis(() => existsSync(join(s.bin, "wartet")), 10000, "Lauf wartet");
  assert.equal((await s.api("POST", "/api/vaults/aktiv", { pfad: s.anderer })).status, 200);
  const pid = Number(readFileSync(join(s.bin, "wartet"), "utf8"));
  await bis(() => frei(pid), 10000, "Prozess beendet");
  assert.equal((await s.api("GET", `/api/ki/vorschlag/stand?id=${r2.j.id}`)).status, 404, "im anderen Vault ist der Stapel unbekannt");
  assert.equal(readdirSync(join(s.vault, "00_inbox")).length >= 4, true);
});
