using System.Diagnostics;

namespace ClipboardSync;

internal static class Program
{
    internal static readonly string AppDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "clipboard-sync");

    internal static readonly string LauncherPath = Path.Combine(AppDir, "launcher.exe");
    private  static readonly string UiPath       = Path.Combine(AppDir, "clipboard-sync-ui.exe");

    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();

        string currentExe = Process.GetCurrentProcess().MainModule!.FileName!;
        bool isInAppDir = string.Equals(
            Path.GetFullPath(currentExe),
            Path.GetFullPath(LauncherPath),
            StringComparison.OrdinalIgnoreCase);

        if (!isInAppDir)
        {
            // First run: download app.zip from GitHub, extract to AppDir, create shortcut
            Application.Run(new SetupForm());
        }
        else
        {
            // Normal mode: show loading screen while launcher-engine checks for updates
            Application.Run(new LaunchingForm());
        }
    }

    internal static void LaunchUiAndExit()
    {
        if (File.Exists(UiPath))
            Process.Start(new ProcessStartInfo(UiPath) { UseShellExecute = true });
        Application.Exit();
    }
}
