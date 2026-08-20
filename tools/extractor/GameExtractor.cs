using System.Collections.Concurrent;
using CUE4Parse.Compression;
using CUE4Parse.Encryption.Aes;
using CUE4Parse.FileProvider;
using CUE4Parse.MappingsProvider;
using CUE4Parse.UE4.Assets.Exports;
using CUE4Parse.UE4.Assets.Exports.Engine;
using CUE4Parse.UE4.Assets.Exports.Texture;
using CUE4Parse.UE4.Objects.Core.Misc;
using CUE4Parse.UE4.Versions;
using CUE4Parse_Conversion.Textures;
using Newtonsoft.Json;
using Serilog;

namespace Palai.Extractor;

public sealed class GameExtractor
{
    private static readonly byte[] ZeroAesKey = new byte[32];

    private readonly CliOptions _opts;
    private readonly string _pakDir;
    private readonly string _mappingsPath;

    public GameExtractor(CliOptions opts, string pakDir, string mappingsPath)
    {
        _opts = opts;
        _pakDir = pakDir;
        _mappingsPath = mappingsPath;
    }

    public async Task RunAsync(CancellationToken ct)
    {
        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Warning()
            .WriteTo.Console()
            .CreateLogger();

        EnsureCompressionLibs(); // must succeed before mounting paks

        if (_opts.CleanOutput)
        {
            CleanDir(_opts.FmodelDir);
            CleanDir(_opts.IconsDir);
        }

        Directory.CreateDirectory(_opts.FmodelDir);
        Directory.CreateDirectory(_opts.IconsDir);

        Console.WriteLine($"Pak dir: {_pakDir}");
        Console.WriteLine($"Mappings: {_mappingsPath}");
        Console.WriteLine($"FModel out: {_opts.FmodelDir}");
        Console.WriteLine($"Icons out: {_opts.IconsDir}");

        var provider = new DefaultFileProvider(
            _pakDir,
            SearchOption.TopDirectoryOnly,
            new VersionContainer(EGame.GAME_UE5_1),
            StringComparer.OrdinalIgnoreCase);

        provider.Initialize();
        provider.MappingsContainer = new FileUsmapTypeMappingsProvider(_mappingsPath);
        provider.SubmitKey(new FGuid(), new FAesKey(ZeroAesKey));
        provider.PostMount();
        provider.LoadVirtualPaths();

        Console.WriteLine($"Arquivos no VFS: {provider.Files.Count}");

        var files = provider.Files.Keys
            .Where(p => p.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            .Where(p => p.Contains("Pal/Content", StringComparison.OrdinalIgnoreCase) ||
                        p.StartsWith("Pal/Content", StringComparison.OrdinalIgnoreCase))
            .ToList();

        var tables = files.Where(IsDataTablePath).ToList();
        var textures = files.Where(p => IsIconTexturePath(p, _opts.AllTextures)).ToList();

        Console.WriteLine($"DataTables candidatas: {tables.Count}");
        Console.WriteLine($"Texturas candidatas: {textures.Count}");

        var tableOk = 0;
        var tableFail = 0;
        var iconOk = 0;
        var iconFail = 0;

        if (!_opts.SkipTables)
        {
            Console.WriteLine("Exportando DataTables...");
            await Parallel.ForEachAsync(
                tables,
                new ParallelOptions
                {
                    MaxDegreeOfParallelism = _opts.Parallelism,
                    CancellationToken = ct,
                },
                async (path, token) =>
                {
                    try
                    {
                        if (ExportDataTable(provider, path))
                            Interlocked.Increment(ref tableOk);
                        else
                            Interlocked.Increment(ref tableFail);
                    }
                    catch
                    {
                        Interlocked.Increment(ref tableFail);
                    }
                    await Task.CompletedTask;
                });
        }

        if (!_opts.SkipIcons)
        {
            Console.WriteLine("Exportando ícones (PNG)...");
            var seen = new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase);
            await Parallel.ForEachAsync(
                textures,
                new ParallelOptions
                {
                    MaxDegreeOfParallelism = _opts.Parallelism,
                    CancellationToken = ct,
                },
                async (path, token) =>
                {
                    try
                    {
                        if (ExportTexture(provider, path, seen))
                            Interlocked.Increment(ref iconOk);
                        else
                            Interlocked.Increment(ref iconFail);
                    }
                    catch
                    {
                        Interlocked.Increment(ref iconFail);
                    }
                    await Task.CompletedTask;
                });
        }

        Console.WriteLine();
        Console.WriteLine($"DataTables OK/fail: {tableOk}/{tableFail}");
        Console.WriteLine($"Icons OK/fail: {iconOk}/{iconFail}");
        Console.WriteLine("Concluído.");
    }

