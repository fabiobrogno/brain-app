// Konflikt-Ansicht über die Werkstatt, Teil 2: Prüfung der Auswahl (der größte Einzelfall). Hilfen: konflikt-werkstatt-hilfe.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, g, pfad, erzeugeHandler, kennung, wirft, mitRemote, commitIn, lies, loesen, konfliktAufbauen } from "./konflikt-werkstatt-hilfe.mjs";

test("Lösen prüft die Auswahl (400), kein Konflikt → 409; Fehler des Kerns kommen als HttpFehler mit Status", async () => {
  const { a, v } = await konfliktAufbauen();
  assert.equal((await wirft(loesen(v, []))).status, 400);
  for (const wahl of ["--theirs", "meine ", "Meine", "", `ext::sh -c "touch x" x`]) assert.equal((await wirft(loesen(v, [{ pfad: "start.md", wahl }]))).status, 400, wahl);
  assert.equal((await wirft(loesen(v, [{ pfad: "../x", wahl: "meine" }]))).status, 400);
  assert.ok(existsSync(join(a, ".git", "MERGE_HEAD")), "nichts angefasst");
  await v.gitKonfliktAbbrechen();
  assert.equal((await wirft(loesen(v, []))).status, 409);
});

