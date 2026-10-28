#!/usr/bin/env node
// mcp/brain-mcp.mjs — lokaler MCP-Server für Brain Studio (Spec §7): stdio, JSON-RPC 2.0 zeilengetrennt, ohne
// Abhängigkeiten. Nur stdout für JSON-RPC, Logs nach stderr. Aufruf: node brain-mcp.mjs [<vault>]
// Mit Vault-Argument (oder BRAIN_VAULT) ist der Server an diesen Vault gebunden. Ohne Argument folgt er dem aktiven Vault aus
// <support>/vaults.json (bei jedem Werkzeugaufruf geprüft) — gibt es keinen, antworten die Werkzeuge mit einem Hinweis.
import { createInterface } from "node:readline";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { oeffneVault, HttpFehler, STUFE_TEXT as STUFE } from "../gemeinsam/vault.mjs";
import { leseVaults, aktiverVaultPfad } from "../gemeinsam/vaults.mjs";
import { beendeLaufendes } from "../gemeinsam/git.mjs";
import { bereinigePfad } from "../gemeinsam/basis.mjs";
import { leseKopf } from "../gemeinsam/pruefung.mjs";
import { protokolliere } from "../gemeinsam/nutzung.mjs";

const VERSIONEN = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const WERKZEUGE = [
  { name: "brain_suchen", description: "Durchsucht das Brain (Titel und Inhalt) und nennt je Treffer Pfad, Titel, Auszug und Prüf-Stufe.",
    inputSchema: { type: "object", properties: { frage: { type: "string", description: "Suchbegriffe" }, anzahl: { type: "integer", minimum: 1, maximum: 20, description: "Höchstzahl der Treffer (Standard 10)" } }, required: ["frage"], additionalProperties: false } },
  { name: "brain_lesen", description: "Liest eine Seite des Brains samt Prüf-Signalen und Stand.",
    inputSchema: { type: "object", properties: { pfad: { type: "string", description: "Pfad relativ zum Vault, z. B. 09_wiki/firma/amazon/thema_x.md" } }, required: ["pfad"], additionalProperties: false } },
  { name: "brain_merken", description: "Legt eine neue Notiz in 00_inbox/ ab. Schreibt nie ins Wiki; erst /ingest macht daraus Wissen.",
    inputSchema: { type: "object", properties: { text: { type: "string" }, titel: { type: "string" } }, required: ["text"], additionalProperties: false } },
  { name: "brain_gesundheit", description: "Kurzfassung der Brain-Gesundheit (Ampel und Befunde), falls das Kit installiert ist.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "brain_vaults", description: "Listet die in der App eingerichteten Vaults (Brains) und nennt den, den dieser Server gerade nutzt.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "brain_verlauf", description: "Git-Verlauf einer Datei (neueste zuerst).",
    inputSchema: { type: "object", properties: { pfad: { type: "string" }, max: { type: "integer", minimum: 1, maximum: 100, description: "Standard 20" } }, required: ["pfad"], additionalProperties: false } },
  { name: "brain_kontext", description: "Kontext-Paket zum aktuellen Projekt: 3–8 passende Seiten des Brains (Pfad, Titel, Stand, Prüf-Stufe, Auszug). Zu Beginn einer Sitzung mit dem Projektnamen aufrufen.",
    inputSchema: { type: "object", properties: { projekt: { type: "string", description: "Repo- oder Ordnername des Projekts" }, cwd: { type: "string", description: "Arbeitsordner (optional); schärft die Zuordnung über `pfade`" } }, required: ["projekt"], additionalProperties: false } },
];

const text = (t) => ({ content: [{ type: "text", text: t }] });
const fehlerText = (t) => ({ content: [{ type: "text", text: t }], isError: true });
const zeit = (iso) => String(iso || "").slice(0, 16).replace("T", " ");

const KEIN_VAULT = "Es ist noch kein Vault eingerichtet. Lege in Brain Studio einen an (Willkommen → Brain-Vorlage) und versuche es dann noch einmal.";

function vaultText(v) {
  const l = leseVaults();
  const dieser = v ? v.wurzel : null;
  if (!l.vaults.length && !dieser) return KEIN_VAULT;
  const zeilen = l.vaults.map((e, i) => `${i + 1}. ${e.pfad === dieser ? "*" : " "} ${e.name} — ${e.pfad}${l.aktiv === e.pfad && e.pfad !== dieser ? " (in der App aktiv)" : ""}`);
  if (dieser && !l.vaults.some((e) => e.pfad === dieser)) zeilen.push(`*  ${v.name} — ${dieser} (nicht in der Liste der App)`);
  return `Vaults (* = von diesem Server genutzt):\n${zeilen.join("\n")}`;
}