    private bool ExportDataTable(DefaultFileProvider provider, string path)
    {
        if (!provider.TryLoadPackage(path, out var package))
            return false;

        var exports = package.GetExports().ToList();
        var dataTable = exports.OfType<UDataTable>().FirstOrDefault();
        if (dataTable is null)
            return false;

        // Composite tables often keep rows in ParentTables — merge when possible.
        if (dataTable is UCompositeDataTable || dataTable.RowMap.Count == 0)
        {
            TryMergeParentRows(provider, dataTable);
        }

        // Avoid clobbering a good previous export (e.g. FModel) with an empty parse
        // caused by outdated .usmap mappings.
        if (dataTable.RowMap.Count == 0)
            return false;

        var assetName = Path.GetFileNameWithoutExtension(path.Replace('\\', '/'));
        var outPath = ResolveTableOutputPath(path, assetName);
        Directory.CreateDirectory(Path.GetDirectoryName(outPath)!);

        // Prefer CUE4Parse JSON converters (FModel-compatible shape).
        var json = JsonConvert.SerializeObject(exports, Formatting.Indented);

        if (File.Exists(outPath))
        {
            var existingLen = new FileInfo(outPath).Length;
            // Keep richer existing file if the new one is drastically smaller.
            if (existingLen > json.Length * 2 && existingLen > 2048)
                return false;
        }

        File.WriteAllText(outPath, json);
        return true;
    }

    private static void TryMergeParentRows(DefaultFileProvider provider, UDataTable table)
    {
        try
        {
            var parentProp = table.Properties.FirstOrDefault(p =>
                p.Name.Text.Equals("ParentTables", StringComparison.OrdinalIgnoreCase));
            if (parentProp?.Tag is null)
                return;

            // ParentTables is typically an ArrayProperty of SoftObject/Object paths.
            var raw = parentProp.Tag.GenericValue;
            if (raw is null)
                return;

            var json = JsonConvert.SerializeObject(raw);
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != System.Text.Json.JsonValueKind.Array)
                return;

            foreach (var item in doc.RootElement.EnumerateArray())
            {
                string? objectPath = null;
                if (item.ValueKind == System.Text.Json.JsonValueKind.Object)
                {
                    if (item.TryGetProperty("ObjectPath", out var op))
                        objectPath = op.GetString();
                    else if (item.TryGetProperty("AssetPathName", out var ap))
                        objectPath = ap.GetString();
                }
                else if (item.ValueKind == System.Text.Json.JsonValueKind.String)
                {
                    objectPath = item.GetString();
                }

                if (string.IsNullOrWhiteSpace(objectPath) || objectPath == "None")
                    continue;

                // "Pal/Content/.../DT_Foo.0" → package path without export index
                var pkg = objectPath.Replace('\\', '/');
                var dot = pkg.LastIndexOf('.');
                if (dot > 0) pkg = pkg[..dot];
                if (!pkg.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
                    pkg += ".uasset";

                if (!provider.TryLoadPackage(pkg, out var parentPkg))
                    continue;
                var parentTable = parentPkg.GetExports().OfType<UDataTable>().FirstOrDefault();
                if (parentTable is null || parentTable.RowMap.Count == 0)
                    continue;

                foreach (var (key, value) in parentTable.RowMap)
                {
                    table.RowMap[key] = value;
                }
            }
        }
        catch
        {
            // Best-effort merge; outdated mappings may still leave RowMap empty.
        }
    }

