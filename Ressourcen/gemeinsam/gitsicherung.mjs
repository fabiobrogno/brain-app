// gemeinsam/gitsicherung.mjs — Ist der Vault bereit für die Sicherung (Assistent „Kortex einrichten“, Schritt „Sicherung“)?
// Reine Auswertung des Git-Status (git.status bzw. vault.gitStatus), ohne eigene Aufrufe. Zweck: BEVOR ein Repository bei GitHub angelegt
// wird, steht fest, dass sich der Vault danach auch verbinden lässt — sonst blieben verwaiste, leere Repositories zurück.
//
// → { zustand: "gesichert" }                  Remote UND Upstream sind da: es ist nichts zu tun.
//   { zustand: "bereit" }                     Kein Remote, auf einem Zweig, mit mindestens einer gespeicherten Version.
//   { zustand: "blockiert", grund, text }     Es geht (noch) nicht; text ist ein Satz für den Nutzer.
//     grund: gesperrt | kein-git | losgeloest | unfertig | keine-version

export function sicherungStand(s) {
  const blockiert = (grund, text) => ({ zustand: "blockiert", grund, text });
  if (!s || typeof s !== "object") return blockiert("kein-git", "Der Stand deines Brains war nicht lesbar.");
  if (s.gesperrt) {
    return blockiert("gesperrt", "Git ist für dieses Brain gesperrt, bis du ihm im Studio vertraust. Solange kann Kortex nichts sichern — es wurde auch nichts bei GitHub angelegt.");
  }
  if (!s.repo) return blockiert("kein-git", "Dieser Ordner hat keinen Versionsverlauf (git). Schalte ihn zuerst ein.");
  if (s.zweig === "(losgelöst)") {
    return blockiert("losgeloest", "Dein Brain steht auf keinem Zweig (Git ist „losgelöst“). Wechsle zuerst auf einen Zweig, zum Beispiel „main“. Es wurde nichts bei GitHub angelegt.");
  }
  if (s.remote && s.upstream) return { zustand: "gesichert" };
  if (s.remote) {
    return blockiert("unfertig", "Dein Brain ist schon mit einem Server verbunden, aber es wurde noch nichts dorthin gesendet. Öffne das Studio und gleiche dort ab — oder entferne das Remote in Git. Es wurde nichts bei GitHub angelegt.");
  }
  if (!s.letzterCommit) return blockiert("keine-version", "Dein Brain hat noch keine gespeicherte Version. Speichere im Studio zuerst eine Version und sichere dann.");
  return { zustand: "bereit" };
}
