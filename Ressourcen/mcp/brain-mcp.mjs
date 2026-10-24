#!/usr/bin/env node
// mcp/brain-mcp.mjs — lokaler MCP-Server für Brain Studio (Spec §7): stdio, JSON-RPC 2.0 zeilengetrennt, ohne
// Abhängigkeiten. Nur stdout für JSON-RPC, Logs nach stderr. Aufruf: node brain-mcp.mjs <vault>
import { createInterface } from "node:readline";
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { oeffneVault, HttpFehler } from "../gemeinsam/vault.mjs";

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
  { name: "brain_verlauf", description: "Git-Verlauf einer Datei (neueste zuerst).",
    inputSchema: { type: "object", properties: { pfad: { type: "string" }, max: { type: "integer", minimum: 1, maximum: 100, description: "Standard 20" } }, required: ["pfad"], additionalProperties: false } },
];

const STUFE = { gruen: "grün", gelb: "gelb", rot: "rot", grau: "grau", ohne: "ohne Befund" };
const text = (t) => ({ content: [{ type: "text", text: t }] });
const fehlerText = (t) => ({ content: [{ type: "text", text: t }], isError: true });
const zeit = (iso) => String(iso || "").slice(0, 16).replace("T", " ");

async function rufe(v, name, a) {
  const arg = (k) => { if (typeof a[k] !== "string" || !a[k].trim()) throw new HttpFehler(400, `Der Parameter „${k}“ fehlt.`); return a[k]; };
  switch (name) {
    case "brain_suchen": {
      const n = Math.min(20, Math.max(1, Number.parseInt(a.anzahl, 10) || 10));
      const { treffer } = v.suche(arg("frage"));
      if (!treffer.length) return text("Keine Treffer.");
      return text(treffer.slice(0, n).map((t, i) => {
        let stufe = "grau"; try { stufe = v.pruefung(t.pfad).stufe; } catch { /* unlesbar → grau */ }
        return `${i + 1}. ${t.pfad} — ${t.titel} [${STUFE[stufe]}]\n   ${t.auszug}`;
      }).join("\n"));
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
      if (g.grund === "nicht-vertraut") return text("Das Brain-Kit in diesem Vault ist noch nicht freigegeben. In der App einmal erlauben (Brain Studio → Kit erlauben), dann klappt die Gesundheitsprüfung.");
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
  const vaultPfad = process.argv[2] || process.env.BRAIN_VAULT;
  if (!vaultPfad) { process.stderr.write("Aufruf: node brain-mcp.mjs <vault>\n"); process.exit(2); }
  let v;
  try { v = oeffneVault(vaultPfad); } catch (e) { process.stderr.write(`${e.message}\n`); process.exit(2); }
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
  process.on("SIGTERM", () => process.exit(0));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) haupt();
