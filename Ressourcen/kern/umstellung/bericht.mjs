// umstellung/bericht.mjs — Befundbericht in Klartext für Nicht-Techniker (Paket P7a). Reine Funktion: Befund (JSON) rein, Text raus.
// Begriffe: App „Kortex“, Datenordner „Vault“, „Versionsverlauf“, „Passwort-Prüfung vor dem Speichern“, „Hintergrunddienst“, „Online-Sicherung“.
// Der Text enthält nur, was schon im Befund steht (Kategorien, Zählungen, Schlüssel*namen*) – nie Werte.

const GRUPPEN = [
  { schwere: "auto", titel: "Stellt Kortex für dich um" },
  { schwere: "frage", titel: "Braucht deine Entscheidung" },
  { schwere: "hinweis", titel: "Kann Kortex nicht ändern – nur zur Info" },
  { schwere: "blocker", titel: "Muss vorher gelöst werden" },
];

const zeile = (f) => `  • ${f.text}`;

export function befundText(b) {
  const z = [];
  if (b.funde.length === 0) {
    z.push("Dein Vault ist auf dem neuen Stand.");
    z.push("Kortex hat nachgesehen und nichts gefunden, das noch auf die alten Werkzeuge im Vault zeigt. Es ist nichts umzustellen.");
    return z.join("\n") + "\n";
  }
  z.push(b.kitZeit ? "Dein Vault stammt aus der Zeit vor Kortex." : "Kortex hat in deinem Vault ein paar Dinge gefunden.");
  z.push(b.kitZeit
    ? "Kortex hat nachgesehen, was noch auf die alten Werkzeuge im Vault zeigt. An deinen Notizen ändert sich nichts."
    : "An deinen Notizen ändert sich nichts.");
  for (const g of GRUPPEN) {
    const liste = b.funde.filter((f) => f.schwere === g.schwere && !(g.schwere === "blocker" && f.blockiertPhase === "B"));
    if (!liste.length) continue;
    z.push("", `${g.titel} (${liste.length})`, ...liste.map(zeile));
  }
  const spaeter = b.funde.filter((f) => f.schwere === "blocker" && f.blockiertPhase === "B");
  if (spaeter.length) z.push("", `Erst vor dem späteren Aufräumen zu lösen (${spaeter.length})`, ...spaeter.map(zeile));
  z.push("");
  z.push(b.umstellbar
    ? "Als Nächstes probiert Kortex alles an einer Kopie deines Vaults aus. Das Original bleibt dabei unberührt."
    : "Löse zuerst die Punkte unter „Muss vorher gelöst werden“. Erst dann bietet Kortex die Umstellung an.");
  return z.join("\n") + "\n";
}
