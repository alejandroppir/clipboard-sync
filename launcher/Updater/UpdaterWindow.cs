// This project is no longer included in the distribution.
// File copy logic has been moved to src/updater-engine.ts (packaged as updater-engine.exe).
// This stub exists only to keep the csproj compiling.
namespace Updater;

internal sealed class UpdaterWindow : Form
{
    [STAThread]
    static void Main()
    {
        // No-op — replaced by updater-engine.exe (TypeScript)
    }
}


    private static readonly string TmpDir = Path.Combine(AppDir, "tmp_updater");

    private readonly Label _msgLabel;
    private readonly ProgressBar _progressBar;

    internal UpdaterWindow()
    {
        Text = "Clipboard Sync – Actualizando";
        Size = new Size(420, 145);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        ControlBox = false;         // disables the X button during update
        StartPosition = FormStartPosition.CenterScreen;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

        _msgLabel = new Label
        {
            Text = "Actualizando, esto podría tardar unos minutos...",
            AutoSize = false,
            Size = new Size(380, 40),
            Location = new Point(20, 20),
            TextAlign = ContentAlignment.MiddleLeft
        };

        _progressBar = new ProgressBar
        {
            Size = new Size(380, 22),
            Location = new Point(20, 70),
            Style = ProgressBarStyle.Marquee,
            MarqueeAnimationSpeed = 30
        };

        Controls.AddRange(new Control[] { _msgLabel, _progressBar });
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        await Task.Run(RunUpdate);
        Application.Exit();
    }

    private void RunUpdate()
    {
        try
        {
            // 5.3 — Kill running instances of the UI and engine
            KillProcess("clipboard-sync-ui");
            KillProcess("clipboard-sync-engine");

            // 5.4 — Copy files from tmp_updater\ to AppDir\, excluding updater.exe and app.zip
            var skipNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "updater.exe", "app.zip"
            };

            foreach (string srcFile in Directory.GetFiles(TmpDir, "*", SearchOption.AllDirectories))
            {
                string fileName = Path.GetFileName(srcFile);
                if (skipNames.Contains(fileName)) continue;

                string relativePath = Path.GetRelativePath(TmpDir, srcFile);
                string destFile = Path.Combine(AppDir, relativePath);
                string? destDir = Path.GetDirectoryName(destFile);
                if (destDir != null) Directory.CreateDirectory(destDir);

                File.Copy(srcFile, destFile, overwrite: true);
            }

            // 5.5 — version.txt is already handled by the above copy (it's included in app.zip)

            // 5.6 — Write cleanup .bat to %TEMP% and launch it
            string batPath = Path.Combine(Path.GetTempPath(), $"cs-cleanup-{Guid.NewGuid():N}.bat");
            string launcherPath = Path.Combine(AppDir, "launcher.exe");
            string batContent = $"""
                @echo off
                :waitloop
                tasklist /FI "IMAGENAME eq updater.exe" 2>NUL | find /I "updater.exe" >NUL
                if not ERRORLEVEL 1 (
                    timeout /t 1 /nobreak >NUL
                    goto waitloop
                )
                rd /s /q "{TmpDir}"
                start "" "{launcherPath}"
                del "%~f0"
                """;

            File.WriteAllText(batPath, batContent, System.Text.Encoding.ASCII);
            Process.Start(new ProcessStartInfo("cmd.exe", $"/c \"{batPath}\"")
            {
                CreateNoWindow = true,
                UseShellExecute = false
            });
        }
        catch (Exception ex)
        {
            Invoke(() =>
            {
                MessageBox.Show($"Error durante la actualización:\n{ex.Message}",
                    "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            });
        }
    }

    private static void KillProcess(string processName)
    {
        foreach (var p in Process.GetProcessesByName(processName))
        {
            try
            {
                p.Kill(entireProcessTree: true);
                p.WaitForExit(5000);
            }
            catch { /* already exited */ }
            finally { p.Dispose(); }
        }
    }
}
