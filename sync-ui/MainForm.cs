using System.Text.Json;

namespace SyncApp;

internal sealed class MainForm : Form
{
    private static readonly string AppDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "clipboard-sync");

    private static readonly string ConfigPath = Path.Combine(AppDir, "config.json");

    private readonly SyncEngineManager _engine;
    private readonly TextBox _logBox;
    private readonly Label _statusLabel;
    private readonly Label _userIdLabel;
    private readonly Button _changeUserIdBtn;
    private readonly Button _stopBtn;
    private readonly Button _restartBtn;
    private readonly NotifyIcon _trayIcon;

    private enum EngineStatus { Running, Stopped, Error }
    private EngineStatus _status = EngineStatus.Stopped;

    internal MainForm()
    {
        _engine = new SyncEngineManager();

        // ── Window setup ──────────────────────────────────────────────────────
        Text = "Clipboard Sync";
        Size = new Size(600, 460);
        MinimumSize = new Size(480, 360);
        StartPosition = FormStartPosition.CenterScreen;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

        // ── Status bar ────────────────────────────────────────────────────────
        _statusLabel = new Label
        {
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(6, 0, 0, 0),
            Font = new Font(Font.FontFamily, 9f, FontStyle.Bold),
            Text = "Estado: Iniciando..."
        };

        _changeUserIdBtn = new Button
        {
            Text = "Cambiar",
            Size = new Size(68, 24),
            Margin = new Padding(4, 4, 6, 4),
            FlatStyle = FlatStyle.Flat,
            Font = new Font(Font.FontFamily, 8f),
            Anchor = AnchorStyles.None
        };
        _changeUserIdBtn.FlatAppearance.BorderSize = 1;
        _changeUserIdBtn.Click += (_, _) => ChangeUserId();

        _userIdLabel = new Label
        {
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleRight,
            Padding = new Padding(0, 0, 6, 0),
            Font = new Font("Consolas", 8.5f),
            Text = ""
        };

        var statusLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 1,
            ColumnCount = 3,
            Margin = new Padding(0),
            Height = 32
        };
        statusLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        statusLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
        statusLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        statusLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));
        statusLayout.Controls.Add(_statusLabel, 0, 0);
        statusLayout.Controls.Add(_userIdLabel, 1, 0);
        statusLayout.Controls.Add(_changeUserIdBtn, 2, 0);

        // ── Log area ──────────────────────────────────────────────────────────
        _logBox = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Dock = DockStyle.Fill,
            Font = new Font("Consolas", 9f),
            BackColor = Color.FromArgb(30, 30, 30),
            ForeColor = Color.FromArgb(200, 200, 200),
            WordWrap = false
        };

        // ── Button panel ──────────────────────────────────────────────────────
        _stopBtn = new Button
        {
            Text = "Detener",
            Size = new Size(100, 30),
            Margin = new Padding(4),
            Enabled = true
        };
        _stopBtn.Click += (_, _) => StopEngine();

        _restartBtn = new Button
        {
            Text = "Reiniciar",
            Size = new Size(100, 30),
            Margin = new Padding(4),
            BackColor = ColorTranslator.FromHtml("#2cb232"),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Enabled = true
        };
        _restartBtn.FlatAppearance.BorderSize = 0;
        _restartBtn.Click += (_, _) => RestartEngine();

        var btnPanel = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            AutoSize = true,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(4)
        };
        btnPanel.Controls.AddRange(new Control[] { _restartBtn, _stopBtn });

        // ── Main layout ───────────────────────────────────────────────────────
        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            RowCount = 3,
            ColumnCount = 1
        };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.Controls.Add(statusLayout, 0, 0);
        layout.Controls.Add(_logBox, 0, 1);
        layout.Controls.Add(btnPanel, 0, 2);
        Controls.Add(layout);

        // ── Tray icon ─────────────────────────────────────────────────────────
        var trayMenu = new ContextMenuStrip();
        trayMenu.Items.Add("Abrir", null, (_, _) => { Show(); WindowState = FormWindowState.Normal; Activate(); });

        _trayIcon = new NotifyIcon
        {
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application,
            Visible = true,
            Text = "Clipboard Sync",
            ContextMenuStrip = trayMenu
        };
        trayMenu.Items.Add("Salir", null, (_, _) => { _trayIcon.Visible = false; _engine.Dispose(); Application.Exit(); });
        _trayIcon.DoubleClick += (_, _) => { Show(); WindowState = FormWindowState.Normal; Activate(); };

        // ── Engine events ─────────────────────────────────────────────────────
        _engine.OutputReceived += line => AppendLog(line);
        _engine.ErrorReceived += line => AppendLog($"[ERR] {line}");
        _engine.Exited += OnEngineExited;

        // ── Dark theme ────────────────────────────────────────────────────────
        DarkTheme.Apply(this);
        DarkTheme.StyleMenu(trayMenu);
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        if (!EnsureConfigExists()) return;
        UpdateUserIdLabel();
        StartEngine();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        _engine.Dispose();
        _trayIcon.Visible = false;
        base.OnFormClosing(e);
    }

    private bool EnsureConfigExists()
    {
        if (File.Exists(ConfigPath))
        {
            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(ConfigPath));
                if (doc.RootElement.TryGetProperty("userId", out var uid) && !string.IsNullOrWhiteSpace(uid.GetString()))
                    return true;
            }
            catch { }
        }

        // Prompt for userId
        using var dlg = new UserIdDialog();
        if (dlg.ShowDialog(this) != DialogResult.OK || string.IsNullOrWhiteSpace(dlg.UserId))
        {
            using var err = new ErrorDialog("Es necesario un userId para sincronizar el portapapeles.");
            err.ShowDialog(this);
            return false;
        }

        Directory.CreateDirectory(AppDir);
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(new { userId = dlg.UserId }, new JsonSerializerOptions { WriteIndented = true }));
        return true;
    }

    private void StartEngine()
    {
        SetStatus(EngineStatus.Running);
        AppendLog("[UI] Iniciando engine...");
        _engine.Start();
    }

    private void StopEngine()
    {
        AppendLog("[UI] Deteniendo engine...");
        _engine.Stop();
        SetStatus(EngineStatus.Stopped);
        AppendLog("[UI] Engine detenido.");
    }

    private void RestartEngine()
    {
        if (!EnsureConfigExists()) return;
        UpdateUserIdLabel();
        AppendLog("[UI] Reiniciando engine...");
        SetStatus(EngineStatus.Running);
        _engine.Restart();
    }

    private void OnEngineExited(int exitCode)
    {
        if (IsDisposed) return;
        Invoke(() =>
        {
            if (exitCode == 0)
            {
                SetStatus(EngineStatus.Stopped);
                AppendLog("[UI] El engine finalizó correctamente.");
            }
            else
            {
                SetStatus(EngineStatus.Error);
                AppendLog($"[UI] El engine terminó inesperadamente (código {exitCode}). Usa Reiniciar para volver a lanzarlo.");
            }
        });
    }

    private void SetStatus(EngineStatus status)
    {
        _status = status;
        string text = status switch
        {
            EngineStatus.Running => "Estado: ● Activo",
            EngineStatus.Stopped => "Estado: ○ Detenido",
            EngineStatus.Error   => "Estado: ✖ Error",
            _                    => "Estado: Desconocido"
        };
        Color color = status switch
        {
            EngineStatus.Running => Color.FromArgb(44, 178, 50),
            EngineStatus.Error   => Color.OrangeRed,
            _                    => DarkTheme.Text
        };

        if (_statusLabel.InvokeRequired)
        {
            _statusLabel.Invoke(() => { _statusLabel.Text = text; _statusLabel.ForeColor = color; });
            return;
        }
        _statusLabel.Text = text;
        _statusLabel.ForeColor = color;
    }

    private void AppendLog(string line)
    {
        if (_logBox.IsDisposed) return;
        if (_logBox.InvokeRequired)
        {
            _logBox.Invoke(() => AppendLog(line));
            return;
        }
        string ts = DateTime.Now.ToString("HH:mm:ss");
        _logBox.AppendText($"[{ts}] {line}{Environment.NewLine}");
    }

    private void UpdateUserIdLabel()
    {
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(ConfigPath));
            if (doc.RootElement.TryGetProperty("userId", out var uid))
            {
                string text = uid.GetString() ?? "";
                if (_userIdLabel.InvokeRequired)
                    _userIdLabel.Invoke(() => _userIdLabel.Text = text);
                else
                    _userIdLabel.Text = text;
            }
        }
        catch { }
    }

    private void ChangeUserId()
    {
        using var dlg = new UserIdDialog();
        if (dlg.ShowDialog(this) != DialogResult.OK || string.IsNullOrWhiteSpace(dlg.UserId))
            return;

        Directory.CreateDirectory(AppDir);
        File.WriteAllText(ConfigPath, JsonSerializer.Serialize(
            new { userId = dlg.UserId },
            new JsonSerializerOptions { WriteIndented = true }));
        UpdateUserIdLabel();
        AppendLog("[UI] Usuario cambiado. Reiniciando engine...");
        SetStatus(EngineStatus.Running);
        _engine.Restart();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _engine.Dispose();
            _trayIcon.Dispose();
        }
        base.Dispose(disposing);
    }
}

