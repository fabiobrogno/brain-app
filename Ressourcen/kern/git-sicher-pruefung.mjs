// git-sicher-pruefung.mjs — Erlaubnisliste für die Repo-Konfiguration in Node (Plattform-Paket „Windows grün“, Gruppe G3).
//
// Wortgetreue Übersetzung von git-sicher-pruefung.pl (Perl), gleiche Aufrufe, gleiche Ausgabe, gleiche Exit-Codes:
//   node git-sicher-pruefung.mjs <git> <ordner> [--alle]
// Der Perl-Fassung bleibt die Arbeit von git-sicher (macOS/Linux: das Skript ist dort unverändert). Diese Fassung läuft, wo es kein Perl gibt (Windows) und
// für den Befund der Umstellung (umstellung/git-lage.mjs#pruefungAlle). Tests/Kern/test-git-sicher-liste.mjs vergleicht beide Fassungen an denselben Fällen.
// Erläuterungen zu Regeln und Listen stehen im Kopf von git-sicher-pruefung.pl; sie gelten hier unverändert.
//
// Wie in Perl wird die Ausgabe von git als BYTES gelesen (latin1: ein Zeichen = ein Byte); Kleinschreibung nur für ASCII; `$` in Mustern lässt ein
// abschließendes "\n" zu (Perl-Verhalten), `\s` meint nur ASCII-Leerraum.
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NWS = "[^ \\t\\n\\r\\f\\v]";
const lc = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const def = (w) => w !== undefined && w !== null;
const re = (src, flags = "") => new RegExp(src, flags);
const passt = (w, r) => def(w) && r.test(w);

