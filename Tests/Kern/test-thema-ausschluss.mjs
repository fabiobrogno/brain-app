// .tools/tests/test-thema-ausschluss.mjs — der gemeinsame Themen-Ausschluss (thema-ausschluss.mjs): Fakten zu bestimmten
// (privaten) Themen kommen nie ins Brain, gleich aus welchem Ordner die Sitzung stammt. Treffer = GANZES Wort (Unicode-
// Wortgrenzen), Groß/Klein egal. Nur neutrale Wörter (zebra, giraffe) — keine echten Projektnamen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { THEMA_GRUND, normiereWortliste, themaMatcher, nenntThema } from "../thema-ausschluss.mjs";

test("THEMA_GRUND ist ein gültiger Aussortier-Grund (nur a-z, 0-9, Bindestrich, höchstens 40 Zeichen)", () => {
  assert.equal(THEMA_GRUND, "thema-ausgeschlossen");
  assert.match(THEMA_GRUND, /^[a-z0-9-]{1,40}$/);
});

test("normiereWortliste: Text → ein Wort, Liste → getrimmte nicht leere Strings ohne Dubletten, alles andere → []", () => {
  assert.deepEqual(normiereWortliste("zebra"), ["zebra"]);
  assert.deepEqual(normiereWortliste("  zebra  "), ["zebra"]);
  assert.deepEqual(normiereWortliste(["zebra", " giraffe ", "", "   ", "ZEBRA", 7, null, { a: 1 }, "weißes   zebra"]), ["zebra", "giraffe", "weißes zebra"],
    "Leerraum innen wird einfach, Dubletten (ohne Groß/Klein) entfallen, Nicht-Texte fallen weg");
  for (const nichts of [undefined, null, 0, 7, true, {}, [], "", "   "]) assert.deepEqual(normiereWortliste(nichts), [], JSON.stringify(nichts));
  assert.equal(normiereWortliste(Array.from({ length: 900 }, (_, i) => `w${i}`)).length, 500, "großzügig, aber nicht unbegrenzt");
});

test("themaMatcher: ohne Wörter kein Matcher; sonst ein Treffer-Test", () => {
  assert.equal(themaMatcher([]), null);
  assert.equal(themaMatcher(undefined), null);
  assert.equal(themaMatcher(["", "  "]), null);
  assert.equal(typeof themaMatcher(["zebra"]).test, "function");
});

test("nenntThema: ganzes Wort, Groß/Klein egal — Teilwörter und Fremdwörter mit demselben Anfang treffen nicht", () => {
  const w = ["zebra"];
  for (const text of ["Das Zebra frisst Heu.", "ZEBRA", "zebra", "ein zebra.", "(zebra)", "Zebra, Giraffe", "Zebra\nGiraffe", "„Zebra“", "\tzebra\t", "zebra-streifen", "Zebra_Gehege", "Zebra/Gehege", "Zebra's"])
    assert.equal(nenntThema(w, text), true, text);
  for (const text of ["Zebras", "Zebrastreifen", "Zebrafink", "gezebra", "zebrazebra", "zebra1", "1zebra", "Zeebra", "Zebr a", ""])
    assert.equal(nenntThema(w, text), false, text);
});

test("nenntThema: Umlaute und andere Schriften zählen als Buchstaben; NFC und NFD sind dasselbe Wort; Groß/Klein auch bei Umlauten", () => {
  assert.equal(nenntThema(["Überraschung"], "eine ÜBERRASCHUNG am Morgen"), true);
  assert.equal(nenntThema(["überraschung"], "Überraschungen"), false);
  assert.equal(nenntThema(["Müller"], "Herr Müller kommt."), true, "Text in NFD, Wort in NFC");
  assert.equal(nenntThema(["Müller"], "Herr Müller kommt."), true, "Wort in NFD, Text in NFC");
  assert.equal(nenntThema(["Müller"], "Müllerin"), false);
  assert.equal(nenntThema(["Muller"], "Müller"), false, "ein Umlaut ist nicht der Buchstabe ohne Umlaut");
  assert.equal(nenntThema(["тест"], "это ТЕСТ."), true);
  assert.equal(nenntThema(["тест"], "тестовый"), false);
  assert.equal(nenntThema(["東京"], "旅行先は東京です"), false, "ohne Wortgrenzen im Text kein Teilwort-Treffer (CJK läuft ineinander)");
  assert.equal(nenntThema(["東京"], "旅行先は 東京 です"), true);
});

