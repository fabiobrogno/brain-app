// Attrappen für die v2-Routen, solange das Backend sie nicht liefert: erst die echte Antwort versuchen, bei 404 aus dem Vault-Ordner bauen.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename } from "node:path";

const BEKANNT = { thema: ["#4a78e0", "buch"], quelle: ["#c99a1e", "zitat"], entitaet: ["#2a9ba8", "wuerfel"], projekt: ["#d9772b", "rakete"], person: ["#3a9a68", "person"], entscheidung: ["#7a5fd6", "waage"] };

function lies(vault, rel = "", aus = []) {
  for (const e of readdirSync(join(vault, rel), { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const r = rel ? rel + "/" + e.name : e.name;
    if (e.isDirectory()) lies(vault, r, aus);
    else if (/\.(md|txt)$/i.test(e.name)) aus.push(r);
  }
  return aus;
}
function kopf(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n(---|\.\.\.)\s*(\r?\n|$)/.exec(text);
  const felder = {};
  if (m) for (const z of m[1].split(/\r?\n/)) {
    const k = /^([A-Za-z0-9_äöüÄÖÜ-]+)\s*:\s*(.*)$/.exec(z);
    if (!k) continue;
    let w = k[2].trim();
    if (w.startsWith("[") && w.endsWith("]")) { try { w = JSON.parse(w); } catch { /* bleibt Text */ } }
    felder[k[1]] = typeof w === "string" ? w.replace(/^["']|["']$/g, "") : w;
  }
  return { felder, rest: m ? text.slice(m[0].length) : text };
}
export function baueIndex(vault) {
  return lies(vault).map((pfad) => {
    const text = readFileSync(join(vault, pfad), "utf8");
    const { felder, rest } = kopf(text);
    const h1 = /^#\s+(.+)$/m.exec(rest)?.[1]?.trim();
    const titel = h1 || felder.title || felder.titel || felder.name || basename(pfad).replace(/\.(md|txt)$/i, "");
    const absaetze = rest.split(/\n\s*\n/).map((a) => a.replace(/^#.*$/gm, "").trim()).filter(Boolean);
    const bereich = /^90_/.test(pfad) ? "archiv" : /^00_inbox\/_/.test(pfad) ? "maschine" : pfad.startsWith("01_vorlagen/") ? "vorlage"
      : /^(claude|agents|gemini)\.md$/i.test(pfad) ? "system" : pfad.startsWith("00_inbox/") ? "inbox" : pfad.startsWith("09_wiki/") ? "wissen" : "notiz";
    const st = statSync(join(vault, pfad));
    return {
      pfad, titel, vorschau: (felder.description || absaetze[0] || "").slice(0, 200), typ: felder.typ || felder.type || null, bereich,
      geaendert: st.mtime.toISOString(), erstellt: st.birthtime.toISOString(), stufe: bereich === "wissen" ? "gelb" : "grau",
      links: [...text.matchAll(/\[\[([^\]|#]+)/g)].map((x) => x[1].trim()), felder, generiert: /(^|\/)(INDEX|_index)\.md$/i.test(pfad) || /generiert\s*—\s*nicht editieren/.test(text.split("\n").slice(0, 3).join(" ")),
    };
  });
}
export function baueTypen(index) {
  const m = new Map();
  for (const n of index) if (n.typ) m.set(n.typ, (m.get(n.typ) || 0) + 1);
  return [...m].map(([name, anzahl]) => ({ name, anzahl, farbe: (BEKANNT[name] || ["#8b877f", "notiz"])[0], symbol: (BEKANNT[name] || ["", "notiz"])[1] }));
}

// Lädt die Seite neu, während eine Anfrage noch läuft, ist die Anfrage verworfen; nur dann still aufgeben
const verworfen = (e) => { if (!/disposed|closed|already handled/i.test(String(e?.message))) throw e; };

// opts.erzwingen: true = immer die Attrappe (auch wenn das Backend antwortet)
export async function mockeV2(page, vault, { erzwingen = false, ueberschreibe = {} } = {}) {
  const versuche = async (route, bauer) => {
    if (!erzwingen) { try { const r = await route.fetch(); if (r.status() !== 404) return await route.fulfill({ response: r }); } catch { /* weiter mit Attrappe */ } }
    return route.fulfill({ json: bauer() }).catch(verworfen);
  };
  await page.route("**/api/notizen", async (route) => {
    if (!erzwingen) { try { const r = await route.fetch(); if (r.status() !== 404) return await route.fulfill({ response: r }); } catch { /* weiter mit Attrappe */ } }
    const notizen = ueberschreibe.notizen || baueIndex(vault);
    // Prüf-Stufe der Wiki-Seiten über die echte Prüf-Route (die gibt es schon)
    const ursprung = new URL(route.request().url()).origin;
    await Promise.all(notizen.filter((n) => n.bereich === "wissen").map(async (n) => {
      try { const r = await page.request.get(`${ursprung}/api/pruefung?pfad=${encodeURIComponent(n.pfad)}`); if (r.ok()) n.stufe = (await r.json()).stufe || n.stufe; } catch { /* bleibt */ }
    }));
    return route.fulfill({ json: { notizen } }).catch(verworfen);
  });
  await page.route("**/api/typen", (route) => versuche(route, () => ({ typen: ueberschreibe.typen || baueTypen(ueberschreibe.notizen || baueIndex(vault)) })));
  await page.route("**/api/ansichten", (route) => versuche(route, () => ({ ansichten: ueberschreibe.ansichten || [] })));
  await page.route("**/api/notiz/kontext**", (route) => versuche(route, () => {
    const pfad = new URL(route.request().url()).searchParams.get("pfad");
    const n = baueIndex(vault).find((x) => x.pfad === pfad) || { felder: {}, links: [] };
    const bez = Object.entries(n.felder).filter(([, w]) => /\[\[/.test(w)).map(([feld, w]) => ({ feld, ziele: [...String(w).matchAll(/\[\[([^\]|#]+)/g)].map((x) => x[1].trim()) }));
    const rueck = baueIndex(vault).filter((x) => x.pfad !== pfad && x.links.some((l) => l === basename(pfad || "").replace(/\.md$/i, ""))).map((x) => ({ pfad: x.pfad, titel: x.titel }));
    const text = pfad ? readFileSync(join(vault, pfad), "utf8") : "";
    return { felder: n.felder, beziehungen: bez, verweise: [...new Set(n.links)], rueckverweise: rueck, info: { woerter: text.split(/\s+/).filter(Boolean).length, bytes: Buffer.byteLength(text), geaendert: n.geaendert, erstellt: n.erstellt } };
  }));
}

// ---- Vertrauen v2 (Spec §8): info.vertrauen, POST /api/kit/vertrauen → { kit, vertrauen }, Git gesperrt.
// Antwortform genau nach §8: vertrauen = { erlaubt, noetig, geaendert, gitGesperrt, gruende: [{ art: "kit"|"hooks"|"git", text }] }.
export const vertrauenAntwort = (o = {}) => ({
  erlaubt: false, noetig: true, geaendert: false, gitGesperrt: false,
  gruende: [{ art: "kit", text: "Brain-Werkzeuge (.tools) mit 3 Programmdateien" }], ...o,
});
export const GRUENDE_ALLE = [
  { art: "kit", text: "Brain-Werkzeuge (.tools) mit 3 Programmdateien" },
  { art: "hooks", text: "Git-Hooks: pre-commit" },
  { art: "git", text: "Git-Einstellungen, die Programme starten: core.gitProxy" },
];

// opt.vertrauen: Anfangszustand (veränderlich über das zurückgegebene stand.vertrauen)
// opt.alt: ältere Werkstatt ohne info.vertrauen (nur kit: { vorhanden, vertraut })
// opt.postFehler: { status, fehler } → POST /api/kit/vertrauen scheitert
// stand.post = Anfragen an /api/kit/vertrauen, stand.anfragen = Zähler je Route (info, notizen, gitStatus, gesundheit), stand.gitGesperrtAnfragen = abgewiesene Git-Aufrufe
// POST /api/kit/vertrauen wie die Werkstatt (Spec §8, Vertrauen v2): { erlauben, vault } — ohne vault 400, mit dem Pfad eines anderen Vaults
// als dem offenen (stand.vault, aus /api/info) 409 { fehler, art: "anderer-vault" } und nichts wird erlaubt.
export async function mockeVertrauen(page, { vertrauen = vertrauenAntwort(), alt = false, postFehler = null } = {}) {
  const stand = { vertrauen: { ...vertrauen }, post: [], anfragen: { info: 0, notizen: 0, gitStatus: 0, gesundheit: 0 }, gitGesperrtAnfragen: [], vault: null };
  const kitVon = (v) => ({ vorhanden: !!v.noetig, vertraut: !!v.erlaubt });
  await page.route("**/api/info", async (route) => {
    stand.anfragen.info++;
    const r = await route.fetch(); const { vertrauen: _echt, ...j } = await r.json(); // die echte Werkstatt liefert info.vertrauen schon: für „ältere Werkstatt“ weglassen, sonst ersetzen
    stand.vault = j.vault || stand.vault;
    await route.fulfill({ response: r, json: { ...j, kit: kitVon(stand.vertrauen), ...(alt ? {} : { vertrauen: stand.vertrauen }) } });
  });
  await page.route("**/api/kit/vertrauen", async (route) => {
    const body = route.request().postDataJSON();
    stand.post.push(body);
    if (postFehler) return route.fulfill({ status: postFehler.status, json: { fehler: postFehler.fehler } });
    if (typeof body.vault !== "string") return route.fulfill({ status: 400, json: { fehler: "Der Vault fehlt: die Frage muss den gezeigten Pfad mitschicken." } });
    if (stand.vault && body.vault !== stand.vault) return route.fulfill({ status: 409, json: { fehler: "Das ist nicht der Vault, der in der Werkstatt offen ist.", art: "anderer-vault" } });
    stand.vertrauen = { ...stand.vertrauen, erlaubt: !!body.erlauben, geaendert: false, gitGesperrt: body.erlauben ? false : stand.vertrauen.gitGesperrt };
    await route.fulfill({ json: { kit: kitVon(stand.vertrauen), vertrauen: stand.vertrauen } });
  });
  // Git gesperrt: Status 200 { repo, gesperrt, grund }, alle übrigen Git-Routen 409 { fehler, gitGesperrt: true }
  await page.route(/\/api\/git\/(status|sync|commit|log|verlauf|diff|fassung|remote)(\?|$)/, async (route) => {
    const name = new URL(route.request().url()).pathname.split("/").pop();
    if (name === "status") stand.anfragen.gitStatus++;
    if (!stand.vertrauen.gitGesperrt) return route.fallback();
    if (name === "status") return route.fulfill({ json: { repo: true, gesperrt: true, grund: "Die Git-Einstellungen dieses Vaults können Programme starten." } });
    stand.gitGesperrtAnfragen.push(name);
    return route.fulfill({ status: 409, json: { fehler: "Roher Backend-Text: Git ist gesperrt (core.gitProxy).", gitGesperrt: true } });
  });
  await page.route("**/api/notizen", (route) => { stand.anfragen.notizen++; return route.fallback(); });
  // Ohne Vertrauen läuft das Kit nicht: Gesundheit und Rückfragen sind „nicht verfügbar“
  await page.route("**/api/gesundheit", (route) => { stand.anfragen.gesundheit++; return route.fulfill({ json: stand.vertrauen.erlaubt || !stand.vertrauen.noetig ? { ampel: "gruen", warnungen: [], pruefungen: [] } : { verfuegbar: false, grund: "nicht-vertraut" } }); });
  await page.route("**/api/rueckfragen", (route) => route.fulfill({ json: stand.vertrauen.erlaubt || !stand.vertrauen.noetig ? { offen: 2 } : { verfuegbar: false, grund: "nicht-vertraut" } }));
  return stand;
}
