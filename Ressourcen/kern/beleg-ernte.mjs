// beleg-ernte.mjs — alles, was die Ernte rund um beleg.mjs braucht (B1, §4.1): die Selbstbestätigungs-Sperre
// (Werkzeug-Ergebnisse aus dem eigenen Brain — Vault oder ernteNichtIn — zählen nie als Beleg), Fehler und unbekannte
// Aufrufe als „ki“, die Web-Adresse eines web-Belegs und die Fundstelle. Die Regeln „Zitat finden / Herkunft je Rolle“
// stehen nur in beleg.mjs; markiereEigenes formt den Verlauf so um, dass beleg.mjs Eigenes als Assistenten-Text (ki) sieht.
// Liest nur: realpath für Pfadformen, git worktree list, die Wiki-Seiten (W1); wirft nie. Nur Node-Standardbibliothek.
import { realpathSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute, resolve, win32 } from "node:path";
import { spawnSync } from "node:child_process";
import { normalisiere, enthaeltMitGrenzen } from "./beleg.mjs";
import { ordner, ladeConfig, entferneBom } from "./pfade.mjs";
import { gitBefehl } from "./werkzeug.mjs";

export const HERKUNFT_WERTE = ["du", "tool", "web", "ki"];
export const MAX_ZITAT = 300;
export const FUNDSTELLE_MUSTER = /^[\w?-]{1,64}#[\w?-]{1,80} (?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z|\?)$/;

// ---------- Eingespielter Kontext ----------

const EINGESPIELT = /<(system-reminder|command-[a-z-]+|local-command-[a-z-]+|task-notification|agent-message|user-prompt-submit-hook|bash-[a-z-]+)(?:\s[^>]*)?>[\s\S]*?(?:<\/\1>|$)/g;
export function ohneEingespieltes(text) {
  return String(text ?? "").replace(EINGESPIELT, "\n").trim();
}
export function ergebnisText(inhalt) {
  if (typeof inhalt === "string") return inhalt;
  if (!Array.isArray(inhalt)) return "";
  return inhalt.filter((x) => x?.type === "text" && typeof x.text === "string").map((x) => x.text).join("\n");
}

// ---------- Pfade ----------

const fwd = (p) => String(p ?? "").replace(/\\/g, "/");
const ohneSchluss = (p) => p.replace(/\/+$/, "");
const faltet = (plattform) => plattform === "darwin" || plattform === "win32";
const vergleich = (p, plattform) => { const f = fwd(p).normalize("NFC"); return faltet(plattform) ? f.toLowerCase() : f; };
const VOR_GRENZE = /[\p{L}\p{N}_.~\/-]/u;   // davor kein Pfadzeichen
const NACH_GRENZE = /[\p{L}\p{N}_.~-]/u;    // danach kein Namenszeichen („/“, Ende, Anführung, Leerraum sind ok)

// Schreibweisen eines absoluten Ordners: wie angegeben, echt (realpath), mit ~ fürs Home — immer mit „/“.
// Relative oder leere Angaben und die Wurzel liefern nichts (nicht sicher prüfbar).
export function pfadFormen(pfad, { home = homedir() } = {}) {
  let p = typeof pfad === "string" ? pfad.trim() : "";
  if (!p) return [];
  if (p === "~" || p.startsWith("~/") || p.startsWith("~\\")) p = join(home, p.slice(1));
  if (!isAbsolute(p) && !win32.isAbsolute(p)) return [];
  const formen = new Set();
  const dazu = (x) => { const f = ohneSchluss(fwd(x).normalize("NFC")); if (f) formen.add(f); };
  dazu(p);
  try { dazu(realpathSync(p)); } catch {}
  const h = ohneSchluss(fwd(home).normalize("NFC"));
  for (const f of [...formen]) if (h && f.startsWith(h + "/")) formen.add("~" + f.slice(h.length));
  return [...formen];
}

