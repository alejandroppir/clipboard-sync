using System.Diagnostics;

namespace SyncApp;

internal sealed class SyncEngineManager : IDisposable
{
    private static readonly string AppDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "clipboard-sync");

    private readonly string _enginePath;
    private Process? _process;
    private bool _disposed;

    internal event Action<string>? OutputReceived;
    internal event Action<string>? ErrorReceived;
    internal event Action<int>? Exited;

    internal bool IsRunning => _process is { HasExited: false };

    internal SyncEngineManager()
    {
        // Environment.ProcessPath is the correct way to get the exe location
        // in .NET single-file published apps (Assembly.Location returns empty string there)
        string uiDir = Path.GetDirectoryName(Environment.ProcessPath ?? "") ?? AppDir;
        _enginePath = Path.Combine(uiDir, "clipboard-sync-engine.exe");
    }

    internal void Start()
    {
        if (IsRunning) return;

        if (!File.Exists(_enginePath))
        {
            ErrorReceived?.Invoke($"[UI] No se encontró el engine en: {_enginePath}");
            Exited?.Invoke(-1);
            return;
        }

        var psi = new ProcessStartInfo(_enginePath)
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
            StandardErrorEncoding = System.Text.Encoding.UTF8,
        };

        _process = new Process { StartInfo = psi, EnableRaisingEvents = true };

        _process.OutputDataReceived += (_, e) =>
        {
            if (e.Data is not null)
                OutputReceived?.Invoke(e.Data);
        };

        _process.ErrorDataReceived += (_, e) =>
        {
            if (e.Data is not null)
                ErrorReceived?.Invoke(e.Data);
        };

        _process.Exited += (_, _) =>
        {
            int code = -1;
            try { code = _process.ExitCode; } catch { }
            Exited?.Invoke(code);
        };

        _process.Start();
        _process.BeginOutputReadLine();
        _process.BeginErrorReadLine();
    }

    internal void Stop()
    {
        if (_process is null || _process.HasExited) return;
        try
        {
            _process.Kill(entireProcessTree: true);
            _process.WaitForExit(3000);
        }
        catch { /* already exited */ }
    }

    internal void Restart()
    {
        Stop();
        DisposeProcess();
        Start();
    }

    private void DisposeProcess()
    {
        try { _process?.Dispose(); } catch { }
        _process = null;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Stop();
        DisposeProcess();
    }
}