    private bool ExportTexture(
        DefaultFileProvider provider,
        string path,
        ConcurrentDictionary<string, byte> seen)
    {
        if (!provider.TryLoadPackage(path, out var package))
            return false;

        foreach (var export in package.GetExports())
        {
            if (export is not UTexture texture)
                continue;

            var bitmap = TextureDecoder.Decode(texture, ETexturePlatform.DesktopMobile);
            if (bitmap is null)
                return false;

            var baseName = Path.GetFileNameWithoutExtension(path.Replace('\\', '/'));
            var relativeDir = ResolveIconRelativeDir(path);
            var outDir = string.IsNullOrEmpty(relativeDir)
                ? _opts.IconsDir
                : Path.Combine(_opts.IconsDir, relativeDir);
            Directory.CreateDirectory(outDir);
            var outPath = Path.Combine(outDir, baseName + ".png");

            if (!seen.TryAdd(outPath, 0))
                return true;
            if (File.Exists(outPath))
                return true;

            using var png = TextureEncoder.Encode(bitmap, ETextureFormat.Png, 100);
            File.WriteAllBytes(outPath, png.ToArray());
            return true;
        }

        return false;
    }

    private string ResolveTableOutputPath(string assetPath, string assetName)
    {
        var normalized = assetPath.Replace('\\', '/');
        var locale = TryGetLocale(normalized);
        if (locale is not null)
        {
            return Path.Combine(_opts.FmodelDir, "l10n", locale, assetName + ".json");
        }

        // Keep a few known subfolders for clarity; otherwise flatten.
        if (normalized.Contains("/Migration/", StringComparison.OrdinalIgnoreCase))
            return Path.Combine(_opts.FmodelDir, "Migration", assetName + ".json");
        if (normalized.Contains("/RchTextData/", StringComparison.OrdinalIgnoreCase) ||
            normalized.Contains("/RichTextData/", StringComparison.OrdinalIgnoreCase))
            return Path.Combine(_opts.FmodelDir, "RchTextData", assetName + ".json");

        return Path.Combine(_opts.FmodelDir, assetName + ".json");
    }

    private static string? TryGetLocale(string normalizedPath)
    {
        // Pal/Content/L10N/en/...
        var marker = "/L10N/";
        var idx = normalizedPath.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
        if (idx < 0) return null;
        var rest = normalizedPath[(idx + marker.Length)..];
        var slash = rest.IndexOf('/');
        if (slash <= 0) return null;
        var locale = rest[..slash];
        return locale switch
        {
            "en" => "en",
            "pt-BR" or "pt" or "ptBR" => "pt-BR",
            _ => locale,
        };
    }

