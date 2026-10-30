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

## Hinweis
Die Auswahl trifft der Koordinator. Das Final-Icon wird spaeter als .icon (Icon Composer) bzw. .icns
gebaut; diese Entwuerfe sind nicht im App-Bundle eingebunden.
