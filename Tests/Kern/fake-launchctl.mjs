// fake-launchctl.mjs — Ersatz für launchctl in Tests der Umstellung (Testhaken BRAIN_LAUNCHCTL, P7b). Vermerkt jeden Aufruf in $FAKE_LAUNCHCTL_LOG und meldet Erfolg. Nie das echte launchctl.
import { appendFileSync } from "node:fs";
if (process.env.FAKE_LAUNCHCTL_LOG) appendFileSync(process.env.FAKE_LAUNCHCTL_LOG, `${process.argv.slice(2).join(" ")}\n`);
