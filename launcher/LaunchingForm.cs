using System.Diagnostics;
using System.Text.Json;

namespace ClipboardSync;

/// <summary>
/// Shown briefly while launcher-engine.exe runs the version check.
/// Closes itself once the check completes and forwards control accordingly.
/// </summary>
internal sealed class LaunchingForm : Form
{
    private static readonly string UiPath        = Path.Combine(Program.AppDir, "clipboard-sync-ui.exe");
    private static readonly string EngineExePath = Path.Combine(Program.AppDir, "launcher-engine.exe");

    internal LaunchingForm()
    {
        Text            = "Clipboard Sync";
        Size            = new Size(340, 110);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox     = false;
        MinimizeBox     = false;
        ControlBox      = false;
        StartPosition   = FormStartPosition.CenterScreen;
        Icon            = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        var lbl = new Label
        {
            Text      = "Iniciando Clipboard Sync...",
            AutoSize  = false,
            TextAlign = ContentAlignment.MiddleCenter,
            Dock      = DockStyle.Fill,
            Font      = new Font(Font.FontFamily, 10f)
        };
        Controls.Add(lbl);
        DarkTheme.Apply(this);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        await Task.Run(RunEngineCheck);
    }

    private void RunEngineCheck()
    {
        string enginePath = File.Exists(EngineExePath)
            ? EngineExePath
            : Path.Combine(
                Path.GetDirectoryName(Process.GetCurrentProcess().MainModule!.FileName!)!,
                "launcher-engine.exe");

        if (!File.Exists(enginePath))
        {
            Invoke(() => { Hide(); LaunchUiAndExit(); });
            return;
        }

        string? jsonLine = null;
        try
        {
            var psi = new ProcessStartInfo(enginePath)
            {
                CreateNoWindow          = true,
                UseShellExecute         = false,
                RedirectStandardOutput  = true,
                StandardOutputEncoding  = System.Text.Encoding.UTF8,
            };
            using var proc = Process.Start(psi)!;
            jsonLine = proc.StandardOutput.ReadLine();
            proc.WaitForExit(10_000);
        }
        catch
        {
            Invoke(() => { Hide(); LaunchUiAndExit(); });
            return;
        }

        Invoke(() => HandleEngineResult(jsonLine));
    }

    private void HandleEngineResult(string? jsonLine)
    {
        if (string.IsNullOrWhiteSpace(jsonLine))
        {
            LaunchUiAndExit();
            return;
        }

        try
        {
            using var doc  = JsonDocument.Parse(jsonLine);
            string action  = doc.RootElement.TryGetProperty("action", out var a) ? a.GetString() ?? "launch" : "launch";

            switch (action)
            {
                case "launch":
                    LaunchUiAndExit();
                    break;

                case "update":
                {
                    string version      = doc.RootElement.TryGetProperty("version",    out var v) ? v.GetString() ?? "" : "";
                    string appZipUrl    = doc.RootElement.TryGetProperty("appZipUrl",  out var z) ? z.GetString() ?? "" : "";
                    string sha256Url    = doc.RootElement.TryGetProperty("sha256Url",  out var h) ? h.GetString() ?? "" : "";
                    bool   firstInstall = doc.RootElement.TryGetProperty("isFirstInstall", out var f) && f.GetBoolean();
                    Hide();
                    Application.Run(new UpdateForm(version, firstInstall, appZipUrl, sha256Url));
                    break;
                }

                default: // "error" or unknown
                    LaunchUiAndExit();
                    break;
            }
        }
        catch
        {
            LaunchUiAndExit();
        }
    }

    private static void LaunchUiAndExit()
    {
        if (File.Exists(UiPath))
            Process.Start(new ProcessStartInfo(UiPath) { UseShellExecute = true });
        Application.Exit();
    }
}
