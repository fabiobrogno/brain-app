// Starter für Test-Attrappen unter Windows (Tests/Node/attrappe.mjs). Wird mit dem csc des .NET Framework übersetzt (liegt auf jedem Windows) und als
// <name>.exe neben die Attrappe kopiert: Windows startet aus Node nur .exe-Dateien, keine Shell-Skripte. Der Starter liest <eigener Pfad>.ini:
//   Zeile 1: Programm (sh.exe oder node.exe) · Zeile 2: Ordner, der vor PATH gesetzt wird (Hilfsprogramme von sh; darf leer sein) · weitere Zeilen: feste erste Argumente (das Skript)
// und startet es mit den eigenen Argumenten, gleichen Ein-/Ausgaben und gibt dessen Exit-Code zurück.
using System;
using System.Diagnostics;
using System.IO;
using System.Text;

static class Start
{
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
        string selbst = System.Reflection.Assembly.GetEntryAssembly().Location;
        string[] cfg = File.ReadAllLines(selbst + ".ini");
        var sb = new StringBuilder();
        for (int i = 2; i < cfg.Length; i++) { if (cfg[i].Length == 0) continue; Q(sb, cfg[i]); sb.Append(' '); }
        for (int i = 0; i < a.Length; i++) { if (i > 0) sb.Append(' '); Q(sb, a[i]); }
        var psi = new ProcessStartInfo(cfg[0], sb.ToString());
        psi.UseShellExecute = false;
        if (cfg.Length > 1 && cfg[1].Length > 0)
        {
            string alt = psi.EnvironmentVariables.ContainsKey("PATH") ? psi.EnvironmentVariables["PATH"] : "";
            psi.EnvironmentVariables["PATH"] = cfg[1] + ";" + alt;
        }
        using (var p = Process.Start(psi)) { p.WaitForExit(); return p.ExitCode; }
    }
}
