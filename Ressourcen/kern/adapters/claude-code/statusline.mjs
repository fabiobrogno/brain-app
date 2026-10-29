#!/usr/bin/env node
// Claude-Code-Statusline: Brain-Status immer sichtbar, farbig. Erhält Session-JSON auf stdin.
// Farben: grün = aktuell · gelb = Inbox wartet · rot = offene Konflikte · grau = Modell
// Die Zählweise lebt in brain-stand.mjs (gemeinsam mit dem Brain-Band des Plugins brain-mods).
import { readFileSync } from "node:fs";
import { vaultPfadOderEnde } from "../../pfade.mjs";
import { brainStand, statusZeile } from "../../brain-stand.mjs";

function leseStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

const V = vaultPfadOderEnde([], { still: true });
let eingabe = {};
try { eingabe = JSON.parse(leseStdin()); } catch {}
const MODEL = eingabe?.model?.display_name || "";
console.log(statusZeile(brainStand(V), MODEL));
