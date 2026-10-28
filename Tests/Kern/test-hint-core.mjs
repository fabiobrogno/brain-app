import { test } from "node:test";
import assert from "node:assert/strict";
import { qmdToRel, shouldQuery, decide, format, countSuppressed, suchtext, istFolgefrage, ablaufZusatz, seitenStatus, anzeigePfad } from "../hint-core.mjs";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const map = {
  paths: { "09-wiki/thema-a.md": "09_wiki/thema_a.md", "09-wiki/thema-b.md": "09_wiki/thema_b.md",
           "20-firma/quelle-q.md": "20_firma/quelle-q.md", "09-wiki/log.md": "09_wiki/_log.md" },
  pages: { "09_wiki/thema_a.md": { name: "a", description: "Thema A" }, "09_wiki/thema_b.md": { name: "b", description: "Thema B" } },
  bySource: { "20_firma/quelle-q.md": ["09_wiki/thema_b.md"] },
};
const r = (file, score) => ({ file: "qmd://brain/" + file, score });

test("qmdToRel bildet QMD-Pfade ab, Unbekanntes → null", () => {
  assert.equal(qmdToRel("qmd://brain/09-wiki/thema-a.md", map), "09_wiki/thema_a.md");
  assert.equal(qmdToRel("qmd://brain/unbekannt.md", map), null);
});
test("shouldQuery: still bei Slash-Commands, Kurzantworten, Zustimmung", () => {
  for (const p of ["", "ja", "danke dir", "ok passt, weiter", "/ingest ~/x.md", "  /brain-lint  "]) assert.equal(shouldQuery(p), false, p);
  for (const p of ["warum bricht der nightly sync ab", "wann sind die abrechnungszahlen endgültig"]) assert.equal(shouldQuery(p), true, p);
});
test("decide: unter Schwelle → nichts", () => {
  assert.deepEqual(decide([r("09-wiki/thema-a.md", 0.40)], map, new Set(), { schwelle: 0.45 }), []);
});
test("decide: Wiki-Treffer direkt, Rohquelle → zitierende Wiki-Seite", () => {
  const h = decide([r("20-firma/quelle-q.md", 0.55), r("09-wiki/thema-a.md", 0.50)], map, new Set(), { schwelle: 0.45 });
  assert.deepEqual(h.map(x => x.page), ["09_wiki/thema_b.md", "09_wiki/thema_a.md"]);
});
test("decide: _-Dateien (Log/Index) nie melden", () => {
  assert.deepEqual(decide([r("09-wiki/log.md", 0.9)], map, new Set()), []);
});
test("decide: Dedupe gegen seen und innerhalb der Liste, max begrenzt", () => {
  const res = [r("09-wiki/thema-b.md", 0.6), r("20-firma/quelle-q.md", 0.58), r("09-wiki/thema-a.md", 0.5)];
  assert.deepEqual(decide(res, map, new Set(["09_wiki/thema_a.md"])).map(x => x.page), ["09_wiki/thema_b.md"]);
  assert.equal(decide(res, map, new Set(), { max: 1 }).length, 1);
});
test("decide: kaputte Ergebnisse werfen nicht", () => {
  assert.deepEqual(decide([{}, { file: 5, score: "x" }, null], map, new Set()), []);
});
test("format: leer bei 0 Treffern, sonst Kopf + 1 Zeile je Seite, Beschreibung ≤ 90 Zeichen", () => {
  assert.equal(format([]), "");
  const out = format([{ page: "09_wiki/thema_a.md", score: 0.5, description: "x".repeat(200) }]);
  const zeilen = out.split("\n");
  assert.equal(zeilen.length, 2);
  assert.match(zeilen[1], /^- 09_wiki\/thema_a\.md — x{90}$/);
});

import { qmdPath } from "../qmd-pfad.mjs";
test("qmdPath entspricht QMDs handelize (Groß/klein bleibt, Nicht-Alnum-Folgen → ein '-', Ränder weg, ___ → /)", () => {
  const faelle = {
    "09_wiki/thema_beispiel-datenreife.md": "09-wiki/thema-beispiel-datenreife.md",
    "09_wiki/_index.md": "09-wiki/index.md",
    "INDEX.md": "INDEX.md",
    "README.md": "README.md",
    "v2.1-notes.md": "v2-1-notes.md",
    "foo_.md": "foo.md",
    "a__b.md": "a-b.md",
    "Über & Co.md": "Über-Co.md",
    "a___b.md": "a/b.md",
    "10_projekte/alpha/notiz-a.md": "10-projekte/alpha/notiz-a.md",
  };
  for (const [ein, aus] of Object.entries(faelle)) assert.equal(qmdPath(ein), aus, ein);
});

