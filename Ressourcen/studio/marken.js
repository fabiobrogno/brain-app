// Marken-Logos für Dienste, mit denen Kortex sich verbindet (derzeit GitHub). Keine Fremdbibliothek, kein Netz.
// Gleiche Mechanik wie ki-logos.js, aber für Dienste statt KI-Apps. Die Pfaddaten sind unverändert aus Ressourcen/logos/github.svg übernommen
// (Simple Icons 16.36.0, CC0; Herkunft und Markenhinweis in Ressourcen/logos/HERKUNFT.md). Die Marken gehören den jeweiligen Inhabern,
// Nutzung nur zur Kennzeichnung der Integration. Einfarbig in currentColor (passt zu Hell und Dunkel).
//
// markenLogoMarkup("github", 16) -> SVG-Text (oder null bei unbekannter Marke)
// markenLogo("github", 16)       -> <span class="marken-logo" data-marke="github" role="img" aria-label="GitHub">…svg…</span>
//   { dekorativ: true }          -> steht das Logo neben dem Namen, bekommt es aria-hidden statt role/aria-label

const PFAD = {
  github: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
};

const NAME = { github: "GitHub" };

export const markeId = (id) => (Object.hasOwn(NAME, id) ? id : null);
export const markenName = (id) => { const k = markeId(id); return k ? NAME[k] : null; };

export function markenLogoMarkup(id, groesse = 16) {
  const k = markeId(id);
  if (!k) return null;
  return `<svg viewBox="0 0 24 24" width="${groesse}" height="${groesse}" fill="currentColor" xmlns="http://www.w3.org/2000/svg" focusable="false" aria-hidden="true"><path d="${PFAD[k]}"/></svg>`;
}

export function markenLogo(id, groesse = 16, { dekorativ = false } = {}) {
  const k = markeId(id);
  if (!k) return null;
  const el = document.createElement("span");
  el.className = `marken-logo marken-logo-${k}`;
  el.dataset.marke = k;
  el.style.setProperty("--marken-logo-groesse", `${groesse}px`);
  if (dekorativ) el.setAttribute("aria-hidden", "true");
  else { el.title = NAME[k]; el.setAttribute("role", "img"); el.setAttribute("aria-label", NAME[k]); }
  el.innerHTML = markenLogoMarkup(k, groesse); // feste Konstante oben, keine Daten von außen
  return el;
}
