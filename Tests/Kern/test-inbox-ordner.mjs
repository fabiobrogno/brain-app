// ordner(vault).inbox: ein einzelner, nicht versteckter Name, der nie der Ordner von Wiki oder Archiv ist — sonst der Standard 00_inbox.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ordner } from "../pfade.mjs";

const inboxBei = (cfg) => { const v = mkdtempSync(join(tmpdir(), "brain inbox ")); writeFileSync(join(v, "brain.config.json"), JSON.stringify(cfg)); return ordner(v).inbox; };

test("ordner.inbox: gültige Namen gelten (auch Umlaute), Standard ohne Angabe", () => {
  assert.equal(inboxBei({ ordner: { inbox: "Eingang" } }), "Eingang");
  assert.equal(inboxBei({ ordner: { inbox: "Posteingang-Büro" } }), "Posteingang-Büro");
  assert.equal(inboxBei({}), "00_inbox");
});
test("ordner.inbox: versteckte Namen fallen auf den Standard zurück", () => {
  for (const n of [".versteckt", ".git", ".claude", ".."]) assert.equal(inboxBei({ ordner: { inbox: n } }), "00_inbox", n);
});
test("ordner.inbox: Wiki-, Archiv- und Systemnamen (auch groß/klein, konfiguriert oder Standard) fallen auf den Standard zurück", () => {
  assert.equal(inboxBei({ ordner: { inbox: "09_wiki" } }), "00_inbox");
  assert.equal(inboxBei({ ordner: { inbox: "90_ARCHIV" } }), "00_inbox");
  assert.equal(inboxBei({ ordner: { inbox: "node_modules" } }), "00_inbox");
  assert.equal(inboxBei({ ordner: { inbox: "Wissen", wiki: "wissen" } }), "00_inbox");
  assert.equal(inboxBei({ ordner: { inbox: "Ablage", archiv: "ABLAGE" } }), "00_inbox");
  assert.equal(inboxBei({ ordner: { inbox: "Wissen" }, wiki: { ordner: "Wissen" } }), "00_inbox"); // alter Schlüssel wiki.ordner
});
test("ordner.inbox: Pfade und Nicht-Texte fallen auf den Standard zurück", () => {
  for (const n of ["a/b", "/etc", "../x", "", 5, null]) assert.equal(inboxBei({ ordner: { inbox: n } }), "00_inbox", String(n));
});
