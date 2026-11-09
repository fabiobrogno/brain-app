// „In den Posteingang legen“ (K1): der Text kommt von Kortex; die Sätze der KI werden entschärft (kein Link, Bild, keine Überschrift, kein HTML), Link-Titel können keinen [[Link]] sprengen.
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname } from "node:path";

const { markdownSicher, linkTitel, baueMerkText } = await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "Ressourcen", "studio", "ki-zusammenfassung-text.js")).href);

test("markdownSicher: Markdown-Zeichen und Adressen werden entschärft, Zeilenumbrüche und Steuerzeichen werden Leerzeichen", () => {
  const t = markdownSicher("# Titel\n[klick](https://evil.example) ![b](x.png) <b>fett</b> `code` *a* _b_ www.evil.example zwei");
  assert.ok(!/(^|\s)#/.test(t) && !t.includes("\n") && !t.includes(" "));
  for (const z of ["[", "<", "`", "*", "_", "!", "#"]) assert.ok(!new RegExp("(^|[^\\\\])\\" + z).test(t), `unmaskiert: ${z} in ${t}`);
  assert.ok(t.includes("https\\://") && !t.includes("https://"));
  assert.ok(t.includes("www\\."));
});

test("linkTitel: keine Zeichen, die einen Wikilink sprengen oder umlenken", () => {
  assert.equal(linkTitel("Atlas]] [[Geheim|x#y^z"), "Atlas [[Geheimxyz".replace("[[", ""));
  assert.equal(linkTitel("a\nb"), "a b");
});

test("baueMerkText: Titel und Text von Kortex, ein Satz je Zeile mit [[Links]] auf die Belege, Hinweis „von einer KI“", () => {
  const { titel, text } = baueMerkText({ saetze: [{ text: "Neu: [x](http://e.example)", belege: [{ titel: "Atlas" }, { titel: "Atlas" }, { titel: "Kaffee]]", pfad: "10/Kaffee-Notiz.md" }] }] }, { seitText: "Mo., 9. Nov.", datum: "2026-11-09" });
  assert.equal(titel, "KI-Zusammenfassung: Was ist neu (2026-11-09)");
  assert.match(text, /^Von einer KI zusammengefasst, was seit Mo\., 9\. Nov\. neu ist\./);
  assert.match(text, /\n- Neu: \\\[x\\\]\(http\\:\/\/e\.example\) \(\[\[Atlas\]\], \[\[Kaffee-Notiz\|Kaffee\]\]\)$/);
});
