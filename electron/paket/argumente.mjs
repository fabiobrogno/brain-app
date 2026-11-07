// electron/paket/argumente.mjs — Argumente des Paketbaus (baue.mjs), getrennt, damit sie ohne electron-builder prüfbar sind (Tests/Node/electron-haertung.test.mjs).
export function liesArgumente(argv) {
  const o = { system: argv[0], arch: "x64", version: process.env.KORTEX_VERSION || null, genericUrl: null, fuses: "release", ausgabe: "pakete", dir: false };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--arch") o.arch = argv[++i];
    else if (argv[i] === "--version") o.version = argv[++i];
    else if (argv[i] === "--generic-url") o.genericUrl = argv[++i];
    else if (argv[i] === "--fuses") o.fuses = argv[++i];
    else if (argv[i] === "--ausgabe") o.ausgabe = argv[++i];
    else if (argv[i] === "--dir") o.dir = true;
    else throw new Error(`Unbekanntes Argument: ${argv[i]}`);
  }
  if (!["win", "linux"].includes(o.system)) throw new Error("Erstes Argument: win oder linux");
  if (!["x64", "arm64"].includes(o.arch)) throw new Error("--arch: x64 oder arm64");
  if (!["release", "test"].includes(o.fuses)) throw new Error("--fuses: release oder test");
  if (o.genericUrl !== null && !/^http:\/\/127\.0\.0\.1:\d{1,5}(\/|$)/.test(o.genericUrl)) throw new Error("--generic-url: nur http://127.0.0.1:<Port> (Update-Test), nie ein fremder Server");
  if (o.system === "win" && o.arch !== "x64") throw new Error("Windows: nur x64");
  return o;
}
