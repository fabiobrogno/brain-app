// gemeinsam/github.mjs — Anmeldung bei GitHub per Gerätecode (OAuth Device Flow), ohne Terminal.
// Das Token landet NUR über `git credential approve` im Schlüsselbund (Helper osxkeychain). Es steht nie in einer Datei, einem Log,
// vaults.json oder einer Antwort; im Speicher lebt es nur bis zum Speichern. Die Client-ID ist eine öffentliche Einstellung
// (Info.plist `KortexGitHubClientID` → Umgebung `KORTEX_GITHUB_CLIENT_ID`); fehlt sie, ist die Anmeldung „nicht verfügbar“.
import { HttpFehler, kindUmgebung, absoluterGitPfad, testmodus } from "./basis.mjs";
import { starte } from "./prozess.mjs";

const SCOPE = "repo"; // Klonen und Pushen privater Repos
const NETZ_FRIST = 15_000;
const GIT_FRIST = 15_000;
const SLOW_DOWN_PLUS = 5; // Sekunden laut GitHub-Doku
const MAX_ABLAUF = 3600; // nie länger als eine Stunde pollen, egal was der Server sagt

const standardWarte = (ms) => new Promise((ok) => setTimeout(ok, ms).unref());

// opt: { clientId, basis, apiBasis, helper, fetch, warte, jetzt, log, git }
//   basis/apiBasis/helper sind nur im Testmodus änderbar (BRAIN_TESTMODUS=1), sonst feste GitHub-Werte und osxkeychain.
//   git(args, stdin) → { code, stdout }: Ersatz für den Git-Aufruf (Tests). Standard: System-git mit zurückgesetzter Helper-Liste.
export function erzeugeGitHub(opt = {}) {
  const frei = testmodus();
  const clientId = typeof opt.clientId === "string" ? opt.clientId.trim() : "";
  const basis = new URL(frei && opt.basis ? opt.basis : "https://github.com");
  const apiBasis = (frei && opt.apiBasis ? opt.apiBasis : "https://api.github.com").replace(/\/$/, "");
  const helper = frei && opt.helper ? opt.helper : "osxkeychain";
  const holen = opt.fetch || globalThis.fetch;
  const warte = opt.warte || standardWarte;
  const jetzt = opt.jetzt || Date.now;
  const log = opt.log || ((m) => console.error(`[github] ${m}`));
  const verfuegbar = /^[A-Za-z0-9._-]{3,100}$/.test(clientId);
  if (!verfuegbar) log(clientId ? "KortexGitHubClientID ist ungültig — GitHub-Anmeldung ausgeblendet." : "KortexGitHubClientID fehlt — GitHub-Anmeldung ausgeblendet.");

  // Git-Aufruf an den Schlüsselbund: die Helper-Liste wird zuerst geleert, damit genau EIN Helper zuständig ist.
  const gitAufruf = opt.git || (async (args, stdin) => {
    const programm = absoluterGitPfad();
    if (!programm) throw new HttpFehler(500, "Git ist auf diesem Mac nicht installiert.");
    const env = kindUmgebung({ GIT_TERMINAL_PROMPT: "0" });
    const r = await starte(programm, ["-c", "credential.helper=", "-c", `credential.helper=${helper}`, "credential", ...args],
      { cwd: process.env.HOME || "/", env, timeout: GIT_FRIST, stdin, fehlt: "Git ist auf diesem Mac nicht installiert." });
    return r;
  });
  const eintrag = (felder) => Object.entries(felder).map(([k, v]) => `${k}=${v}`).join("\n") + "\n\n";
  const GITHUB = { protocol: "https", host: "github.com" };

  let lauf = 0; // Zähler: ein neuer Start oder Abmelden beendet das alte Polling
  let zustand = null; // { zustand, code, url, ablauf (ISO), login? } — nie das Token
  let ablaufMs = 0;

  const formular = (felder) => ({ method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Kortex" },
    body: new URLSearchParams(felder).toString(), signal: AbortSignal.timeout(NETZ_FRIST) });
  async function holeJson(url, o) {
    const r = await holen(url, o);
    let j = null; try { j = await r.json(); } catch { /* kein JSON */ }
    return { status: r.status, j: j && typeof j === "object" ? j : {} };
  }

  async function loginZu(token) {
    try {
      const { status, j } = await holeJson(`${apiBasis}/user`, { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "Kortex" }, signal: AbortSignal.timeout(NETZ_FRIST) });
      return status === 200 && typeof j.login === "string" && /^[A-Za-z0-9-]{1,39}$/.test(j.login) ? j.login : null;
    } catch { return null; }
  }

  async function speichere(token, login) {
    const r = await gitAufruf(["approve"], eintrag({ ...GITHUB, username: login, password: token }));
    if (r.code !== 0) throw new Error("approve fehlgeschlagen");
  }

  // Polling im Hintergrund. Netzfehler brechen nicht ab (Schlaf, kurz offline): es geht weiter, bis der Code abläuft.
  async function poll(meine, deviceCode, intervall) {
    const lebt = () => meine === lauf;
    while (lebt()) {
      await warte(intervall * 1000);
      if (!lebt()) return;
      if (jetzt() >= ablaufMs) { zustand = { ...zustand, zustand: "abgelaufen" }; return; }
      let a;
      try {
        a = await holeJson(new URL("/login/oauth/access_token", basis).href,
          formular({ client_id: clientId, device_code: deviceCode, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }));
      } catch { continue; }
      if (!lebt()) return;
      const j = a.j;
      if (typeof j.access_token === "string" && j.access_token) {
        const token = j.access_token;
        const login = await loginZu(token);
        try { await speichere(token, login || "kortex"); } catch {
          log("Das Token konnte nicht im Schlüsselbund gespeichert werden.");
          zustand = { ...zustand, zustand: "abgelehnt", grund: "schluesselbund" };
          return;
        }
        if (lebt()) zustand = { zustand: "fertig", login: login || null };
        return;
      }
      switch (j.error) {
        case "authorization_pending": break;
        case "slow_down": intervall = (Number.isFinite(j.interval) && j.interval > intervall ? j.interval : intervall + SLOW_DOWN_PLUS); break;
        case "expired_token": zustand = { ...zustand, zustand: "abgelaufen" }; return;
        case "access_denied": zustand = { ...zustand, zustand: "abgelehnt" }; return;
        default: // unbekannter Fehler (z. B. falsche Client-ID, Device Flow nicht eingeschaltet): beenden, ohne Servertext weiterzugeben
          log(`GitHub meldet beim Anmelden: ${typeof j.error === "string" ? j.error.slice(0, 60) : "HTTP " + a.status}`);
          zustand = { ...zustand, zustand: "abgelehnt", grund: "github" };
          return;
      }
    }
  }

  async function anmelden() {
    if (!verfuegbar) throw new HttpFehler(404, "Die Anmeldung bei GitHub ist in dieser Version nicht eingerichtet.", { art: "nicht-eingerichtet" });
    let a;
    try { a = await holeJson(new URL("/login/device/code", basis).href, formular({ client_id: clientId, scope: SCOPE })); }
    catch { throw new HttpFehler(502, "GitHub war nicht erreichbar. Prüfe die Internetverbindung.", { art: "netz" }); }
    const j = a.j;
    if (a.status !== 200 || typeof j.device_code !== "string" || typeof j.user_code !== "string" || typeof j.verification_uri !== "string") {
      log(`GitHub hat den Gerätecode abgelehnt (HTTP ${a.status}${typeof j.error === "string" ? ", " + j.error.slice(0, 60) : ""}).`);
      throw new HttpFehler(502, "GitHub hat die Anmeldung abgelehnt.", { art: "github" });
    }
    let url;
    try { url = new URL(j.verification_uri); } catch { url = null; }
    if (!url || url.host !== basis.host || url.protocol !== basis.protocol) throw new HttpFehler(502, "GitHub hat eine unerwartete Adresse genannt.", { art: "github" });
    const sek = Math.min(Number.isFinite(j.expires_in) && j.expires_in > 0 ? j.expires_in : 900, MAX_ABLAUF);
    const intervall = Number.isFinite(j.interval) && j.interval >= 0 ? j.interval : 5;
    ablaufMs = jetzt() + sek * 1000;
    const meine = ++lauf;
    zustand = { zustand: "wartet", code: j.user_code, url: url.href, ablauf: new Date(ablaufMs).toISOString() };
    poll(meine, j.device_code, intervall).catch(() => { if (meine === lauf) zustand = { ...zustand, zustand: "abgelehnt", grund: "intern" }; });
    return { code: zustand.code, url: zustand.url, ablauf: zustand.ablauf };
  }

  // Zustand für die Oberfläche (ohne Token). „wartet“ nennt Code, Adresse und Ablauf, damit die Karte nach einem Neuladen weitermachen kann.
  function status() {
    if (!zustand) return { zustand: "keiner" };
    const { zustand: z, code, url, ablauf, login, grund } = zustand;
    return z === "wartet" ? { zustand: z, code, url, ablauf } : { zustand: z, ...(login ? { login } : {}), ...(grund ? { grund } : {}) };
  }

  // Login-Name des gespeicherten Kontos: aus dem Schlüsselbund (`credential fill`); das Passwort wird sofort verworfen, nie weitergegeben.
  async function gespeicherterLogin() {
    let r;
    try { r = await gitAufruf(["fill"], eintrag(GITHUB)); } catch { return null; }
    if (r.code !== 0) return null;
    const m = /^username=(.+)$/m.exec(String(r.stdout || ""));
    return m && /^[A-Za-z0-9._-]{1,100}$/.test(m[1]) ? m[1] : null;
  }
  async function konto() {
    if (!verfuegbar) return { verfuegbar: false, angemeldet: false };
    const login = await gespeicherterLogin();
    return { verfuegbar: true, angemeldet: !!login, ...(login ? { login } : {}) };
  }

  async function abmelden() {
    lauf++; zustand = null;
    if (!verfuegbar) return { ok: true };
    const login = await gespeicherterLogin();
    try {
      if (login) await gitAufruf(["reject"], eintrag({ ...GITHUB, username: login }));
      await gitAufruf(["reject"], eintrag(GITHUB));
    } catch { throw new HttpFehler(502, "Das Konto konnte nicht aus dem Schlüsselbund entfernt werden.", { art: "schluesselbund" }); }
    return { ok: true };
  }

  return { verfuegbar, anmelden, status, konto, abmelden, stoppe: () => { lauf++; } };
}
