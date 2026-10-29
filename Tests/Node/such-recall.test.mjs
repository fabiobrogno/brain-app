// Qualitätssicherung Token-Paket 1: Recall@5 von brain_suchen, alt (jedes Wort muss als Teilstring vorkommen) gegen neu (Rangfolge wie die
// CLI-Suche). Lokal, ohne KI-Aufrufe. Zwei Fragensätze: (1) die gebündelten Messfragen kit/vorlage-eval.json gegen die Kern-Fixture,
// (2) ein kleines Korpus mit Stichwort-, Satz- und Titelfragen. Neu darf nie schlechter sein als alt.
//
// Eigener Vault zum Nachmessen (nur lesend): KORTEX_RECALL_VAULT=<Vault> KORTEX_RECALL_EVAL=<hint-eval.json oder _messlatte.json> node --test Tests/Node/such-recall.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, cpSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { tmp, schreibe, pfad, WURZEL } from "./hilfe.mjs";

const { oeffneVault } = await import(pfad("gemeinsam", "vault.mjs"));
const K = 5;

// → { alt, neu, n } Zahl der Fragen, bei denen eine erwartete Seite unter den ersten K Treffern steht
export async function recall(v, fragen) {
  let alt = 0, neu = 0;
  for (const f of fragen) {
    const erwartet = f.erwartet.map((p) => basename(p));
    const trifft = (liste) => liste.slice(0, K).some((t) => erwartet.includes(basename(t.pfad)));
    if (trifft(v.suche(f.prompt).treffer)) alt++;
    if (trifft((await v.suchenFuerKi(f.prompt, K)).treffer)) neu++;
  }
  return { alt, neu, n: fragen.length };
}
const positiv = (datei) => (JSON.parse(readFileSync(datei, "utf8")).positiv || []).filter((c) => c && typeof c.prompt === "string" && Array.isArray(c.erwartet));

test("Recall@5 mit den gebündelten Messfragen (kit/vorlage-eval.json) auf der Kern-Fixture: neu ≥ alt", async () => {
  const d = tmp();
  cpSync(join(WURZEL, "..", "Tests", "Kern", "fixture"), d, { recursive: true });
  const fragen = positiv(join(WURZEL, "kern", "kit", "vorlage-eval.json"));
  assert.ok(fragen.length >= 6);
  const r = await recall(oeffneVault(d), fragen);
  console.log(`# Recall@${K} vorlage-eval: alt ${r.alt}/${r.n}, neu ${r.neu}/${r.n}`);
  assert.ok(r.neu >= r.alt, `neu ${r.neu} < alt ${r.alt}`);
  assert.ok(r.neu >= r.n - 1, `neu ${r.neu}/${r.n}`);
});