test("countSuppressed: zählt nur wegen seen unterdrückte Seiten über Schwelle", () => {
  const res = [r("09-wiki/thema-a.md", 0.6), r("20-firma/quelle-q.md", 0.5), r("09-wiki/thema-a.md", 0.2)];
  assert.equal(countSuppressed(res, map, new Set(["09_wiki/thema_a.md"]), { schwelle: 0.45 }), 1);
  assert.equal(countSuppressed(res, map, new Set(), { schwelle: 0.45 }), 0);
  assert.equal(countSuppressed(res, map, new Set(["09_wiki/thema_a.md", "09_wiki/thema_b.md"]), { schwelle: 0.45 }), 2);
});

test("format: Überblick-Zeile nur bei gleichem Themenordner mit existierender Übersicht", () => {
  const v = mkdtempSync(join(tmpdir(), "brain-")); mkdirSync(join(v, "09_wiki/firma/kunde_a"), { recursive: true }); writeFileSync(join(v, "09_wiki/firma/kunde_a/_kunde_a.md"), "# x");
  const h = (p) => ({ page: p, score: 0.5, description: "d" });
  assert.match(format([h("09_wiki/firma/kunde_a/a.md"), h("09_wiki/firma/kunde_a/b.md")], { vault: v }), new RegExp(`Überblick: ${v.split("\\").join("/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/09_wiki/firma/kunde_a/_kunde_a\\.md`));
  assert.doesNotMatch(format([h("09_wiki/firma/kunde_a/a.md"), h("09_wiki/wissen/x/b.md")], { vault: v }), /Überblick/);
  assert.doesNotMatch(format([h("09_wiki/firma/kunde_a/a.md")], { vault: v }), /Überblick/);
  assert.doesNotMatch(format([h("09_wiki/wissen/x/a.md"), h("09_wiki/wissen/x/b.md")], { vault: v }), /Überblick/);
  assert.doesNotMatch(format([h("09_wiki/a.md"), h("09_wiki/b.md")], { vault: v }), /Überblick/);
});
test("suchtext: kurz unverändert, lang = Anfang + Ende ≤ 500, Mitte (Secret) fehlt", () => {
  assert.equal(suchtext("kurze frage"), "kurze frage");
  const t = suchtext("a".repeat(300) + "GEHEIM".repeat(2000) + "z".repeat(197));
  assert.ok(t.length <= 500 && t.startsWith("aaa") && t.endsWith("zzz") && !t.includes("GEHEIM"));
});

test("istFolgefrage: echte Anschlussfragen ja, Bestätigungen nein", () => {
  for (const p of ["und beim zweiten account?", "und bei den anderen", "was ist mit fr?", "warum nicht?"]) assert.equal(istFolgefrage(p), true, p);
  for (const p of ["ja bitte", "ok passt", "danke dir", "weiter", "mach das", "jo"]) assert.equal(istFolgefrage(p), false, p);
});

test("format: echter Vault-Pfad statt fest ~/brain; Home wird als ~ abgekürzt", async () => {
  const { homedir } = await import("node:os");
  const h = homedir().split("\\").join("/");
  const hit = [{ page: "wiki/a.md", score: 0.9, description: "d" }];
  assert.match(format(hit, { vault: join(homedir(), "Documents", "Brain") }), /^- ~\/Documents\/Brain\/wiki\/a\.md — d$/m);
  assert.match(format(hit, { vault: "/srv/wissen" }), /^- \/srv\/wissen\/wiki\/a\.md — d$/m);
  assert.doesNotMatch(format(hit, { vault: "/srv/wissen" }), /~\/brain/);
  assert.ok(!h.endsWith("/"));
});

