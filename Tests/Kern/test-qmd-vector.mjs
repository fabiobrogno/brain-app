// qmd-vector.sucheKarten (Rückfall-Weg „vektor" des Hinweis-Hooks im Kindprozess) gegen einen Nachbau der echten
// QMD-2.5-Semantik: searchVector holt k = 3×limit nächste Abschnitte über ALLE Sammlungen und filtert erst danach.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "qmd-vector-"));
const fremd = Array.from({ length: 200 }, (_, i) => ({ filepath: `qmd://brain/00-inbox/vorschlag-${i}.md`, score: 0.7 - i / 1000 }));
writeFileSync(join(dir, "alle.json"), JSON.stringify([...fremd, { filepath: "qmd://brainkarten/thema-a.md", score: 0.47 }]));
writeFileSync(join(dir, "fake-qmd.mjs"), `import { readFileSync } from "node:fs";
export async function createStore() {
  const alle = JSON.parse(readFileSync(${JSON.stringify(join(dir, "alle.json"))}, "utf8"));
  return { async searchVector(q, { limit = 20, collection } = {}) {
    if (limit * 3 > 4096) throw new Error("k value in knn query too large");
    return alle.slice(0, limit * 3).filter(x => !collection || x.filepath.startsWith("qmd://" + collection + "/")).slice(0, limit);
  }, async close() {} };
}
`);
process.env.QMD_MODULE = join(dir, "fake-qmd.mjs");
const { sucheKarten } = await import("../qmd-vector.mjs");

test("sucheKarten: Karte hinter >60 näheren Fremd-Abschnitten wird trotzdem gefunden (Vektor-Rückfall)", async () => {
  const r = await sucheKarten("kundenportal meldungen", { collection: "brainkarten", limit: 20 });
  assert.deepEqual(r, [{ file: "qmd://brainkarten/thema-a.md", score: 0.47 }]);
});
