// werkstatt/verdrahtung.mjs — „Kortex richtet sich ein“ (Kern-Umzug P6): Hooks und Statuszeile in Claude Code, die Passwort-Prüfung vor jedem Commit
// im Versionsverlauf des Vaults und der Hintergrunddienst. Alles läuft über den STARTER der App (Support/Kortex/bin/kortex), der KORTEX_KERN_PFAD auf den
// stabilen Symlink bin/kern setzt — die Installer des Kerns tragen nur diesen festen Pfad ein, nie einen Versionsordner oder einen Pfad im App-Paket
// (so bleibt alles nach einem App-Update gültig). Jeder Schritt hat einen Rückweg („aus“); Fremdes in den Einstellungen anderer Programme bleibt.
//   GET  /api/kern/stand       → { starter, profile: [{pfad, name, standard}], claude: { profile: { <pfad>: {aktiv, …} } }, git, dienst } (liest nur)
//   POST /api/kern/verdrahten  { was: "claude" | "git" | "dienst", an: true|false, ersetzen?: true, profile?: [<pfad>], profil?: <pfad> } → { ok, ausgabe, stand }
//   Hintergrunddienst: läuft nur für Vaults, für die er eingeschaltet wurde (tageslauf/dienst-merker.mjs); `eingerichtet` heißt: für DIESEN Vault.
//   Claude-Profile (profile.mjs): die App kennt CLAUDE_CONFIG_DIR nicht (Start aus dem Finder). „claude“ wirkt auf die gewählten Profile (Pfade aus der erkannten
//   Liste, je Profil --claude-home); „dienst“ schreibt KEIN Profil mehr in die plist (docs/plaene/ki-konten.md, P3): das Konto der Pflege steht je Vault in der Liste der KI-Konten
//   (POST /api/ki/pflege). Ein mitgeschicktes `profil` (alter Assistent) wird nur noch als Vorschlag gelesen: hat das Konto dieses Profils für den Vault „erweitert“ und gibt es noch
//   keine Pflege-Einstellung, wird es das Pflege-Konto (Stufe mittel).
//   POST /api/ki/pflege/jetzt → Tageslauf des offenen Vaults einmal im Hintergrund starten (jetztPflegen)
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { HttpFehler, kindUmgebung, testmodus } from "../gemeinsam/basis.mjs";
import { starte, neueFrist } from "../gemeinsam/prozess.mjs";
import { erkenneProfile, profilZuPfad, mitProfil } from "./profile.mjs";

const FRIST = 30_000;
const NICHT_VERTRAUT = "Das geht erst, wenn du diesem Vault vertraust: Bestätige ihn in der Statusleiste des Studios („Nur ansehen“). Bis dahin tut Kortex an diesem Vault nichts außer Lesen und Suchen.";
const kurz = (t) => String(t || "").trim().split("\n").filter(Boolean).slice(0, 6).join("\n").slice(0, 600);

