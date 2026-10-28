// Gemeinsamer Datei-Walker (Indexer + Struktur-Lint): alle .md relativ zum Vault, ohne Punkt-Pfade,
// ohne generierte Dateien (INDEX.md, _index.md, _<ordner>.md), ohne AGENTS.md/CLAUDE.md im Vault-Root
// (Agenten-Anweisungen, kein Wissen) und ohne .brainignore-Einträge. Sortiert.
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { istGeneriert } from "./wiki-pfade.mjs";
import { ordner } from "./pfade.mjs";

export function ignorierListe(vault) {
  const f = join(vault, ".brainignore");
  return existsSync(f) ? readFileSync(f, "utf8").split("\n").map(s => s.trim()).filter(Boolean) : [];
}
export function walk(vault, { wikiDir = ordner(vault).wiki, ignore = ignorierListe(vault) } = {}) {
  // .brainignore-Einträge stehen mit "/" — unter Windows liefert relative() "\\", darum vorher angleichen.
  const skip = (relNativ) => { const rel = relNativ.split(sep).join("/");
    return rel.startsWith(".") || rel === "INDEX.md" || rel === "AGENTS.md" || rel === "CLAUDE.md"
      || istGeneriert(rel, wikiDir)
      || ignore.some(p => rel === p || rel.startsWith(p + "/") || rel.startsWith(p)); };
  const out = [];
  const lauf = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name), rel = relative(vault, full);
      if (skip(rel)) continue;
      const st = statSync(full);
      if (st.isDirectory()) lauf(full);
      else if (name.endsWith(".md")) out.push({ full, rel, size: st.size });
    }
  };
  lauf(vault);
  return out;
}

// Inbox-Dateien, die auf /ingest warten (Sitzungsstart „Brain-Inbox: N Datei(en)“ und Gesundheits-Wächter zählen gleich):
// ohne Punkt-Namen und ohne die Systemordner der Inbox — _vorschlaege (eigene Zeile „N neue Vorschläge“), _import (wird je Paket nach Ja
// eingearbeitet, nicht pauschal; Final-Review #6), _entscheidungen und _lektionen (eigene Zeilen), _pflege (Prüfaufträge, keine Quellen),
// _warten und _rueckfragen. Nur obere Ebene wird so ausgenommen; darunter zählt jede Datei. Fehlender Ordner → 0.
export const NICHT_INGEST = new Set(["_vorschlaege", "_import", "_entscheidungen", "_lektionen", "_pflege", "_warten", "_rueckfragen"]);
export function zaehleInboxDateien(dir, oben = true) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    if (oben && e.isDirectory() && NICHT_INGEST.has(e.name)) continue;
    const full = join(dir, e.name);
    n += e.isDirectory() ? zaehleInboxDateien(full, false) : 1;
  }
  return n;
}
export const wartendeInboxDateien = (vault) => zaehleInboxDateien(join(vault, ordner(vault).inbox));
