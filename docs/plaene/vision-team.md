# Vision nach v1: Kortex für Teams

Stand: 2026-11-06 · Status: **Idee, nicht geplant**. Erst angehen, wenn v1 für eine Einzelperson solide und rund ist (siehe „Voraussetzung“).

## Wunsch (Nutzer, 06.11.2026, sinngemäß)

> Wenn Kortex für eine Person perfekt funktioniert, soll es die Kommunikation in Teams lösen: mit Kollegen, der Firma oder der Abteilung
> über das eigene Claude bzw. einen Team-Vault kommunizieren. Dafür ggf. ein eigener Posteingang; man wird benachrichtigt, und die KI kann es
> direkt über eine CLI abrufen. Man kann sich gegenseitig schreiben oder im Team-Vault strukturiertes Team-Wissen übergeben – effizienter
> zusammenarbeiten.

## Warum das zu Kortex passt

Fast alle Bausteine gibt es schon für eine Person:

| Heute (Einzelperson) | Im Team |
|---|---|
| Vault = Ordner mit Markdown, Sicherung über git/GitHub | **Team-Vault** = gemeinsames Repository; jeder hat eine Kopie, Abgleich über git |
| Posteingang `00_inbox` | **Persönlicher Team-Posteingang** je Mitglied (z. B. `posteingang/@name/`) |
| KI-Stufen je Konto und Vault (`gesperrt` / `lesen` / `posteingang` / `erweitert`) | gleiche Stufen für den Team-Vault; der private Vault bleibt für Team-KIs gesperrt |
| MCP-Werkzeuge (`brain_suchen`, `brain_lesen`, Ablegen) | neue Werkzeuge: Posteingang lesen, Nachricht senden, Übergabe anlegen |
| Mitteilungen, Glocke, Kartenstapel (E7) | Hinweis bei neuer Team-Nachricht |
| Zusammenführen bei Fremdänderung (#93), Papierkorb/Undo (#95) | gleichzeitiges Arbeiten mehrerer Menschen und KIs |
| Vorlagen (#96) | Vorlagen für Übergaben, Protokolle, Entscheidungen |

## Grobes Bild

- **Nachricht = Notiz.** Eine Datei im Posteingang der Empfänger, Kopf mit `von`, `an`, `betreff`, `status` (neu / gelesen / erledigt), optional
  `antwort-auf`. Lesbar ohne Kortex, versioniert über git.
- **Übergabe = strukturierte Notiz** nach Vorlage (Kontext, Stand, offene Punkte, Entscheidungen, Links ins Team-Wissen). Die KI kann sie
  entwerfen, der Mensch gibt sie frei (Grundsatz: KI schlägt vor, Mensch übernimmt).
- **Benachrichtigung:** Kortex gleicht den Team-Vault im Hintergrund ab und meldet neue Einträge im eigenen Posteingang.
- **KI-Zugriff per CLI/MCP:** z. B. `brain team posteingang`, `brain team senden`, MCP `brain_team_posteingang` / `brain_team_senden` /
  `brain_uebergabe`, je mit Mindeststufe und Herkunft (`ki:<programm>/<konto>`).
- **Trennung:** privater Vault und Team-Vault strikt getrennt; nichts wandert automatisch vom privaten ins Team-Wissen.

## Offene Fragen (später klären)

1. Transport: nur git (einfach, offline-fähig, aber verzögert) oder zusätzlich ein Echtzeit-Weg?
2. Identität und Rechte im Team: GitHub-Konten/Teams? Wer darf in wessen Posteingang schreiben? Lesebestätigungen ja/nein?
3. Datenschutz und Firmenregeln: was darf eine KI aus dem Team-Vault lesen, was nie (Firmen-/Kundenordner, „nie lernen“-Regeln)?
4. Konflikte bei vielen gleichzeitigen Schreibern; Prompt-Injection über Nachrichten fremder Personen (Nachrichten sind Daten, nie Anweisungen).
5. Plattform: Team-Mitglieder ohne Mac (Kern ist plattformneutral, App nicht).

## Voraussetzung: v1 für eine Person

Bevor das angegangen wird, soll v1 rund sein, u. a.: Einrichtung in einem Fenster mit Konten und Anmelden im Fenster (Pakete E1–E5),
Darstellung/Einstellungs-Layout, verlässliches Schreiben/Suchen/Umbenennen (erledigt: #92–#96), echter Durchlauf am Mac und Beta-Veröffentlichung.
