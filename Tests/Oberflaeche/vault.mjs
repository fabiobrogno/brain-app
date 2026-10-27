// Wegwerf-Vault für die Oberflächentests (nur im Temp-Ordner).
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@example.org", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@example.org" } }).toString();
export { git };

const SEITEN = {
  "00_inbox/2026-10-20_lieferanten-idee.md": "# Lieferanten-Idee\n\nNeue Kaffeemühle prüfen. Siehe [[Kaffee]].\n",
  "00_inbox/2026-10-22_notiz-meeting.md": "# Meeting-Notiz\n\n- Punkt eins\n- Punkt zwei\n",
  "00_inbox/2026-10-23_gedanke.md": "Ein loser Gedanke ohne Überschrift.\n",
  "10_notizen/Reise nach Lissabon.md": "# Reise nach Lissabon\n\nFlug im Mai. Hotel in der Alfama.\n",
  "10_notizen/crlf.md": "# CRLF-Datei\r\n\r\nZeile mit Emoji 🙂 und Umlauten äöü.\r\nLetzte Zeile\r\n",
  "09_wiki/_schema.md": "---\ngeneriert: nein\n---\n# Schema\n",
  "09_wiki/INDEX.md": "<!-- generiert — nicht editieren -->\n# Index\n",
  "09_wiki/wissen/Kaffee.md": "---\ntitel: Kaffee\nstand: 2026-10-01\nverfall: 2027-10-01\nquelle: quelle_buch\nquellen_sha: abc123\n---\n# Kaffee\n\nKaffee ist ein **Heißgetränk** aus gerösteten Bohnen. Siehe auch [[Espresso]] und [[Mühle|die Mühle]].\n\n## Fakten\n\n- Arabica enthält weniger Koffein als Robusta · [[09_wiki/belege/kaffee-1]]\n- Die Röstung beeinflusst den Geschmack stark.\n\n> Ein Zitat über Kaffee.\n\n```js\nconst tasse = 1;\n```\n",
  "09_wiki/wissen/Espresso.md": "---\ntitel: Espresso\nstand: 2026-09-01\n---\n# Espresso\n\nZubereitung unter hohem Druck. Mehr in [[Kaffee]].\n\n> [!konflikt] PRÜFBEDÜRFTIG\n",
  "09_wiki/wissen/Mühle.md": "---\ntitel: Mühle\npruefen_bis: 2020-01-01\n---\n# Mühle\n\nEine Kaffeemühle mahlt Bohnen. Zurück zu [[Kaffee]].\n",
  "09_wiki/wissen/agentic-os/tief/thema_claude-mods.md": "---\nname: claude-mods\ndescription: Plugins, die Claude Code selbst ändern\ntyp: thema\nstand: 2026-10-08\n---\n# Claude Mods\n\nText zu den Mods.\n",
  "30_wissen/yt-claude-mods.md": "# Claude Mods Is The Biggest Claude Code Upgrade\n\nTranskript.\n",
  "09_wiki/belege/kaffee-1.md": "# Beleg 1\n\nQuelle: Buch.\n",
};
export function baueVault({ leer = false, mitRemote = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "brain-studio-test-"));
  const vault = join(dir, "vault");
  mkdirSync(vault);
  git(vault, "init", "-q", "-b", "main");
  if (!leer) {
    for (const [p, inhalt] of Object.entries(SEITEN)) {
      mkdirSync(join(vault, p, ".."), { recursive: true });
      writeFileSync(join(vault, p), inhalt);
    }
    git(vault, "add", "--", ...Object.keys(SEITEN));
    git(vault, "commit", "-q", "-m", "Erste Fassung");
    writeFileSync(join(vault, "10_notizen/Reise nach Lissabon.md"), "# Reise nach Lissabon\n\nFlug im Mai. Hotel in der Alfama. Mietwagen nicht nötig.\n");
    git(vault, "add", "--", "10_notizen/Reise nach Lissabon.md");
    git(vault, "commit", "-q", "-m", "Mietwagen ergänzt");
    if (mitRemote) {
      const bare = join(dir, "remote.git");
      git(dir, "init", "-q", "--bare", "-b", "main", bare);
      git(vault, "remote", "add", "origin", bare);
      git(vault, "push", "-q", "-u", "origin", "main");
    }
  }
  return { dir, vault };
}
