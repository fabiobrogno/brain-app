// fake-mcp-server.mjs — Ersatz für den MCP-Server von Kortex in Tests der Umstellung (Paket P7b). KEIN Test.
// Spricht das Nötigste von stdio-JSON-RPC: initialize, tools/call brain_suchen. Folgt wie der echte Server dem aktiven Vault aus <BRAIN_APP_SUPPORT>/vaults.json
// und liefert die Wiki-Seiten (<vault>/09_wiki/*.md), deren Text ein Wort der Frage enthält, als _meta["brain-studio/treffer"].
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const aktiv = () => { try { return JSON.parse(readFileSync(join(process.env.BRAIN_APP_SUPPORT || "", "vaults.json"), "utf8")).aktiv || null; } catch { return null; } };
function suche(frage) {
  const v = aktiv();
  if (!v) return [];
  const woerter = String(frage).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const treffer = [];
  try {
    for (const n of readdirSync(join(v, "09_wiki")).sort()) {
      if (!n.endsWith(".md")) continue;
      const t = readFileSync(join(v, "09_wiki", n), "utf8").toLowerCase();
      if (woerter.some((w) => t.includes(w))) treffer.push({ pfad: `09_wiki/${n}` });
    }
  } catch { /* kein Wiki */ }
  return treffer;
}
const senden = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
createInterface({ input: process.stdin }).on("line", (z) => {
  let m; try { m = JSON.parse(z); } catch { return; }
  if (m.method === "initialize") senden({ id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-brain", version: "0" } } });
  else if (m.method === "tools/call") { const t = suche(m.params?.arguments?.frage); senden({ id: m.id, result: { content: [{ type: "text", text: `${t.length} Treffer` }], _meta: { "brain-studio/treffer": t } } }); }
});
