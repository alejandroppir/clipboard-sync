using System.Threading;

namespace SyncApp;

internal static class Program
{
    private const string MutexName = "Global\\ClipboardSyncUI-{A4E9B2C1-7F3D-4E12-B5A0-9C8D7E6F1234}";

    [STAThread]
    internal static void Main()
    {
        ApplicationConfiguration.Initialize();

        bool createdNew;
        using var mutex = new Mutex(initiallyOwned: true, name: MutexName, createdNew: out createdNew);

        if (!createdNew)
        {
            // Another instance is running — bring it to front via Win32
            BringExistingInstanceToFront();
            return;
        }

        Application.Run(new MainForm());
    }

    private static void BringExistingInstanceToFront()
    {
        var currentProcess = System.Diagnostics.Process.GetCurrentProcess();
        foreach (var p in System.Diagnostics.Process.GetProcessesByName(currentProcess.ProcessName))
        {
            if (p.Id == currentProcess.Id) continue;
            IntPtr hWnd = p.MainWindowHandle;
            if (hWnd == IntPtr.Zero) continue;
            NativeMethods.ShowWindow(hWnd, NativeMethods.SW_RESTORE);
            NativeMethods.SetForegroundWindow(hWnd);
            break;
        }
    }
}

internal static class NativeMethods
{
    internal const int SW_RESTORE = 9;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    internal static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    internal static extern bool SetForegroundWindow(IntPtr hWnd);
}