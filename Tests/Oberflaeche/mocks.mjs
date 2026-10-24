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
    const bereich = pfad.startsWith("00_inbox/") ? "inbox" : pfad.startsWith("09_wiki/") ? "wissen" : /^90_/.test(pfad) ? "archiv" : "notiz";
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

// opts.erzwingen: true = immer die Attrappe (auch wenn das Backend antwortet)
export async function mockeV2(page, vault, { erzwingen = false, ueberschreibe = {} } = {}) {
  const versuche = async (route, bauer) => {
    if (!erzwingen) { try { const r = await route.fetch(); if (r.status() !== 404) return route.fulfill({ response: r }); } catch { /* weiter mit Attrappe */ } }
    return route.fulfill({ json: bauer() });
  };
  await page.route("**/api/notizen", async (route) => {
    if (!erzwingen) { try { const r = await route.fetch(); if (r.status() !== 404) return route.fulfill({ response: r }); } catch { /* weiter mit Attrappe */ } }
    const notizen = ueberschreibe.notizen || baueIndex(vault);
    // Prüf-Stufe der Wiki-Seiten über die echte Prüf-Route (die gibt es schon)
    const ursprung = new URL(route.request().url()).origin;
    await Promise.all(notizen.filter((n) => n.bereich === "wissen").map(async (n) => {
      try { const r = await page.request.get(`${ursprung}/api/pruefung?pfad=${encodeURIComponent(n.pfad)}`); if (r.ok()) n.stufe = (await r.json()).stufe || n.stufe; } catch { /* bleibt */ }
    }));
    return route.fulfill({ json: { notizen } });
  });
  await page.route("**/api/typen", (route) => versuche(route, () => ({ typen: ueberschreibe.typen || baueTypen(ueberschreibe.notizen || baueIndex(vault)) })));
  await page.route("**/api/ansichten", (route) => versuche(route, () => ({ ansichten: ueberschreibe.ansichten || [] })));
  await page.route("**/api/notiz/kontext**", (route) => versuche(route, () => {
    const pfad = new URL(route.request().url()).searchParams.get("pfad");
    const n = baueIndex(vault).find((x) => x.pfad === pfad) || { felder: {}, links: [] };
    const bez = Object.entries(n.felder).filter(([, w]) => /\[\[/.test(w)).map(([feld, w]) => ({ feld, ziele: [...String(w).matchAll(/\[\[([^\]|#]+)/g)].map((x) => x[1].trim()) }));
    const rueck = baueIndex(vault).filter((x) => x.pfad !== pfad && x.links.some((l) => l === basename(pfad || "").replace(/\.md$/i, ""))).map((x) => ({ pfad: x.pfad, titel: x.titel }));
    const text = pfad ? readFileSync(join(vault, pfad), "utf8") : "";
    return { felder: n.felder, beziehungen: bez, rueckverweise: rueck, info: { woerter: text.split(/\s+/).filter(Boolean).length, bytes: Buffer.byteLength(text), geaendert: n.geaendert, erstellt: n.erstellt } };
  }));
}
