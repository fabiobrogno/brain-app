export * from "@codemirror/state";
export * from "@codemirror/view";
export { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from "@codemirror/commands";
export { syntaxTree, syntaxHighlighting, HighlightStyle, LanguageDescription } from "@codemirror/language";
export { markdown, markdownLanguage } from "@codemirror/lang-markdown";
export { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
export { search, searchKeymap, openSearchPanel, closeSearchPanel, highlightSelectionMatches } from "@codemirror/search";
export { tags, tagHighlighter, highlightTree } from "@lezer/highlight";
export { sprachListe } from "./sprachen.js"; // Code-Blöcke (R4-2): Sprachen werden einzeln nachgeladen
