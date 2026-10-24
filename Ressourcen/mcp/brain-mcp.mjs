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

// v: ein geöffneter Vault, eine Funktion, die den aktuellen liefert (Server ohne Vault-Argument), oder null.
async function rufe(vArg, name, a) {
  const v = typeof vArg === "function" ? vArg() : vArg;
  if (name === "brain_vaults") return text(vaultText(v));
  if (!v) return fehlerText(KEIN_VAULT);
  const arg = (k) => { if (typeof a[k] !== "string" || !a[k].trim()) throw new HttpFehler(400, `Der Parameter „${k}“ fehlt.`); return a[k]; };
  switch (name) {
    case "brain_suchen": {
      const r = v.suchenFuerKi(arg("frage"), a.anzahl);
      // _meta ist für Clients tabu (die KI sieht nur den Text); die Probe-Frage der App liest hier die Treffer strukturiert statt den Text zu zerlegen.
      return { ...text(r.text), _meta: { "brain-studio/treffer": r.treffer } };
    }
    case "brain_lesen": {
      const d = v.lies(arg("pfad"));
      const p = v.pruefung(d.pfad);
      const kopf = [`Pfad: ${d.pfad}`, `Geändert: ${zeit(d.geaendert)}`, `Prüf-Stufe: ${STUFE[p.stufe]} — ${p.zusammenfassung}`,
        ...p.signale.map((s) => `  · ${s.text}${s.zeile ? ` (Zeile ${s.zeile})` : ""}`), d.schreibschutz ? "Schreibgeschützt (generiert oder kein Text)." : ""].filter(Boolean);
      return text(`${kopf.join("\n")}\n\n---\n${d.inhalt}`);
    }
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
      try {
        return ok(await rufe(v, p.name, p.arguments && typeof p.arguments === "object" ? p.arguments : {}));
      } catch (e) {
        if (e instanceof HttpFehler) return ok(fehlerText(e.message));
        process.stderr.write(`brain-mcp: ${(e && e.stack) || e}\n`);
        return ok(fehlerText("Interner Fehler"));
      }
    }
    default:
      if (msg.method.startsWith("notifications/")) return null;
      return nein(-32601, `Method not found: ${msg.method}`);
  }
}

function haupt() {
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
