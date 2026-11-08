// Tags (gemeinsam/tags.mjs): Parser mit Grenzfällen, Zählung, Umbenennen im ganzen Vault mit Rückgängig (ein Vorgang), Werkstatt-Routen und MCP-Werkzeug brain_tags.
// Nur Wegwerf-Ordner (tmp), nie ein echter Vault.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, pfad } from "./hilfe.mjs";

const T = await import(pfad("gemeinsam", "tags.mjs"));
const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
const { bearbeite, WERKZEUGE } = await import(pfad("mcp", "brain-mcp.mjs"));
const A = await import(pfad("gemeinsam", "aktivitaet.mjs"));
process.env.BRAIN_NUTZUNG = "aus";

// ───────────── Parser ─────────────
test("Parser: Inline-Tags, verschachtelt, Unicode, Reihenfolge, Groß/klein zählt als ein Tag", () => {
  assert.deepEqual(T.extrahiereTags("Text #eins und #projekt/atlas, (#Zwei) #Übung #eins #EINS\n#am-anfang."), ["eins", "projekt/atlas", "Zwei", "Übung", "am-anfang"]);
});
test("Parser: kein Tag in Überschriften, Code, Zäunen, Links, URLs, Wikilinks, HTML, Kommentaren, maskiert, nur Ziffern", () => {
  const t = [
    "# Titel #nicht", "## Auch #nicht", "###### Sechs #nicht",
    "Seite#abschnitt a#b &#39; https://x.de/#frag www.x.de/#teil [l](u#nein) [[Seite#abs]] [[Seite|#alias]]",
    "`#code` ``#doppel`` \\#maskiert #123 #2024", "<span id=\"#x\">#html</span> <!-- #kommentar --> ", "<!-- #mehr", "#kommentar2 -->",
    "```", "#zaun", "```", "~~~md", "#tilde", "~~~", "echt #ja",
  ].join("\n");
  assert.deepEqual(T.extrahiereTags(t), ["ja"]);
});
test("Parser: #2024-plan ist ein Tag, #123 und #1/2 nicht; Zeichen _ und - ja, leere Teile nein", () => {
  assert.deepEqual(T.extrahiereTags("#2024-plan #123 #1/2 #a_b #a-b #a//b #a/ #/b"), ["2024-plan", "a_b", "a-b", "a"]);
});
test("Parser: Zaun bleibt offen bis zum passenden Ende (längerer Zaun, anderes Zeichen)", () => {
  assert.deepEqual(T.extrahiereTags("````\n```\n#drin\n```\n````\n#draussen\n```js\n~~~\n#drin2\n```\n#wieder"), ["draussen", "wieder"]);
});
test("Parser: Front-Matter als Liste, Blockliste, Text, Schlüsselvarianten, # und Anführungszeichen, Kommentar", () => {
  const t = "---\ntitle: X #nein\ntags: [Alpha, \"projekt/atlas\", #beta]\nkeywords:\n  - gamma\n  - \"#delta/eps\"\nschlagworte: eins, zwei drei # kommentar\ntag: solo\nbeschreibung: nicht #dies\n---\n#koerper";
  assert.deepEqual(T.extrahiereTags(t), ["Alpha", "projekt/atlas", "beta", "gamma", "delta/eps", "eins", "zwei", "drei", "solo", "koerper"]);
});
test("Parser: mehrzeilige Inline-Liste im Kopf, BOM, CRLF, kein Kopf wenn --- nicht schließt", () => {
  assert.deepEqual(T.extrahiereTags("﻿---\r\ntags: [a,\r\n  b, c]\r\n---\r\ntext #d\r\n"), ["a", "b", "c", "d"]);
  assert.deepEqual(T.extrahiereTags("---\ntags: [a]\nohne ende #x"), ["x"]);
});
test("Parser: pruefeTagName und Zählung mit Eltern, Schreibweisen, Notizen ohne Tags", () => {
  assert.equal(T.pruefeTagName(" #Projekt/Atlas "), "Projekt/Atlas");
  for (const schlecht of ["", "123", "a b", "a//b", "a/", "x".repeat(101), 5, null, "a#b", "a.b"]) assert.equal(T.pruefeTagName(schlecht), null, String(schlecht));
  const z = T.zaehleTags([
    { pfad: "1", tags: ["projekt/atlas", "Wichtig"] }, { pfad: "2", tags: ["Projekt/Atlas/idee", "wichtig"] }, { pfad: "3", tags: ["projekt"] }, { pfad: "4", tags: [] },
  ]);
  const m = Object.fromEntries(z.tags.map((t) => [t.name.toLowerCase(), [t.anzahl, t.direkt]]));
  assert.deepEqual(m, { projekt: [3, 1], "projekt/atlas": [2, 1], "projekt/atlas/idee": [1, 1], wichtig: [2, 2] });
  assert.equal(z.notizen, 3);
});