    private static string ResolveIconRelativeDir(string assetPath)
    {
        var n = assetPath.Replace('\\', '/');
        if (n.Contains("/Yakushima/", StringComparison.OrdinalIgnoreCase))
            return "Yakushima";
        if (n.Contains("/Texture/UI/", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("/UI/InGame/", StringComparison.OrdinalIgnoreCase) ||
            n.Contains("/UI/", StringComparison.OrdinalIgnoreCase))
            return "UI";
        return string.Empty;
    }

    private static bool IsDataTablePath(string path)
    {
        var name = Path.GetFileNameWithoutExtension(path.Replace('\\', '/'));
        return name.StartsWith("DT_", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsIconTexturePath(string path, bool allTextures)
    {
        var n = path.Replace('\\', '/');
        if (!n.EndsWith(".uasset", StringComparison.OrdinalIgnoreCase))
            return false;

        if (allTextures)
        {
            return n.Contains("/Texture/", StringComparison.OrdinalIgnoreCase) ||
                   n.Contains("/Textures/", StringComparison.OrdinalIgnoreCase) ||
                   n.Contains("Icon", StringComparison.OrdinalIgnoreCase);
        }

        var file = Path.GetFileNameWithoutExtension(n);
        if (file.Contains("icon", StringComparison.OrdinalIgnoreCase) ||
            file.StartsWith("T_itemicon_", StringComparison.OrdinalIgnoreCase) ||
            file.StartsWith("T_icon_", StringComparison.OrdinalIgnoreCase) ||
            file.Contains("_icon_normal", StringComparison.OrdinalIgnoreCase) ||
            file.StartsWith("T_icon_buildObject_", StringComparison.OrdinalIgnoreCase) ||
            file.StartsWith("T_icon_palwork_", StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        return n.Contains("/InventoryItemIcon/", StringComparison.OrdinalIgnoreCase) ||
               n.Contains("/ItemIcon/", StringComparison.OrdinalIgnoreCase) ||
               n.Contains("/CharacterIcon/", StringComparison.OrdinalIgnoreCase) ||
               n.Contains("/Texture/UI/", StringComparison.OrdinalIgnoreCase) ||
               n.Contains("/UI/InGame/", StringComparison.OrdinalIgnoreCase);
    }

    private static void EnsureCompressionLibs()
    {
        var oodlePath = ResolveOrDownloadOodle();
        OodleHelper.Initialize(oodlePath);
        Console.WriteLine($"Oodle: {oodlePath}");

        try
        {
            var zlibPath = Path.Combine(AppContext.BaseDirectory, ZlibHelper.DLL_NAME);
            if (!File.Exists(zlibPath))
            {
                Console.WriteLine("Baixando zlib-ng DLL...");
                ZlibHelper.DownloadDll(zlibPath);
            }
            ZlibHelper.Initialize(zlibPath);
            Console.WriteLine($"zlib: {zlibPath}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Aviso: falha ao inicializar zlib ({ex.Message}). Continuando...");
        }
    }

    private static string ResolveOrDownloadOodle()
    {
        var target = Path.Combine(AppContext.BaseDirectory, OodleHelper.OODLE_DLL_NAME);
        if (File.Exists(target) && new FileInfo(target).Length > 100_000)
            return target;

        foreach (var candidate in FindExistingOodleDlls())
        {
            Console.WriteLine($"Copiando Oodle de {candidate}");
            File.Copy(candidate, target, overwrite: true);
            return target;
        }

        Console.WriteLine("Baixando Oodle DLL (OodleUE)...");
        using var http = new HttpClient();
        http.Timeout = TimeSpan.FromMinutes(5);
        var ok = OodleHelper.DownloadOodleDllFromOodleUEAsync(http, target)
            .GetAwaiter()
            .GetResult();
        if (ok && File.Exists(target))
            return target;

        Console.WriteLine("Fallback: DownloadOodleDll (Warframe index)...");
        if (OodleHelper.DownloadOodleDll(target) && File.Exists(target))
            return target;

        throw new FileNotFoundException(
            $"Não foi possível obter {OodleHelper.OODLE_DLL_NAME}. " +
            "Copie a DLL para tools/extractor/bin/... ou para a pasta do executável.");
    }

    private static IEnumerable<string> FindExistingOodleDlls()
    {
        var names = new[]
        {
            "oo2core_9_win64.dll",
            "oo2core_8_win64.dll",
            "oo2core_7_win64.dll",
        };

        var roots = new List<string>
        {
            AppContext.BaseDirectory,
            Path.Combine(AppContext.BaseDirectory, "..", "..", ".."),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "FModel"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Palworld-Randomizer"),
        };

        // Also search next to common steam libraries for leftover tools
        foreach (var drive in new[] { "C", "D", "E" })
        {
            roots.Add($@"{drive}:\SteamLibrary\steamapps\common\Palworld\Pal\Binaries\Win64");
        }

        foreach (var root in roots.Where(Directory.Exists))
        {
            foreach (var name in names)
            {
                var direct = Path.Combine(root, name);
                if (File.Exists(direct))
                    yield return direct;
            }

            IEnumerable<string> matches = [];
            try
            {
                matches = Directory.EnumerateFiles(root, "oo2core*.dll", SearchOption.AllDirectories)
                    .Take(5);
            }
            catch
            {
                // ignore permission issues
            }

            foreach (var m in matches)
                yield return m;
        }
    }

    private static void CleanDir(string dir)
    {
        if (!Directory.Exists(dir)) return;
        Console.WriteLine($"Limpando {dir}...");
        Directory.Delete(dir, recursive: true);
    }
}
