# Suchindex der Werkstatt: Messung vorher und nachher

Gemessen mit `node scripts/messe-grosse-vaults.mjs 5000 20000 --ui --alt <Ordner mit der Fassung von main vor dem Index>` (macOS, Apple Silicon, Node 26, synthetischer Vault im Temp-Ordner mit Git-Repository, Median bzw. 95. Perzentil in ms, ein Prozess, Betriebssystem-Cache warm).

**vorher** = `suche()` aus `gemeinsam/vault.mjs`: liest bei jeder Anfrage alle Dateien synchron und blockiert die Werkstatt für diese Zeit; in der Palette filtert jede Taste alle Titel im Hauptthread.
**nachher** = Index im Speicher (`gemeinsam/suchindex.mjs`) über `GET /api/suche`; die Palette fragt zusätzlich entprellt den Inhalt ab.

| Dateien | Messung | vorher | nachher | Ziel |
|---:|---|---:|---:|---|
| 5.000 | Volltext je Anfrage, Median / p95 | 168 / 203 | 2,9 / 7,4 | p95 < 100 |
| 20.000 | Volltext je Anfrage, Median / p95 | 730 / 772 | 4,9 / 12,4 | p95 < 100 |
| 20.000 | ⌘K-Inhaltsanfrage (8 Treffer), p95 | – | 10 | < 50 |
| 20.000 | Volltext mit Filterzahlen für die Chips, p95 | – | 10 | – |
| 20.000 | gespeichert, sofort gesucht (Datei ist auffindbar) | 730 | 0,2 | – |
| 20.000 | Aufbau des Index bis fertig (im Hintergrund, in 6-ms-Scheiben) | – | 2,4 s | – |
| 20.000 | Speichern während des Aufbaus (85 Speichervorgänge): Median / p95 / größter | blockiert ≈ 730 je Suche | 0,5 / 0,6 / 0,7 | < 50 |
| 20.000 | Verzug der Ereignisschleife während des Aufbaus, größter | ≈ 730 je Suche | 13 | – |
| 20.000 | Speicher des Index (Heap + Puffer) | – | ≈ 59 MB | – |
| 5.000 | ⌘K je Taste im Browser, Eingabe-Handler, Median / größte | 57 / 61 | 1,8 / 25 | < 50 |
| 20.000 | ⌘K je Taste im Browser, Eingabe-Handler, Median / größte | 173 / 227 | 1,9 / 49 | < 50 |
| 20.000 | ⌘K je Taste bis zum nächsten Bild, Median / größte | 174 / 229 | 12,5 / 51 | – |

Anmerkungen
- Die größte Taste im Browser ist die erste Ein-Buchstaben-Taste, auf die fast jeder Titel passt; ab zwei Buchstaben liegt der Handler bei 1–3 ms. Der Suchschlüssel je Datei wird nach dem Laden des Baums in Leerlauf-Häppchen vorgewärmt.
- Die Kern-Suche (`minisuche`, MCP `brain_suchen`) ist unverändert und läuft in einem eigenen Prozess; sie nutzt den Index nicht.
- Der Index wird nicht auf die Platte geschrieben: Der Aufbau dauert bei 20.000 Notizen 2,4 s im Hintergrund, und schon währenddessen ist er durchsuchbar (neueste Notizen zuerst).
