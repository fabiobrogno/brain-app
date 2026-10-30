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
Gewählt ist Entwurf C (`kortex-c-k.svg`). Daraus entsteht `Ressourcen/AppIcon.icns` (`bash scripts/baue-icon.sh`, braucht
`rsvg-convert` und `iconutil`); `Info.plist` nennt es mit `CFBundleIconFile`, `scripts/baue-app.sh` legt es nach
`Contents/Resources`. Bei 16 px verschwimmt das K des vollen Entwurfs (dünne Striche, Glanz), darum nutzen 16 und 32 px
(inkl. 16@2x) die Kleinvariante `kortex-c-k-klein.svg`: größerer Squircle, kein Glanz, dickere Striche, gerades Bein.
Alle übrigen Größen (32@2x bis 1024) kommen aus dem vollen Entwurf. Das Menüleisten-Symbol (`KortexMenueBild` in
`Sources/BrainApp/Kortex.swift`) zeichnet dieselben Striche der Kleinvariante einfarbig als Template.

## Entwürfe v2 (Auswahl offen, nicht im Bundle)
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

PNG 1024 und Proben mit `rsvg-convert -w <px> -h <px> <name>.svg -o <ziel>.png`. Für den Einbau würde die Wahl wie bei Entwurf C
nach `scripts/baue-icon.sh` übernommen (bei 16/32 px ggf. eine Kleinvariante mit kräftigeren Strichen und ohne Glanz).
