// gemeinsam/gitwerkzeug.mjs — Kleinigkeiten rund um Git, die Vault-Verwaltung (Klonen, Remote) und Neuanlage teilen:
// Prüfung von Repository-Adressen und eine lokale Git-Identität für frisch angelegte Repos. Keine Abhängigkeiten außer basis/git.
import { userInfo } from "node:os";
import { HttpFehler, testmodus } from "./basis.mjs";
import { git } from "./git.mjs";

// Erlaubt: https://host/pfad · ssh://[nutzer@]host[:port]/pfad · scp-Form nutzer@host:pfad.
// Nie: ext::/Transport-Helfer („x::…“), file://, git://, http://, lokale Pfade, Passwörter in der Adresse, Leerzeichen/Steuerzeichen,
// führendes „-“ (wäre eine Git-Option). Im Testmodus (BRAIN_TESTMODUS=1) sind zusätzlich lokale absolute Pfade und file:// erlaubt.
// Gibt die bereinigte Adresse zurück oder wirft HttpFehler 400.
export function pruefeGitUrl(roh) {
  if (typeof roh !== "string" || !roh.trim()) throw new HttpFehler(400, "Bitte die Adresse des Repositorys eingeben.");
  const url = roh.trim();
  if (url.length > 500) throw new HttpFehler(400, "Die Adresse ist zu lang.");
  if (/[\s\0-\x1f\x7f\\"'`$;|&<>]/.test(url)) throw new HttpFehler(400, "Die Adresse enthält ungültige Zeichen.");
  if (url.startsWith("-")) throw new HttpFehler(400, "Das ist keine gültige Adresse.");
  if (/^[A-Za-z][A-Za-z0-9+.-]*::/.test(url)) throw new HttpFehler(400, "Dieser Adressentyp ist nicht erlaubt. Erlaubt sind https://…, ssh://… und git@host:pfad.");
  if (testmodus() && (/^\//.test(url) || /^file:\/\/\//i.test(url))) return url;

  const host = "[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?";
  let m = new RegExp(`^https://(?:([^/@:]+)(:[^/@]*)?@)?(${host})(?::\\d{1,5})?/([^/].*)$`, "i").exec(url);
  if (m) {
    if (m[2] !== undefined) throw new HttpFehler(400, "Bitte keine Zugangsdaten in die Adresse schreiben — die Anmeldung läuft über Git (z. B. den Schlüsselbund).");
    return url;
  }
  m = new RegExp(`^ssh://(?:([A-Za-z0-9._-]+)@)?(${host})(?::\\d{1,5})?/(.+)$`, "i").exec(url);
  if (m) return url;
  m = new RegExp(`^(?:([A-Za-z0-9._-]+)@)?(${host}):([^/].*)$`).exec(url); // scp-Form: nach dem Doppelpunkt kein „/“ am Anfang (sonst wäre es eine URL)
  if (m) return url;
  throw new HttpFehler(400, "Diese Adresse wird nicht unterstützt. Erlaubt sind https://…, ssh://… und git@host:pfad.");
}

// Frisch angelegte Repos brauchen eine Identität, sonst scheitert der erste Commit (viele Macs haben Git ohne user.name/user.email).
// Fehlt sie überall (system/global/lokal), wird sie NUR in diesem Repo gesetzt: Mac-Benutzername und <name>@localhost.
export async function sorgeFuerIdentitaet(wurzel) {
  const lies = async (k) => { const r = await git(wurzel, ["config", "--get", k]); return r.code === 0 ? r.stdout.trim() : ""; };
  const [n, e] = [await lies("user.name"), await lies("user.email")];
  if (n && e) return;
  let konto = "brain";
  try { konto = userInfo().username || konto; } catch { /* Standardname */ }
  if (!n) await git(wurzel, ["config", "user.name", konto]);
  if (!e) await git(wurzel, ["config", "user.email", `${konto}@localhost`]);
}

// Git-Fehlerausgabe (stderr) → { status, meldung } in Alltagssprache. Reihenfolge zählt: Anmeldung vor „nicht gefunden“.
export function uebersetzeGitFehler(ausgabe, standard = "Git hat den Vorgang abgelehnt.") {
  const a = String(ausgabe || "");
  if (/Authentication failed|could not read (Username|Password)|Permission denied|terminal prompts disabled|access denied|error: 403|publickey/i.test(a)) {
    return { status: 403, meldung: "Zugriff verweigert. Das Repository ist privat oder du bist nicht angemeldet. Melde dich zuerst in Git an (Schlüsselbund oder SSH-Schlüssel) und versuche es noch einmal." };
  }
  if (/Host key verification failed/i.test(a)) {
    return { status: 502, meldung: "Der Server ist diesem Mac noch unbekannt. Verbinde dich einmal im Terminal mit ihm (zum Beispiel „ssh -T git@github.com“) und bestätige den Fingerabdruck." };
  }
  if (/Could not resolve host|Connection (timed out|refused|reset)|Network is unreachable|early EOF|Operation timed out/i.test(a)) {
    return { status: 502, meldung: "Der Server war nicht erreichbar. Prüfe die Internetverbindung und die Adresse." };
  }
  if (/not found|does not exist|does not appear to be a git repository|error: 404/i.test(a)) {
    return { status: 404, meldung: "Dieses Repository gibt es nicht (oder du hast keinen Zugriff darauf)." };
  }
  return { status: 502, meldung: standard };
}