// Nennt `text` einen der Pfade an Ordnergrenzen? (ein Ordner „brain-kit“ ist nicht der Ordner „brain“.) darwin/win32 ohne Groß/Klein.
export function nenntPfad(text, formen, { plattform = process.platform } = {}) {
  if (!Array.isArray(formen) || !formen.length) return false;
  const s = vergleich(text, plattform);
  for (const f0 of formen) {
    const f = vergleich(f0, plattform);
    if (!f) continue;
    for (let i = s.indexOf(f); i !== -1; i = s.indexOf(f, i + 1)) {
      const vor = i > 0 ? s[i - 1] : "", nach = s[i + f.length] ?? "";
      if ((!vor || !VOR_GRENZE.test(vor)) && (!nach || !NACH_GRENZE.test(nach))) return true;
    }
  }
  return false;
}

// Alle Schreibweisen der gesperrten Ordner: absolut, echt, mit ~ und — für Befehle in der Shell — mit $HOME und ${HOME}.
export function sperrPfade(vault, ernteNichtIn = [], { home = homedir() } = {}) {
  const alle = new Set();
  for (const p of [vault, ...(Array.isArray(ernteNichtIn) ? ernteNichtIn : [])]) for (const f of pfadFormen(p, { home })) alle.add(f);
  const h = ohneSchluss(fwd(home).normalize("NFC"));
  for (const f of [...alle]) if (h && f.startsWith(h + "/")) { alle.add("$HOME" + f.slice(h.length)); alle.add("${HOME}" + f.slice(h.length)); }
  return [...alle];
}

// Alle Arbeitsordner des Git-Repos, zu dem der Vault gehört (`git worktree list`): eine Kopie des Brains in einem
// Worktree ist ebenso das eigene Brain. Kein Repo, kein git, Fehler → [].
export function worktreePfade(vault) {
  if (typeof vault !== "string" || !vault) return [];
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
    const r = spawnSync(gitBefehl({ cfg: ladeConfig(vault) }), ["-C", vault, "worktree", "list", "--porcelain"],
      { encoding: "utf8", timeout: 5000, windowsHide: true, env });
    if (r.status !== 0) return [];
    return String(r.stdout || "").split(/\r?\n/).filter((z) => z.startsWith("worktree ")).map((z) => z.slice(9).trim()).filter(Boolean);
  } catch { return []; }
}

// „~/…“ und „$HOME/…“ sind Textformen für nenntPfad; zum Vergleich mit echten Pfaden taugen nur die absoluten.
const textForm = (f) => f.startsWith("~") || f.startsWith("$");
function liegtUnter(pfad, formen, plattform) {
  if (typeof pfad !== "string" || !pfad) return false;
  const p = ohneSchluss(vergleich(pfad, plattform));
  return formen.some((f0) => { const f = vergleich(f0, plattform); return f && !textForm(f) && (p === f || p.startsWith(f + "/")); });
}
// Liegt ein gesperrter Ordner unter dem cwd, kann ein Befehl ihn relativ nennen („cat brain/09_wiki/a.md“ in ~).
function relativeFormen(formen, cwd, plattform) {
  if (typeof cwd !== "string" || !cwd) return [];
  const c = ohneSchluss(vergleich(cwd, plattform));
  const out = [];
  for (const f0 of formen) {
    const f = ohneSchluss(fwd(f0).normalize("NFC"));
    if (textForm(f) || !vergleich(f, plattform).startsWith(c + "/")) continue;
    const rel = f.slice(c.length + 1);
    if (rel) out.push(rel, "./" + rel);
  }
  return out;
}
function werteText(x, tiefe = 0) {
  if (typeof x === "string") return [x];
  if (!x || typeof x !== "object" || tiefe > 5) return [];
  return Object.values(x).flatMap((w) => werteText(w, tiefe + 1));
}

