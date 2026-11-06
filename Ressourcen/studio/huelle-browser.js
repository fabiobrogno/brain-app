// Browser-Hülle (Paket W1, „Kortex im Browser“): setzt den Hüllen-Vertrag (huellen-vertrag.json) im Browser um. Klassisches Skript, wird NUR vom Browser-Dienst (werkstatt/browser-dienst.mjs)
// in index.html eingefügt — in der App und in der Entwicklung (entwicklung.mjs) wird es nie geladen. api.js ruft `window.kortexHuelle.aktion(name, wert)` statt des WebKit-Kanals.
// Jede Aktion des Vertrags hat hier einen Eintrag (Test: Tests/Node/browser-modus.test.mjs). Was ein Browser nicht kann, antwortet sauber mit { ok:false, grund:"browser-vorschau" }
// (die Oberfläche blendet solche Funktionen vorher aus, siehe api.js `inApp()` / `browserModus()`); nie ein Fehler.
//   · Ordner wählen: Dialog mit Pfadfeld + Unterordner-Liste des Dienstes (huelle-browser-ordner.js), kein showDirectoryPicker (liefert keinen Pfad).
//   · Zwischenablage: Clipboard API (127.0.0.1 gilt als sichere Herkunft), Rückfall execCommand. Extern: window.open mit noopener. Mitteilungen: Web Notifications nach Klick.
//   · Einrichtung: gleiche Regeln wie die App (nur offen nach Anforderung, Domänenliste für `extern`), Stand in <Support>/browser-einrichtung.json über den Dienst.
(function () {
  "use strict";
  var nativ = false;
  try { nativ = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.aktion); } catch (e) { nativ = false; }
  if (nativ || window.kortexHuelle) return;

  var OK = { ok: true };
  var nicht = function (grund) { return { ok: false, grund: grund || "browser-vorschau" }; };
  var einrichtungOffen = false, einrichtungAngefordert = false;
  // Nur bei offener Einrichtung (wie EinrichtungsOverlay.nurAusEinrichtung in Swift; der Vertragstest vergleicht diese Liste)
  var NUR_EINRICHTUNG = ["git-pruefen", "git-installieren", "kopieren", "einrichtung-ende", "einrichtung-schritt"];
  var ANMELDE_DOMAENEN = ["claude.ai", "claude.com", "anthropic.com", "openai.com", "chatgpt.com"];
  var hostIn = function (host, liste) { return liste.some(function (d) { return host === d || host.slice(-(d.length + 1)) === "." + d; }); };

  function json(methode, pfad, daten) {
    return fetch(pfad, { method: methode, headers: daten === undefined ? {} : { "Content-Type": "application/json" }, body: daten === undefined ? undefined : JSON.stringify(daten), cache: "no-store" })
      .then(function (r) { return r.json(); });
  }

  // Im Standardbrowser öffnen: nur https; bei offener Einrichtung nur GitHub (Gerätecode) und die Anmeldung bei Claude/Codex. Muss synchron bleiben (Klick-Geste gegen Popup-Sperre).
  function extern(url) {
    var u; try { u = new URL(String(url)); } catch (e) { return nicht("adresse-nicht-erlaubt"); }
    if (u.protocol !== "https:") return nicht("adresse-nicht-erlaubt");
    if (einrichtungOffen && !(/^(www\.)?github\.com$/i.test(u.hostname) || hostIn(u.hostname.toLowerCase(), ANMELDE_DOMAENEN))) return nicht("adresse-nicht-erlaubt");
    var w = null;
    try { w = window.open(u.href, "_blank"); } catch (e) { w = null; } // ohne „noopener“ im Aufruf, damit ein Popup-Blocker (null) erkennbar bleibt
    if (!w) return nicht("popup-blockiert");
    try { w.opener = null; } catch (e) { /* egal */ } // der neue Tab erreicht diese Seite nie (die Seite sendet ohnehin keinen Referrer)
    return OK;
  }

  function kopieren(text) {
    var t = String(text == null ? "" : text);
    if (!t || t.length > 400 || /[\r\n]/.test(t)) return Promise.resolve(nicht("text-nicht-erlaubt"));
    var rueckfall = function () {
      try {
        var a = document.createElement("textarea"); a.value = t; a.setAttribute("readonly", ""); a.style.position = "fixed"; a.style.opacity = "0";
        document.body.appendChild(a); a.select(); var ok = document.execCommand("copy"); a.remove();
        return ok ? OK : nicht("kopieren-nicht-moeglich");
      } catch (e) { return nicht("kopieren-nicht-moeglich"); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return OK; }, function () { return rueckfall(); });
    return Promise.resolve(rueckfall());
  }

  function mitteilung() {
    if (typeof Notification === "undefined") return Promise.resolve(nicht("nicht-verfuegbar"));
    var zeige = function () { try { new Notification("Kortex", { body: "So sehen Mitteilungen von Kortex im Browser aus." }); return OK; } catch (e) { return nicht("nicht-verfuegbar"); } };
    if (Notification.permission === "granted") return Promise.resolve(zeige());
    if (Notification.permission === "denied") return Promise.resolve(nicht("nicht-erlaubt"));
    return Notification.requestPermission().then(function (p) { return p === "granted" ? zeige() : nicht("nicht-erlaubt"); }, function () { return nicht("nicht-erlaubt"); });
  }

  var AKTIONEN = {
    "ansicht": function () { return { ok: false, grund: "kein-kit" }; },
    "ordner-zeigen": function () { return nicht(); },
    "extern": extern,
    "ordner-waehlen": function (w) { return import("./huelle-browser-ordner.js").then(function (m) { return m.waehleOrdner(w || {}); }); },
    "vault-gewechselt": function () { return OK; },
    "vertrauen-geaendert": function () { return OK; },
    "status-auffrischen": function () { return OK; },
    "titel": function (t) { try { document.title = String(t || "").slice(0, 200) || "Kortex"; } catch (e) { /* egal */ } return OK; },
    "fehler": function (w) { try { console.warn("Studio-Fehler:", w && w.text, w && w.ort); } catch (e) { /* egal */ } return OK; },
    "git-pruefen": function () { return json("GET", "/_kortex/git/pruefen").catch(function () { return { stand: "nicht-pruefbar" }; }); },
    "git-installieren": function () { return json("POST", "/_kortex/git/installieren", {}).catch(function () { return { ok: false, stand: "fehlt", meldung: "Installiere Git und starte Kortex neu." }; }); },
    "kopieren": kopieren,
    "einrichtung-ende": function (w) { einrichtungOffen = false; return json("POST", "/_kortex/einrichtung", { ende: w && w.art }).then(function () { return OK; }, function () { return OK; }); },
    "einrichtung-sitzung": function (w) {
      if (!w || w.offen !== true) { einrichtungOffen = false; einrichtungAngefordert = false; return OK; }
      if (!einrichtungAngefordert && !einrichtungOffen) return { ok: false, grund: "nicht-angefordert" };
      einrichtungAngefordert = false; einrichtungOffen = true; return OK;
    },
    "einrichtung-schritt": function (w) { return json("POST", "/_kortex/einrichtung", { schritt: w && w.schritt }).then(function () { return OK; }, function () { return OK; }); },
    "einrichtung-oeffnen": function (w) {
      einrichtungAngefordert = true;
      var befehl = function () { try { window.studio.befehl("einrichtung", w || {}); } catch (e) { /* Studio noch nicht da */ } };
      Promise.resolve().then(befehl);
      return OK;
    },
    "mitteilung-probe": mitteilung,
    "kuerzel-geaendert": function () { return OK; },
    "kuerzel-global": function () { return nicht(); },
    "fenster-ziehen": function () { return OK; },
    "fenster-zoom": function () { return OK; },
    "darstellung": function () { return OK; },
    "app-symbol": function () { return nicht(); },
  };

  window.kortexHuelle = {
    art: "browser",
    aktionen: Object.keys(AKTIONEN),
    aktion: function (name, wert) {
      var f = Object.prototype.hasOwnProperty.call(AKTIONEN, name) ? AKTIONEN[name] : null;
      if (!f) return { ok: false, grund: "unbekannt" };
      if (NUR_EINRICHTUNG.indexOf(name) >= 0 && !einrichtungOffen) return { ok: false, grund: "einrichtung-nicht-offen" };
      try { return f(wert); } catch (e) { return { ok: false, grund: "fehler" }; }
    },
  };

  // Erster Start: ohne Vault und ohne beendete Einrichtung öffnet die Hülle die Einrichtung selbst (am Mac tut das die App). `studio-bereit` kommt von app.js.
  function ersterStart() {
    Promise.all([json("GET", "/_kortex/einrichtung"), json("GET", "/api/info")]).then(function (r) {
      if (!r[1].vault && !r[0].ende) window.kortexHuelle.aktion("einrichtung-oeffnen", {});
    }, function () { /* ohne Stand bleibt der leere Zustand mit den Knöpfen */ });
  }
  if (window.__studioBereit) ersterStart(); else window.addEventListener("studio-bereit", ersterStart, { once: true });
})();