// ───────────── Umbenennen (rein) ─────────────
test("benenneTagUm: Inline und Kopf, Unterthemen folgen, Rest bleibt bytegleich (CRLF, Quotes, Code)", () => {
  const t = "---\r\ntags: [\"Alt\", alt/kind, #alt, anders]\r\n---\r\nText #alt und #ALT/zwei, #altmodisch `#alt` #anders\r\n```\r\n#alt\r\n```\r\n";
  const r = T.benenneTagUm(t, "alt", "neu/ort");
  assert.equal(r.text, "---\r\ntags: [\"neu/ort\", neu/ort/kind, anders]\r\n---\r\nText #neu/ort und #neu/ort/zwei, #altmodisch `#alt` #anders\r\n```\r\n#alt\r\n```\r\n");
  assert.equal(r.anzahl, 5);
  assert.equal(T.benenneTagUm("nichts #anders", "alt", "neu").text, "nichts #anders");
  // zurück: gleiche Stellen
  assert.equal(T.benenneTagUm(r.text, "neu/ort", "alt").text.replace(/#ALT/, "#alt").includes("#altmodisch"), true);
});

test("Parser: NFD-Umlaute (kombinierende Marken) sind Teil des Tags, nie am Anfang; Namen kommen als NFC", () => {
  const nfd = "Übung".normalize("NFD");
  assert.deepEqual(T.extrahiereTags(`Text #${nfd} und #${nfd}/Teil`), ["Übung", "Übung/Teil"]);
  assert.deepEqual(T.extrahiereTags("#\u0301x"), [], "Marke am Anfang ist kein Tag");
  const r = T.benenneTagUm(`Text #${nfd} und #${nfd}/teil`, "Übung", "Praxis");
  assert.equal(r.text, "Text #Praxis und #Praxis/teil");
  assert.equal(T.pruefeTagName(`#${nfd}`), "Übung");
});
test("Parser: eingerückter Code und HTML-Blöcke zählen nicht und werden nie umgeschrieben; in Listen zählt Einrückung als Inhalt", () => {
  const t = "Absatz #echt\n\n    #im-code\n    #auch-code\n\n- Punkt\n\n    #in-liste\n\n<pre>\n#in-pre\n</pre>\n\n<div class=\"x\">\n#in-div\n\n#nach-div\n";
  assert.deepEqual(T.extrahiereTags(t), ["echt", "in-liste", "nach-div"]);
  const r = T.benenneTagUm(t, "im-code", "x").text;
  assert.equal(r, t);
  assert.equal(T.benenneTagUm(t, "in-pre", "x").anzahl, 0);
  assert.equal(T.benenneTagUm("<pre>a #q</pre> #q", "q", "z").text, "<pre>a #q</pre> #q", "eine Zeile mit HTML-Block-Anfang bleibt ganz unberührt");
});
test("benenneTagUm: Zusammenführen entfernt doppelte Einträge im Kopf ([beta, beta], Blockliste, Anführungszeichen)", () => {
  assert.equal(T.benenneTagUm("---\ntags: [alpha, beta]\n---\n", "alpha", "beta").text, "---\ntags: [beta]\n---\n");
  assert.equal(T.benenneTagUm("---\ntags: [beta, alpha, gamma]\n---\n", "alpha", "beta").text, "---\ntags: [beta, gamma]\n---\n");
  assert.equal(T.benenneTagUm("---\ntags: [alpha, \"beta\"]\n---\n", "alpha", "BETA").text, "---\ntags: [\"beta\"]\n---\n");
  assert.equal(T.benenneTagUm("---\ntags:\n  - alpha\n  - beta\n---\ntext #alpha\n", "alpha", "beta").text, "---\ntags:\n  - beta\n---\ntext #beta\n");
  assert.equal(T.benenneTagUm("---\ntags: [a, a]\n---\n", "a", "b").text, "---\ntags: [b]\n---\n", "zwei umbenannte Einträge werden einer");
  assert.equal(T.benenneTagUm("---\ntags: [alpha]\n---\n#beta #alpha\n", "alpha", "beta").text, "---\ntags: [beta]\n---\n#beta #beta\n", "Inline bleibt, nur der Kopf wird dedupliziert");
});

// ───────────── Vault: Index, Umbenennen, Rückgängig ─────────────
function aufbau() {
  const d = tmp("tags-vault-"), support = tmp("tags-support-");
  schreibe(d, "brain.config.json", "{}\n");
  schreibe(d, "a.md", "---\ntags: [alt, keep]\n---\n# A\nText #alt/kind\n");
  schreibe(d, "ordner/b.md", "# B\n#alt und #keep\n");
  schreibe(d, "c.md", "# C\nnichts #anders\n");
  schreibe(d, "09_wiki/_index.md", "# generiert\n#alt\n");
  schreibe(d, "ink/d.md", "# D\n#alt `#alt`\n");
  schreibe(d, ".versteckt/e.md", "#alt\n");
  const v = oeffneVault(d, { support, heute: "2026-11-05" });
  return { d, support, v };
}
const lies = (d, p) => readFileSync(join(d, p), "utf8");

test("Vault.tags: zählt Notizen, überspringt generierte Dateien und Punkt-Ordner", async () => {
  const { v } = aufbau();
  const { tags, notizen } = await v.tags();
  const m = Object.fromEntries(tags.map((t) => [t.name, [t.anzahl, t.direkt]]));
  assert.deepEqual(m, { alt: [3, 3], "alt/kind": [1, 1], keep: [2, 2], anders: [1, 1] });
  assert.equal(notizen, 4);
  assert.deepEqual((await v.tagNotizen("alt")).map((e) => e.pfad).sort(), ["a.md", "ink/d.md", "ordner/b.md"]);
});

test("tagUmbenennen: Vorschau schreibt nichts, Ausführen ist EIN Verlaufseintrag, Rückgängig stellt jedes Byte her, Wieder wiederholt", async () => {
  const { d, support, v } = aufbau();
  const vorher = ["a.md", "ordner/b.md", "ink/d.md", "c.md", "09_wiki/_index.md"].map((p) => lies(d, p));
  const vor = await v.tagUmbenennen({ alt: "alt", neu: "neu", vorschau: true });
  assert.equal(vor.ok, true);
  assert.deepEqual(vor.liste.map((x) => x.pfad), ["a.md", "ink/d.md", "ordner/b.md"]);
  assert.equal(vor.notizen, 3);
  assert.equal(vor.verweise, 4); // a.md: Kopf-Eintrag + #alt/kind, b.md: 1, d.md: 1 (Code zählt nicht)
  assert.deepEqual(["a.md", "ordner/b.md", "ink/d.md", "c.md", "09_wiki/_index.md"].map((p) => lies(d, p)), vorher, "Vorschau schreibt nichts");

  const r = await v.tagUmbenennen({ alt: "alt", neu: "neu", token: vor.token });
  assert.equal(r.ok, true);
  assert.ok(r.vorgang);
  assert.equal(lies(d, "a.md"), "---\ntags: [neu, keep]\n---\n# A\nText #neu/kind\n");
  assert.equal(lies(d, "ordner/b.md"), "# B\n#neu und #keep\n");
  assert.equal(lies(d, "ink/d.md"), "# D\n#neu `#alt`\n");
  assert.equal(lies(d, "c.md"), vorher[3]);
  assert.equal(lies(d, "09_wiki/_index.md"), vorher[4], "generierte Datei bleibt");
  assert.deepEqual((await v.tags()).tags.map((t) => t.name).sort(), ["anders", "keep", "neu", "neu/kind"]);

  // genau ein Verlaufseintrag
  const e = A.leseEreignisse(support, A.kennungVault(v.wurzel), { arten: ["datei-aktion"] });
  assert.equal(e.length, 1);
  assert.match(e[0].text, /Tag #alt in #neu umbenannt/);
  assert.equal(e[0].rueckgaengig.art, "vorgang");

  const z = await v.vorgangZurueck({ id: r.vorgang });
  assert.equal(z.ok, true);
  assert.deepEqual(["a.md", "ordner/b.md", "ink/d.md", "c.md", "09_wiki/_index.md"].map((p) => lies(d, p)), vorher, "Rückgängig stellt alles her");
  const w = await v.vorgangWieder({ id: r.vorgang });
  assert.equal(w.ok, true);
  assert.equal(lies(d, "ordner/b.md"), "# B\n#neu und #keep\n");
});

test("tagUmbenennen: veraltete Vorschau (409), fremd geänderte Notiz verhindert Rückgängig, ungültige Namen (400), nichts zu tun", async () => {
  const { d, v } = aufbau();
  const vor = await v.tagUmbenennen({ alt: "keep", neu: "bleibt", vorschau: true });
  writeFileSync(join(d, "ordner/b.md"), "# B\n#alt und #keep und mehr\n");
  await assert.rejects(() => v.tagUmbenennen({ alt: "keep", neu: "bleibt", token: vor.token }), (e) => e instanceof HttpFehler && e.status === 409 && e.extra?.art === "vorschau-veraltet");
  for (const neu of ["", "123", "a b", "a//b"]) await assert.rejects(() => v.tagUmbenennen({ alt: "keep", neu, vorschau: true }), (e) => e instanceof HttpFehler && e.status === 400, neu);
  const r = await v.tagUmbenennen({ alt: "keep", neu: "bleibt" });
  writeFileSync(join(d, "ordner/b.md"), lies(d, "ordner/b.md") + "fremd\n");
  await assert.rejects(() => v.vorgangZurueck({ id: r.vorgang }), (e) => e instanceof HttpFehler && e.status === 409);
  const nix = await v.tagUmbenennen({ alt: "gibtsnicht", neu: "x" });
  assert.equal(nix.unveraendert, true);
  const zus = await v.tagUmbenennen({ alt: "anders", neu: "bleibt", vorschau: true });
  assert.equal(zus.zusammen, true, "Zusammenführen mit vorhandenem Tag wird gemeldet");
});

test("tagUmbenennen: nur Großschreibung ändern geht; Schreibweise von neu wird übernommen", async () => {
  const { d, v } = aufbau();
  await v.tagUmbenennen({ alt: "keep", neu: "KEEP" });
  assert.equal(lies(d, "ordner/b.md"), "# B\n#alt und #KEEP\n");
});

// ───────────── Werkstatt-Routen ─────────────
const aufruf = (h) => async (methode, p, daten) => {
  const [pf, q] = p.split("?");
  const r = await h({ methode, pfad: pf, query: q || null, body: daten === undefined ? undefined : Buffer.from(JSON.stringify(daten)) });
  let j = null; try { j = JSON.parse(r.body.toString("utf8")); } catch { /* statisch */ }
  return { status: r.status, j };
};
test("Routen: /api/tags, /api/tags/notizen, Umbenennen mit Vorschau, Rückgängig über das Aktivitätsprotokoll; falsche Methode", async () => {
  const d = tmp("tags-r-vault-"), support = tmp("tags-r-support-");
  schreibe(d, "brain.config.json", "{}\n");
  schreibe(d, "a.md", "# A\n#alt #keep\n");
  schreibe(d, "b.md", "# B\n#alt/x\n");
  writeFileSync(join(support, "vaults.json"), JSON.stringify({ vaults: [{ name: "Haupt", pfad: d, farbe: "#5B8DEF" }], aktiv: d }));
  const h = erzeugeHandler({ vault: d, vaultOptionen: { support }, ereignisse: { modus: "poll", pollMs: 80, entprellMs: 40 } });
  const rufe = aufruf(h);
  const l = await rufe("GET", "/api/tags");
  assert.equal(l.status, 200);
  assert.deepEqual(l.j.tags.map((t) => [t.name, t.anzahl]), [["alt", 2], ["alt/x", 1], ["keep", 1]]);
  assert.deepEqual((await rufe("GET", "/api/tags/notizen?tag=alt")).j.notizen.map((e) => e.pfad).sort(), ["a.md", "b.md"]);
  assert.equal((await rufe("POST", "/api/tags")).status, 405);
  const vor = await rufe("POST", "/api/tags/umbenennen", { alt: "alt", neu: "neu", vorschau: true });
  assert.equal(vor.status, 200); assert.equal(vor.j.notizen, 2);
  const r = await rufe("POST", "/api/tags/umbenennen", { alt: "alt", neu: "neu", token: vor.j.token });
  assert.equal(r.status, 200); assert.ok(r.j.aktivitaetId); assert.deepEqual(r.j.geaendert.sort(), ["a.md", "b.md"]);
  assert.equal(readFileSync(join(d, "b.md"), "utf8"), "# B\n#neu/x\n");
  assert.equal((await rufe("POST", "/api/tags/umbenennen", { alt: "neu", neu: "123" })).status, 400);
  const z = await rufe("POST", "/api/aktivitaet/rueckgaengig", { id: r.j.aktivitaetId });
  assert.equal(z.status, 200);
  assert.equal(readFileSync(join(d, "b.md"), "utf8"), "# B\n#alt/x\n");
  assert.equal(readFileSync(join(d, "a.md"), "utf8"), "# A\n#alt #keep\n");
});

// ───────────── MCP ─────────────
test("MCP brain_tags: Liste und Notizen eines Tags; liest nur, steht in der Werkzeugliste, kein Schreibrecht nötig", async () => {
  const { v } = aufbau();
  assert.ok(WERKZEUGE.some((w) => w.name === "brain_tags"));
  const w = JSON.stringify(WERKZEUGE).length;
  assert.ok(w <= 4400, `Werkzeugliste ${w} Zeichen`);
  let n = 0;
  const rufe = async (args) => (await bearbeite(v, { jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name: "brain_tags", arguments: args } })).result;
  const liste = await rufe({});
  assert.match(liste.content[0].text, /#alt 3/);
  assert.match(liste.content[0].text, /#keep 2/);
  const eins = await rufe({ tag: "#alt" });
  assert.match(eins.content[0].text, /3 Notizen/);
  assert.match(eins.content[0].text, /ordner\/b\.md/);
  assert.doesNotMatch(eins.content[0].text, /_index|versteckt/);
  assert.match((await rufe({ tag: "nix" })).content[0].text, /Keine Notiz/);
});

test("MCP brain_tags: ein gesperrtes Konto sieht nichts (zentrale Stufenprüfung)", async () => {
  const { v } = aufbau();
  const zugriff = { stufe: () => "gesperrt", defekt: () => false, gefiltert: () => true, kontoName: () => null, konto: () => null, heimat: () => null };
  const a = await bearbeite(v, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "brain_tags", arguments: {} } }, "x", { klient: "", angelegt: 0 }, zugriff);
  assert.equal(a.result.isError, true);
  assert.doesNotMatch(a.result.content[0].text, /#alt/);
});