test("nenntThema: Sonderzeichen im Wort sind buchstäblich gemeint (kein Regex), Mehrwort-Begriffe passen auf jeden Leerraum", () => {
  assert.equal(nenntThema(["c++"], "Wir nutzen C++ dafür."), true);
  assert.equal(nenntThema(["c++"], "Wir nutzen c dafür."), false);
  assert.equal(nenntThema(["a.b"], "a.b steht da"), true);
  assert.equal(nenntThema(["a.b"], "aXb steht da"), false);
  assert.equal(nenntThema(["(x)"], "ein (x) hier"), true);
  assert.equal(nenntThema(["[zebra"], "ein [zebra hier"), true);
  assert.equal(nenntThema([".*"], "irgendwas"), false);
  assert.equal(nenntThema(["a|b"], "a"), false);
  assert.equal(nenntThema(["weißes zebra"], "Ein Weißes   Zebra\nsteht da"), true);
  assert.equal(nenntThema(["weißes zebra"], "weißes"), false);
});

test("nenntThema: mehrere Wörter und mehrere Texte (Titel, Text, Zitat) — ein Treffer reicht, fremde Werte stören nicht", () => {
  assert.equal(nenntThema(["zebra", "giraffe"], "nichts", "hier die Giraffe"), true);
  assert.equal(nenntThema(["zebra", "giraffe"], "Zebra", "nichts"), true);
  assert.equal(nenntThema(["zebra", "giraffe"], "nichts", "gar nichts", "auch nichts"), false);
  assert.equal(nenntThema(["zebra"], undefined, null, 42, { a: "zebra" }, ["zebra"], "kein Treffer"), false, "Nicht-Texte werden ignoriert");
  assert.equal(nenntThema(["zebra"]), false, "ohne Text kein Treffer");
  assert.equal(nenntThema([], "zebra"), false, "ohne Wörter kein Treffer");
  assert.equal(nenntThema(undefined, "zebra"), false);
  assert.equal(nenntThema("zebra", "Ein Zebra"), true, "ein einzelnes Wort als Text wird wie eine Liste mit einem Wort behandelt");
});

test("nenntThema: sehr langer Text bleibt schnell (kein Regex-Aufschaukeln)", () => {
  const lang = "zebrazebrazebra ".repeat(60000) + "x".repeat(200000);
  const t0 = Date.now();
  assert.equal(nenntThema(["zebra", "giraffe", "a+", "(a|aa)+"], lang), false);
  assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
});

test("nenntThema: ß und ẞ gelten wie ss — „Straße“ trifft „STRASSE“ und umgekehrt, „weißes Zebra“ trifft „WEISSES ZEBRA“ (Wort und Text werden vor dem Vergleich gefaltet)", () => {
  assert.equal(nenntThema(["Straße"], "die STRASSE ist gesperrt"), true);
  assert.equal(nenntThema(["Straße"], "die STRAẞE ist gesperrt"), true, "großes ẞ");
  assert.equal(nenntThema(["Straße"], "die Strasse ist gesperrt"), true);
  assert.equal(nenntThema(["STRASSE"], "die Straße ist gesperrt"), true, "Wort in SS, Text mit ß");
  assert.equal(nenntThema(["weißes zebra"], "Ein WEISSES   ZEBRA steht da"), true);
  assert.equal(nenntThema(["WEISSES ZEBRA"], "ein weißes Zebra"), true);
  assert.equal(nenntThema(["weißes zebra"], "weisses Zebra\nund mehr"), true);
  assert.equal(nenntThema(["Straße"], "Straßenbahn"), false, "ganzes Wort bleibt ganzes Wort");
  assert.equal(nenntThema(["Straße"], "die STRASSEN sind frei"), false);
  assert.equal(nenntThema(["Strasse"], "Straßen"), false);
  assert.equal(nenntThema(["Maß"], "das MASS ist voll"), true);
  assert.equal(nenntThema(["Mas"], "das MASS ist voll"), false, "ss ist nicht s");
  assert.equal(themaMatcher(["Straße"]).test("STRASSE"), true, "auch der Matcher allein faltet");
});

test("nenntThema: NFKC — Vollbreiten-Buchstaben und Ligaturen treffen wie ihre einfache Schreibweise; NFC/NFD bleiben dasselbe Wort", () => {
  assert.equal(nenntThema(["zebra"], "ein ｚｅｂｒａ im Zoo"), true, "Vollbreite");
  assert.equal(nenntThema(["ｚｅｂｒａ"], "ein Zebra im Zoo"), true, "Wort in Vollbreite");
  assert.equal(nenntThema(["office"], "im oﬃce"), true, "Ligatur ﬃ");
  assert.equal(nenntThema(["fische"], "die ﬁsche"), true, "Ligatur ﬁ");
  assert.equal(nenntThema(["Müller"], "Herr Müller kommt"), true);
  assert.equal(nenntThema(["zebra"], "Zebras"), false, "Teilwörter treffen weiter nicht");
});
