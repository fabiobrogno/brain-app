// Gemeinsame Hilfen der konflikt-werkstatt-*.test.mjs: Umgebung (HOME, Support-Ordner), Wegwerf-Repos mit Bare-Remote, Konflikt aufbauen.
// Früher war das EINE Testdatei. Unter Windows (ein Node-Start je git-Aufruf) brauchte sie rund 230 s und riss mehrfach das Limit von 240 s je Datei.
// node:test führt die Fälle einer Datei nacheinander aus, Dateien dagegen parallel: darum sind die Fälle auf vier Dateien verteilt (je unter ~80 s dort, gemessen aus dem Log von Lauf 42374136550 mit der git-Schranke).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmp, schreibe, repo, g, pfad } from "./hilfe.mjs";
export { tmp, schreibe, g, pfad };
process.env.HOME = tmp("brain-home-"); if (process.platform === "win32") process.env.USERPROFILE = process.env.HOME; /* Windows: os.homedir() liest USERPROFILE */
process.env.GIT_CONFIG_NOSYSTEM = "1";

export const { oeffneVault, HttpFehler } = await import(pfad("gemeinsam", "vault.mjs"));
export const { erzeugeHandler } = await import(pfad("werkstatt", "handler.mjs"));
export const { kennung, merkeRemoteBestaetigt } = await import(pfad("gemeinsam", "sicherungsmerker.mjs"));
export const wirft = async (p) => { try { await p; } catch (e) { assert.ok(e instanceof HttpFehler, String(e && e.stack)); return e; } assert.fail("kein Fehler"); };

export function mitRemote({ bestaetigt = true } = {}) {
  const bare = tmp("brain-bare-");
  g(bare, "init", "-q", "--bare", "-b", "main");
  const a = repo();
  g(a, "remote", "add", "origin", bare);
  g(a, "push", "-q", "-u", "origin", "main");
  const b = tmp("brain-klon-");
  g(b, "clone", "-q", bare, ".");
  g(b, "config", "core.autocrlf", "false"); /* Windows: Git for Windows stellt sonst CRLF her */ g(b, "config", "user.name", "B"); g(b, "config", "user.email", "b@Fabios-iPhone.local");
  if (bestaetigt) merkeRemoteBestaetigt(a, bare, { support: process.env.BRAIN_APP_SUPPORT }); // das Ziel ist vom Nutzer bestätigt (Assistent „Sicherung“)
  return { bare, a, b, v: oeffneVault(a) };
}
export const commitIn = (d, datei, inhalt, msg, push = false) => { schreibe(d, datei, inhalt); g(d, "add", "--", datei); g(d, "commit", "-q", "-m", msg); if (push) g(d, "push", "-q"); };
export const lies = (d, rel) => readFileSync(join(d, rel), "utf8");
// Lösen wie die Oberfläche: mit dem gesehenen Stand
export const loesen = async (v, auswahl) => { const an = await v.gitKonfliktAnsicht(); return v.gitKonfliktLoesen({ auswahl, gesehen: { meine: an.meine, andere: an.andere } }); };
export async function konfliktAufbauen(opt) {
  const x = mitRemote(opt);
  commitIn(x.b, "start.md", "# Start\nVersion von B\n", "B ändert start\n\nKortex-Geraet: Fabios iPhone", true);
  commitIn(x.a, "start.md", "# Start\nVersion von A\n", "A ändert start");
  const e = await wirft(x.v.gitSync({ konflikteLoesen: true }));
  return { ...x, e };
}
