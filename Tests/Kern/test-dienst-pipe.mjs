// Suchdienst unter Windows: der Name der Named Pipe darf aus dem Vault-Pfad allein nicht folgen (R4-8, Review). Ohne Geheimnis legte ein fremder lokaler Benutzer die Pipe vorher an,
// der echte Dienst endete, und der Hinweis-Hook übernähme die Antworten des Fremden. Das Geheimnis liegt im Support-Ordner des Benutzers (Rechte 0600).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { statSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tempOrdner } from "./verlauf-fixture.mjs";
import { dienstSocket, dienstGeheimnis } from "../dienst-client.mjs";
import { nurUnix } from "./nur-unix.mjs";

test("Geheimnis: 64 Hex-Zeichen, beim zweiten Aufruf dasselbe, je Support-Ordner ein anderes", () => {
  const a = tempOrdner("pipe-a"), b = tempOrdner("pipe-b");
  const g = dienstGeheimnis(a);
  assert.match(g, /^[0-9a-f]{64}$/);
  assert.equal(dienstGeheimnis(a), g);
  assert.notEqual(dienstGeheimnis(b), g);
  assert.equal(readFileSync(join(a, "suchdienst-geheimnis"), "utf8").trim(), g);
});

test("Geheimnis: nur der Benutzer darf die Datei lesen (0600)", { skip: nurUnix("Unix-Dateirechte; unter Windows schützt das Benutzerprofil (%APPDATA%)") }, () => {
  const a = tempOrdner("pipe-r");
  dienstGeheimnis(a);
  assert.equal(statSync(join(a, "suchdienst-geheimnis")).mode & 0o777, 0o600);
});

test("Geheimnis: eine kaputte Datei wird nie überschrieben und nie als Name benutzt (Fehler = kein Dienst)", () => {
  const a = tempOrdner("pipe-k");
  mkdirSync(a, { recursive: true });
  writeFileSync(join(a, "suchdienst-geheimnis"), "kaputt\n");
  assert.throws(() => dienstGeheimnis(a), /unlesbar/);
  assert.equal(readFileSync(join(a, "suchdienst-geheimnis"), "utf8"), "kaputt\n");
});

test("Pipe-Name (Windows-Form): hängt vom Geheimnis ab, ist aus dem Vault-Pfad allein nicht berechenbar, gleicher Vault + gleiches Geheimnis = gleicher Name", () => {
  const a = tempOrdner("pipe-n1"), b = tempOrdner("pipe-n2");
  const vault = join(tempOrdner("pipe-v"), "Mein Vault");
  const n1 = dienstSocket(vault, "win32", { support: a });
  assert.match(n1, /^\\\\\.\\pipe\\kortex-suchdienst-[0-9a-f]{32}$/);
  assert.equal(dienstSocket(vault, "win32", { support: a }), n1);
  assert.notEqual(dienstSocket(vault, "win32", { support: b }), n1, "anderes Geheimnis, anderer Name");
  const altName = `\\\\.\\pipe\\kortex-suchdienst-${createHash("sha256").update(join(vault).toLowerCase()).digest("hex").slice(0, 24)}`;
  assert.notEqual(n1, altName, "nicht der frühere, erratbare Name");
  assert.ok(!n1.includes(createHash("sha256").update(join(vault).toLowerCase()).digest("hex").slice(0, 24)));
});

test("Unix-Form bleibt: Datei-Socket im .logs-Ordner des Vaults, ohne Geheimnis", () => {
  assert.equal(dienstSocket("/v/x", "linux"), join("/v/x", ".logs", "suchdienst.sock"));
  assert.equal(dienstSocket("/v/x", "darwin"), join("/v/x", ".logs", "suchdienst.sock"));
});