// Relative Pfade, die nach oben führen („../brain/x“, „./../x“): gegen den cwd auflösen und prüfen, wo sie landen.
const AUFWAERTS = /(?<![\p{L}\p{N}_.~$\/\\-])(?:\.\.?[\/\\])*\.\.[\/\\][^\s"'`;|&<>()]*/gu;
function aufwaertsGesperrt(texte, orte, sperr, plattform) {
  for (const cwd of orte) {
    const aufloesen = isAbsolute(cwd) ? resolve : win32.isAbsolute(cwd) ? win32.resolve : null;
    if (!aufloesen) continue;
    for (const t of texte) for (const m of t.matchAll(AUFWAERTS)) if (liegtUnter(aufloesen(cwd, m[0]), sperr, plattform)) return true;
  }
  return false;
}

// Werkzeug-Aufruf liest aus dem eigenen Brain: ein cwd liegt darin oder ein Eingabewert nennt einen gesperrten Pfad.
export function aufrufGesperrt(input, cwds, sperr, { plattform = process.platform } = {}) {
  if (!Array.isArray(sperr) || !sperr.length) return false;
  const orte = (Array.isArray(cwds) ? cwds : [cwds]).filter((c) => typeof c === "string" && c);
  if (orte.some((c) => liegtUnter(c, sperr, plattform))) return true;
  const formen = [...sperr, ...orte.flatMap((c) => relativeFormen(sperr, c, plattform))];
  const texte = werteText(input);
  return texte.some((t) => nenntPfad(t, formen, { plattform })) || aufwaertsGesperrt(texte, orte, sperr, plattform);
}

// ---------- Selbstbestätigung nach Inhalt (W1) ----------
// Pfade erkennen nicht jeden Weg ins eigene Brain (cd in einem früheren Aufruf, Kopie, Pipe …). Darum zusätzlich: steht
// das Zitat schon wörtlich in einer Seite unter <vault>/<wiki>/, ist es Brain-Inhalt und zählt als ki — gleich, ob es als
// Werkzeug-Ergebnis, Nutzertext (eingefügt) oder anders zurückkam.
const MAX_WIKI_BYTES = 32 * 1024 * 1024, MAX_SEITE = 2 * 1024 * 1024;
// Alle Markdown-Seiten unter dem Wiki-Ordner des Vaults, normalisiert (beleg.mjs). Zu große Seiten/Mengen entfallen.
export function wikiTexte(vault) {
  const out = [];
  if (typeof vault !== "string" || !vault) return out;
  let summe = 0;
  const lauf = (dir, tiefe) => {
    if (tiefe > 12) return;
    let eintraege;
    try { eintraege = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of eintraege) {
      const voll = join(dir, e.name);
      try {
        const st = statSync(voll);   // folgt Verweisen; Ordner-Verweise werden nicht betreten (Schleifen)
        if (st.isDirectory()) { if (!e.isSymbolicLink()) lauf(voll, tiefe + 1); continue; }
        if (!st.isFile() || !e.name.endsWith(".md") || st.size > MAX_SEITE || summe + st.size > MAX_WIKI_BYTES) continue;
        summe += st.size;
        out.push(normalisiere(entferneBom(readFileSync(voll, "utf8"))));
      } catch {}
    }
  };
  lauf(join(vault, ordner(vault).wiki), 0);
  return out;
}
export function zitatImWiki(zitat, texte) {
  const z = normalisiere(zitat);
  return z !== "" && Array.isArray(texte) && texte.some((t) => enthaeltMitGrenzen(t, z));
}

// ---------- Verlauf für beleg.mjs vorbereiten ----------

// Werkzeug-Ergebnisse aus dem eigenen Brain, Fehler-Ergebnisse und Ergebnisse ohne bekannten Aufruf → Assistenten-Zeile
// (gleiche uuid/timestamp): beleg.mjs zählt sie dann als „ki“. Alles andere bleibt unverändert (gleiche Objekte).
export function markiereEigenes(zeilen, { sperr = [], plattform = process.platform } = {}) {
  const aufrufe = new Map();   // tool_use id → gesperrt?
  const out = [];
  for (const o of Array.isArray(zeilen) ? zeilen : []) {
    const c = o && typeof o === "object" ? o.message?.content : null;
    if (o?.type === "assistant" && Array.isArray(c)) {
      for (const b of c) if (b?.type === "tool_use") aufrufe.set(String(b.id ?? ""), aufrufGesperrt(b.input, [o.cwd], sperr, { plattform }));
    }
    if (o?.type !== "user" || !Array.isArray(c) || !c.some((b) => b?.type === "tool_result")) { out.push(o); continue; }
    const cwdGesperrt = aufrufGesperrt({}, [o.cwd], sperr, { plattform });
    const bleibt = [], alsKi = [];
    for (const b of c) {
      const eigen = b?.type === "tool_result" && (b.is_error === true || aufrufe.get(String(b.tool_use_id ?? "")) !== false || cwdGesperrt);
      (eigen ? alsKi : bleibt).push(b);
    }
    if (!alsKi.length) { out.push(o); continue; }
    if (bleibt.length) out.push({ ...o, message: { ...o.message, content: bleibt } });
    for (const b of alsKi) {
      out.push({ type: "assistant", uuid: o.uuid, timestamp: o.timestamp, sessionId: o.sessionId, cwd: o.cwd,
        message: { role: "assistant", content: [{ type: "text", text: ergebnisText(b.content) }] } });
    }
  }
  return out;
}

// Adresse (Herkunft + Pfad, nie Query/Fragment) der WebFetch-Seite, deren Ergebnis in der Zeile `uuid` steht.
export function webAdresse(zeilen, uuid) {
  const urls = new Map();
  for (const o of Array.isArray(zeilen) ? zeilen : []) {
    const c = o?.message?.content;
    if (!Array.isArray(c)) continue;
    if (o.type === "assistant") for (const b of c) if (b?.type === "tool_use" && b.name === "WebFetch") urls.set(String(b.id ?? ""), b.input?.url);
    if (o.type !== "user" || !uuid || String(o.uuid ?? "") !== uuid) continue;
    for (const b of c) {
      if (b?.type !== "tool_result" || !urls.has(String(b.tool_use_id ?? ""))) continue;
      try {
        const u = new URL(String(urls.get(String(b.tool_use_id))));
        if (u.protocol === "http:" || u.protocol === "https:") return (u.origin + u.pathname).slice(0, MAX_ZITAT);
      } catch {}
    }
  }
  return "";
}

// ---------- Aussage gegen das Zitat (K1) ----------
// Das Zitat steht im Verlauf — aber sagt es auch, was der Vorschlag behauptet? Haiku formuliert die Aussage selbst und
// kann „Halle 7“ zu „Halle 12“ machen. Regelbasiert, ohne KI: alle Zahlen, Datumsangaben, Uhrzeiten, Wochentage und
// Verneinungen der Aussage (Titel + Text) müssen auch im Zitat stehen. Gleiches Maß auf beiden Seiten: Zahlen kanonisch
// (1.200 = 1200 = 1,200; 4,20 = 4.2; 50k = 50.000), Uhrzeiten als HH:MM, Daten als Tag.Monat und Jahr, Zahlwörter
// (zwei … zwölf, zwanzig, hundert, tausend; auch englisch) als Zahl, Verneinungen in drei Gruppen (nicht/kein/not/no …,
// nie/never, ohne/without — nicht und kein sind dieselbe Gruppe, so bleibt die Umformulierung möglich). Fehlt eins, ist
// der Vorschlag ungedeckt: lieber Lücke als Fehler. Rein, wirft nie. → { gedeckt, fehlt: string[] } (fehlt: Anzeigeform).
const NICHT_BUCHSTABE = "(?<![\\p{L}\\p{N}])";
const KEIN_BUCHSTABE = "(?![\\p{L}\\p{N}])";
const MONATE = {
  januar: 1, january: 1, februar: 2, february: 2, "märz": 3, maerz: 3, april: 4, mai: 5, juni: 6, june: 6, juli: 7, july: 7,
  august: 8, september: 9, oktober: 10, october: 10, november: 11, dezember: 12, december: 12,
};
const WOCHENTAGE = {
  montag: 1, monday: 1, dienstag: 2, tuesday: 2, mittwoch: 3, wednesday: 3, donnerstag: 4, thursday: 4,
  freitag: 5, friday: 5, samstag: 6, sonnabend: 6, saturday: 6, sonntag: 7, sunday: 7,
};
const ZAHLWOERTER = {
  zwei: 2, drei: 3, vier: 4, "fünf": 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, "zwölf": 12, zwoelf: 12,
  zwanzig: 20, "dreißig": 30, dreissig: 30, hundert: 100, tausend: 1000,
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  twenty: 20, thirty: 30, hundred: 100, thousand: 1000,
};
const alt = (o) => Object.keys(o).join("|");
const ZEIT_KOMMA = new RegExp(`(?<![\\p{N}.:,])(?<h>[01]?\\d|2[0-3])(?<sep>[:.])(?<min>[0-5]\\d)(?::[0-5]\\d)?(?:\\s?(?<suf>uhr|h))?${KEIN_BUCHSTABE}`, "gu");
const ZEIT_UHR = new RegExp(`(?<![\\p{N}.:,])(?<h>\\d{1,2})\\s?uhr${KEIN_BUCHSTABE}`, "gu");
const ZEIT_AMPM = new RegExp(`(?<![\\p{N}.:,])(?<h>1[0-2]|0?[1-9])(?::(?<min>[0-5]\\d))?\\s?(?<ap>am|pm)${KEIN_BUCHSTABE}`, "gu");
const TAG = "0?[1-9]|[12]\\d|3[01]", MON = "0?[1-9]|1[0-2]";
const DATUM_ISO = new RegExp(`(?<![\\p{N}])(?<y>\\d{4})-(?<m>0[1-9]|1[0-2])-(?<d>0[1-9]|[12]\\d|3[01])(?![\\p{N}])`, "gu");
const DATUM_PUNKT = new RegExp(`(?<![\\p{N}.,])(?<d>${TAG})\\.\\s?(?<m>${MON})\\.(?:\\s?(?<y>\\d{4}|\\d{2})(?![\\p{N}])|(?![\\p{N}]))`, "gu");
const DATUM_NAME = new RegExp(`(?<![\\p{L}\\p{N}])(?:(?<d>${TAG})\\.?\\s?)?(?<mon>${alt(MONATE)})${KEIN_BUCHSTABE}(?:\\s?(?<y>\\d{4})(?![\\p{N}]))?`, "gu");
const WOCHENTAG = new RegExp(`${NICHT_BUCHSTABE}(?<wt>${alt(WOCHENTAGE)})\\p{L}*`, "gu");
const ZAHLWORT = new RegExp(`${NICHT_BUCHSTABE}(?<w>${alt(ZAHLWOERTER)})${KEIN_BUCHSTABE}`, "gu");
const ZAHL = new RegExp(`(?<![\\p{N}])(?<n>\\d+(?:[.,]\\d+)*)(?:(?<suf>k)${KEIN_BUCHSTABE}|\\s?(?<suf2>tsd|mio|mrd)${KEIN_BUCHSTABE})?`, "gu");
const VERNEINUNG = new RegExp(`${NICHT_BUCHSTABE}(?:(?<nicht>nicht|nichts|kein\\p{L}{0,8}|niemand\\p{L}{0,2}|nirgend\\p{L}*|weder|not|no|none|nothing|nobody|nowhere|neither|cannot|\\p{L}+n't)|(?<nie>nie|niemals|never)|(?<ohne>ohne|without))${KEIN_BUCHSTABE}`, "gu");

const ohneNullen = (ganz, bruch) => {
  const g = ganz.replace(/^0+(?=\d)/, ""), b = bruch.replace(/0+$/, "");
  return b ? `${g}.${b}` : g;
};
// "1.200" → "1200", "4,20" → "4.2", "1.200,50" → "1200.5"; Versionsnummern (26.3.0) bleiben, wie sie sind.
function kanonZahl(roh) {
  let t = roh;
  const punkt = t.includes("."), komma = t.includes(",");
  if (punkt && komma) {
    const dez = t.lastIndexOf(".") > t.lastIndexOf(",") ? "." : ",";
    t = t.split(dez === "." ? "," : ".").join("").replace(dez, ".");
  } else if (/^[1-9]\d{0,2}(?:[.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, "");
  else if (t.split(/[.,]/).length > 2) return t.replace(/,/g, ".");
  else t = t.replace(",", ".");
  const [ganz, bruch = ""] = t.split(".");
  return ohneNullen(ganz, bruch);
}
const ZEIT = (h, min) => `t:${Number(h)}:${String(min).padStart(2, "0")}`;

// Text → Map(Schlüssel → Anzeige). `fuerZitat`: zusätzlich der Monat jedes Datums („m:11“), damit „im November“ aus
// „21.11.2026“ gedeckt ist. Zeiten und Daten werden vor den Zahlen herausgenommen (14:30 und 31.12. sind keine Zahlen).
function merkmale(text, { fuerZitat = false } = {}) {
  const m = new Map();
  const dazu = (anzeige, ...schluessel) => { for (const k of schluessel) if (k && !m.has(k)) m.set(k, anzeige); };
  const merke = []; // [anzeige, Schlüssel…] — ungedeckt, sobald ein Schlüssel fehlt
  let t = normalisiere(text).toLowerCase();
  // Treffer durch ein Leerzeichen ersetzen (f liefert null → Treffer bleibt für die späteren Muster stehen).
  const nimm = (re, f) => { t = t.replace(re, (...a) => (f(a.at(-1), a[0]) === null ? a[0] : " ")); };
  nimm(ZEIT_KOMMA, (g) => {
    if (g.sep === "." && !g.suf) return null;   // „14.30“ ohne Uhr ist eine Dezimalzahl
    merke.push([ZEIT(g.h, g.min).slice(2), ZEIT(g.h, g.min)]); return true;
  });
  nimm(ZEIT_UHR, (g) => { if (Number(g.h) > 24) return null; merke.push([ZEIT(g.h, "00").slice(2), ZEIT(g.h, "00")]); return true; });
  nimm(ZEIT_AMPM, (g) => {
    const h = (Number(g.h) % 12) + (g.ap === "pm" ? 12 : 0);
    merke.push([ZEIT(h, g.min ?? "00").slice(2), ZEIT(h, g.min ?? "00")]); return true;
  });
  const datum = (anzeige, d, mon, y) => {
    const jahr = y ? (y.length === 2 ? `20${y}` : y) : null;
    const schluessel = [];
    if (d) schluessel.push(`dm:${Number(d)}.${Number(mon)}`); else if (!fuerZitat) schluessel.push(`m:${Number(mon)}`);
    if (fuerZitat) dazu(anzeige, `m:${Number(mon)}`);
    if (jahr) schluessel.push(`n:${jahr}`);
    merke.push([anzeige, ...schluessel]);
  };
  nimm(DATUM_ISO, (g) => { datum(`${g.d}.${g.m}.${g.y}`, g.d, g.m, g.y); return true; });
  nimm(DATUM_PUNKT, (g, all) => { datum(all.trim(), g.d, g.m, g.y); return true; });
  nimm(DATUM_NAME, (g, all) => { datum(all.trim(), g.d, MONATE[g.mon], g.y); return true; });
  nimm(WOCHENTAG, (g, all) => { merke.push([all, `wt:${WOCHENTAGE[g.wt]}`]); return true; });
  nimm(ZAHLWORT, (g, all) => { merke.push([all, `n:${ZAHLWOERTER[g.w]}`]); return true; });
  nimm(ZAHL, (g, all) => {
    let k = kanonZahl(g.n);
    const mal = g.suf ? 1e3 : { tsd: 1e3, mio: 1e6, mrd: 1e9 }[g.suf2];
    if (mal) { const z = Number(k) * mal; if (Number.isFinite(z)) k = ohneNullen(String(Math.round(z)), ""); }
    merke.push([all.trim(), `n:${k}`]); return true;
  });
  const neg = new Map(); // Verneinungsklasse (nicht|nie|ohne) → Anzahl; wird beidseitig verglichen, nicht als Schlüssel
  nimm(VERNEINUNG, (g) => { const k = g.nicht ? "nicht" : g.nie ? "nie" : "ohne"; neg.set(k, (neg.get(k) ?? 0) + 1); return true; });
  for (const [anzeige, ...schluessel] of merke) dazu(anzeige, ...schluessel);
  return { alle: m, merke, neg };
}

// Kernsatz eines Stands: die erste nichtleere Zeile (getrimmt, Aufzählungszeichen bleibt). Nur er wird gegen das Zitat geprüft
// und in „## Stand“ geschrieben — die weiteren Zeilen sind Zugabe der KI, die kein 300-Zeichen-Zitat Zahl für Zahl trägt.
export function kernsatz(text) {
  for (const z of String(typeof text === "string" ? text : "").replace(/\r\n?/g, "\n").split("\n")) {
    const t = z.trim();
    if (t && !/^[-*•]$/.test(t)) return t;
  }
  return "";
}

export function aussageGedeckt(aussage, zitat) {
  try {
    const text = typeof aussage === "string" ? aussage : "";
    const a = merkmale(text);
    const z = merkmale(typeof zitat === "string" ? zitat : "", { fuerZitat: true });
    const fehlt = [];
    for (const [anzeige, ...schluessel] of a.merke) {
      if (schluessel.every((k) => z.alle.has(k))) continue;
      if (!fehlt.includes(anzeige)) fehlt.push(anzeige);
    }
    // Verneinungen müssen beidseitig stimmen (Klasse und Anzahl): fehlt im Zitat → Aussage erfindet sie; steht sie NUR im Zitat
    // (auch in einem fremden Nebensatz) → Sinn womöglich umgekehrt. Im Zweifel ungedeckt — lieber Lücke als Fehler.
    // Eine leere Aussage behauptet nichts und ist gedeckt.
    if (text.trim()) {
      for (const k of new Set([...a.neg.keys(), ...z.neg.keys()])) {
        if ((a.neg.get(k) ?? 0) !== (z.neg.get(k) ?? 0)) fehlt.push(`verneinung:${k}`);
      }
    }
    return { gedeckt: fehlt.length === 0, fehlt };
  } catch { return { gedeckt: false, fehlt: ["?"] }; }
}

// ---------- Fundstelle ----------

const rein = (s, n) => String(s ?? "").replace(/[^\w-]/g, "").slice(0, n) || "?";
const ISO_ZEIT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
export function baueFundstelle({ sitzung, uuid, zeit } = {}) {
  return `${rein(sitzung, 64)}#${rein(uuid, 80)} ${ISO_ZEIT.test(String(zeit ?? "")) ? zeit : "?"}`;
}
export function leseFundstelle(s) {
  const t = String(s ?? "");
  if (!FUNDSTELLE_MUSTER.test(t)) return null;
  const [kopf, zeit] = t.split(" ");
  const [sitzung, uuid] = kopf.split("#");
  const ohne = (x) => (x === "?" ? "" : x);
  return { sitzung: ohne(sitzung), uuid: ohne(uuid), zeit: ohne(zeit) };
}
