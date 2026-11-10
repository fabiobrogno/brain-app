// Virtuelle Liste (R4-5): zeichnet von sehr vielen Einträgen nur die sichtbaren plus einen Puffer; der Rest ist ein Platzhalter mit der Höhe der übrigen Einträge.
// Eigener kleiner Virtualisierer statt Bibliothek: Höhen sind gemessen (je Schlüssel gemerkt, ResizeObserver), noch Ungemessene zählen mit einem Schätzwert.
// Beim Messen und Neuzeichnen bleibt der oberste sichtbare Eintrag an derselben Stelle (Ankerkorrektur, `overflow-anchor: none` am Host), also keine Sprünge.
// Der Host darf davor beliebige Kinder haben (Leisten, Karten); der Platzhalter oben/unten und die Einträge hängen hinten an.
// Nur DOM und Zahlen, kein Wissen über Notizen: erzeugeVirtuelleListe({ host }) → { setze, stopp, aktiv, zeige, karte, gerendert, bisEnde, rendere, untenEl }.

const SCHAETZ = 92;      // Höhe einer Karte mit zwei Vorschauzeilen (Mittel über echte Vaults); Gemessenes ersetzt das sofort
const PUFFER = 700;      // px über und unter dem Sichtbereich, die schon gezeichnet sind
const RAND = 280;        // so nah darf der Sichtbereich an den Rand des gezeichneten Teils, bevor nachgezeichnet wird
const MAX_GEMERKT = 60000;

