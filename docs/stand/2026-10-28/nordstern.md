# Nordstern Kortex (CEO, 28.10.2026, Vorgabe Fabio)

## Ziel in einem Satz
Kortex ist ein sehr gutes Gedächtnis für KIs. Es läuft unbemerkt im Hintergrund, ist auf jedem Rechner in wenigen Minuten eingerichtet, verbraucht kaum Tokens, ist sehr zuverlässig und erscheint am Ende als **öffentliches Open-Source-Repo „Kortex“** für alle.

## Woran wir „fertig“ messen (gilt für jede Aufgabe)
| Eigenschaft | Messbares Ziel |
|---|---|
| **Unbemerkt** | Nach der Einrichtung null Pflicht-Handgriffe. Fabio braucht höchstens 10 Sekunden pro Tag (Karten bestätigen). |
| **Einfach einzurichten** | Ein frischer Mac ohne git, Homebrew und Terminal-Erfahrung ist in **unter 3 Minuten** einsatzbereit, mit DMG und geführtem Assistenten (Spec 2026-10-16 §9.1). |
| **Wenig Tokens** | Lesen ist lokal und kostet **0 Tokens** (Suche/MCP ohne LLM). Der Autopilot hat ein festes Tagesbudget (Standard ≤ 50k) und nutzt lokal das Apple-Modell, wo es geht. Das Kontext-Paket beim Sitzungsstart ist ≤ 1.500 Tokens. |
| **Zuverlässig** | Hintergrunddienst (LaunchAgent) startet sich selbst neu. Kein Datenverlust, jede Änderung am Brain ist ein git-Commit. Fehler werden sichtbar (Menüleiste ✓⚠✕), niemals still. |
| **Gute App** | Manuelles Arbeiten wie in Tolaria, nur besser: Vaults, Seiten, Suche, Posteingang, Versionsverlauf (Spec Studio v2). |

## Weg dorthin (Meilensteine, Leitstand plant die Aufgaben darunter)
1. **Jetzt: Produktrunde 2** (FBL-67): Kontext-Paket, Posteingang, KI verbinden, Nutzungsmessung. Läuft.
2. **Assistent „Kortex einrichten“** (M4 + Studio-v2 „Willkommen“): eine echte, geführte Mac-Oberfläche mit Schritten: Vault anlegen, öffnen oder von GitHub klonen; git prüfen bzw. installieren lassen; GitHub-Anmeldung per Gerätecode (keine Tokens in der App); KIs erkennen und verbinden; Probe-Frage „Es funktioniert“. Mehrere Vaults, jeder Vault ein Repo, eingebauter einfacher git-Client (Status, Commit, Abgleich, Verlauf).
3. **Zuverlässigkeit und Sparsamkeit belegen:** Dauerlauf-Test (7 Tage Hintergrunddienst ohne Absturz), Token-Messung pro Tag im Tagesbericht, Wiederanlauf nach Neustart oder Schlaf. Dazu Suche und Frische härten (FBL-90): BM25-Probe ohne Vektoren, neuere Fakten höher gewichten, Wächter für Zuführungen, Gesundheitswert.
4. **Verteilung** (M5): DMG, Signatur, Notarisierung, Sparkle. Steht größtenteils, Test mit einem Kollegen am frischen Mac.
5. **Andere Rechner:** Das Kit und der MCP-Teil laufen auch auf Linux und Windows (CLI ohne App, Installation mit einem Befehl). Die Mac-App bleibt das Aushängeschild.
6. **Öffentlich: Repo „Kortex“** mit englischem README, Lizenz, Installationsanleitung, Screenshots, `brew install --cask kortex`, sauberer Repo-Struktur, ohne private Daten und Pfade. **Freigabe nur durch Fabio** (öffentlicher Release, Lizenzwahl).

## Was Fabio entscheidet (sonst niemand fragt ihn)
Live-Schalten im echten `~/brain`, öffentlicher Release, Lizenz, Geld, Zugangsdaten.
