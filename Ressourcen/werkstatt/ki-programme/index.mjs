// werkstatt/ki-programme/index.mjs — Einstieg: Adapter je KI-Programm (verbinde/trenne/konfiguration) und die Erkennung.
import { BESCHREIBUNGEN as ALLE, ADAPTER, ERKENNBAR } from "./programme.mjs";
import { erkenneProgramme as erkenne } from "./erkennung.mjs";

export { ADAPTER };
export const BESCHREIBUNGEN = ALLE;
/** Erkennung aller Programme mit eigener Erkennung (ohne Cursor); Optionen wie erkennung.mjs. */
export const erkenneProgramme = (optionen) => erkenne(ERKENNBAR, optionen);
