namespace Palai.Extractor;

public sealed record GameInstall(
    string InstallDir,
    string PakDir,
    string PakFile,
    string BuildId,
    string Name);

public static class SteamLocator
{
    public const string AppId = "1623730";

    public static GameInstall? Find(string? explicitGamePath)
    {
        if (!string.IsNullOrWhiteSpace(explicitGamePath))
        {
            var installDir = Path.GetFullPath(explicitGamePath);
            if (!Directory.Exists(installDir))
                throw new DirectoryNotFoundException($"Game path not found: {installDir}");
            return Build(installDir, buildId: "unknown", name: "Palworld");
        }

        foreach (var library in EnumerateSteamLibraries())
        {
            var steamapps = Path.Combine(library, "steamapps");
            var manifest = Path.Combine(steamapps, $"appmanifest_{AppId}.acf");
            if (!File.Exists(manifest)) continue;

            var acf = ParseAcf(File.ReadAllText(manifest));
            var installDirName = acf.GetValueOrDefault("installdir") ?? "Palworld";
            var installDir = Path.Combine(steamapps, "common", installDirName);
            if (!Directory.Exists(installDir)) continue;

            return Build(
                installDir,
                buildId: acf.GetValueOrDefault("buildid") ?? "unknown",
                name: acf.GetValueOrDefault("name") ?? "Palworld");
        }

        return null;
    }

    private static GameInstall Build(string installDir, string buildId, string name)
    {
        var pakDir = Path.Combine(installDir, "Pal", "Content", "Paks");
        var pakFile = Path.Combine(pakDir, "Pal-Windows.pak");
        return new GameInstall(installDir, pakDir, pakFile, buildId, name);
    }

    private static IEnumerable<string> EnumerateSteamLibraries()
    {
        var found = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var candidates = new[]
        {
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "Steam", "steamapps", "libraryfolders.vdf"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "Steam", "steamapps", "libraryfolders.vdf"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".steam", "steam", "steamapps", "libraryfolders.vdf"),
        };

        foreach (var vdf in candidates)
        {
            if (!File.Exists(vdf)) continue;
            var content = File.ReadAllText(vdf);
            foreach (var path in ExtractLibraryPaths(content))
                found.Add(path);
            found.Add(Path.GetFullPath(Path.Combine(Path.GetDirectoryName(vdf)!, "..")));
        }

        foreach (var drive in new[] { "D", "E", "F" })
        {
            var extra = $@"{drive}:\SteamLibrary";
            if (Directory.Exists(extra)) found.Add(extra);
        }

        return found;
    }

    private static IEnumerable<string> ExtractLibraryPaths(string vdf)
    {
        foreach (System.Text.RegularExpressions.Match m in
                 System.Text.RegularExpressions.Regex.Matches(vdf, "\"path\"\\s+\"([^\"]+)\""))
        {
            yield return m.Groups[1].Value.Replace(@"\\", @"\");
        }
    }

    private static Dictionary<string, string> ParseAcf(string content)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (System.Text.RegularExpressions.Match m in
                 System.Text.RegularExpressions.Regex.Matches(content, "\"([^\"]+)\"\\s+\"([^\"]*)\""))
        {
            result[m.Groups[1].Value] = m.Groups[2].Value;
        }
        return result;
    }
}
