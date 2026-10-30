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
**Gewählt ist Entwurf 3 „Windung“ in der Fassung v2a (`kortex-3-windung-v2a.svg`), am 30.10.2026.** Das Netz (Entwurf 2, `kortex-2-netz.svg`)
ist verworfen und löst das K nicht mehr ab; vorher war das Netz kurz eingebaut (PR 51), davor das K (Entwurf C). Netz, K und alle übrigen Entwürfe
(A, B, C, 1, 2, 4, 5, die erste Windung) bleiben als Archiv in diesem Ordner; er gehört nicht ins App-Paket (`scripts/baue-app.sh`
überspringt `icon-entwuerfe`, `scripts/ci-aenderungen.sh` zählt ihn nicht als Testgegenstand).

- **App-Icon:** `bash scripts/baue-icon.sh` (braucht `rsvg-convert` und `iconutil`) erzeugt `Ressourcen/AppIcon.icns` aus der Windung:
  16, 16@2x und 32 px aus der Kleinvariante `kortex-3-windung-klein.svg`, alle übrigen Größen (32@2x bis 1024) aus dem vollen Entwurf `kortex-3-windung-v2a.svg`.
  `Info.plist` nennt es mit `CFBundleIconFile`, `scripts/baue-app.sh` legt es nach `Contents/Resources`.
- **Kleinvariante:** Bei 16 px verschwimmen im vollen Entwurf die sechs dünnen Bahnen. Die Kleinvariante hat einen größeren Squircle (weniger Rand),
  kein Glanz, kein Innenlicht, keinen Rand und keinen Schatten, nur vier Bahnen je Seite (statt sechs), spiegelgleich, mit dickerem Strich
  (80 statt 27); Farben gleich.
- **Menüleiste:** Das Template-Bild (18 pt, scharf bei 1x/2x/3x, weil bei jeder Auflösung neu gezeichnet) ist dieselbe vereinfachte Windung ohne Fläche
  (vier Bahnen, ein Strang, Spalt in der Mitte, Strich 1,15 und Bahnabstand 2,2 Einheiten, damit Luft zwischen den Bahnen bleibt).
  Geometrie und Zeichnung: `Sources/BrainCore/KortexMenueSymbol.swift` (getestet in `Tests/BrainCoreTests/KortexLogoTests.swift`); als Bild eingebunden
  in `KortexMenueBild` (`Sources/BrainApp/Kortex.swift`). `kortex-3-windung-menue.svg` zeigt dasselbe einfarbig als Vorlage (zur Ansicht, nicht im Bundle).
- **Studio:** Das Marken-Symbol (`marke` in `Ressourcen/studio/symbole.js`, Willkommen-Kopf und leere Editor-Fläche) ist dieselbe vereinfachte Windung
  als ein Linienzug im 16er Raster des Studios (`currentColor`).

### Warum Windung v2a
Die erste Windung (`kortex-3-windung`) wirkte wie eine Röhre oder ein Heizkörper: gleich lange, gerade Bahnen, dicker Strich. Drei verfeinerte Fassungen
(Proben in `proben/`, PNG 1024 jeweils daneben):

| Datei | Idee |
|---|---|
| kortex-3-windung-v2a | Zwei Hemisphären aus einem Strang: je sechs Bahnen, unten durchgehende Brücke, oben zwei freie Enden am Spalt. Bahnen leicht zur Mitte gewölbt, unterschiedlich lang (Umriss ein hohes Oval), Innenwendungen enden unterschiedlich weit vom Spalt, links und rechts leicht verschieden. Strich 27 bei Bahnabstand 90, gleichmäßige Wendungsradien. |
| kortex-3-windung-v2b | Wie v2a mit nur vier Bahnen und dickem Strich (36): am ruhigsten, bei 32 px am klarsten, wirkt aber wie ein Gesicht („Brauen und Mund“) und ist weniger Gehirn |
| kortex-3-windung-v2c | Wie v2a, dünner (24), größerer Spalt, stärkere Unregelmäßigkeit, um 4° gekippt: wirkt zufällig statt organisch |

Gewählt wurde v2a nach Eigenständigkeit (ein Strang mit Spalt, kein Buchstabe und kein Graph), Lesbarkeit bei 16/32 px (dafür die Kleinvariante nach dem
Muster von v2b) und Ruhe (dünne Linie, viel Luft). Verworfen wurden dabei: gerade Bahnen in einem Oval (bleibt Heizkörper), gewellte Bahnen (unruhig),
Doppelspirale (Büroklammer-Effekt) und senkrechte Bahnen (Equalizer).

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
