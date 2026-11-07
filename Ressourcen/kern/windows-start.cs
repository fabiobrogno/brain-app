// Starter für den Kern unter Windows (windows-start.mjs). Windows startet aus Node nur .exe-Dateien — eine .cmd braucht cmd.exe, und das deutet jedes Argument um
// (%VAR%, ^, &, |, <, >, ") — darum ein winziges Programm, das seine Argumente UNVERÄNDERT weitergibt. Es wird mit dem csc des .NET Framework übersetzt (liegt auf jedem Windows,
// C# 5) und als <name>.exe neben eine <name>.exe.ini kopiert. Die .ini (UTF-8): Zeile 1: Programm (node.exe) · Zeile 2: Skript (git-sicher.mjs).
// Der Starter startet `<Programm> <Skript> <eigene Argumente>` mit denselben Ein-/Ausgaben und gibt dessen Exit-Code zurück. NODE_OPTIONS und NODE_PATH entfernt er
// (kein fremder Code im Node, der die Schranke ausführt). Fehlt die .ini oder ist sie kaputt: Exit 125, es läuft nichts.
// Job-Objekt: der Starter legt sich selbst in ein Job-Objekt mit KILL_ON_JOB_CLOSE. Wird er beendet (Zeitüberschreitung des Aufrufers, Abbruch), endet der ganze Baum
// (node, git, deren Kinder) mit ihm — wie am Mac, wo `exec` den Prozess ersetzt. Ein im Hintergrund abgelöstes `git gc --auto` endet damit auch (git räumt das beim nächsten Lauf auf).
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

static class Job
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attribute, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)]
    struct Basic
    {
        public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
        public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Extended
    {
        public Basic BasicInformation; public IoCounters Io;
        public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
    }

    // Bestmöglich: gelingt es nicht (ältere Windows, der Aufrufer hat uns in ein Job-Objekt ohne Verschachtelung gesteckt), läuft der Starter wie sonst.
    public static void Setze()
    {
        try
        {
            IntPtr job = CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return;
            var info = new Extended();
            info.BasicInformation.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            int laenge = Marshal.SizeOf(typeof(Extended));
            IntPtr zeiger = Marshal.AllocHGlobal(laenge);
            try
            {
                Marshal.StructureToPtr(info, zeiger, false);
                if (SetInformationJobObject(job, 9, zeiger, (uint)laenge)) AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle); // 9 = JobObjectExtendedLimitInformation
            }
            finally { Marshal.FreeHGlobal(zeiger); }
        }
        catch (Exception) { }
    }
}

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
        Job.Setze();
        var sb = new StringBuilder();
        Q(sb, cfg[1]);
        foreach (string s in a) { sb.Append(' '); Q(sb, s); }
        var psi = new ProcessStartInfo(cfg[0], sb.ToString());
        psi.UseShellExecute = false;
        psi.EnvironmentVariables.Remove("NODE_OPTIONS");
        psi.EnvironmentVariables.Remove("NODE_PATH");
        try { using (var p = Process.Start(psi)) { p.WaitForExit(); return p.ExitCode; } }
        catch (Exception) { return 127; }
    }
}
