// pflege-konto.mjs — Welches KI-Konto und wie viel KI die Hintergrund-Pflege (Tageslauf) für EINEN Vault nutzt (Plan docs/plaene/ki-konten.md, Abschnitt 5, Paket P3).
//
// Die Einstellung steht je Vault in <support>/ki-konten.json: vaults[<pfad>].pflege = { konto, stufe } (geschrieben von der Werkstatt, gelesen über kern/ki-konten.mjs#pflegeFuer):
//   klein   nur Haiku (auch der Richter), keine teuren Schritte: weder die Schreibpflege B3 (Sonnet) noch der Traum
//   mittel  wie bisher: Haiku für Urteile, Sonnet für Richter, B3 und Traum
//   aus     „ohne KI“: nur die Schritte, die ohne KI laufen. Bewusst gewählt gilt der Lauf als erfolgreich (Status ok-ohne-ki)
// Das Konto bestimmt die Umgebung jedes `claude -p`-Aufrufs: CLAUDE_CONFIG_DIR = Ordner des Kontos, beim Standardprofil wird die Variable entfernt (Regel von werkstatt/profile.mjs#mitProfil).
// Die plist des Dienstes trägt kein CLAUDE_CONFIG_DIR mehr; ein Dienstprozess erbt also kein Konto, sondern bekommt es hier aus der Liste.
//
// Rückfall „alter Weg“ (modus "alt"): Gibt es die Liste noch nicht oder hat der Vault noch keine Pflege-Einstellung, gilt das Konto der Prozess-Umgebung wie bisher (kiKontoDarf),
// bis die Werkstatt die Einstellung gesetzt (oder aus der alten plist übernommen) hat. Eine Einstellung, die das Konto nicht tragen kann (Stufe unter „erweitert“, Konto weg,
// kein Konto gewählt), heißt „ohne KI“ mit Grund und ist NICHT bewusst (Warnzustand), nie ein stilles Ausweichen auf ein anderes Konto.
import { liesKonten, kontenOrte, stufeFuer, darfMindestens, pflegeFuer } from "./ki-konten.mjs";
import { supportOrdner } from "./pfade.mjs";

export const PFLEGE_GRUND_KEIN_KONTO = "Für die Pflege ist kein KI-Konto gewählt — die Pflege läuft ohne KI";
export const PFLEGE_GRUND_STUFE = "Das gewählte KI-Konto hat für diesen Vault keine ausreichende Freigabe — die Pflege läuft ohne KI";
export const PFLEGE_GRUND_PROGRAMM = "Das gewählte KI-Konto ist kein Claude-Code-Konto — die Pflege läuft ohne KI";
export const PFLEGE_GRUND_UNLESBAR = "Die Pflege-Einstellung ist nicht lesbar — die Pflege läuft ohne KI";

// Fremde Zugangsdaten und Umleitungen: Ein Aufruf im Pflege-Konto meldet sich mit dem Konto an, das die Liste nennt (CLAUDE_CONFIG_DIR). Variablen wie ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
// CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_BASE_URL oder CLAUDE_CODE_USE_BEDROCK/VERTEX in der Umgebung des Prozesses (Terminal, Werkstatt) würden sonst die Anmeldung des Kontos übersteuern und die Prüfung
// „hat dieses Konto die Stufe erweitert?“ umgehen (Rückfall beim Sitzungsstart, `brain tageslauf` im Terminal, „Jetzt pflegen“). Darum fliegen alle ANTHROPIC_* und CLAUDE_CODE_* heraus, außer der
// Erlaubt-Liste: CLAUDE_CODE_GIT_BASH_PATH ist nur ein Programmpfad (Windows), keine Anmeldung. AWS_BEARER_TOKEN_BEDROCK ist ein Zugangstoken für Bedrock.
export const FREMD_ERLAUBT = new Set(["CLAUDE_CODE_GIT_BASH_PATH"]);
const FREMD_MUSTER = /^(ANTHROPIC_|CLAUDE_CODE_)/;
export const istFremdeAnmeldung = (name) => (FREMD_MUSTER.test(name) && !FREMD_ERLAUBT.has(name)) || name === "AWS_BEARER_TOKEN_BEDROCK";
export function ohneFremdeAnmeldung(env) {
  const out = {};
  for (const [k, w] of Object.entries(env || {})) if (!istFremdeAnmeldung(k)) out[k] = w;
  return out;
}

// Umgebung für einen `claude`-Aufruf im Konto: nur ein NICHT-Standardprofil setzt CLAUDE_CONFIG_DIR, sonst wird eine geerbte Variable entfernt (wie profile.mjs#mitProfil); fremde Anmeldungen fliegen heraus.
export function umgebungFuer(daten, kontoId, basis = process.env) {
  const env = ohneFremdeAnmeldung(basis);
  delete env.CLAUDE_CONFIG_DIR;
  const k = daten && daten.konten && typeof kontoId === "string" && Object.hasOwn(daten.konten, kontoId) ? daten.konten[kontoId] : null;
  if (k && k.programm === "claude" && k.standard !== true && typeof k.ordner === "string" && k.ordner) env.CLAUDE_CONFIG_DIR = k.ordner;
  return env;
}

// → { modus: "alt" | "konto" | "aus", stufe: "klein" | "mittel" | "aus", konto, env, bewusst, grund }
//   env: die Umgebung für jeden KI-Aufruf dieses Laufs (Kopie von `env`, mit gesetztem/entferntem CLAUDE_CONFIG_DIR)
//   bewusst: „ohne KI“ ist so eingestellt (kein Fehler, keine Warnung) · grund: Satz für den Bericht, wenn die KI nicht läuft, obwohl sie laufen sollte
export function pflegeAufloesen(vault, { support, env = process.env } = {}) {
  const alt = { modus: "alt", stufe: "mittel", konto: null, env, bewusst: false, grund: null };
  try {
    const sup = typeof support === "string" ? support : supportOrdner({ env });
    let gefunden = null;
    for (const ort of kontenOrte(sup)) {
      const r = liesKonten(ort);
      if (r.zustand !== "ok") continue;
      const p = pflegeFuer(r.daten, vault);
      if (p.gesetzt) { gefunden = { p, daten: r.daten }; break; }
    }
    if (!gefunden) return alt;     // keine Liste, kein Eintrag oder Vault unbekannt: der alte Weg (kiKontoDarf entscheidet, fail-closed bei defekter Liste)
    const { p, daten } = gefunden;
    const aus = (grund, bewusst = false) => ({ modus: "aus", stufe: p.stufe, konto: p.konto, env, bewusst, grund: bewusst ? null : grund });
    if (p.ungueltig) return aus(PFLEGE_GRUND_UNLESBAR);
    if (p.stufe === "aus") return aus(null, true);
    if (!p.konto) return aus(PFLEGE_GRUND_KEIN_KONTO);
    if (daten.konten[p.konto].programm !== "claude") return aus(PFLEGE_GRUND_PROGRAMM);
    if (!darfMindestens(stufeFuer(daten, vault, p.konto), "erweitert")) return aus(PFLEGE_GRUND_STUFE);
    return { modus: "konto", stufe: p.stufe, konto: p.konto, env: umgebungFuer(daten, p.konto, env), bewusst: false, grund: null };
  } catch {
    return { modus: "aus", stufe: "aus", konto: null, env, bewusst: false, grund: PFLEGE_GRUND_UNLESBAR };
  }
}
