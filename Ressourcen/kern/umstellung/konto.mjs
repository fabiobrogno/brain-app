// umstellung/konto.mjs — Welches KI-Konto gehört zu einem Programm-Ordner? (docs/plaene/ki-konten.md, Paket P2). NUR LESEN.
// Die Umstellung schreibt Hook-Befehle und MCP-Einträge mit `--konto <id>`, damit der Server und die Hooks wissen, für welches Konto sie laufen (Stufen je Vault). Die Kennung kommt aus der
// Liste <support>/ki-konten.json (von der Werkstatt geführt; der Kern liest nur, kern/ki-konten.mjs): ein Konto ist ein Programm plus Konfig-Ordner, gefunden wird es über den echten Ort
// des Ordners (bei mehreren Treffern über die Ordnerkennung). Fehlt die Liste oder ist sie beschädigt, oder kennt sie den Ordner nicht, gibt es keine Kennung: dann bleibt es bei der
// Altform ohne `--konto` (für sie gilt `ohneKonto` des Vaults), und nichts wird geraten.
import { join } from "node:path";
import { liesKonten, echterOrt, kennungVon } from "../ki-konten.mjs";

const falte = (s) => String(s).normalize("NFC").toLowerCase();

// → (programm, ordner) => Kennung | null
export function kontoLeser(support) {
  const r = typeof support === "string" && support ? liesKonten(support) : { zustand: "fehlt", daten: null };
  const daten = r.zustand === "ok" ? r.daten : null;
  return (programm, ordner) => {
    if (!daten || typeof ordner !== "string" || !ordner) return null;
    const f = falte(echterOrt(ordner));
    const treffer = Object.entries(daten.konten).filter(([, k]) => k.programm === programm && falte(k.ordner) === f);
    if (treffer.length <= 1) return treffer.length ? treffer[0][0] : null;
    let kennung = null; try { kennung = kennungVon(echterOrt(ordner)); } catch { /* Ordner fehlt */ }
    const g = treffer.find(([, k]) => k.ordnerKennung === kennung);
    return g ? g[0] : null;
  };
}

// Die Kennung für ein Ziel der MCP-Einträge: claude (Profilordner), codex (~/.codex), alle übrigen Programme mit Einstellungsdatei (ihre id, Ordner = Elternordner der Datei; hier nur cursor).
export function kontoFuerZiel(lies, ziel, home, profil = null) {
  if (ziel === "claude") return profil ? lies("claude", profil.pfad) : null;
  if (ziel === "codex") return lies("codex", join(home, ".codex"));
  if (ziel === "cursor") return lies("cursor", join(home, ".cursor"));
  return null;
}
