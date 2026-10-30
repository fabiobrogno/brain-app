// umstellung/bericht-schritte.mjs — Klartext zu Probelauf, Phase A und Rückweg (Paket P7b; der Befundbericht steht in bericht.mjs).
// Begriffe: App „Kortex“, Datenordner „Vault“, „Versionsverlauf“, „Hintergrunddienst“. Nur Titel, Ampel und feste Kurztexte – nie Werte.

const KRIT = { gruen: "✓", rot: "✗", uebersprungen: "–" };
const GRUENDE = {
  "kein-stabiler-kern": "Kortex ist noch nicht ganz eingerichtet (fester Programmpfad fehlt)",
  "git-gesperrt": "der Versionsverlauf ist für Kortex gesperrt (eine persönliche Einstellung steht im Weg)",
  "eintrag-noch-alt": "ein Eintrag bei einem KI-Programm zeigt noch auf den alten Ort",
  "plist-noch-alt": "der Hintergrunddienst startet noch das alte Programm",
  "original-veraendert": "am Original hat sich etwas verändert",
};
const grund = (g) => (g ? ` – ${GRUENDE[g] || g}` : "");

export function probelaufText(r) {
  const z = [];
  if (r.plan) {
    z.push("Kortex probiert alles zuerst an einer Kopie deines Vaults aus. Das Original bleibt dabei unberührt.", "Starte den Probelauf mit --ja.");
    return z.join("\n") + "\n";
  }
  z.push(r.ok ? "Der Probelauf ist in Ordnung. Am Original wurde nichts geändert." : "Hier hat etwas nicht geklappt. Am Original wurde nichts geändert.");
  for (const c of r.kriterien || []) z.push(`  ${KRIT[c.status] || "?"} ${c.titel}${c.status === "rot" ? grund(c.grund) : ""}`);
  if (r.ok) z.push("", "Du kannst jetzt umstellen (phase-a --ja).");
  else if (r.kopieBehalten) z.push("", "Die Kopie bleibt zur Ansicht liegen und wird später gelöscht.");
  return z.join("\n") + "\n";
}

export function phaseAText(r) {
  const z = [];
  if (r.plan) {
    z.push("Das würde Kortex umstellen (nichts davon ist passiert):");
    for (const s of r.schritte || []) z.push(`  ${s.noetig ? "•" : "–"} ${s.id} ${s.titel}: ${s.text}`);
    z.push("", "Starte die Umstellung mit --ja (nach einem grünen Probelauf).");
    return z.join("\n") + "\n";
  }
  if (!r.ok) {
    z.push(`Schritt ${r.fehlerBei} hat nicht geklappt${r.zurueckgenommen ? " und wurde zurückgenommen" : ""}. Die übrigen Schritte bleiben, wie sie sind.`);
    z.push("Du kannst es noch einmal versuchen („Weitermachen“) oder alles rückgängig machen.");
    return z.join("\n") + "\n";
  }
  if (r.phase === "A") z.push("Fertig. Kortex arbeitet jetzt mit deinem Vault.", "Starte offene Claude-Sitzungen neu, damit sie die neuen Einstellungen lesen. Der alte Werkzeug-Ordner bleibt vorerst liegen und wird nicht mehr benutzt – aufgeräumt wird mit einem der nächsten Kortex-Updates.");
  else z.push("Die gewählten Schritte sind erledigt.");
  for (const s of r.schritte || []) z.push(`  ${s.status === "ok" ? "✓" : s.status === "rot" ? "✗" : "–"} ${s.id} ${s.titel}${s.grund ? ` (${s.grund})` : ""}`);
  if (r.a9 && r.a9.ampel === "rot") z.push("", "Die Prüfung am Schluss hat etwas gefunden. Du kannst die Umstellung rückgängig machen.");
  return z.join("\n") + "\n";
}

export function rueckwegText(r) {
  const z = [];
  if (r.plan) {
    z.push("Das kann Kortex rückgängig machen:");
    for (const s of r.schritte || []) z.push(`  ${s.hatRueckweg ? "•" : "–"} ${s.id} ${s.titel}${s.status ? ` (${s.status})` : ""}`);
    z.push("", "Mit --schritt <A1…A8> oder --alles und --ja.");
    return z.join("\n") + "\n";
  }
  z.push(r.alles ? "Kortex hat die Umstellung rückgängig gemacht." : "Der Schritt wurde rückgängig gemacht.");
  for (const s of r.schritte || []) z.push(`  ${s.status === "zurueck" ? "✓" : s.status === "fehler" ? "✗" : "–"} ${s.id} ${s.titel}`);
  if ((r.hinweise || []).length) z.push("", "Dinge, die du inzwischen selbst geändert hast, hat Kortex nicht überschrieben. Die Sicherungen liegen im Support-Ordner von Kortex.");
  return z.join("\n") + "\n";
}

export function standText(s) {
  const z = [`Phase: ${s.phase || "noch nicht umgestellt"}`];
  if (s.phaseB && s.phaseB.status) z.push(`Aufräumen (Phase B): ${s.phaseB.status === "fertig" ? "erledigt" : s.phaseB.status}`);
  if (s.unterbrochen) z.push("Die Umstellung wurde unterbrochen: starte sie noch einmal („Weitermachen“) oder mache sie rückgängig.");
  if (s.probelauf) z.push(`Probelauf: ${s.probelauf.ampel === "gruen" ? (s.probelauf.gueltig ? "in Ordnung" : "in Ordnung, aber nicht mehr aktuell") : "nicht in Ordnung"}`);
  for (const [id, e] of Object.entries(s.schritte || {})) z.push(`  ${id}: ${e.status}`);
  return z.join("\n") + "\n";
}