test("format: Treffer auf abgelaufene Seiten tragen „(abgelaufen seit N Tagen)“ (Spec A, W1-Review #8)", () => {
  const v = mkdtempSync(join(tmpdir(), "hint ablauf, Ü "));
  mkdirSync(join(v, "09_wiki"), { recursive: true });
  writeFileSync(join(v, "09_wiki", "alt.md"), "\uFEFF---\r\nname: alt\r\npruefen_bis: 2026-09-30\r\n---\r\n# Alt\r\n");
  writeFileSync(join(v, "09_wiki", "frisch.md"), "---\nname: frisch\npruefen_bis: 2026-12-01\n---\n# Frisch\n");
  writeFileSync(join(v, "09_wiki", "text.md"), "# Text\n\npruefen_bis: 2020-01-01\n");
  writeFileSync(join(v, "09_wiki", "eins.md"), "---\npruefen_bis: 2026-10-02\n---\n");
  const jetzt = new Date(2026, 9, 3, 12).getTime();
  const out = format([
    { page: "09_wiki/alt.md", description: "Alte Seite" }, { page: "09_wiki/frisch.md", description: "Frisch" },
  ], { vault: v, jetzt });
  assert.match(out, /alt\.md \(abgelaufen seit 3 Tagen\) — Alte Seite/);
  assert.doesNotMatch(out.split("\n")[2], /abgelaufen/);
  assert.equal(ablaufZusatz(v, "09_wiki/text.md", { jetzt }), "", "ohne Frontmatter kein Zusatz");
  assert.equal(ablaufZusatz(v, "09_wiki/eins.md", { jetzt }), " (abgelaufen seit 1 Tag)");
  assert.equal(ablaufZusatz(v, "09_wiki/gibtsnicht.md", { jetzt }), "");
  assert.equal(ablaufZusatz(null, "09_wiki/alt.md", { jetzt }), "");
});

test("Systemnachrichten werden nie durchsucht; Lücken nur bei echten Wissensfragen", async () => {
  const { shouldQuery, istWissensfrage, istSystemNachricht } = await import("../hint-core.mjs");
  for (const s of ["<task-notification><task-id>x</task-id> completed", "<agent-message from=\"a1\">Bericht fertig mit vielen Wörtern</agent-message>",
    "[SYSTEM NOTIFICATION - NOT USER INPUT] irgendwas langes hier", "Another Claude session sent a message: Status fertig"]) {
    assert.equal(istSystemNachricht(s), true, s); assert.equal(shouldQuery(s), false, s); assert.equal(istWissensfrage(s), false, s);
  }
  assert.equal(istWissensfrage("wie funktioniert der Kundenportal Sync eigentlich genau"), true);
  assert.equal(istWissensfrage("welche Preise gelten für die Toner?"), true);
  assert.equal(istWissensfrage("mach das bitte schnell fertig und sichere alles"), false);
  assert.equal(istWissensfrage("ich sag dir ehrlich ich find das richtig krass"), false);
  assert.equal(shouldQuery("mach das bitte schnell fertig und sichere alles"), true);
});

function w6Vault() {
  const v = mkdtempSync(join(tmpdir(), "w6 Brän, Jo's "));
  mkdirSync(join(v, "09_wiki", "garten"), { recursive: true });
  const schreib = (n, fm, body = "# x\n") => writeFileSync(join(v, "09_wiki", "garten", n), `---\nname: x\ndescription: d\n${fm}---\n\n${body}`);
  schreib("alt.md", "ersetzt_durch: \"[[thema_beet_neu]]\"\n");
  schreib("kaputt.md", "ersetzt_durch: thema_beet_neu\n");
  schreib("text.md", "", "# x\n\nersetzt_durch: [[y]]\n");
  schreib("zweifel.md", "zweifel: \"2026-10-22: Nutzer sagt abends\"\npruefen_bis: 2026-10-01\n");
  schreib("normal.md", "");
  return v;
}
const w6Treffer = (page, extra = {}) => [{ page, score: 0.6, description: "Gießplan alt", ...extra }];

test("W6: ersetzte Seite nie als aktuell — „ersetzt → [[neu]]“; ungültig → „(Nachfolger fehlt)“; nur echtes Frontmatter; Import unverändert", () => {
  const v = w6Vault();
  assert.equal(format(w6Treffer("09_wiki/garten/alt.md"), { vault: v }),
    `Brain-Treffer (lokal, ungelesen — nur öffnen, wenn für die Aufgabe relevant):\n- ${anzeigePfad(v, "09_wiki/garten/alt.md")} — ersetzt → [[thema_beet_neu]], nicht mehr aktuell`);
  assert.match(format(w6Treffer("09_wiki/garten/kaputt.md"), { vault: v }), / — ersetzt → \(Nachfolger fehlt\), nicht mehr aktuell$/);
  assert.match(format(w6Treffer("09_wiki/garten/text.md"), { vault: v }), /text\.md — Gießplan alt$/);
  assert.match(format(w6Treffer("09_wiki/garten/alt.md", { import: true }), { vault: v }), /alt\.md — Gießplan alt$/);
  assert.deepEqual(seitenStatus(v, "09_wiki/garten/alt.md"), { ersetzt: true, ersetztDurch: "thema_beet_neu", zusatz: "" });
  assert.deepEqual(seitenStatus(v, "09_wiki/garten/fehlt.md"), { ersetzt: false, ersetztDurch: null, zusatz: "" });
});

