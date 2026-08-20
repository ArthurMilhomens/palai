using System.Text.Json;

namespace Palai.Extractor;

public static class MappingsResolver
{
    private const string GitHubApi =
        "https://api.github.com/repos/elliotks/Palworld-FModel/contents/";

    public static async Task<string> ResolveAsync(
        string? explicitPath,
        bool downloadLatest,
        string mappingsDir,
        CancellationToken ct)
    {
        Directory.CreateDirectory(mappingsDir);

        if (!string.IsNullOrWhiteSpace(explicitPath))
        {
            var full = Path.GetFullPath(explicitPath);
            if (!File.Exists(full))
                throw new FileNotFoundException($"Mappings file not found: {full}");
            return full;
        }

        var localCandidates = new[]
        {
            Path.Combine(mappingsDir, "Mappings.usmap"),
            Path.Combine(mappingsDir, "Pal-Windows_Mappings.usmap"),
        }.Concat(Directory.Exists(mappingsDir)
            ? Directory.EnumerateFiles(mappingsDir, "*.usmap")
            : []);

        var existing = localCandidates
            .Where(File.Exists)
            .OrderByDescending(File.GetLastWriteTimeUtc)
            .FirstOrDefault();

        if (downloadLatest || existing is null)
        {
            var downloaded = await DownloadLatestAsync(mappingsDir, ct);
            return downloaded;
        }

        Console.WriteLine($"Usando mappings local: {existing}");
        return existing;
    }

    private static async Task<string> DownloadLatestAsync(string mappingsDir, CancellationToken ct)
    {
        Console.WriteLine("Baixando .usmap mais recente (elliotks/Palworld-FModel)...");
        using var http = new HttpClient();
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Palai.Extractor/1.0");

        using var listRes = await http.GetAsync(GitHubApi, ct);
        listRes.EnsureSuccessStatusCode();
        await using var stream = await listRes.Content.ReadAsStreamAsync(ct);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);

        string? bestName = null;
        string? bestUrl = null;
        foreach (var item in doc.RootElement.EnumerateArray())
        {
            var name = item.GetProperty("name").GetString() ?? "";
            if (!name.EndsWith(".usmap", StringComparison.OrdinalIgnoreCase)) continue;
            if (bestName is null ||
                string.Compare(name, bestName, StringComparison.OrdinalIgnoreCase) > 0)
            {
                bestName = name;
                bestUrl = item.GetProperty("download_url").GetString();
            }
        }

        if (bestName is null || bestUrl is null)
            throw new InvalidOperationException("Nenhum .usmap encontrado no repositório de mappings.");

        var target = Path.Combine(mappingsDir, bestName);
        var canonical = Path.Combine(mappingsDir, "Mappings.usmap");

        Console.WriteLine($"  → {bestName}");
        var bytes = await http.GetByteArrayAsync(bestUrl, ct);
        await File.WriteAllBytesAsync(target, bytes, ct);
        await File.WriteAllBytesAsync(canonical, bytes, ct);
        return canonical;
    }
}
