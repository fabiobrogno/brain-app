// fake-launchctl.mjs — Ersatz für launchctl in Tests der Umstellung (Testhaken BRAIN_LAUNCHCTL, P7b). Nie das echte launchctl.
// Vermerkt jeden Aufruf in $FAKE_LAUNCHCTL_LOG und führt Buch über „geladen“ (Datei $FAKE_LAUNCHCTL_LOG.geladen):
//   bootstrap <domain> <plist>   Exit 5, wenn schon geladen („Bootstrap failed: 5: Input/output error“), sonst geladen
//   bootout <domain>/<label>     Exit 3, wenn nicht geladen, sonst entladen
//   print <domain>/<label>       Exit 0 = geladen, Exit 113 = nicht geladen
// $FAKE_LAUNCHCTL_VORGELADEN=1 meldet beim ersten Aufruf „schon geladen“ (der Dienst lief vor der Umstellung).
// $FAKE_LAUNCHCTL_FAIL="bootstrap" lässt den ERSTEN Aufruf dieses Unterbefehls mit Exit 5 scheitern (danach geht er wieder), „bootstrap*“ lässt ALLE scheitern.
import { appendFileSync, existsSync, writeFileSync, rmSync } from "node:fs";

const a = process.argv.slice(2);
const log = process.env.FAKE_LAUNCHCTL_LOG;
if (log) appendFileSync(log, `${a.join(" ")}\n`);
const geladenDatei = log ? `${log}.geladen` : null;
const markeDatei = log ? `${log}.fehlgeschlagen-${a[0]}` : null;
if (geladenDatei && !existsSync(`${log}.start`)) { writeFileSync(`${log}.start`, "1"); if (process.env.FAKE_LAUNCHCTL_VORGELADEN === "1") writeFileSync(geladenDatei, "1"); }
const geladen = () => !!geladenDatei && existsSync(geladenDatei);
const sollScheitern = () => {
  const f = String(process.env.FAKE_LAUNCHCTL_FAIL || "");
  if (f === `${a[0]}*`) return true;
  if (f !== a[0]) return false;
  if (!markeDatei || existsSync(markeDatei)) return false;
  writeFileSync(markeDatei, "1");
  return true;
};
if (sollScheitern()) process.exit(5);
if (a[0] === "bootstrap") { if (geladen()) process.exit(5); if (geladenDatei) writeFileSync(geladenDatei, "1"); }
else if (a[0] === "bootout") { if (!geladen()) process.exit(3); if (geladenDatei) rmSync(geladenDatei, { force: true }); }
else if (a[0] === "print") process.exit(geladen() ? 0 : 113);