export function protokollText(p) {
  const z = [`Das Protokoll liegt im Support-Ordner von Kortex: ${p.ordner}/${p.datei}`];
  for (const e of p.zeilen || []) z.push(`  ${e.zeit || ""} ${e.lauf || ""} ${e.schritt || ""} ${e.ereignis || ""}${e.anzahl !== undefined ? ` (${e.anzahl})` : ""}${e.grund ? ` – ${e.grund}` : ""}`);
  return z.join("\n") + "\n";
}

export function kopieText(r) {
  if (r.plan) return r.anzahl ? `Es liegt ${r.anzahl === 1 ? "eine Probekopie" : r.anzahl + " Probekopien"} bereit. Mit --ja wird sie gelöscht.\n` : "Es liegt keine Probekopie bereit.\n";
  return r.uebrig ? "Nicht alles ließ sich löschen.\n" : r.geloescht ? "Die Probekopie ist gelöscht. Dein Original war nie betroffen.\n" : "Es lag keine Probekopie da.\n";
}

// --- Phase B (P7d) -------------------------------------------------------------------------------------------------------------------------
export function torText(tor) {
  const z = [tor.frei ? "Das Aufräumen ist freigegeben." : "Das Aufräumen ist noch nicht freigegeben:"];
  for (const b of tor.bedingungen || []) z.push(`  ${b.erfuellt ? "✓" : "✗"} ${b.titel}${b.erfuellt ? "" : ` – ${b.text}`}`);
  return z.join("\n");
}
export function phaseBText(r) {
  const z = [];
  if (r.plan) {
    z.push("Das würde Kortex aufräumen (nichts davon ist passiert):");
    for (const s of r.schritte || []) z.push(`  ${s.noetig ? "•" : "–"} ${s.id} ${s.titel}: ${s.text}`);
    z.push("", torText(r.tor), "", "Starte das Aufräumen mit --ja (nach einem grünen Probelauf: --probelauf --ja).");
    return z.join("\n") + "\n";
  }
  if (!r.ok) {
    z.push(`Schritt ${r.fehlerBei} hat nicht geklappt${r.zurueckgenommen ? " und wurde zurückgenommen" : ""}. Der alte Werkzeug-Ordner ist nicht verloren: er liegt im Archiv im Support-Ordner von Kortex.`);
    z.push("Du kannst es noch einmal versuchen oder das Aufräumen rückgängig machen (zurueck --schritt B3,B2,B1).");
    return z.join("\n") + "\n";
  }
  z.push(r.mitWarnungen ? "Die Prüfung am Schluss hat etwas gefunden. Du kannst das Aufräumen rückgängig machen." : "Fertig. Der alte Werkzeug-Ordner liegt jetzt im Archiv und ist aus deinem Vault verschwunden.");
  if (!r.mitWarnungen) z.push("Der Ordner bleibt 30 Tage im Archiv, danach bietet Kortex an, ihn in den Papierkorb zu legen. Sichere deinen Vault jetzt einmal.");
  for (const s of r.schritte || []) z.push(`  ${s.status === "ok" ? "✓" : s.status === "rot" ? "✗" : "–"} ${s.id} ${s.titel}${s.grund ? ` (${s.grund})` : ""}`);
  return z.join("\n") + "\n";
}
export function probelaufBText(r) {
  const z = [];
  if (r.plan) { z.push("Kortex probiert das Aufräumen zuerst an einer Kopie deines Vaults aus – samt Rückweg. Das Original bleibt dabei unberührt.", "Starte den Probelauf mit --ja."); return z.join("\n") + "\n"; }
  z.push(r.ok ? "Der Probelauf ist in Ordnung. Am Original wurde nichts geändert." : "Hier hat etwas nicht geklappt. Am Original wurde nichts geändert.");
  for (const c of r.kriterien || []) z.push(`  ${KRIT[c.status] || "?"} ${c.titel}${c.status === "rot" ? grund(c.grund) : ""}`);
  if (r.ok) z.push("", "Das Tor für das Aufräumen kann sich jetzt öffnen (phase-b zeigt den Stand).");
  else if (r.kopieBehalten) z.push("", "Die Kopie bleibt zur Ansicht liegen und wird später gelöscht.");
  return z.join("\n") + "\n";
}
export function aufraeumenText(r) {
  const z = [];
  if (r.angebote) {
    if (!r.angebote.length) return "Es gibt gerade nichts aufzuräumen.\n";
    for (const a of r.angebote) z.push(`  ${a.faellig ? "•" : "–"} ${a.id}${a.name ? ` (${a.name})` : ""}: ${a.text}`);
    z.push("", "Mit --was <verwaist|archiv|sicherungen|bundles> --ja räumt Kortex das auf (Papierkorb, nie endgültig).");
    return z.join("\n") + "\n";
  }
  if (r.plan) return `${r.angebot.text}\nMit --ja in den Papierkorb legen.\n`;
  return r.ok ? "Aufgeräumt.\n" : "Nicht alles ließ sich aufräumen.\n";
}
