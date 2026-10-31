// umstellung/git-revert.mjs — der Rückweg eines eigenen Commits (A8 „Gerät umgestellt“, B3 „alten Werkzeug-Ordner entfernt“) sicher ausführen (Paket P7d, Review W1/W2).
//
//  · Arbeitet der Nutzer gerade selbst an etwas (cherry-pick, revert, merge, rebase), fasst der Rückweg nichts an: Hinweis „git-beschaeftigt“, kein `revert`, kein `--abort`.
//  · `revert --abort` läuft nur, wenn REVERT_HEAD durch UNSEREN Aufruf entstanden ist (vorher gab es keinen) – nie für einen Stand des Nutzers.
//  · Idempotent: unterscheiden sich die Pfade des Commits zwischen seinem Elternteil und HEAD nicht, ist er schon zurückgenommen (oder wurde es von Hand) → nichts zu tun, kein Hinweis.
//    Das verhindert auch, dass ein älterer Commit nach „Phase B → zurück → Phase B → zurück“ ein zweites Mal zurückgenommen wird.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { gitSicherLauf } from "./ziele.mjs";

const BESCHAEFTIGT = ["CHERRY_PICK_HEAD", "REVERT_HEAD", "MERGE_HEAD", "sequencer", "rebase-merge", "rebase-apply"];
export const gitBeschaeftigt = (z) => BESCHAEFTIGT.some((n) => existsSync(join(z.vault, ".git", n)));

// → { status: "ok" | "nichts", hinweise: [] }
export function nimmCommitZurueck(z, commit, pfade = []) {
  if (gitBeschaeftigt(z)) return { status: "nichts", hinweise: ["git-beschaeftigt"] };
  if (pfade.length) {
    const d = gitSicherLauf(z, ["diff", "--quiet", `${commit}^`, "HEAD", "--", ...pfade]);
    if (d.status === 0) return { status: "nichts", hinweise: [] };
  }
  const r = gitSicherLauf(z, ["revert", "--no-edit", commit]);
  if (r.status === 0) return { status: "ok", hinweise: [] };
  if (existsSync(join(z.vault, ".git", "REVERT_HEAD"))) gitSicherLauf(z, ["revert", "--abort"]);      // nur unser eigener, gerade gescheiterter Aufruf
  return { status: "nichts", hinweise: ["revert-fehlgeschlagen"] };
}
