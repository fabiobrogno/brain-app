@echo off
rem Kortex im Browser (Vorschau fuer Windows): startet den lokalen Dienst und oeffnet den Standardbrowser.
rem Aufruf: kortex.cmd [--vault Ordner] [--nicht-oeffnen] [--beenden]. Braucht Node.js 22 oder neuer (https://nodejs.org).
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js fehlt. Installiere Node.js 22 oder neuer ^(https://nodejs.org^) und starte Kortex noch einmal.
  exit /b 1
)
node "%~dp0Ressourcen\werkstatt\start.mjs" %*
