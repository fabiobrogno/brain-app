# Messprotokoll: Alltags-Wirkung — Ausgangsmessung (K15)

- **Zweck:** Ausgangswert für K15 (Spec §12.2, §13.2). Spätere Messungen (`brain wirkung`, monatlich im
  Pflegebericht) werden **nur mit der Node-Ausgangsmessung (Teil B)** verglichen.
- **Rauschband (vorab festgelegt):** Eine Änderung je Gruppe gilt als echt ab **≥ 1,0 je 100 Nachrichten UND ≥ 25 %
  des Vorwerts**, wenn beide Zeiträume **≥ 500 Nutzer-Nachrichten** haben und dieselbe Musterliste gilt.
  Anteil großer Werkzeug-Ausgaben **≥ 30 %** = „hoch“ → Vorschlag eines eigenen Bausteins (Auslagern großer
  Ausgaben, Muster von context-mode) an Fabio; vorher wird nichts gebaut.
- **Datenschutz:** nur Zahlen — keine Zitate, keine Pfade, keine Projektnamen.

## A. Python-Auswertung vom 16.10.2026 (nur Einordnung, nicht vergleichbar)

Herkunft: Sitzung 8def260d (Skripte ex.py, an.py, an2.py), 30 Tage bis 16.10.2026, 193 Haupt-Verläufe
(190 in `~/.claude`, 3 in `~/.claude-firma2`), 174 mit Nutzertext, 2.600 Nutzer-Nachrichten, 70 Befehle.

| Gruppe | Nachrichten | Sitzungen |
|---|---|---|
| ungeprüft/kaputt | 55 | 28 |
| Werkzeug/Modell/Tokens | 55 | 27 |
| falsch/stimmt nicht | 39 | 24 |
| Wiederholung/nochmal | 37 | 17 |
| Freigabe/Sicherheit | 27 | 15 |
| Regelbruch | 20 | 14 |
| Kontext/Gedächtnis | 10 | 8 |
| Rückfragen/Stil | 9 | 8 |

Weitere: Kompaktierungen 43 (27 automatische Fortsetzungen, 16 × `/compact`) · Rückbezüge 62 in 35 Sitzungen,
8 Sitzungsstarts mit Rückbezug · Brain-Hinweise 495 in 134 Sitzungen, 5 dieser Sitzungen mit Korrektur.

Warum nicht vergleichbar: Python-`\b` ist Unicode, JavaScript-`\b` nur ASCII; Python zählte die
Kompaktierungs-Fortsetzungen als Nutzer-Nachricht, Node zählt Kompaktierungen über die Grenzzeile im Verlauf.

## B. Node-Ausgangsmessung (Vergleichsbasis, Musterliste v1)

Herkunft: `node .tools/wirkung.mjs … --bis=2026-10-16 --zeitlimit=900 --json`, Kit-Commit a9ace6d,
gemessen am 2026-10-16 23:28, Zeitraum 2026-09-16 bis 2026-10-16 (30 Tage, Fenster nach Datei-Änderungszeit), Wurzeln 2,
Verläufe 179, Sitzungen mit Nutzertext 156, Nutzer-Nachrichten 2019, Befehle 80,
unvollständig: nein.

| Gruppe | Nachrichten | Sitzungen | je 100 Nachrichten |
|---|---|---|---|
| Kontext/Gedächtnis | 9 | 7 | 0,4 |
| falsch/stimmt nicht | 30 | 18 | 1,5 |
| Wiederholung/nochmal | 28 | 12 | 1,4 |
| Regelbruch | 14 | 9 | 0,7 |
| ungeprüft/kaputt | 47 | 23 | 2,3 |
| Rückfragen/Stil | 7 | 6 | 0,3 |
| Werkzeug/Modell/Tokens | 46 | 22 | 2,3 |
| Freigabe/Sicherheit | 20 | 11 | 1,0 |

Weitere: Rückbezüge 29 in 17 Sitzungen (7 als erste Nachricht) ·
Kompaktierungen 14 automatisch + 13 manuell · Brain-Hinweise 200 in
71 Sitzungen, 2 davon mit späterer Korrektur · große Werkzeug-Ausgaben
782 Stück, Anteil 23,9 % (Bash 47 %, Read 12 %, MCP 38 %, andere 3 %).

**Bewertung Anteil großer Ausgaben:** nicht hoch (< 30 %) → kein eigener Baustein.

## C. Bekannte Grenzen
- Regex statt Lesen: Treffer enthalten Rauschen; Gruppen überlappen. Deshalb nur Trends gegen Teil B, nie Absolutwerte.
- Zeitfenster über die Datei-Änderungszeit: Sitzungen, die nach dem Stichtag weiterliefen, fehlen in Teil B.
- Kausalität (Brain-Hinweis → Korrektur) ist nicht belegbar; die Zahl ist ein Signal für M2b (W7).
