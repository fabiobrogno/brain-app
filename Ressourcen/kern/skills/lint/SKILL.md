---
name: lint
description: Vault-Hygiene prüfen (read-only) — Konflikte, Waisen, Drift, Verfall, Review
---

1. Führe aus: `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" lint` und zeige die Befunde als Liste.
1b. Zeige zusätzlich den Gesundheitswert: `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" pflege` (Zeile „Gesundheit: N/100“ mit den Abzügen).
2. Ergänze je Befund eine konkrete Empfehlung (1 Zeile): entscheiden / verlinken / aktualisieren /
   archivieren (nach {{ARCHIV}}) / Skill ingest / Re-Ingest (bei PRÜFBEDÜRFTIG).
   TEAM-DRIFT → Seite erneut in die Team-Wissensbasis speichern (nur mit Freigabe).
3. NICHTS ändern ohne explizite User-Freigabe. Nach Freigabe einzelner Punkte: bei Wiki-Änderungen
   zuerst Lock setzen (`{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" lock` — der Riegel-Hook verlangt es; Exit 1 = andere Sitzung arbeitet gerade),
   umsetzen, _log.md ergänzen (Zeit per `{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" jetzt`), committen (`lint: <was>`, Dateien explizit stagen),
   Lock entfernen (`{{NODE}} "{{KERN}}/brain.mjs" --vault "{{VAULT}}" unlock`).
   FRISCHE/SUCHINDEX/HINWEIS-QUALITÄT: Ursache nennen (liegengebliebenes Wissen, Refresh, Schwelle).