export function erzeugeVirtuelleListe({ host }) {
  const oben = document.createElement("div"), unten = document.createElement("div");
  for (const el of [oben, unten]) { el.className = "v-platz"; el.setAttribute("aria-hidden", "true"); }
  host.style.overflowAnchor = "none";
  let n = 0, schluesselVon = null, baue = null;
  let P = new Float64Array(1);          // P[i] = Höhe aller Einträge vor i (n + 1 Werte)
  let schmutzig = true;
  const hoehen = new Map();             // Schlüssel → gemessene Höhe samt Abstand unter der Karte
  const el = new Map();                 // Index → Element (zusammenhängender Bereich von a bis b)
  let a = 0, b = 0;
  const marge = 1;                      // Abstand unter einer Karte (CSS: .karte margin-bottom)
  let laeuft = false, messPlan = 0;
  const ro = new ResizeObserver(() => plane());

  const hoeheVon = (i) => hoehen.get(schluesselVon(i)) ?? SCHAETZ;
  function rechne() {
    if (!schmutzig) return;
    if (P.length < n + 1) P = new Float64Array(n + 1);
    let s = 0;
    for (let i = 0; i < n; i++) { P[i] = s; s += hoeheVon(i); }
    P[n] = s; schmutzig = false;
  }
  // größtes i mit P[i] <= y (0 ≤ i ≤ n - 1)
  function indexBei(y) {
    let lo = 0, hi = n - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (P[m] <= y) lo = m; else hi = m - 1; }
    return lo;
  }
  const basis = () => oben.offsetTop;
  const aktiv = () => laeuft && oben.isConnected;

  function erzeuge(i) {
    const k = baue(i);
    k.__vi = i;
    k.setAttribute("aria-setsize", String(n)); k.setAttribute("aria-posinset", String(i + 1));
    return k;
  }
  function entferne(i) { const k = el.get(i); if (!k) return; ro.unobserve(k); k.remove(); el.delete(i); }
  // Der Eintrag mit dem Fokus (z. B. eine Umbenennung an Ort und Stelle) bleibt gezeichnet, solange er nicht weit weg ist
  const fokusIndex = () => { const f = document.activeElement; if (!f || f === document.body || !host.contains(f)) return -1; for (const [i, k] of el) if (k.contains(f)) return i; return -1; };

  // Ankerkorrektur: der oberste sichtbare Eintrag bleibt an seiner Stelle, auch wenn davor Höhen ersetzt werden
  function anker() {
    const r = host.getBoundingClientRect();
    let best = null;
    for (const [i, k] of el) {
      if (best && i > best[0]) continue;
      const kr = k.getBoundingClientRect();
      if (kr.bottom > r.top + 1) best = [i, kr.top - r.top];
    }
    return best;
  }
  function korrigiere(an) {
    if (!an) return;
    const k = el.get(an[0]); if (!k) return;
    const d = (k.getBoundingClientRect().top - host.getBoundingClientRect().top) - an[1];
    if (Math.abs(d) > 0.5) host.scrollTop += d;
  }

  function messe() {
    let geaendert = false;
    for (const [i, k] of el) {
      const h = k.getBoundingClientRect().height;
      if (!h) continue; // nicht sichtbar (Host ausgeblendet): nichts merken
      const voll = h + marge, key = schluesselVon(i);
      if (Math.abs((hoehen.get(key) ?? -1) - voll) > 0.01) { hoehen.set(key, voll); geaendert = true; }
    }
    if (hoehen.size > MAX_GEMERKT) { const behalten = new Set(); for (let i = a; i < b; i++) behalten.add(schluesselVon(i)); for (const k of [...hoehen.keys()]) if (!behalten.has(k)) hoehen.delete(k); geaendert = true; }
    if (geaendert) schmutzig = true;
    return geaendert;
  }
  function plaetze() { rechne(); oben.style.height = `${P[a]}px`; unten.style.height = `${Math.max(0, P[n] - P[b])}px`; }

  // Zeichnet [von, bis) (Einträge, die schon da sind, bleiben); danach messen, Platzhalter setzen, Anker halten.
  // Ordnung im Host: Vorspann …, oben, Einträge von a bis b, unten
  function zeichne(von, bis) {
    const an = el.size ? anker() : null;
    const f = fokusIndex();
    if (f >= 0 && Math.abs(f - von) < 150 && Math.abs(f - bis) < 150) { von = Math.min(von, f); bis = Math.max(bis, f + 1); }
    for (const i of [...el.keys()]) if (i < von || i >= bis) entferne(i);
    const erst = el.size ? Math.min(...el.keys()) : null;
    const vorn = document.createDocumentFragment(), hinten = document.createDocumentFragment();
    for (let i = von; i < bis; i++) {
      if (el.has(i)) continue;
      const k = erzeuge(i); el.set(i, k); ro.observe(k);
      (erst !== null && i < erst ? vorn : hinten).append(k);
    }
    if (vorn.hasChildNodes()) host.insertBefore(vorn, el.get(erst));
    if (hinten.hasChildNodes()) host.insertBefore(hinten, unten);
    a = von; b = bis;
    const geaendert = messe();
    plaetze();
    if (geaendert) korrigiere(an);
  }

  function berechneFenster() {
    rechne();
    const top = host.scrollTop - basis();
    const von = indexBei(Math.max(0, top - PUFFER)), bisY = top + host.clientHeight + PUFFER;
    let bis = Math.min(n, indexBei(Math.min(P[n] - 0.01, Math.max(0, bisY))) + 2);
    return [von, Math.max(bis, von + 1)];
  }
  const sichtbarBedeckt = () => {
    if (!el.size || !el.has(a)) return false;
    const top = host.scrollTop - basis(), unt = top + host.clientHeight;
    const obenOk = a === 0 || top - RAND >= P[a], untenOk = b >= n || unt + RAND <= P[b];
    return obenOk && untenOk;
  };
  function rendere(erzwinge = false) {
    if (!aktiv() || !n) return;
    if (!erzwinge && sichtbarBedeckt()) return;
    const [v, bi] = berechneFenster();
    zeichne(v, bi);
  }
  function plane() {
    if (messPlan) return;
    messPlan = requestAnimationFrame(() => {
      messPlan = 0;
      if (!aktiv()) return;
      const an = anker();
      if (messe()) { plaetze(); korrigiere(an); }
      rendere();
    });
  }
  host.addEventListener("scroll", () => { if (aktiv()) rendere(); }, { passive: true });
  new ResizeObserver(() => { if (aktiv()) plane(); }).observe(host);

  // Neue Liste: anzahl Einträge, schluessel(i) = stabile Kennung (Pfad), baue(i) = Element. Der Host enthält davor schon beliebige Kinder.
  function setze(o) {
    stoppeIntern();
    n = o.anzahl; schluesselVon = o.schluessel; baue = o.baue; laeuft = true; schmutzig = true;
    host.append(oben, unten);
    a = b = 0;
    rechne();
    plaetze();
    if (o.scroll) host.scrollTop = o.scroll;
    rendere(true);
    if (o.bisIndex != null && o.bisIndex >= b) zeige(o.bisIndex);
  }
  function stoppeIntern() { for (const k of el.values()) ro.unobserve(k); el.clear(); a = b = 0; oben.remove(); unten.remove(); }
  function stopp() { laeuft = false; stoppeIntern(); n = 0; }

  // Eintrag i sichtbar machen (block: "nearest" | "center"); zeichnet ihn bei Bedarf erst
  function zeige(i, block = "nearest") {
    if (!aktiv() || i < 0 || i >= n) return null;
    rechne();
    if (!el.has(i)) {
      const y = basis() + P[i];
      host.scrollTop = Math.max(0, y - (block === "center" ? host.clientHeight / 2 : host.clientHeight * 0.35));
      rendere(true);
    }
    const k = el.get(i);
    if (k) {
      k.scrollIntoView({ block });
      rendere(); // direkt am Rand: den Puffer gleich nachzeichnen
    }
    return k || null;
  }
  return {
    setze, stopp, aktiv, zeige, rendere, plane,
    karte: (i) => el.get(i) || null,
    gerendert: () => el.size,
    bereich: () => [a, b],
    bisEnde: () => b >= n,
    anzahl: () => n,
    untenEl: unten, obenEl: oben,
  };
}
