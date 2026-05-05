using System.Net.Http;
using System.Security.Cryptography;

namespace ClipboardSync;

internal static class HttpDownloader
{
    internal static async Task DownloadWithProgressAsync(HttpClient client, string url, string destPath, Action<int> onProgress)
    {
        using var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();

        long? total = response.Content.Headers.ContentLength;
        await using var stream = await response.Content.ReadAsStreamAsync();
        await using var file   = new FileStream(destPath, FileMode.Create, FileAccess.Write, FileShare.None, bufferSize: 81920, useAsync: true);

        byte[] buffer     = new byte[81920];
        long   downloaded = 0;
        int    read;
        while ((read = await stream.ReadAsync(buffer)) > 0)
        {
            await file.WriteAsync(buffer.AsMemory(0, read));
            downloaded += read;
            if (total.HasValue && total > 0)
                onProgress((int)(downloaded * 100L / total.Value));
        }
    }

    internal static string ComputeSha256(string filePath)
    {
        using var sha = SHA256.Create();
        using var fs  = File.OpenRead(filePath);
        return Convert.ToHexString(sha.ComputeHash(fs)).ToUpperInvariant();
    }
}
