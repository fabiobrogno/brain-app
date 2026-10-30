# Stand Kortex, 30.10.2026

Fortsetzung von [29.10.](../2026-10-29/README.md).

## Seit dem letzten Stand gemergt

| PR | Inhalt |
|---|---|
| #39 | P7a: Befund für Vaults aus der Kit-Zeit (nur lesend), 29 Fall-Arten in vier Stufen |
| #40 | KI-Werkzeuge sparsamer: lange Seiten abschnittsweise, Suche mit BM25 wie die CLI, Kontextpaket begrenzt – ca. −32 % Tokens je Sitzung, Recall der Messfragen 6/6 statt 0/6 |
| #41 | P5: Vertrauen pro Vault (Workspace-Trust). Angelegt, eigener Klon oder bestätigt = vertraut; Ordner von außen „Nur ansehen“ ohne git, Dienst, Hooks und ohne Anweisungen an die KI. Altes Kit-Vertrauen entfernt |
| #42 | Sichtbare Texte: App „Kortex“, Datenordner „Vault“; Lint gegen Rückfälle |
| #43 | Einrichtungsassistent neu: KI-Logos, Trennen, Konfiguration kopieren, breite Ordner verweigert, Beispiel-Vault |
| #44 | P7b: Probelauf an APFS-Kopie, Phase A (A0–A9) außerhalb des Vaults mit Rückweg je Schritt |
| #45 | App-Icon „K“, eine Akzentfarbe (Kortex-Lila), Menüleiste neu |
| #46 | P7c: Oberfläche der Umstellung im Studio, Menüeintrag „Vault umstellen …“ |

Repo: `main` ist geschützt (Pflicht-Check `ci-ok`), Secret-Scanning und Push-Schutz an. CI ca. 2–4 Minuten.

## Entscheidungen

- MCP bleibt; Kosten liegen in den Werkzeug-Antworten, nicht im Protokoll.
- Tolaria (AGPL) nur als Ideengeber, kein Code übernommen.
- Lokale git-Schlüssel eines alten Vaults wandern in eine Datei je Vault im Support-Ordner (zwei `includeIf`), nicht flach in `~/.gitconfig`.
- Phase B (`.tools` entfernen) erst ein Release später, mit Gerätemerker je Mac.
- Bei rotem A9 gilt Phase A nicht als abgeschlossen.
- Releases bis zum Umzug auf das Firmenkonto nur als Beta ohne Update-Versprechen.

## Offen

1. Echten Vault umstellen: erst Probelauf, dann nur mit ausdrücklicher Freigabe.
2. P7d: Phase B, Aufräumen nach 30 Tagen, Befund für verwaiste `includeIf`.
3. Release: Lizenzen (THIRD-PARTY-NOTICES), README, Beta-Build, Test auf frischem Mac; Sicherung des privaten Sparkle-Schlüssels bestätigen.
4. Kleinigkeiten: `BRAIN_LAUNCHCTL` in die Release-Liste der Testschalter; Übersicht auf die Akzentfarbe; Menü „KI verbunden“; Probelauf mit Teilfortschritt; großer Vault: Such-Cache prüfen.
5. Codex-Logo nach Markenfreigabe.

## Lektionen

- Merge nur mit harter Bedingung „alle Checks grün“.
- Tests mit Attrappen nur mit explizit gebauter Umgebung (`CLAUDE_CONFIG_DIR` u.ä. entfernen) – eine Attrappe hatte sonst eine echte Claude-Konfiguration beschrieben.
- CI läuft auf Linux: macOS-Eigenheiten (launchctl, plutil) über injizierbare Plattform testen.