export function erzeugeVerdrahtung({ starter, support = null, istVorschau = () => !!process.env.KORTEX_VORSCHAU, kontoFuerProfil = () => null, freigeben = null, pflegeAusProfil = null }) {
  const vorhanden = () => existsSync(starter);

  async function lauf(args, frist, profil = undefined) {
    if (!vorhanden()) {
      throw new HttpFehler(409, "Der Starter von Kortex fehlt noch. Starte Kortex einmal neu, dann wird er angelegt — danach geht es hier weiter.", { art: "kein-starter" });
    }
    return starte(starter, args, {
      cwd: homedir(), env: profil === undefined ? kindUmgebung(support ? { BRAIN_APP_SUPPORT: support } : {}) : mitProfil(kindUmgebung(support ? { BRAIN_APP_SUPPORT: support } : {}), profil), timeout: FRIST, frist, fehlt: "Der Starter von Kortex wurde nicht gefunden.",
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
    const profile = erkenneProfile(undefined, support);
    const aus = { starter: { vorhanden: vorhanden() }, profile, claude: null, git: null, dienst: null };
    if (!aus.starter.vorhanden) return { ...aus, dienst: { verfuegbar: false } };
    const vorschau = istVorschau();
    const abschnitt = async (args, ok) => {
      try { const r = await lauf(args, frist); const j = r.code === 0 ? json(r) : null; return j ? ok(j) : { fehler: kurz(r.stderr) || "unbekannt" }; }
      catch (e) { return { fehler: e && e.message ? e.message : "unbekannt" }; }
    };
    const vaultArgs = v ? ["--vault", v.wurzel] : [];
    const profilStand = async () => {
      const liste = await Promise.all(profile.map(async (pr) => [pr.pfad, await abschnitt(["claude-hooks", "--stand", "--claude-home", pr.pfad], (j) => ({ aktiv: !!j.aktiv, hooks: j.hooks, statuszeile: j.statuszeile, befehle: j.befehle }))]));
      return { profile: Object.fromEntries(liste) };
    };
    const [claude, git, dienst] = await Promise.all([
      profilStand(),
      // Ohne Vertrauen (P5) tut der Kern nichts am Vault: die Prüfung vor dem Speichern lässt sich dann nicht einschalten
      v && (await v.istGitRepo()) && v.vertrauenStand().erlaubt ? abschnitt(["hooks-install", ...vaultArgs, "--stand"], (j) => ({ moeglich: true, aktiv: !!j.aktiv, fremder: !!j.fremder })) : Promise.resolve({ moeglich: false }),
      process.platform === "darwin" && !vorschau && v && (!testmodus() || process.env.BRAIN_LAUNCHCTL)
        ? abschnitt(["dienst", "status", "--json", ...vaultArgs], (j) => ({ verfuegbar: true, eingerichtet: !!j.eingerichtet && !!j.fuerDiesenVault, geladen: !!j.geladen }))
        : Promise.resolve({ verfuegbar: false }),
    ]);
    return { ...aus, claude, git, dienst };
  }

  async function verdrahte(v, e) {
    const an = e.an === true;
    if (typeof e.an !== "boolean") throw new HttpFehler(400, "„an“ muss true oder false sein.");
    if (!vorhanden()) throw new HttpFehler(409, "Der Starter von Kortex fehlt noch. Starte Kortex einmal neu, dann wird er angelegt — danach geht es hier weiter.", { art: "kein-starter" });
    const frist = neueFrist(FRIST);
    let args, was, dienstProfilWunsch;
    let claudeLaeufe = null;
    if (e.was === "claude") {
      if (an && !v) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true });
      if (an && !v.vertrauenStand().erlaubt) throw new HttpFehler(409, NICHT_VERTRAUT, { art: "nicht-vertraut" }); // Befehle und Hinweise für die KI nur für einen vertrauten Vault
      // Profile: nur Pfade aus der erkannten Liste (nie ein frei gewählter Pfad); ohne Angabe das Standardprofil, falls es eines gibt.
      const gewuenscht = e.profile === undefined ? erkenneProfile(undefined, support).filter((p) => p.standard).map((p) => p.pfad) : e.profile;
      if (!Array.isArray(gewuenscht) || gewuenscht.some((x) => typeof x !== "string")) throw new HttpFehler(400, "„profile“ muss eine Liste von Pfaden sein.");
      const gewaehlt = [...new Set(gewuenscht)].map((x) => profilZuPfad(x, undefined, support));
      if (!gewaehlt.length) throw new HttpFehler(409, "Es ist kein Claude-Profil gewählt.", { art: "kein-profil" });
      if (gewaehlt.some((x) => !x)) throw new HttpFehler(409, "Eines der Claude-Profile gibt es nicht mehr. Suche die Profile bitte neu.", { art: "profil-weg" });
      // KI-Konten: die Hook-Befehle des Profils tragen `--konto <id>` (der Hook weiß, für welches Konto er läuft; ohne Konto bleibt es die Altform).
      // Wer die Hooks eines Profils einträgt, kann dem Konto dabei den offenen Vault freigeben ({ zugriff: <Stufe> }); ohne Angabe bleibt die Liste der KI-Konten maßgeblich.
      if (e.zugriff !== undefined && an) {
        if (!["gesperrt", "lesen", "posteingang", "erweitert"].includes(e.zugriff)) throw new HttpFehler(400, "„zugriff“ muss gesperrt, lesen, posteingang oder erweitert sein.");
        for (const pr of gewaehlt) { const k = kontoFuerProfil(pr.pfad); if (k && freigeben) freigeben(k, v, e.zugriff, e.zugriffAusdruecklich === true); }
      }
      claudeLaeufe = gewaehlt.map((pr) => { const k = an ? kontoFuerProfil(pr.pfad) : null; return { pr, args: an ? ["claude-hooks", "--vault", v.wurzel, "--claude-home", pr.pfad, ...(k ? ["--konto", k] : [])] : ["claude-hooks", "--entfernen", "--claude-home", pr.pfad] }; });
      was = "Das Eintragen bei Claude Code";
    } else if (e.was === "git") {
      if (!v) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true });
      if (an && !v.vertrauenStand().erlaubt) throw new HttpFehler(409, NICHT_VERTRAUT, { art: "nicht-vertraut" });
      if (!(await v.istGitRepo())) throw new HttpFehler(409, "Dieser Ordner hat keinen Versionsverlauf — die Prüfung vor dem Speichern gibt es nur mit einem.", { art: "kein-git" });
      args = ["hooks-install", "--vault", v.wurzel, ...(an ? (e.ersetzen === true ? ["--ersetzen"] : []) : ["--aus"])];
      was = "Das Einschalten der Prüfung";
    } else if (e.was === "dienst") {
      if (process.platform !== "darwin") throw new HttpFehler(409, "Den Hintergrunddienst gibt es nur auf dem Mac.", { art: "kein-mac" });
      // Ein echter LaunchAgent gehört nie in die Vorschau oder in einen Test: dort würde macOS ihn wirklich laden.
      if (istVorschau()) throw new HttpFehler(409, "In der Vorschau wird kein Hintergrunddienst eingerichtet.", { art: "vorschau" });
      if (testmodus() && !process.env.BRAIN_LAUNCHCTL) throw new HttpFehler(409, "Im Testmodus ist kein echter Hintergrunddienst erlaubt.", { art: "testmodus" });
      if (!v) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true });
      if (an && !v.vertrauenStand().erlaubt) throw new HttpFehler(409, NICHT_VERTRAUT, { art: "nicht-vertraut" });
      args = ["dienst", an ? "an" : "aus", "--vault", v.wurzel];
      was = "Der Hintergrunddienst";
      // Ein mitgeschicktes Profil kommt nicht mehr in die plist; es schlägt nur das Pflege-Konto vor (nach dem Einrichten, siehe unten).
      if (e.profil !== undefined) {
        dienstProfilWunsch = profilZuPfad(e.profil, undefined, support);
        if (!dienstProfilWunsch) throw new HttpFehler(409, "Das Claude-Profil gibt es nicht mehr. Suche die Profile bitte neu.", { art: "profil-weg" });
      }
    } else throw new HttpFehler(400, "„was“ muss claude, git oder dienst sein.");
    if (claudeLaeufe) {
      // Jedes Profil für sich (atomar, mit eigenem Backup); ein Fehler stoppt nicht die übrigen, wird aber gemeldet.
      const ausgaben = []; let erster = null;
      for (const { pr, args: a } of claudeLaeufe) {
        const r = await lauf(a, frist);
        if (r.code === 0) ausgaben.push(`${pr.name}: ${kurz(r.stdout)}`);
        else erster ||= { r, name: pr.name };
      }
      if (erster) { const f = fehlerAus(erster.r, was); if (claudeLaeufe.length > 1) f.message = `${erster.name}: ${f.message}`; throw f; }
      return { ok: true, ausgabe: ausgaben.join("\n").slice(0, 600), stand: await stand(v) };
    }
    const r = await lauf(args, frist);
    if (r.code !== 0) throw fehlerAus(r, was);
    if (dienstProfilWunsch && an && pflegeAusProfil) { try { pflegeAusProfil(v, dienstProfilWunsch.pfad); } catch { /* der Vorschlag ist nur eine Zugabe */ } }
    return { ok: true, ausgabe: kurz(r.stdout), stand: await stand(v) };
  }

  // „Jetzt pflegen“: der Tageslauf dieses Vaults, einmal, im Hintergrund (derselbe Weg wie der Dienst: Starter, dann brain tageslauf). Er richtet sich nach den Schaltern des Vaults
  // (tageslauf aus/probe/an) und nach dem Pflege-Konto und der Stufe aus der Liste der KI-Konten.
  // Vorher geprüft (409 mit ehrlichem Satz statt eines Starts, der gleich wieder endet): Schalter „aus“ · läuft schon einer (Sperre des Kerns, `laeuft`) · eine kurze Sperre je Vault gegen Mehrfachklicks.
  // `gestartet: true` nur, wenn der Kern den losgelösten Lauf wirklich gestartet hat.
  const kurzGesperrt = new Map();
  async function jetztPflegen(v, { schalter = () => "an", laeuft = () => false } = {}) {
    if (!v) throw new HttpFehler(409, "Es ist noch kein Vault geöffnet.", { keinVault: true });
    if (!v.vertrauenStand().erlaubt) throw new HttpFehler(409, NICHT_VERTRAUT, { art: "nicht-vertraut" });
    if (istVorschau()) throw new HttpFehler(409, "In der Vorschau wird nichts gepflegt.", { art: "vorschau" });
    const s = schalter(v.wurzel);
    if (s === "aus") throw new HttpFehler(409, "Die Pflege ist für diesen Vault ausgeschaltet. Schalte sie unter Einstellungen → Automatik ein (oder auf Probe), dann geht es hier.", { art: "schalter-aus" });
    if (laeuft(v.wurzel)) throw new HttpFehler(409, "Die Pflege läuft gerade schon. Das Ergebnis steht danach hier.", { art: "laeuft-schon" });
    const jetzt = Date.now();
    if ((kurzGesperrt.get(v.wurzel) || 0) > jetzt) throw new HttpFehler(409, "Die Pflege wurde gerade erst gestartet. Warte einen Moment, das Ergebnis steht danach hier.", { art: "laeuft-schon" });
    kurzGesperrt.set(v.wurzel, jetzt + 20_000);
    try {
      const r = await lauf(["tageslauf", "--losgeloest", "--vault", v.wurzel], neueFrist(FRIST));
      if (r.code !== 0) throw fehlerAus(r, "Das Pflegen");
      const aus = kurz(r.stdout);
      if (!/läuft im Hintergrund/.test(aus)) throw new HttpFehler(409, `Die Pflege wurde nicht gestartet${aus ? `: ${aus.replace(/^Tageslauf nicht gestartet:\s*/, "")}` : "."}`, { art: "nicht-gestartet" });
      return { ok: true, gestartet: true, ...(s === "probe" ? { probe: true } : {}) };
    } catch (e) { kurzGesperrt.delete(v.wurzel); throw e; }
  }

  return { stand, verdrahte, jetztPflegen };
}