// brain_kontext: Seiten zum Projekt. Erst Frontmatter repo/pfade (K14), dann Titel/Name; rote Seiten fehlen, verfallene kommen ans Ende.
const KONTEXT_MAX = 8, KONTEXT_LIMIT = 6000, KONTEXT_DATEI = 256 * 1024;
const norm = (x) => String(x || "").toLowerCase().replace(/\\/g, "/").replace(/^\.?\/+|\/+$/g, "");
const liste = (w) => String(w || "").replace(/^\[|\]$/g, "").split(",").map((x) => norm(x.trim().replace(/^(["'])(.*)\1$/, "$2"))).filter(Boolean);
function kontextText(v, projekt, cwd, spur) {
  const name = norm(projekt).split("/").pop();
  const cw = norm(cwd);
  const treffer = [];
  for (const e of v.baum().eintraege) {
    if (e.art !== "datei" || !e.pfad.startsWith("09_wiki/") || !e.pfad.endsWith(".md") || e.schreibschutz || e.groesse > KONTEXT_DATEI) continue;
    let d, p; try { d = v.lies(e.pfad); p = v.pruefung(e.pfad); } catch { continue; }
    if (p.stufe === "rot") continue;
    const { felder, bis } = leseKopf(d.inhalt);
    const repoNamen = liste(felder.repo);
    const pfadeW = liste(felder.pfade);
    const ueberRepo = repoNamen.some((r) => r === norm(projekt) || r.split("/").pop() === name)
      || pfadeW.some((x) => x.split("/").includes(name) || (cw && (cw === x || cw.startsWith(`${x}/`) || cw.endsWith(`/${x}`))));
    const titel = e.titel || felder.name || e.pfad.split("/").pop().replace(/\.md$/, "");
    const ueberTitel = !ueberRepo && name.length > 1 && [titel, felder.name, e.pfad.split("/").pop().replace(/\.md$/, "")].some((t) => norm(t).includes(name));
    if (!ueberRepo && !ueberTitel) continue;
    const verfallen = p.signale.some((s) => s.art === "verfall");
    const saetze = d.inhalt.split(/\r?\n/).slice(bis).filter((z) => z.trim() && !/^#/.test(z.trim()) && !/^```/.test(z.trim())).join(" ").replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) || [];
    const auszug = saetze.slice(0, 3).join(" ").trim().slice(0, 400);
    treffer.push({ rang: (verfallen ? 2 : 0) + (ueberRepo ? 0 : 1), pfad: e.pfad, titel, stand: felder.stand || zeit(d.geaendert).slice(0, 10), stufe: p.stufe, verfallen, auszug });
  }
  if (!treffer.length) return `Keine Seiten zum Projekt „${projekt}“ im Brain gefunden.`;
  treffer.sort((a, b) => a.rang - b.rang || a.pfad.localeCompare(b.pfad));
  const zeilen = [];
  let laenge = 0;
  for (const t of treffer.slice(0, KONTEXT_MAX)) {
    const z = `${zeilen.length + 1}. ${t.pfad} — ${t.titel}\n   Stand ${t.stand} · Prüf-Stufe: ${STUFE[t.stufe]}${t.verfallen ? " · Stand verfallen" : ""}${t.auszug ? `\n   ${t.auszug}` : ""}`;
    if (zeilen.length >= 3 && laenge + z.length > KONTEXT_LIMIT) break;
    zeilen.push(z.slice(0, KONTEXT_LIMIT)); laenge += z.length + 1;
    spur.seiten.push(t.pfad);
  }
  return `Brain-Kontext zu „${projekt}“ (${zeilen.length} Seite(n); Details mit brain_lesen):\n${zeilen.join("\n")}`.slice(0, KONTEXT_LIMIT);
}

// v: ein geöffneter Vault, eine Funktion, die den aktuellen liefert (Server ohne Vault-Argument), oder null.
// spur.seiten sammelt die Seiten, die diese Antwort der KI nennt (für das lokale Nutzungsprotokoll, nutzung.mjs).
async function rufe(vArg, name, a, spur = { seiten: [] }) {
  const v = typeof vArg === "function" ? vArg() : vArg;
  if (name === "brain_vaults") return text(vaultText(v));
  if (!v) return fehlerText(KEIN_VAULT);
  const arg = (k) => { if (typeof a[k] !== "string" || !a[k].trim()) throw new HttpFehler(400, `Der Parameter „${k}“ fehlt.`); return a[k]; };
  switch (name) {
    case "brain_suchen": {
      const r = v.suchenFuerKi(arg("frage"), a.anzahl);
      // _meta ist für Clients tabu (die KI sieht nur den Text); die Probe-Frage der App liest hier die Treffer strukturiert statt den Text zu zerlegen.
      spur.seiten = r.treffer.map((t) => t.pfad);
      return { ...text(r.text), _meta: { "brain-studio/treffer": r.treffer } };
    }
    case "brain_lesen": {
      const d = v.lies(arg("pfad"));
      const p = v.pruefung(d.pfad);
      spur.seiten = [d.pfad];
      const kopf = [`Pfad: ${d.pfad}`, `Geändert: ${zeit(d.geaendert)}`, `Prüf-Stufe: ${STUFE[p.stufe]} — ${p.zusammenfassung}`,
        ...p.signale.map((s) => `  · ${s.text}${s.zeile ? ` (Zeile ${s.zeile})` : ""}`), d.schreibschutz ? "Schreibgeschützt (generiert oder kein Text)." : ""].filter(Boolean);
      return text(`${kopf.join("\n")}\n\n---\n${d.inhalt}`);
    }
    case "brain_kontext": return text(kontextText(v, arg("projekt"), typeof a.cwd === "string" ? a.cwd : "", spur));
    case "brain_merken": {
      const r = v.merken({ text: arg("text"), titel: typeof a.titel === "string" ? a.titel : undefined });
      return text(`Gemerkt in ${r.pfad}. Erst /ingest macht daraus Wissen im Wiki.`);
    }
    case "brain_gesundheit": {
      const g = await v.gesundheit();
      if (g.grund === "nicht-vertraut") {
        const geaendert = v.vertrauenStand().geaendert;
        return text(geaendert
          ? "Das Brain-Kit in diesem Vault hat sich seit der Freigabe geändert (oder der Ordner ist ein anderer). In der App neu erlauben (Brain Studio → Kit erlauben), dann klappt die Gesundheitsprüfung."
          : "Das Brain-Kit in diesem Vault ist noch nicht freigegeben. In der App einmal erlauben (Brain Studio → Kit erlauben), dann klappt die Gesundheitsprüfung.");
      }
      if (g.verfuegbar === false) return text("Die Gesundheitsprüfung ist nicht verfügbar (kein Brain-Kit in diesem Vault).");
      const zeilen = [`Ampel: ${g.ampel}${g.warnungen !== undefined ? ` · ${g.warnungen} Warnung(en)` : ""}`];
      for (const p of g.pruefungen || []) {
        if (p.stufe === "gruen") continue;
        zeilen.push(`- ${p.name} [${p.stufe}]: ${p.text}`);
        for (const b of p.befunde || []) zeilen.push(`    · ${b.kurz || JSON.stringify(b)}`);
      }
      return text(zeilen.join("\n"));
    }
    case "brain_verlauf": {
      const { eintraege } = await v.gitVerlauf(arg("pfad"), Math.min(100, Math.max(1, Number.parseInt(a.max, 10) || 20)));
      if (!eintraege.length) return text("Kein Verlauf gefunden (Datei nicht in Git oder noch nicht committet).");
      return text(eintraege.map((e) => `${e.kurz} ${zeit(e.zeit)} ${e.autor}: ${e.nachricht}`).join("\n"));
    }
    default: return null;
  }
}

// Eine JSON-RPC-Nachricht → Antwortobjekt oder null (Benachrichtigung). Exportiert für Tests.
export async function bearbeite(v, msg, version = "0.2.0") {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return { jsonrpc: "2.0", id: msg && msg.id !== undefined ? msg.id : null, error: { code: -32600, message: "Invalid Request" } };
  }
  const hatId = msg.id !== undefined && msg.id !== null;
  const ok = (result) => (hatId ? { jsonrpc: "2.0", id: msg.id, result } : null);
  const nein = (code, message) => (hatId ? { jsonrpc: "2.0", id: msg.id, error: { code, message } } : null);
  switch (msg.method) {
    case "initialize": {
      const gewollt = msg.params && msg.params.protocolVersion;
      return ok({ protocolVersion: VERSIONEN.includes(gewollt) ? gewollt : VERSIONEN[0], capabilities: { tools: {} },
        serverInfo: { name: "brain", version }, instructions: "Brain: durchsuche und lies das Wissen des Nutzers; merke Neues nur über brain_merken (landet in der Inbox)." });
    }
    case "ping": return ok({});
    case "tools/list": return ok({ tools: WERKZEUGE });
    case "tools/call": {
      const p = msg.params || {};
      if (typeof p.name !== "string" || !WERKZEUGE.some((w) => w.name === p.name)) return nein(-32602, `Unbekanntes Werkzeug: ${String(p.name)}`);
      const spur = { seiten: [] }, t0 = Date.now();
      // Lokales Nutzungsprotokoll (.logs/mcp.log): protokolliere() wirft nie; der äußere try deckt auch das Auflösen des Vaults ab.
      // BRAIN_NUTZUNG=aus: die App-eigene Probe-Frage und der Selbsttest zählen nicht als KI-Nutzung (und wer nichts protokollieren will, schaltet es so ab).
      const merke = (antwort) => {
        if (process.env.BRAIN_NUTZUNG === "aus") return antwort;
        try { const vv = typeof v === "function" ? v() : v; if (vv && vv.wurzel) protokolliere(vv.wurzel, { werkzeug: p.name, seiten: antwort && antwort.isError ? [] : spur.seiten, ok: !(antwort && antwort.isError), ms: Date.now() - t0 }); } catch { /* Beiwerk */ }
        return antwort;
      };
      try {
        return ok(merke(await rufe(v, p.name, p.arguments && typeof p.arguments === "object" ? p.arguments : {}, spur)));
      } catch (e) {
        if (e instanceof HttpFehler) return ok(merke(fehlerText(e.message)));
        process.stderr.write(`brain-mcp: ${(e && e.stack) || e}\n`);
        return ok(merke(fehlerText("Interner Fehler")));
      }
    }
    default:
      if (msg.method.startsWith("notifications/")) return null;
      return nein(-32601, `Method not found: ${msg.method}`);
  }
}

function haupt() {
  // Claude Code startet uns mit seiner eigenen Umgebung: ein leerer oder relativer PATH-Eintrag ließe `git` aus dem Vault laufen, noch bevor
  // jemand diesem Vault vertraut hat (Vertrauen v2, §8). Danach gilt in Node nur noch, was absolut ist.
  bereinigePfad();
  const gebunden = process.argv[2] || process.env.BRAIN_VAULT || "";
  let aktuell = null, aktuellPfad;
  if (gebunden) { try { aktuell = oeffneVault(gebunden); } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(2); } }
  // Ohne Argument: aktiven Vault der App nehmen; wechselt er, wird neu geöffnet (billig: nur vaults.json lesen).
  const v = () => {
    if (gebunden) return aktuell;
    let p = null; try { p = aktiverVaultPfad(); } catch { /* keine Liste → kein Vault */ }
    if (p !== aktuellPfad) { aktuellPfad = p; aktuell = null; if (p) { try { aktuell = oeffneVault(p); } catch { /* nicht lesbar → kein Vault */ } } }
    return aktuell;
  };
  process.stdout.on("error", () => process.exit(0));
  const sende = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  let offen = 0, zu = false;
  const ende = () => { if (zu && offen === 0) process.stdout.write("", () => process.exit(0)); };
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on("line", (zeile) => {
    if (!zeile.trim()) return;
    offen++;
    (async () => {
      let m;
      try { m = JSON.parse(zeile); } catch { return sende({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
      if (Array.isArray(m) && !m.length) return sende({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
      if (Array.isArray(m)) {
        const r = (await Promise.all(m.map((x) => bearbeite(v, x)))).filter(Boolean);
        if (r.length) sende(r);
      } else {
        const r = await bearbeite(v, m);
        if (r) sende(r);
      }
    })().catch((e) => process.stderr.write(`brain-mcp: ${e}\n`)).finally(() => { offen--; ende(); });
  });
  rl.on("close", () => { zu = true; ende(); });
  process.on("SIGTERM", () => { try { beendeLaufendes(); } catch { /* egal */ } process.exit(0); }); // laufende Git-Prozesse nicht verwaisen lassen
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) haupt();
