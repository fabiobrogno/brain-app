// git-gesperrt.mjs — Platzhalter für git, solange der Vault nicht vertraut ist (Windows-Fassung des Shell-Skripts git-gesperrt; Starter: windows-start.mjs).
// `git --version` bleibt harmlos (doctor). Alles andere endet mit Exit 126 und einem Satz auf stderr — es wird nie ein echtes git gestartet.
if (process.argv.slice(2).includes("--version")) {
  process.stdout.write("git version (gesperrt)\n");
} else {
  process.stderr.write("Kortex: Dieser Vault ist noch nicht als deiner bestätigt, darum startet der Kern kein git. Bestätige ihn im Studio (Statusleiste „Nur ansehen“).\n");
  process.exitCode = 126;
}
