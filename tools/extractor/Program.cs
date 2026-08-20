using Palai.Extractor;

static string FindApiRoot()
{
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir is not null)
    {
        var marker = Path.Combine(dir.FullName, "package.json");
        var gameData = Path.Combine(dir.FullName, "game_data");
        if (File.Exists(marker) && Directory.Exists(gameData))
            return dir.FullName;
        // tools/extractor → api root
        if (dir.Name.Equals("extractor", StringComparison.OrdinalIgnoreCase) &&
            dir.Parent?.Name.Equals("tools", StringComparison.OrdinalIgnoreCase) == true &&
            dir.Parent.Parent is not null)
        {
            return dir.Parent.Parent.FullName;
        }
        dir = dir.Parent;
    }

    // Fallback: cwd when invoked via `dotnet run --project tools/extractor`
    var cwd = Directory.GetCurrentDirectory();
    if (File.Exists(Path.Combine(cwd, "package.json")))
        return cwd;
    var parent = Directory.GetParent(cwd)?.FullName;
    if (parent is not null && File.Exists(Path.Combine(parent, "package.json")))
        return parent;
    return cwd;
}

try
{
    var apiRoot = FindApiRoot();
    var opts = CliOptions.Parse(args, apiRoot);
    var mappingsDir = Path.Combine(apiRoot, "tools", "extractor", "mappings");

    Console.WriteLine("Palai.Extractor");
    Console.WriteLine($"API root: {apiRoot}");

    var game = SteamLocator.Find(opts.GamePath);
    if (game is null && string.IsNullOrWhiteSpace(opts.PakDir))
    {
        Console.Error.WriteLine(
            "Palworld não encontrado. Use --game-path \"C:\\...\\Palworld\" ou --pak-dir.");
        return 1;
    }

    if (game is not null)
    {
        Console.WriteLine($"Jogo: {game.InstallDir}");
        Console.WriteLine($"Build Steam: {game.BuildId}");
        await File.WriteAllTextAsync(
            Path.Combine(opts.OutputRoot, "game-info.json"),
            System.Text.Json.JsonSerializer.Serialize(game, new System.Text.Json.JsonSerializerOptions
            {
                WriteIndented = true,
            }) + "\n");
    }

    var pakDir = !string.IsNullOrWhiteSpace(opts.PakDir)
        ? Path.GetFullPath(opts.PakDir)
        : game!.PakDir;

    if (!Directory.Exists(pakDir))
    {
        Console.Error.WriteLine($"Pasta de paks não encontrada: {pakDir}");
        return 1;
    }

    var mappings = await MappingsResolver.ResolveAsync(
        opts.MappingsPath,
        opts.DownloadMappings,
        mappingsDir,
        CancellationToken.None);

    var extractor = new GameExtractor(opts, pakDir, mappings);
    await extractor.RunAsync(CancellationToken.None);
    return 0;
}
catch (Exception ex)
{
    Console.Error.WriteLine($"Falha: {ex.Message}");
    if (ex.InnerException is not null)
        Console.Error.WriteLine(ex.InnerException.Message);
    return 1;
}
