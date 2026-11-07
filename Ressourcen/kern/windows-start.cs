// Starter für den Kern unter Windows (windows-start.mjs). Windows startet aus Node nur .exe-Dateien — eine .cmd braucht cmd.exe, und das deutet jedes Argument um
// (%VAR%, ^, &, |, <, >, ") — darum ein winziges Programm, das seine Argumente UNVERÄNDERT weitergibt. Es wird mit dem csc des .NET Framework übersetzt (liegt auf jedem Windows,
// C# 5) und als <name>.exe neben eine <name>.exe.ini kopiert. Die .ini (UTF-8):
//   Zeile 1: Programm (node.exe) · Zeile 2: Skript (git-sicher.mjs) · weitere Zeilen: NAME=WERT (Umgebungsvariablen für das Programm, z. B. ELECTRON_RUN_AS_NODE=1)
// Der Starter startet `<Programm> <Skript> <eigene Argumente>` mit denselben Ein-/Ausgaben und gibt dessen Exit-Code zurück. NODE_OPTIONS und NODE_PATH entfernt er
// (kein fremder Code im Node, der die Schranke ausführt). Fehlt die .ini oder ist sie kaputt: Exit 125, es läuft nichts.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

static class Start
{
    // Argument nach den Regeln von CommandLineToArgvW zitieren (Leerzeichen, ", Rückstriche vor ")
    static void Q(StringBuilder sb, string s)
    {
        if (s.Length > 0 && s.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) { sb.Append(s); return; }
        sb.Append('"');
        int bs = 0;
        foreach (char c in s)
        {
            if (c == '\\') { bs++; continue; }
            if (c == '"') { sb.Append('\\', bs * 2 + 1); sb.Append('"'); bs = 0; continue; }
            sb.Append('\\', bs); bs = 0; sb.Append(c);
        }
        sb.Append('\\', bs * 2);
        sb.Append('"');
    }

    static int Main(string[] a)
    {
        string[] cfg;
        try { cfg = File.ReadAllLines(System.Reflection.Assembly.GetEntryAssembly().Location + ".ini", new UTF8Encoding(false)); }
        catch (Exception) { return 125; }
        if (cfg.Length < 2 || cfg[0].Length == 0 || cfg[1].Length == 0) return 125;
        var sb = new StringBuilder();
        Q(sb, cfg[1]);
        foreach (string s in a) { sb.Append(' '); Q(sb, s); }
        var psi = new ProcessStartInfo(cfg[0], sb.ToString());
        psi.UseShellExecute = false;
        psi.EnvironmentVariables.Remove("NODE_OPTIONS");
        psi.EnvironmentVariables.Remove("NODE_PATH");
        for (int i = 2; i < cfg.Length; i++)
        {
            int gl = cfg[i].IndexOf('=');
            if (gl > 0) psi.EnvironmentVariables[cfg[i].Substring(0, gl)] = cfg[i].Substring(gl + 1);
        }
        try { using (var p = Process.Start(psi)) { p.WaitForExit(); return p.ExitCode; } }
        catch (Exception) { return 127; }
    }
}
