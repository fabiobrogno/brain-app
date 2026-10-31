// werkstatt/schutz-ampel.mjs — „Wie fest ist die Sperre?“ je KI-Konto als Ampel mit drei Stufen (Einstellungen → KI & Konten). Reine Funktion über das, was die Werkstatt schon weiß
// (konten.mjs#schutzStand): keine eigene Quelle, keine Dateizugriffe.
//   Stufe 1  Kortex-Wege       Suche, Lesen, Hinweise und Ablegen über Kortex halten sich an die Stufe jedes Kontos. Gilt immer, für jedes Programm.
//   Stufe 2  Leseverbot        Regeln in den Einstellungen von Claude Code (Read/Edit auf den Vault). Nur Claude Code.
//   Stufe 3  Strenger Schutz   Sandbox von Claude Code: auch Shell-Befehle (grep, node, python) sehen gesperrte Vaults nicht. Nur Claude Code.
// zustand je Stufe: "an" | "teil" (nur Stufe 2: nicht für alle gesperrten Vaults) | "aus" | "defekt" (Stufe 2: settings.json unlesbar) | "inaktiv" (Stufe 3 gewünscht, aber in Claude Code nicht wirksam)
//   | "leer" (Stufe 2: es ist nichts gesperrt) | "nicht-moeglich" (anderes Programm als Claude Code)
// farbe (Gesamtbild): "grau" nichts gesperrt · "rot" Claude Code hält nichts auf · "gelb" Leseverbot, aber die Shell sieht noch · "gruen" beides · "kortex" anderes Programm: nur Kortex-Wege
export function schutzAmpel({ programm, gesperrt = 0, schutz = null } = {}) {
  const n = Math.max(0, Number(gesperrt) || 0);
  if (programm !== "claude" || !schutz || schutz.moeglich !== true) {
    return { moeglich: false, gesperrt: n, farbe: n ? "kortex" : "grau", stufen: [{ nr: 1, name: "kortex", zustand: "an" }, { nr: 2, name: "leseverbot", zustand: "nicht-moeglich" }, { nr: 3, name: "streng", zustand: "nicht-moeglich" }] };
  }
  const vaults = schutz.vaults && typeof schutz.vaults === "object" ? Object.values(schutz.vaults) : [];
  const wirksam = vaults.filter((z) => z === "aktiv" || z === "eigene").length;
  let z2 = "leer";
  if (n > 0) z2 = vaults.some((z) => z === "defekt") ? "defekt" : wirksam >= n ? "an" : wirksam === 0 ? "aus" : "teil";
  const z3 = !schutz.strenger ? "aus" : schutz.strengerAktiv ? "an" : "inaktiv";
  let farbe;
  if (n === 0) farbe = "grau";
  else if (z2 === "an" && z3 === "an") farbe = "gruen";
  else if (z2 === "an" || z2 === "teil" || z3 === "an") farbe = "gelb";
  else farbe = "rot";
  return { moeglich: true, gesperrt: n, wirksam, farbe, stufen: [{ nr: 1, name: "kortex", zustand: "an" }, { nr: 2, name: "leseverbot", zustand: z2 }, { nr: 3, name: "streng", zustand: z3 }] };
}