test("W6: Zweifel → „(PRÜFBEDÜRFTIG: Zweifel)“ vor dem Ablauf-Zusatz; Seite ohne Felder unverändert", () => {
  const v = w6Vault();
  const jetzt = Date.UTC(2026, 9, 21, 12);
  assert.match(format(w6Treffer("09_wiki/garten/zweifel.md"), { vault: v, jetzt }), /zweifel\.md \(PRÜFBEDÜRFTIG: Zweifel\) \(abgelaufen seit 20 Tagen\) — Gießplan alt$/);
  assert.match(format(w6Treffer("09_wiki/garten/normal.md"), { vault: v, jetzt }), /normal\.md — Gießplan alt$/);
  assert.equal(ablaufZusatz(v, "09_wiki/garten/zweifel.md", { jetzt }), " (abgelaufen seit 20 Tagen)");
});

test("W4: Frontmatter länger als 4 KB — ersetzt_durch/zweifel/pruefen_bis am Ende werden trotzdem gelesen; offenes Frontmatter wird ausgewertet; Textkörper nie", () => {
  const v = mkdtempSync(join(tmpdir(), "w4 Brän, Jo's "));
  mkdirSync(join(v, "09_wiki", "garten"), { recursive: true });
  const fuell = Array.from({ length: 70 }, (_, i) => `notiz_${String(i).padStart(2, "0")}: "${"Füllung ".repeat(10)}"`).join("\n") + "\n";
  assert.ok(Buffer.byteLength(fuell) > 5300 && Buffer.byteLength(fuell) < 8000, `Füllung ${Buffer.byteLength(fuell)} Bytes`);
  const seite = (n, text) => writeFileSync(join(v, "09_wiki", "garten", n), text);
  seite("lang-ersetzt.md", `---\nname: x\ndescription: d\n${fuell}ersetzt_durch: "[[thema_beet_neu]]"\n---\n\n# x\n`);
  seite("lang-zweifel.md", `---\nname: x\n${fuell}zweifel: "2026-10-22: Nutzer sagt abends"\npruefen_bis: 2026-10-01\n---\n# x\n`);
  seite("lang-crlf.md", `\uFEFF---\r\nname: x\r\n${fuell.replace(/\n/g, "\r\n")}ersetzt_durch: "[[nachfolger]]"\r\n---\r\n# x\r\n`);
  seite("lang-koerper.md", `---\nname: x\n${fuell}---\n\n${"Text ".repeat(900)}\nersetzt_durch: "[[y]]"\n`);
  seite("offen.md", `---\nname: x\nersetzt_durch: "[[offen_neu]]"\n\n# nie geschlossen\n`);
  seite("offen-lang.md", `---\nname: x\nzweifel: "2026-10-22: Nutzer sagt abends"\n${fuell}${fuell}# nie geschlossen\n`);
  seite("kein-fm.md", `# x\n\n${fuell}ersetzt_durch: "[[y]]"\n`);
  assert.equal(seitenStatus(v, "09_wiki/garten/lang-ersetzt.md").ersetztDurch, "thema_beet_neu");
  assert.equal(seitenStatus(v, "09_wiki/garten/lang-crlf.md").ersetztDurch, "nachfolger");
  assert.match(format(w6Treffer("09_wiki/garten/lang-ersetzt.md"), { vault: v }), / — ersetzt → \[\[thema_beet_neu\]\], nicht mehr aktuell$/);
  const jetzt = Date.UTC(2026, 9, 21, 12);
  assert.match(format(w6Treffer("09_wiki/garten/lang-zweifel.md"), { vault: v, jetzt }), /lang-zweifel\.md \(PRÜFBEDÜRFTIG: Zweifel\) \(abgelaufen seit 20 Tagen\) — Gießplan alt$/);
  assert.equal(seitenStatus(v, "09_wiki/garten/lang-koerper.md").ersetzt, false, "ersetzt_durch im Textkörper zählt nie");
  assert.equal(seitenStatus(v, "09_wiki/garten/kein-fm.md").ersetzt, false);
  assert.equal(seitenStatus(v, "09_wiki/garten/offen.md").ersetztDurch, "offen_neu", "ohne schließendes --- trotzdem ausgewertet");
  assert.match(seitenStatus(v, "09_wiki/garten/offen-lang.md").zusatz, /PRÜFBEDÜRFTIG: Zweifel/);
});
