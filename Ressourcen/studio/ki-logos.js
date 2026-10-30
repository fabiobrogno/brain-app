// Logos der KI-Apps, mit denen sich Kortex verbindet (Claude, Codex, Cursor, Claude Desktop, Gemini CLI, GitHub Copilot, Zed, OpenCode, Warp).
// Keine Fremdbibliothek, kein Netz. Die Pfaddaten sind unverändert aus Ressourcen/logos/*.svg übernommen (Simple Icons 16.36.0, CC0; Herkunft,
// Hinweis zu den Marken und die Begründung der Farben in Ressourcen/logos/HERKUNFT.md). Die Marken gehören den jeweiligen Inhabern, Nutzung nur
// zur Kennzeichnung der Integration. Für Codex gibt es kein lizenziertes Vektor-Logo: dort steht nur die Initiale in einem neutralen Kreis (per CSS).
//
// Einheitliche Größe: jedes Logo hat eine eigene ANSICHT (viewBox), die um die Glyphe zentriert ist und deren Füllung im Quadrat nach der
// Tintendichte abgestuft ist (dichte Formen wie Warp kleiner, luftige wie Gemini größer) — die Form selbst wird nie verzerrt. Die Zahlen sind
// in Sources/BrainCore/KILogoQuelle.swift identisch (Tests/Node/ki-logos-gleich.test.mjs prüft das). Farbe: Claude (Desktop) und Gemini in der
// Markenfarbe (mindestens 3:1 Kontrast auf Hell UND Dunkel), alle anderen einfarbig in currentColor (siehe studio.css).
//
// kiLogoMarkup("claude")  -> SVG-Text (oder null, wenn es für diese KI kein Logo gibt)
// kiLogo("claude", 16)    -> <span class="ki-logo" data-ki-logo="claude" role="img" aria-label="Claude" title="Claude">…svg…</span>
//   { dekorativ: true }   -> steht das Logo neben dem Namen, bekommt es aria-hidden statt role/aria-label (der Name wird nicht doppelt vorgelesen)
// Unbekannte KIs (Windsurf, Kiro …) liefern null: der Aufrufer behält sein bisheriges Symbol.

export const PFAD = {
  claude: "m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z",
  cursor: "M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23",
  gemini: "M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81",
  copilot: "M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z",
  zed: "M2.25 1.5a.75.75 0 0 0-.75.75v16.5H0V2.25A2.25 2.25 0 0 1 2.25 0h20.095c1.002 0 1.504 1.212.795 1.92L10.764 14.298h3.486V12.75h1.5v1.922a1.125 1.125 0 0 1-1.125 1.125H9.264l-2.578 2.578h11.689V9h1.5v9.375a1.5 1.5 0 0 1-1.5 1.5H5.185L2.562 22.5H21.75a.75.75 0 0 0 .75-.75V5.25H24v16.5A2.25 2.25 0 0 1 21.75 24H1.655C.653 24 .151 22.788.86 22.08L13.19 9.75H9.75v1.5h-1.5V9.375A1.125 1.125 0 0 1 9.375 8.25h5.314l2.625-2.625H5.625V15h-1.5V5.625a1.5 1.5 0 0 1 1.5-1.5h13.19L21.438 1.5z",
  opencode: "M22 24H2V0h20zM17 4.8H7v14.4h10z",
  warp: "M12.035 2.723h9.253A2.712 2.712 0 0 1 24 5.435v10.529a2.712 2.712 0 0 1-2.712 2.713H8.047Zm-1.681 2.6L6.766 19.677h5.598l-.399 1.6H2.712A2.712 2.712 0 0 1 0 18.565V8.036a2.712 2.712 0 0 1 2.712-2.712Z",
};

// viewBox je Logo: "x y breite höhe" (Quadrat um die Mitte der Glyphe)
export const ANSICHT = {
  claude: "-2.61 -2.61 29.21 29.21",
  cursor: "-3.28 -3.28 30.55 30.55",
  gemini: "-0.52 -0.52 25.03 25.03",
  copilot: "-1.83 -1.83 27.66 27.66",
  zed: "-3.01 -3.01 30.03 30.03",
  opencode: "-4.08 -4.08 32.16 32.16",
  warp: "-4.35 -4.35 32.7 32.7",
};

// Logo-Form, wenn zwei Namen dasselbe Zeichen nutzen (Claude Desktop zeigt das Claude-Zeichen)
const FORM = { "claude-desktop": "claude" };
const NAME = { claude: "Claude", codex: "Codex", cursor: "Cursor", "claude-desktop": "Claude Desktop", gemini: "Gemini CLI", copilot: "GitHub Copilot", zed: "Zed", opencode: "OpenCode", warp: "Warp" };
const ALIAS = { "claude-code": "claude", "cursor-agent": "cursor" };

export const kiLogoId = (id) => {
  const k = ALIAS[id] || id;
  return Object.hasOwn(NAME, k) ? k : null;
};

export const kiLogoName = (id) => { const k = kiLogoId(id); return k ? NAME[k] : null; };

export function kiLogoMarkup(id, groesse = 16) {
  const k = kiLogoId(id);
  const form = k && (FORM[k] || k);
  if (!k || !PFAD[form]) return null;
  return `<svg viewBox="${ANSICHT[form]}" width="${groesse}" height="${groesse}" fill="currentColor" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true"><path d="${PFAD[form]}"/></svg>`;
}

export function kiLogo(id, groesse = 16, { dekorativ = false } = {}) {
  const k = kiLogoId(id);
  if (!k) return null;
  const el = document.createElement("span");
  el.className = `ki-logo ki-logo-${k}`;
  el.dataset.kiLogo = k;
  el.title = NAME[k];
  el.style.setProperty("--ki-logo-groesse", `${groesse}px`);
  if (dekorativ) el.setAttribute("aria-hidden", "true");
  else { el.setAttribute("role", "img"); el.setAttribute("aria-label", NAME[k]); }
  const markup = kiLogoMarkup(k, groesse);
  if (markup) el.innerHTML = markup; // feste Konstante oben, keine Daten von außen
  else { el.classList.add("ki-logo-initiale"); el.dataset.initiale = NAME[k].slice(0, 1); }
  return el;
}
