# Kortex: Icon-Entwuerfe

Drei Entwuerfe im Liquid-Glass-Stil (Squircle 824x824 auf 1024er Leinwand, Rand 100 px, Radius 185 px,
sanfter Lila-Verlauf, Innenlicht, Glanz oben, feiner heller Rand, kein Schlagschatten). Reines SVG, kein Text.

| Datei | Idee | Staerken | Schwaechen |
|---|---|---|---|
| kortex-a-rinde | Zwei Hemisphaeren mit geschwungenen Furchen (Kortex von oben) | Klare Anspielung auf Gehirnrinde, symmetrisch, ruhig | Bei kleiner Groesse fast "Klammern"; innere Furchen werden klein |
| kortex-b-netz | 6 Knoten (ein grosser Kern, 5 aussen) mit Linien | Sofort "Netz/Gedaechtnis", gut bei 64 px, viel Tiefe durch Halo | Generisch (viele Graph-Icons), Linien bei 32 px duenn |
| kortex-c-k | K aus weichen Strichen, unteres Bein als geschwungene Furche | Staerkstes Zeichen, markenfaehig, bei 32 px klar | Gehirn-Bezug nur dezent, K-Schrift wirkt etwas verspielt |

## Farbwerte
- Grund (Diagonale): #8479F7 oben links, #5B4FE0 Mitte (App-Akzent), #3427A8 unten rechts
- Innenlicht: #B8B0FF (45 % Deckkraft, radial); Glanz: Weiss 28 % oben, auslaufend; Rand: Weiss 60 % bis 5 %
- Zeichen: Verlauf #FFFFFF nach #DCD8FF (Netz: Linien Weiss 75 %, Halo Weiss 35 %)

## PNGs erzeugen (1024x1024, transparente Ecken)
    rsvg-convert -w 1024 -h 1024 kortex-a-rinde.svg -o kortex-a-rinde.png
(analog fuer b-netz und c-k). `qlmanage -t -s 1024` liefert dagegen einen weissen Hintergrund
ausserhalb des Squircles und ist deshalb nicht verwendet.

## Entscheidung und Einbau
**Gewählt ist Entwurf 3 „Windung“ in der Originalfassung (`kortex-3-windung.svg`, die eine durchgehende Serpentinenlinie), am 30.10.2026.**
Das Netz (Entwurf 2, `kortex-2-netz.svg`) ist verworfen und löst das K nicht mehr ab; vorher war das Netz kurz eingebaut (PR 51), davor das K
(Entwurf C). Netz, K, die verfeinerten Windungen v2a/b/c und alle übrigen Entwürfe bleiben als Archiv in diesem Ordner; er gehört nicht ins App-Paket
(`scripts/baue-app.sh` überspringt `icon-entwuerfe`, `scripts/ci-aenderungen.sh` zählt ihn nicht als Testgegenstand).

- **App-Icon:** `bash scripts/baue-icon.sh` (braucht `rsvg-convert` und `iconutil`) erzeugt `Ressourcen/AppIcon.icns` aus der Windung:
  16, 16@2x und 32 px aus der Kleinvariante `kortex-3-windung-klein.svg`, alle übrigen Größen (32@2x bis 1024) aus dem vollen Entwurf `kortex-3-windung.svg`
  (Form und Linienführung unverändert; Raster, Squircle, Licht von oben und Tiefe entsprechen den übrigen Entwürfen).
  `Info.plist` nennt es mit `CFBundleIconFile`, `scripts/baue-app.sh` legt es nach `Contents/Resources`.
- **Kleinvariante:** Bei 16 px verschwimmen im vollen Entwurf die sechs Bahnen. Die Kleinvariante hat einen größeren Squircle (weniger Rand), kein Glanz,
  kein Innenlicht, keinen Rand und keinen Schatten, dieselbe Serpentine mit vier statt sechs Bahnen und dickerem Strich (92 statt 46); Farben gleich.
- **Menüleiste:** Das Template-Bild (18 pt, scharf bei 1x/2x/3x, weil bei jeder Auflösung neu gezeichnet) ist dieselbe vereinfachte Serpentine ohne Fläche
  (vier Bahnen, eine Linie, Strich 1,05 bei Bahnabstand 2 Einheiten, damit Luft zwischen den Bahnen bleibt).
  Geometrie und Zeichnung: `Sources/BrainCore/KortexMenueSymbol.swift` (getestet in `Tests/BrainCoreTests/KortexLogoTests.swift`); als Bild eingebunden
  in `KortexMenueBild` (`Sources/BrainApp/Kortex.swift`). `kortex-3-windung-menue.svg` zeigt dasselbe einfarbig als Vorlage (zur Ansicht, nicht im Bundle).
- **Studio:** Das Marken-Symbol (`marke` in `Ressourcen/studio/symbole.js`, Willkommen-Kopf und leere Editor-Fläche) ist dieselbe vereinfachte Serpentine
  als ein Linienzug im 16er Raster des Studios (`currentColor`).

### Warum die Original-Windung
Die Verfeinerungen v2a/b/c (zwei Hemisphären aus einem Strang, dünnere Linie, ungleiche Bahnlängen) wurden geprüft und verworfen: Die ursprüngliche
Serpentine ist die ruhigere, klarere Form, die auch bei 16 bis 32 px und im Menüleisten-Symbol mit wenigen Bahnen trägt. Proben der Kleinvariante:
`proben/kortex-3-windung-klein-16.png`, `-32.png`, `-64.png`.

| Datei | Idee |
|---|---|
| kortex-3-windung | Original: eine durchgehende Serpentinenlinie, sechs Bahnen (gewählt) |
| kortex-3-windung-v2a | Zwei Hemisphären aus einem Strang, sechs Bahnen je Seite, dünner Strich (Archiv) |
| kortex-3-windung-v2b | Wie v2a mit vier Bahnen und dickem Strich; wirkt wie ein Gesicht (Archiv) |
| kortex-3-windung-v2c | Wie v2a, gekippt und unregelmäßiger; wirkt zufällig (Archiv) |

## Entwürfe v2 (Windung gewählt, Netz verworfen, Rest Archiv, nicht im Bundle)
Fünf neue Entwürfe nach macOS-26-Raster: Squircle (Superellipse, 824er Körper auf 1024er Fläche), Licht von oben, dezenter Schlagschatten,
feiner Innenrand, Zeichen mit weichem Schatten. Palette: Kortex-Lila (`#5B4ED6` Mitte, `#8F85F7` oben, `#3A2EA6` unten; Entwurf 5 dunkel mit `#A89FFF`-Licht).
Ansicht aller Entwürfe groß und klein, hell und dunkel: `uebersicht.html`. Proben (16/32/64 px) liegen in `proben/`.

| Datei | Idee |
|---|---|
| kortex-1-boegen | K aus Stamm und zwei spiegelgleichen Rindenbögen (gleicher Radius) |
| kortex-2-netz | K als Graph: großer heller Kern, vier Endknoten, klare Hierarchie |
| kortex-3-windung | Eine durchgehende Windungslinie (Serpentine), Umriss wie ein Gehirn von oben, ohne Buchstaben |
| kortex-4-papier | Monogramm K auf Notizblatt mit umgeschlagener Ecke |
| kortex-5-bahn | Dunkle Variante: leuchtendes K, oberer Arm endet in einem Impuls-Knoten |

PNG 1024 und Proben mit `rsvg-convert -w <px> -h <px> <name>.svg -o <ziel>.png`. Proben der Netz-Kleinvariante: `proben/kortex-2-netz-klein-16.png`, `-32.png`, `-64.png`.
