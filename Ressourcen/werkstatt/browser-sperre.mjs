// werkstatt/browser-sperre.mjs — eine Instanz von „Kortex im Browser“ je Support-Ordner (Paket W1). Die Sperrdatei `browser-dienst.json` liegt im Support-Ordner (plattform.mjs):
// { pid, start (Startzeit des Prozesses gegen PID-Wiederverwendung), port, geheimnis }. Nur für den Benutzer lesbar (0600; unter Windows gilt das Benutzerprofil).
// Anlegen mit „wx“ (nur wenn es sie nicht gibt); eine verwaiste Sperre (Prozess weg oder andere Startzeit) wird übernommen.
import { readFileSync, writeFileSync, renameSync, unlinkSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { prozessStart } from "../gemeinsam/plattform.mjs";

export const sperrDatei = (support) => join(support, "browser-dienst.json");

export function leseSperre(support) {
  try { const o = JSON.parse(readFileSync(sperrDatei(support), "utf8")); return o && typeof o === "object" && Number.isInteger(o.pid) ? o : null; } catch { return null; }
}
export function lebt(o, { startVon = prozessStart } = {}) {
  if (!o || !Number.isInteger(o.pid) || o.pid <= 0) return false;
  try { process.kill(o.pid, 0); } catch (e) { if (e.code !== "EPERM") return false; }
  if (o.start) { const jetzt = startVon(o.pid); if (jetzt && jetzt !== o.start) return false; } // PID wiederverwendet
  return true;
}
// → { ok:true } wenn wir die Sperre halten, sonst { ok:false, andere } mit dem Inhalt der fremden Sperre (lebt sie, ist `andere.lebt` wahr).
export function beanspruche(support, { pid = process.pid, startVon = prozessStart } = {}) {
  mkdirSync(support, { recursive: true });
  const mein = { pid, start: startVon(pid) || "", port: 0, geheimnis: "" };
  for (let versuch = 0; versuch < 3; versuch++) {
    try { writeFileSync(sperrDatei(support), JSON.stringify(mein), { flag: "wx", mode: 0o600 }); return { ok: true }; }
    catch (e) { if (e.code !== "EEXIST") throw e; }
    const andere = leseSperre(support);
    if (andere && andere.pid !== pid && lebt(andere, { startVon })) return { ok: false, andere: { ...andere, lebt: true } };
    // leer/unlesbar, aber ganz frisch: die andere Instanz schreibt gerade (zwischen „wx“ und Inhalt) — nicht übernehmen
    if (!andere) { let alter = Infinity; try { alter = Date.now() - statSync(sperrDatei(support)).mtimeMs; } catch { /* weg */ } if (alter < 5000) return { ok: false, andere: { pid: 0, port: 0, lebt: true } }; }
    if (andere && andere.pid === pid) return { ok: true }; // eigene (z. B. nach Neustart im selben Prozess)
    // verwaist oder unlesbar: nur entfernen, wenn sie noch dieselbe ist (kleines Zeitfenster bleibt, Folge wäre ein zweiter Versuch)
    const jetzt = leseSperre(support);
    if (JSON.stringify(jetzt) === JSON.stringify(andere)) { try { unlinkSync(sperrDatei(support)); } catch { /* weg */ } }
  }
  const rest = leseSperre(support); return { ok: false, andere: rest ? { ...rest, lebt: lebt(rest, { startVon }) } : null };
}
// Port und Geheimnis eintragen (atomar: schreiben, dann umbenennen).
export function veroeffentliche(support, o) {
  const ziel = sperrDatei(support), tmp = `${ziel}.${process.pid}.tmp`;
  mkdirSync(dirname(ziel), { recursive: true });
  writeFileSync(tmp, JSON.stringify(o), { mode: 0o600 });
  renameSync(tmp, ziel);
}
export function gibFrei(support, pid = process.pid) {
  const o = leseSperre(support);
  if (o && o.pid === pid) { try { unlinkSync(sperrDatei(support)); } catch { /* schon weg */ } }
}