const wahr = (w) => passt(w, /^(?:true|false|yes|no|on|off|0|1)\n?$/i);
const falsch = (w) => passt(w, /^(?:false|no|off|0)\n?$/i);
const text = (w) => def(w) && !/[\x00-\x08\x0b-\x1f\x7f]/.test(w);
const zahl = (w) => passt(w, /^[0-9]{1,9}\n?$/);
const zeit = (w) => passt(w, /^(?:never|now|[0-9][0-9A-Za-z. ]{0,40})\n?$/i);
const person_ok = (w) => def(w) && w.length > 0 && !/[;$`|&<>\\\x00-\x1f\x7f]/.test(w);

function url_ok(u, env) {
  if (!(def(u) && u.length > 0 && !/[\x00-\x1f\x7f]/.test(u) && !/^-/.test(u))) return false;
  if (re(`^https://[A-Za-z0-9_\\[][^ \\t\\n\\r\\f\\v/]*(?:/${NWS}*)?\\n?$`).test(u)) return true;
  if (re(`^ssh://[A-Za-z0-9_\\[][^ \\t\\n\\r\\f\\v/]*(?:/${NWS}*)?\\n?$`).test(u)) return true;
  if (re(`^[A-Za-z0-9_][A-Za-z0-9_.-]*@[A-Za-z0-9\\[][A-Za-z0-9_.:\\]-]*:${NWS}*\\n?$`).test(u) && !/::/.test(u)) return true;
  // Lokale Adressen nur in der Testumgebung (siehe Perl-Fassung); unter Windows zählt dort auch ein Laufwerkspfad
  if (!(env.KORTEX_KERN_UNSTABIL_ERLAUBT === "1" || env.BRAIN_TESTMODUS === "1")) return false;
  if (/^\/[^\x00-\x1f]*\n?$/.test(u) && !/^\/\//.test(u)) return true;
  if (/^file:\/\/\/[^\x00-\x1f]*\n?$/.test(u)) return true;
  if (process.platform === "win32" && /^[A-Za-z]:[\\/][^\x00-\x1f]*\n?$/.test(u)) return true;
  return false;
}

const OHNE = {
  "core.repositoryformatversion": (w) => passt(w, /^[01]\n?$/),
  "core.filemode": wahr,
  "core.bare": falsch,
  "core.logallrefupdates": (w) => wahr(w) || (def(w) && lc(w) === "always"),
  "core.ignorecase": wahr,
  "core.precomposeunicode": wahr,
  "core.symlinks": wahr,
  "core.longpaths": wahr,
  "core.autocrlf": (w) => wahr(w) || (def(w) && lc(w) === "input"),
  "core.eol": (w) => passt(w, /^(?:lf|crlf|native)\n?$/i),
  "core.safecrlf": (w) => wahr(w) || (def(w) && lc(w) === "warn"),
  "core.quotepath": wahr,
  "core.hookspath": text,
  "user.name": person_ok,
  "user.email": person_ok,
  "pull.rebase": (w) => wahr(w) || passt(w, /^(?:merges|interactive)\n?$/i),
  "pull.ff": (w) => wahr(w) || (def(w) && lc(w) === "only"),
  "merge.ff": (w) => wahr(w) || (def(w) && lc(w) === "only"),
  "push.default": (w) => passt(w, /^(?:nothing|current|upstream|tracking|simple|matching)\n?$/i),
  "push.autosetupremote": wahr,
  "init.defaultbranch": (w) => passt(w, /^[A-Za-z0-9_][A-Za-z0-9_./-]*\n?$/),
  "fetch.prune": wahr,
  "rebase.autostash": wahr,
  "commit.gpgsign": wahr,
  "tag.gpgsign": wahr,
  "push.gpgsign": (w) => wahr(w) || (def(w) && lc(w) === "if-asked"),
  "extensions.objectformat": (w) => passt(w, /^(?:sha1|sha256)\n?$/i),
  "extensions.worktreeconfig": wahr,
};
const GC = {
  "gc.auto": zahl, "gc.autopacklimit": zahl, "gc.autodetach": wahr,
  "gc.pruneexpire": zeit, "gc.reflogexpire": zeit, "gc.reflogexpireunreachable": zeit, "gc.worktreepruneexpire": zeit,
};
const MIT = {
  "remote.*.url": (w, env) => url_ok(w, env),
  "remote.*.pushurl": (w, env) => url_ok(w, env),
  "remote.*.fetch": (w) => passt(w, /^[+^]?[^ \t\n\r\f\v\x00-\x1f\x7f-][^ \t\n\r\f\v\x00-\x1f\x7f]*\n?$/),
  "branch.*.remote": (w) => passt(w, /^(?:\.|[A-Za-z0-9_][A-Za-z0-9_.-]*)\n?$/),
  "branch.*.pushremote": (w) => passt(w, /^[A-Za-z0-9_][A-Za-z0-9_.-]*\n?$/),
  "branch.*.merge": (w) => passt(w, /^[^ \t\n\r\f\v\x00-\x1f\x7f-][^ \t\n\r\f\v]*\n?$/),
  "branch.*.rebase": (w) => wahr(w) || passt(w, /^(?:merges|interactive)\n?$/i),
  "branch.*.description": text,
  "branch.*.vscode-merge-base": text,
};
const hat = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Prüft die rohe Ausgabe von `git config --list --show-scope --includes -z` → { ausgabe: [Zeilen], exit }
export function pruefeKonfiguration(roh, { alle = false, env = process.env } = {}) {
  const aus = [];
  const t = roh.split("\0");
  if (t.length && t[t.length - 1] === "") t.pop();
  if (t.length % 2) return { ausgabe: ["REFUSE\t(unerwartete Ausgabe von git config)"], exit: 1 };
  let hooks;
  const gesehen = new Set();
  let verboten = false;
  for (let i = 0; i + 1 <= t.length - 1; i += 2) {
    const scope = t[i], eintrag = t[i + 1];
    if (!(scope === "local" || scope === "worktree")) continue;
    const nl = eintrag.indexOf("\n");
    const schluessel = nl < 0 ? eintrag : eintrag.slice(0, nl);
    const wert = nl < 0 ? undefined : eintrag.slice(nl + 1);
    const name = schluessel.replace(/[^\x20-\x7e]/g, "?").slice(0, 120);
    const punkt = schluessel.indexOf(".");
    const abschnitt = punkt < 0 ? schluessel : schluessel.slice(0, punkt);
    const rest = punkt < 0 ? undefined : schluessel.slice(punkt + 1);
    let ok = false;
    if (def(rest)) {
      let unter, v;
      const m = /^([\s\S]*)\.([^.]*)$/.exec(rest);
      if (m) { unter = m[1]; v = m[2]; } else { unter = undefined; v = rest; }
      const a = lc(abschnitt);
      if (!def(unter)) {
        const k = `${a}.${lc(v)}`;
        if (hat(GC, k)) ok = !!GC[k](wert);
        else if (hat(OHNE, k)) { ok = !!OHNE[k](wert); if (k === "core.hookspath" && ok) hooks = wert; }
      } else {
        const k = `${a}.*.${lc(v)}`;
        ok = hat(MIT, k) && unter !== "" ? !!MIT[k](wert, env) : false;
      }
    }
    if (!ok) {
      if (!gesehen.has(name)) { gesehen.add(name); aus.push(`REFUSE\t${name}`); }
      if (!alle) return { ausgabe: aus, exit: 1 };
      verboten = true;
    }
  }
  if (verboten) return { ausgabe: aus, exit: 1 };
  aus.push("OK");
  if (def(hooks)) aus.push(`HOOKSPATH\t${hooks}`);
  return { ausgabe: aus, exit: 0 };
}

// Ganzer Ablauf wie das Perl-Skript: git starten, prüfen. → { ausgabe, exit }
export function pruefe(git, ordner, { alle = false, env = process.env } = {}) {
  const r = spawnSync(git, ["-C", ordner, "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "protocol.ext.allow=never",
    "config", "--list", "--show-scope", "--includes", "-z"], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024, windowsHide: true, env: process.env });
  if (r.error || r.status !== 0) return { ausgabe: ["REFUSE\t(git config --list schlug fehl)"], exit: 1 };
  return pruefeKonfiguration(Buffer.from(r.stdout || "").toString("latin1"), { alle, env });
}

// Kommandozeile (nur, wenn direkt gestartet)
const direkt = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (direkt) {
  const argumente = process.argv.slice(2);
  const alle = argumente.includes("--alle");
  const [git, ordner] = argumente.filter((a) => a !== "--alle");
  if (git === undefined || ordner === undefined) process.exit(2);
  const { ausgabe, exit } = pruefe(git, ordner, { alle });
  if (ausgabe.length) process.stdout.write(ausgabe.join("\n") + "\n", () => process.exit(exit)); else process.exit(exit);
}
