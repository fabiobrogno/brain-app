// .tools/tests/pflege-hilfe.mjs — Test-Hilfen für B3 (Pflege-Intelligenz). Baut auf tageslauf-hilfe.mjs auf; nie echtes claude.
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tempOrdner } from "./verlauf-fixture.mjs";
import { neuerTestVault, seitenText, JETZT } from "./tageslauf-hilfe.mjs";
import { neuerLauf } from "../tageslauf/protokoll.mjs";

const HIER = dirname(fileURLToPath(import.meta.url));
export const FAKE_SONNET = join(HIER, "fake-sonnet.mjs");
export const FAKE_SONNET_BEFEHL = { befehl: process.execPath, args: [FAKE_SONNET] };

// Sonnet-Regeln (siehe fake-sonnet.mjs). Haiku-Regeln setzt weiterhin fakeKi() aus tageslauf-hilfe.mjs.
export function fakeSonnet(regeln = [], { standard = '{"ziel":null,"grund":"nichts"}', exit = 0 } = {}) {
  const d = tempOrdner("fake-sonnet");
  writeFileSync(join(d, "regeln.json"), JSON.stringify(regeln));
  writeFileSync(join(d, "zaehler.jsonl"), "");
  Object.assign(process.env, { FAKE_SONNET_REGELN: join(d, "regeln.json"), FAKE_SONNET_STANDARD: standard,
    FAKE_SONNET_ZAEHLER: join(d, "zaehler.jsonl"), FAKE_SONNET_EXIT: String(exit) });
  const aufrufe = () => readFileSync(join(d, "zaehler.jsonl"), "utf8").split("\n").filter(Boolean).map((z) => JSON.parse(z));
  return { aufrufe, anzahl: () => aufrufe().length };
}

// Test-Vault wie im Tageslauf (Git, grüner Hook, Cluster 10_projekte/20_firma/30_wissen); inbox: { "<name>.md": text } liegt
// UNVERSIONIERT in 00_inbox/ (wie im echten Vault).
export function neuerPflegeVault({ seiten = {}, inbox = {}, automatik = { tageslauf: "an" }, hook = "gruen", config = {} } = {}) {
  const v = neuerTestVault({ seiten, automatik, hook, config });
  for (const [name, text] of Object.entries(inbox)) {
    mkdirSync(join(v, "00_inbox"), { recursive: true });
    writeFileSync(join(v, "00_inbox", name), text);
  }
  return v;
}
export const pflegeCtx = (v, opt = {}) => neuerLauf(v, { jetzt: JETZT, claudeBefehl: FAKE_SONNET_BEFEHL, ...opt });
export const seite = (fm = {}, rumpf = "") => seitenText({ fm, rumpf });
