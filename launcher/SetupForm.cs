using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;
using ClipboardSyncShared;

namespace ClipboardSync;

/// <summary>
/// Shown on first run (when launcher.exe is NOT in AppDir).
/// Downloads the latest app.zip from GitHub, extracts to AppDir, creates shortcut, relaunches.
/// </summary>
internal sealed class SetupForm : Form
{
    private static readonly string GH_OWNER = "alejandroppir";
    private static readonly string GH_REPO  = "clipboard-sync";
    private static readonly string API_URL   = $"https://api.github.com/repos/{GH_OWNER}/{GH_REPO}/releases/latest";

    private readonly Label       _msgLabel;
    private readonly ProgressBar _progressBar;
    private readonly Label       _progressLabel;
    private readonly Button      _cancelBtn;

    internal SetupForm()
    {
        Text            = "Clipboard Sync – Instalación";
        Size            = new Size(480, 200);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox     = false;
        MinimizeBox     = false;
        StartPosition   = FormStartPosition.CenterScreen;
        Icon            = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        _msgLabel = new Label
        {
            AutoSize  = false,
            TextAlign = ContentAlignment.TopLeft,
            Size      = new Size(440, 50),
            Location  = new Point(20, 18),
            Text      = "Descargando Clipboard Sync..."
        };

        _progressBar = new ProgressBar
        {
            Size     = new Size(440, 22),
            Location = new Point(20, 75),
            Minimum  = 0,
            Maximum  = 100,
            Style    = ProgressBarStyle.Continuous
        };

        _progressLabel = new Label
        {
            AutoSize = false,
            Size     = new Size(440, 20),
            Location = new Point(20, 102),
            Text     = string.Empty
        };

        _cancelBtn = new Button
        {
            Text     = "Cancelar",
            Size     = new Size(100, 30),
            Location = new Point(360, 132)
        };
        _cancelBtn.Click += (_, _) => Application.Exit();

        Controls.AddRange(new Control[] { _msgLabel, _progressBar, _progressLabel, _cancelBtn });
        DarkTheme.Apply(this);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        await RunSetupAsync();
    }

    private async Task RunSetupAsync()
    {
        try
        {
            using var client = new HttpClient();
            client.DefaultRequestHeaders.UserAgent.ParseAdd("clipboard-sync-setup/1.0");
            client.Timeout = TimeSpan.FromSeconds(30);

            // ── 1. Fetch latest release from GitHub ──────────────────────────
            SetStatus("Buscando última versión...", 2);
            string json    = await client.GetStringAsync(API_URL);
            using var doc  = JsonDocument.Parse(json);
            var assets     = doc.RootElement.GetProperty("assets");

            string? appZipUrl  = null;
            string? sha256Url  = null;

            foreach (var asset in assets.EnumerateArray())
            {
                string name = asset.GetProperty("name").GetString() ?? "";
                string url  = asset.GetProperty("browser_download_url").GetString() ?? "";
                if (name == "app.zip")         appZipUrl  = url;
                if (name == "app.zip.sha256")  sha256Url  = url;
            }

            if (appZipUrl is null)
            {
                ShowError("No se encontró app.zip en la última release de GitHub.");
                return;
            }

            // ── 2. Download SHA-256 ──────────────────────────────────────────
            string? expectedHash = null;
            if (sha256Url is not null)
            {
                SetStatus("Obteniendo hash de verificación...", 4);
                string raw = await client.GetStringAsync(sha256Url);
                expectedHash = raw.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries)[0].ToUpperInvariant();
            }

            // ── 3. Download app.zip with progress ────────────────────────────
            string tmpZip = Path.Combine(Path.GetTempPath(), $"clipboard-sync-setup-{Guid.NewGuid():N}.zip");
            await HttpDownloader.DownloadWithProgressAsync(client, appZipUrl, tmpZip, pct => SetStatus($"Descargando... {pct}%", 5 + (int)(pct * 0.80)));

            // ── 4. Verify SHA-256 ────────────────────────────────────────────
            if (expectedHash is not null)
            {
                SetStatus("Verificando integridad...", 87);
                string actual = await Task.Run(() => HttpDownloader.ComputeSha256(tmpZip));
                if (actual != expectedHash)
                {
                    try { File.Delete(tmpZip); } catch { }
                    ShowError("Error de integridad: el archivo descargado no es válido. Inténtalo de nuevo.");
                    return;
                }
            }

            // ── 5. Extract to AppDir ─────────────────────────────────────────
            SetStatus("Instalando archivos...", 90);
            Directory.CreateDirectory(Program.AppDir);
            await Task.Run(() => ZipFile.ExtractToDirectory(tmpZip, Program.AppDir, overwriteFiles: true));
            try { File.Delete(tmpZip); } catch { }

            // ── 6. Create desktop shortcut ───────────────────────────────────
            SetStatus("Creando acceso directo...", 97);
            CreateDesktopShortcut();

            // ── 7. Relaunch from AppDir ──────────────────────────────────────
            SetStatus("Lanzando...", 100);
            Process.Start(new ProcessStartInfo(Program.LauncherPath) { UseShellExecute = true });
            Application.Exit();
        }
        catch (Exception ex)
        {
            ShowError($"Error durante la instalación:\n{ex.Message}");
        }
    }

    private static void CreateDesktopShortcut()
    {
        string desktop      = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
        string shortcutPath = Path.Combine(desktop, "Clipboard Sync.lnk");

        Type? shellType = Type.GetTypeFromProgID("WScript.Shell");
        if (shellType == null) return;

        dynamic shell    = Activator.CreateInstance(shellType)!;
        dynamic shortcut = shell.CreateShortcut(shortcutPath);
        shortcut.TargetPath   = Program.LauncherPath;
        shortcut.IconLocation = $"{Program.LauncherPath},0";
        shortcut.Save();
    }

    private void SetStatus(string message, int pct)
    {
        if (InvokeRequired) { Invoke(() => SetStatus(message, pct)); return; }
        _progressLabel.Text = message;
        _progressBar.Value  = Math.Min(pct, 100);
    }

    private void ShowError(string message)
    {
        if (InvokeRequired) { Invoke(() => ShowError(message)); return; }
        MessageBox.Show(message, "Error de instalación", MessageBoxButtons.OK, MessageBoxIcon.Error);
        Application.Exit();
    }
}