const SEITEN = {
  "09_wiki/firma/amazon/thema_retouren.md": ["Amazon Retouren", "Retouren werden im Seller Central geprüft. Der Kunde bekommt die Erstattung nach Wareneingang. Defekte Ware geht an den Lieferanten zurück."],
  "09_wiki/firma/amazon/thema_gebuehren.md": ["Amazon Gebühren", "Die Verkaufsgebühr liegt je nach Kategorie bei acht bis fünfzehn Prozent. Die Versandgebühr hängt vom Gewicht ab."],
  "09_wiki/firma/shop/thema_versand.md": ["Versand im Shop", "Pakete gehen mit DHL raus. Ab fünfzig Euro Bestellwert ist der Versand frei. Abholung im Lager ist möglich."],
  "09_wiki/firma/shop/thema_mahnwesen.md": ["Mahnwesen", "Die erste Mahnung folgt vierzehn Tage nach Fälligkeit. Danach kommt eine zweite Mahnung mit Gebühr, zuletzt das Inkasso."],
  "09_wiki/firma/erp/thema_lagerbestand.md": ["Lagerbestand im ERP", "Der Lagerbestand wird nachts aus dem ERP in den Shop übertragen. Abweichungen meldet der Abgleich per Mail."],
  "09_wiki/themen/thema_tageslauf.md": ["Tageslauf", "Nachts läuft die Pflege im Tageslauf: erst die Inbox sichten, dann veraltete Seiten prüfen und zuletzt den Bericht schreiben."],
  "09_wiki/themen/thema_backup.md": ["Sicherung", "Das Backup des Vaults läuft täglich als Git-Commit auf den Server. Wiederherstellen geht über den Verlauf einer Datei."],
  "09_wiki/themen/thema_inbox.md": ["Inbox und Ingest", "Neue Notizen landen in der Inbox. Der Ingest macht daraus Wissen im Wiki und räumt die Inbox danach auf."],
  "09_wiki/themen/thema_sicherheit.md": ["Sicherheit und Secrets", "Passwörter und Tokens gehören nie in den Vault. Der Commit-Schutz prüft auf Secrets und blockt den Commit."],
  "09_wiki/projekte/projekt_kortex.md": ["Kortex", "Kortex ist die Mac-App für das Gedächtnis der KI. Sie verbindet Vault, Hinweise und MCP-Werkzeuge."],
  "09_wiki/projekte/projekt_garten.md": ["Gartenplanung", "Im Frühjahr werden Tomaten vorgezogen. Die Beete bekommen im April Kompost."],
  "09_wiki/themen/thema_steuer.md": ["Steuererklärung", "Belege für die Steuererklärung sammelt die Buchhaltung bis Ende Mai. Umsatzsteuer wird quartalsweise gemeldet."],
};
const FRAGEN = [
  // Stichworte
  ["Retouren", "thema_retouren.md"], ["Mahnung Gebühr", "thema_mahnwesen.md"], ["Backup", "thema_backup.md"], ["Secrets", "thema_sicherheit.md"], ["Tomaten", "projekt_garten.md"],
  // ganze Sätze (früher: jedes Wort muss vorkommen → keine Treffer)
  ["Wie läuft die Pflege im Tageslauf ab?", "thema_tageslauf.md"], ["Was passiert mit Retouren bei Amazon?", "thema_retouren.md"], ["Wann wird der Versand im Shop kostenlos?", "thema_versand.md"],
  ["Wie kommt der Lagerbestand aus dem ERP in den Shop?", "thema_lagerbestand.md"], ["Was macht der Ingest mit der Inbox?", "thema_inbox.md"], ["Wann kommt die zweite Mahnung?", "thema_mahnwesen.md"],
  ["Wie stelle ich eine Datei aus dem Backup wieder her?", "thema_backup.md"], ["Was kostet mich die Verkaufsgebühr bei Amazon?", "thema_gebuehren.md"], ["Was ist Kortex eigentlich?", "projekt_kortex.md"],
  ["Bis wann sammelt die Buchhaltung die Belege für die Steuer?", "thema_steuer.md"],
  // Titel
  ["Amazon Gebühren", "thema_gebuehren.md"], ["Versand im Shop", "thema_versand.md"], ["Lagerbestand im ERP", "thema_lagerbestand.md"],
].map(([prompt, datei]) => ({ prompt, erwartet: [datei] }));

test("Recall@5 auf einem kleinen Korpus (Stichworte, ganze Sätze, Titel): neu ≥ alt und mindestens 90 %", async () => {
  const d = tmp();
  for (const [rel, [titel, text]] of Object.entries(SEITEN)) schreibe(d, rel, `---\nname: ${titel}\ntyp: thema\n---\n\n# ${titel}\n\n${text}\n`);
  const r = await recall(oeffneVault(d), FRAGEN);
  console.log(`# Recall@${K} Korpus: alt ${r.alt}/${r.n}, neu ${r.neu}/${r.n}`);
  assert.ok(r.neu >= r.alt, `neu ${r.neu} < alt ${r.alt}`);
  assert.ok(r.neu >= Math.ceil(r.n * 0.9), `neu ${r.neu}/${r.n}`);
  assert.ok(r.neu > r.alt, "die ganzen Sätze finden jetzt etwas, was vorher leer blieb");
});

test("Negativ: Fragen ohne passende Seite liefern nicht mehr Treffer als vorher auf Unsinn-Wörter (Wörter ohne Vorkommen → leer)", async () => {
  const d = tmp();
  for (const [rel, [titel, text]] of Object.entries(SEITEN)) schreibe(d, rel, `---\nname: ${titel}\ntyp: thema\n---\n\n# ${titel}\n\n${text}\n`);
  const v = oeffneVault(d);
  for (const f of ["zzzqqq xyzzy", "Quokka Zeppelin Kuckucksuhr", "!!! ???"]) {
    assert.equal((await v.suchenFuerKi(f, K)).treffer.length, 0, f);
    assert.equal(v.suche(f).treffer.length, 0, f);
  }
});

const EIGENER_VAULT = process.env.KORTEX_RECALL_VAULT, EIGENE_FRAGEN = process.env.KORTEX_RECALL_EVAL;
test("Recall@5 im eigenen Vault (nur wenn KORTEX_RECALL_VAULT und KORTEX_RECALL_EVAL gesetzt sind; nur lesend)", { skip: !(EIGENER_VAULT && EIGENE_FRAGEN && existsSync(EIGENER_VAULT)) }, async () => {
  const r = await recall(oeffneVault(EIGENER_VAULT), positiv(EIGENE_FRAGEN));
  console.log(`# Recall@${K} eigener Vault: alt ${r.alt}/${r.n}, neu ${r.neu}/${r.n}`);
  assert.ok(r.neu >= r.alt, `neu ${r.neu} < alt ${r.alt}`);
});