// ── Simple userId input dialog ────────────────────────────────────────────────
internal sealed class UserIdDialog : Form
{
    internal string UserId => _input.Text.Trim();
    private readonly TextBox _input;

    internal UserIdDialog()
    {
        Text            = "Clipboard Sync – Configuración";
        Size            = new Size(440, 190);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox     = false;
        MinimizeBox     = false;
        StartPosition   = FormStartPosition.CenterParent;
        Icon            = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

        var lbl = new Label
        {
            Text      = "Introduce tu userId:",
            AutoSize  = true,
            Location  = new Point(16, 18)
        };

        _input = new TextBox
        {
            Location        = new Point(16, 44),
            Width           = 392,
            Height          = 26,
            PlaceholderText = "correo@ejemplo.com"
        };

        var ok = new Button
        {
            Text         = "Aceptar",
            DialogResult = DialogResult.OK,
            Location     = new Point(216, 100),
            Size         = new Size(96, 36),
            BackColor    = ColorTranslator.FromHtml("#2cb232"),
            ForeColor    = Color.White,
            FlatStyle    = FlatStyle.Flat
        };
        ok.FlatAppearance.BorderSize = 0;

        var cancel = new Button
        {
            Text         = "Cancelar",
            DialogResult = DialogResult.Cancel,
            Location     = new Point(320, 100),
            Size         = new Size(96, 36)
        };

        AcceptButton = ok;
        CancelButton = cancel;
        Controls.AddRange(new Control[] { lbl, _input, ok, cancel });
        DarkTheme.Apply(this);
        ActiveControl = ok;
    }
}

// ── Dark-themed error/info dialog (replaces MessageBox for dark UI) ───────────
internal sealed class ErrorDialog : Form
{
    internal ErrorDialog(string message)
    {
        Text            = "Clipboard Sync";
        Size            = new Size(380, 175);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox     = false;
        MinimizeBox     = false;
        StartPosition   = FormStartPosition.CenterParent;
        Icon            = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;

        var lbl = new Label
        {
            Text      = message,
            AutoSize  = false,
            Size      = new Size(340, 56),
            Location  = new Point(20, 16),
            TextAlign = ContentAlignment.MiddleLeft
        };

        var ok = new Button
        {
            Text         = "Aceptar",
            DialogResult = DialogResult.OK,
            Location     = new Point(264, 84),
            Size         = new Size(90, 34),
            BackColor    = ColorTranslator.FromHtml("#2cb232"),
            ForeColor    = Color.White,
            FlatStyle    = FlatStyle.Flat
        };
        ok.FlatAppearance.BorderSize = 0;

        AcceptButton = ok;
        Controls.AddRange(new Control[] { lbl, ok });
        DarkTheme.Apply(this);
    }
}
