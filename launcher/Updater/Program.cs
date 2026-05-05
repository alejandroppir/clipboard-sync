namespace Updater;

internal static class Program
{
    [STAThread]
    internal static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new UpdaterWindow());
    }
}