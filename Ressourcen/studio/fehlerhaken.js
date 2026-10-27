// Fehlerhaken: meldet JavaScript-Fehler der Oberfläche an die App (Aktion „fehler“ → Zeile „js-fehler“ im App-Log), damit ein
// weißes oder halbes Fenster nicht stumm bleibt. Klassisches Skript, in index.html VOR app.js geladen — so werden auch
// Fehler beim Laden von app.js und seinen Modulen erfasst. Gemeldet werden nur die Meldung (höchstens 300 Zeichen) und der
// Ort (Datei:Zeile:Spalte, ohne Query), nie Stack, Notizinhalt oder Zustand; höchstens 20 Meldungen je Fensterleben, gleiche
// Meldung vom gleichen Ort nur einmal (eine Fehlerschleife verbraucht sonst alle 20). Im Browser (ohne App-Kanal) tut die Datei nichts.
(function () {
  "use strict";
  var MAX_MELDUNGEN = 20;
  var MAX_TEXT = 300;
  var gesendet = 0;
  var imHaken = false;
  var gesehen = Object.create(null);

  function kanal() {
    try { return (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.aktion) || null; }
    catch (e) { return null; }
  }

  // Datei:Zeile:Spalte — nur der Pfad der Adresse (ohne Schema, Host, Query und Fragment); ohne Datei „unbekannt“ (auch für
  // Skripte ohne Adresse, die WebKit als „undefined“ meldet).
  function ortVon(adresse, zeile, spalte) {
    var datei = "";
    if (adresse) { try { datei = new URL(String(adresse), window.location.href).pathname.replace(/^\/+/, ""); } catch (e) { datei = ""; } }
    if (!datei || datei === "undefined") datei = "unbekannt";
    return datei + (zeile ? ":" + zeile + (spalte ? ":" + spalte : "") : "");
  }

  function melde(text, ort) {
    if (imHaken || gesendet >= MAX_MELDUNGEN) return;
    var k = kanal();
    if (!k) return;
    imHaken = true; // Ein Fehler beim Melden selbst löst keine weitere Meldung aus.
    try {
      var t = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) || "(ohne Text)";
      var schluessel = ort + " " + t;
      if (gesehen[schluessel]) return;
      gesehen[schluessel] = true;
      gesendet += 1;
      var antwort = k.postMessage({ aktion: "fehler", wert: { text: t, ort: ort } });
      // Die App antwortet mit einem Promise; eine Abweisung darf nicht selbst als „unbehandelt“ zurückkommen.
      if (antwort && typeof antwort.catch === "function") antwort.catch(function () { /* Diagnose bleibt still */ });
    } catch (e) { /* Diagnose bleibt still */ }
    finally { imHaken = false; }
  }

  // Fangphase auf window: Ladefehler von <script> und <link> steigen nicht auf, kommen aber hier an.
  window.addEventListener("error", function (e) {
    var ziel = e.target;
    if (ziel && ziel !== window && ziel.nodeType === 1) {
      var art = String(ziel.tagName || "").toLowerCase();
      if (art === "script" || art === "link") melde("Datei lässt sich nicht laden (" + art + ")", ortVon(ziel.src || ziel.href));
      return;
    }
    melde(e.message, ortVon(e.filename, e.lineno, e.colno));
  }, true);

  window.addEventListener("unhandledrejection", function (e) {
    var grund = e.reason;
    var text = grund instanceof Error ? grund.name + ": " + grund.message : "Zusage abgelehnt (" + typeof grund + ")";
    var ort = grund instanceof Error ? ortVon(grund.sourceURL, grund.line, grund.column) : "unbekannt";
    melde(text, ort);
  });
})();
