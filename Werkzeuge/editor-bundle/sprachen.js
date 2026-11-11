// Sprachen für Code-Blöcke: jede wird erst geladen, wenn ein Block sie braucht (dynamisches import → eigene Datei neben dem Bündel).
import { LanguageDescription, LanguageSupport, StreamLanguage } from "@codemirror/language";

// Lädt eine Sprache nicht (Datei fehlt, Netz, Sperre), liefert load() EINMAL eine einfarbige Ersatzsprache: CodeMirror merkt sich das Ergebnis
// und fragt nicht bei jeder Auswertung neu nach der Datei.
const einfarbig = () => new LanguageSupport(StreamLanguage.define({ token(strom) { strom.skipToEnd(); return null; } }));
const L = (name, alias, laden) => LanguageDescription.of({ name, alias, load: () => Promise.resolve().then(laden).catch(einfarbig) });

export const sprachListe = [
  L("JavaScript", ["js", "jsx", "javascript", "mjs", "cjs", "node", "ts", "typescript", "tsx"], () => import("@codemirror/lang-javascript").then((m) => m.javascript({ jsx: true, typescript: true }))),
  L("JSON", ["json", "jsonc", "json5"], () => import("@codemirror/lang-json").then((m) => m.json())),
  L("Python", ["py", "python", "python3"], () => import("@codemirror/lang-python").then((m) => m.python())),
  L("Shell", ["sh", "bash", "shell", "zsh", "console", "terminal"], () => import("@codemirror/legacy-modes/mode/shell").then((m) => new LanguageSupport(StreamLanguage.define(m.shell)))),
  L("Swift", ["swift"], () => import("@codemirror/legacy-modes/mode/swift").then((m) => new LanguageSupport(StreamLanguage.define(m.swift)))),
  L("YAML", ["yaml", "yml"], () => import("@codemirror/lang-yaml").then((m) => m.yaml())),
  L("HTML", ["html", "htm", "xml", "svg", "vue"], () => import("@codemirror/lang-html").then((m) => m.html())),
  L("CSS", ["css", "scss", "less"], () => import("@codemirror/lang-css").then((m) => m.css())),
  L("SQL", ["sql", "sqlite", "postgres", "postgresql", "mysql"], () => import("@codemirror/lang-sql").then((m) => m.sql())),
  L("Markdown", ["md", "markdown"], () => import("@codemirror/lang-markdown").then((m) => m.markdown())),
];
