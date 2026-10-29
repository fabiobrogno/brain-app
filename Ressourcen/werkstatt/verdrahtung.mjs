// werkstatt/verdrahtung.mjs — „Kortex richtet sich ein“ (Kern-Umzug P6): Hooks und Statuszeile in Claude Code, die Passwort-Prüfung vor jedem Commit
// im Versionsverlauf des Vaults und der Hintergrunddienst. Alles läuft über den STARTER der App (Support/Kortex/bin/kortex), der KORTEX_KERN_PFAD auf den
// stabilen Symlink bin/kern setzt — die Installer des Kerns tragen nur diesen festen Pfad ein, nie einen Versionsordner oder einen Pfad im App-Paket
// (so bleibt alles nach einem App-Update gültig). Jeder Schritt hat einen Rückweg („aus“); Fremdes in den Einstellungen anderer Programme bleibt.
//   GET  /api/kern/stand       → { starter, claude, git, dienst } (liest nur)
//   POST /api/kern/verdrahten  { was: "claude" | "git" | "dienst", an: true|false, ersetzen?: true } → { ok, ausgabe, stand }
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { HttpFehler, kindUmgebung, testmodus } from "../gemeinsam/basis.mjs";
import { starte, neueFrist } from "../gemeinsam/prozess.mjs";

const FRIST = 30_000;
const kurz = (t) => String(t || "").trim().split("\n").filter(Boolean).slice(0, 6).join("\n").slice(0, 600);

export function erzeugeVerdrahtung({ starter, istVorschau = () => !!process.env.KORTEX_VORSCHAU }) {
  const vorhanden = () => existsSync(starter);

  async function lauf(args, frist) {
    if (!vorhanden()) {
      throw new HttpFehler(409, "Der Starter von Kortex fehlt noch. Starte Kortex einmal neu, dann wird er angelegt — danach geht es hier weiter.", { art: "kein-starter" });
    }
    return starte(starter, args, {
      cwd: homedir(), env: kindUmgebung(), timeout: FRIST, frist, fehlt: "Der Starter von Kortex wurde nicht gefunden.",
      zuLange: "Das hat zu lange gedauert und wurde abgebrochen. Es wurde nichts Halbes hinterlassen — versuche es noch einmal.",
    });
  }
  const json = (r) => { try { return JSON.parse(String(r.stdout || "").trim().split("\n").pop()); } catch { return null; } };

  // Eine Meldung für Menschen aus dem Ergebnis eines gescheiterten Laufs.
  function fehlerAus(r, was) {
    const text = kurz(r.stderr) || kurz(r.stdout);
    if (r.code === 3 || /stabilen Kern-Pfad/.test(text)) {
      return new HttpFehler(409, "Kortex ist noch nicht ganz eingerichtet: der feste Programmpfad fehlt. Öffne Kortex bitte aus dem Ordner „Programme“ (nicht aus dem Download-Ordner) und versuche es dann noch einmal.", { art: "nicht-stabil", ausgabe: text });
    }
    if (r.code === 4) {
      return new HttpFehler(409, "In diesem Vault ist schon eine andere Prüfung vor dem Speichern eingetragen. Kortex lässt sie unverändert, solange du nicht ausdrücklich „Ersetzen“ wählst.", { art: "anders", ausgabe: text });
    }
    if (r.code === 2) return new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true, ausgabe: text });
    if (r.code === 127) return new HttpFehler(409, "Kortex ist noch nicht vollständig bereit (Node oder der Kern fehlt). Starte Kortex neu und versuche es noch einmal.", { art: "kein-starter", ausgabe: text });
    return new HttpFehler(502, `${was} hat nicht geklappt.${text ? ` ${text.split("\n")[0]}` : ""}`, { ausgabe: text });
  }

  async function stand(v) {
    const frist = neueFrist(FRIST);
    const aus = { starter: { vorhanden: vorhanden() }, claude: null, git: null, dienst: null };
    if (!aus.starter.vorhanden) return { ...aus, dienst: { verfuegbar: false } };
    const vorschau = istVorschau();
    const abschnitt = async (args, ok) => {
      try { const r = await lauf(args, frist); const j = r.code === 0 ? json(r) : null; return j ? ok(j) : { fehler: kurz(r.stderr) || "unbekannt" }; }
      catch (e) { return { fehler: e && e.message ? e.message : "unbekannt" }; }
    };
    const vaultArgs = v ? ["--vault", v.wurzel] : [];
    const [claude, git, dienst] = await Promise.all([
      abschnitt(["claude-hooks", "--stand"], (j) => ({ aktiv: !!j.aktiv, hooks: j.hooks, statuszeile: j.statuszeile, befehle: j.befehle })),
      v && (await v.istGitRepo()) ? abschnitt(["hooks-install", ...vaultArgs, "--stand"], (j) => ({ moeglich: true, aktiv: !!j.aktiv, fremder: !!j.fremder })) : Promise.resolve({ moeglich: false }),
      process.platform === "darwin" && !vorschau && v && (!testmodus() || process.env.BRAIN_LAUNCHCTL)
        ? abschnitt(["dienst", "status", "--json", ...vaultArgs], (j) => ({ verfuegbar: true, eingerichtet: !!j.eingerichtet, geladen: !!j.geladen }))
        : Promise.resolve({ verfuegbar: false }),
    ]);
    return { ...aus, claude, git, dienst };
  }

  async function verdrahte(v, e) {
    const an = e.an === true;
    if (typeof e.an !== "boolean") throw new HttpFehler(400, "„an“ muss true oder false sein.");
    const frist = neueFrist(FRIST);
    let args, was;
    if (e.was === "claude") {
      if (an && !v) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true });
      args = an ? ["claude-hooks", "--vault", v.wurzel] : ["claude-hooks", "--entfernen"];
      was = "Das Eintragen bei Claude Code";
    } else if (e.was === "git") {
      if (!v) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true });
      if (!(await v.istGitRepo())) throw new HttpFehler(409, "Dieser Ordner hat keinen Versionsverlauf — die Prüfung vor dem Speichern gibt es nur mit einem.", { art: "kein-git" });
      args = ["hooks-install", "--vault", v.wurzel, ...(an ? (e.ersetzen === true ? ["--ersetzen"] : []) : ["--aus"])];
      was = "Das Einschalten der Prüfung";
    } else if (e.was === "dienst") {
      if (process.platform !== "darwin") throw new HttpFehler(409, "Den Hintergrunddienst gibt es nur auf dem Mac.", { art: "kein-mac" });
      // Ein echter LaunchAgent gehört nie in die Vorschau oder in einen Test: dort würde macOS ihn wirklich laden.
      if (istVorschau()) throw new HttpFehler(409, "In der Vorschau wird kein Hintergrunddienst eingerichtet.", { art: "vorschau" });
      if (testmodus() && !process.env.BRAIN_LAUNCHCTL) throw new HttpFehler(409, "Im Testmodus ist kein echter Hintergrunddienst erlaubt.", { art: "testmodus" });
      if (!v) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true });
      args = ["dienst", an ? "an" : "aus", "--vault", v.wurzel];
      was = "Der Hintergrunddienst";
    } else throw new HttpFehler(400, "„was“ muss claude, git oder dienst sein.");
    const r = await lauf(args, frist);
    if (r.code !== 0) throw fehlerAus(r, was);
    return { ok: true, ausgabe: kurz(r.stdout), stand: await stand(v) };
  }

  return { stand, verdrahte };
}
