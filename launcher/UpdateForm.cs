using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http;
using System.Text.Json;
using ClipboardSyncShared;

namespace ClipboardSync;

internal sealed class UpdateForm : Form
{
    private readonly string? _version;
    private readonly bool _isFirstInstall;
    private readonly string? _appZipUrl;
    private readonly string? _sha256Url;

    private readonly Label _msgLabel;
    private readonly ProgressBar _progressBar;
    private readonly Label _progressLabel;
    private readonly Button _continueBtn;
    private readonly Button _updateBtn;

    private static readonly string TmpDir = Path.Combine(Program.AppDir, "tmp_updater");

    internal UpdateForm(string? version, bool isFirstInstall, string? appZipUrl, string? sha256Url)
    {
        _version        = version;
        _isFirstInstall = isFirstInstall;
        _appZipUrl      = appZipUrl;
        _sha256Url      = sha256Url;

        Text            = "Clipboard Sync";
        Size            = new Size(480, 235);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox     = false;
        MinimizeBox     = false;
        StartPosition   = FormStartPosition.CenterScreen;
        Icon            = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        _msgLabel = new Label
        {
            AutoSize  = false,
            TextAlign = ContentAlignment.TopLeft,
            Size      = new Size(440, 80),
            Location  = new Point(20, 20),
            Text      = _isFirstInstall
                ? "Instalando aplicación..."
                : $"Hay una nueva versión disponible ({_version}).\n¿Quieres descargarla?\n\nSi no la descargas, la funcionalidad puede no ser correcta."
        };

        _progressBar = new ProgressBar
        {
            Size    = new Size(440, 22),
            Location = new Point(20, 105),
            Visible = false,
            Minimum = 0,
            Maximum = 100,
            Style   = ProgressBarStyle.Continuous
        };

        _progressLabel = new Label
        {
            AutoSize = false,
            Size     = new Size(440, 20),
            Location = new Point(20, 132),
            Text     = string.Empty,
            Visible  = false
        };

        _continueBtn = new Button
        {
            Text    = "Continuar",
            Size    = new Size(100, 35),
            Location = new Point(248, 165),
            Visible  = !_isFirstInstall,
            Enabled  = !_isFirstInstall
        };
        _continueBtn.Click += (_, _) => Program.LaunchUiAndExit();

        _updateBtn = new Button
        {
            Text      = _isFirstInstall ? "Instalar" : "Actualizar",
            Size      = new Size(112, 35),
            Location  = new Point(356, 165),
            BackColor = ColorTranslator.FromHtml("#2cb232"),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        _updateBtn.FlatAppearance.BorderSize = 0;
        _updateBtn.Click += async (_, _) => await StartDownloadAsync();

        Controls.AddRange(new Control[] { _msgLabel, _progressBar, _progressLabel, _continueBtn, _updateBtn });
        DarkTheme.Apply(this);
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (_isFirstInstall)
            await StartDownloadAsync();
    }

    private async Task StartDownloadAsync()
    {
        if (_appZipUrl is null || _sha256Url is null)
        {
            MessageBox.Show("No se encontraron los archivos de descarga en la release.", "Error",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Application.Exit();
            return;
        }

        _continueBtn.Enabled = false;
        _updateBtn.Enabled   = false;
        _progressBar.Visible = true;
        _progressLabel.Visible = true;

        try
        {
            Directory.CreateDirectory(TmpDir);

            // Step 1 — Download SHA-256
            SetStatus("Obteniendo hash de verificación...", 2);
            using var client = new HttpClient();
            client.DefaultRequestHeaders.UserAgent.ParseAdd("clipboard-sync-launcher/1.0");
            string sha256Raw    = await client.GetStringAsync(_sha256Url);
            string expectedHash = sha256Raw.Trim().Split(' ', StringSplitOptions.RemoveEmptyEntries)[0].ToUpperInvariant();

            // Step 2 — Download app.zip with progress
            string zipPath = Path.Combine(TmpDir, "app.zip");
            await HttpDownloader.DownloadWithProgressAsync(client, _appZipUrl, zipPath, pct => SetStatus($"Descargando... {pct}%", pct));

            // Step 3 — Verify SHA-256
            SetStatus("Verificando integridad del archivo...", 91);
            string actualHash = await Task.Run(() => HttpDownloader.ComputeSha256(zipPath));
            if (actualHash != expectedHash)
            {
                CleanupTmpDir();
                MessageBox.Show(
                    "Error de integridad: el archivo descargado no es válido. Por favor, inténtalo de nuevo.",
                    "Error de descarga", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Application.Exit();
                return;
            }

            // Step 4 — Extract app.zip to tmp_updater/
            SetStatus("Extrayendo archivos...", 93);
            await Task.Run(() => ZipFile.ExtractToDirectory(zipPath, TmpDir, overwriteFiles: true));

            // Step 5 — Run updater-engine.exe (TS) for file copy + cleanup
            string updaterEnginePath = Path.Combine(TmpDir, "updater-engine.exe");
            if (!File.Exists(updaterEnginePath))
            {
                CleanupTmpDir();
                MessageBox.Show("No se encontró updater-engine.exe en el paquete descargado.",
                    "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Application.Exit();
                return;
            }

            SetStatus("Instalando archivos...", 95);
            await RunUpdaterEngineAsync(updaterEnginePath);
        }
        catch (Exception ex)
        {
            CleanupTmpDir();
            MessageBox.Show($"Error durante la descarga:\n{ex.Message}", "Error",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Application.Exit();
        }
    }

    private async Task RunUpdaterEngineAsync(string updaterEnginePath)
    {
        var psi = new ProcessStartInfo(updaterEnginePath, $"\"{Program.AppDir}\"")
        {
            CreateNoWindow         = true,
            UseShellExecute        = false,
            RedirectStandardOutput = true,
        };

        using var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        var tcs = new TaskCompletionSource<int>();
        proc.Exited += (_, _) => tcs.TrySetResult(proc.ExitCode);

        proc.Start();
        proc.BeginOutputReadLine();
        proc.OutputDataReceived += (_, e) =>
        {
            if (e.Data is null) return;
            try
            {
                using var doc = JsonDocument.Parse(e.Data);
                string step = doc.RootElement.TryGetProperty("step", out var s) ? s.GetString() ?? "" : "";
                string msg  = doc.RootElement.TryGetProperty("message", out var m) ? m.GetString() ?? "" : "";
                int    pct  = doc.RootElement.TryGetProperty("pct", out var p) ? p.GetInt32() : -1;

                if (step == "error")
                    Invoke(() => MessageBox.Show(msg, "Error al actualizar", MessageBoxButtons.OK, MessageBoxIcon.Error));
                else if (pct >= 0)
                    Invoke(() => SetStatus(msg, pct));
            }
            catch { /* non-JSON line — ignore */ }
        };

        int exitCode = await tcs.Task;
        if (exitCode != 0)
        {
            CleanupTmpDir();
            MessageBox.Show("El proceso de actualización falló.", "Error",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            Application.Exit();
            return;
        }

        // Write cleanup bat and relaunch launcher
        string batPath      = Path.Combine(Path.GetTempPath(), $"cs-cleanup-{Guid.NewGuid():N}.bat");
        string launcherPath = Path.Combine(Program.AppDir, "launcher.exe");
        string batContent   = $"""
            @echo off
            :waitloop
            tasklist /FI "IMAGENAME eq updater-engine.exe" 2>NUL | find /I "updater-engine.exe" >NUL
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
            CreateNoWindow  = true,
            UseShellExecute = false
        });

        Application.Exit();
    }

    private void SetStatus(string message, int progress)
    {
        if (InvokeRequired) { Invoke(() => SetStatus(message, progress)); return; }
        _progressLabel.Text  = message;
        _progressBar.Value   = Math.Min(progress, 100);
    }

    private void CleanupTmpDir()
    {
        try { if (Directory.Exists(TmpDir)) Directory.Delete(TmpDir, recursive: true); } catch { }
    }
}
