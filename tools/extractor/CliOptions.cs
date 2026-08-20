namespace Palai.Extractor;

public sealed class CliOptions
{
    public string? GamePath { get; private set; }
    public string? PakDir { get; private set; }
    public string? MappingsPath { get; private set; }
    public string OutputRoot { get; private set; } = string.Empty;
    public string FmodelDir { get; private set; } = string.Empty;
    public string IconsDir { get; private set; } = string.Empty;
    public bool DownloadMappings { get; private set; }
    public bool AllTextures { get; private set; }
    public bool SkipIcons { get; private set; }
    public bool SkipTables { get; private set; }
    public bool CleanOutput { get; private set; }
    public int Parallelism { get; private set; } = Math.Max(2, Environment.ProcessorCount / 2);

    public static CliOptions Parse(string[] args, string apiRoot)
    {
        var opts = new CliOptions
        {
            OutputRoot = Path.Combine(apiRoot, "game_data"),
        };

        for (var i = 0; i < args.Length; i++)
        {
            var a = args[i];
            switch (a)
            {
                case "--game-path":
                    opts.GamePath = RequireValue(args, ref i, a);
                    break;
                case "--pak-dir":
                    opts.PakDir = RequireValue(args, ref i, a);
                    break;
                case "--mappings":
                    opts.MappingsPath = RequireValue(args, ref i, a);
                    break;
                case "--output":
                    opts.OutputRoot = Path.GetFullPath(RequireValue(args, ref i, a));
                    break;
                case "--download-mappings":
                    opts.DownloadMappings = true;
                    break;
                case "--all-textures":
                    opts.AllTextures = true;
                    break;
                case "--skip-icons":
                    opts.SkipIcons = true;
                    break;
                case "--skip-tables":
                    opts.SkipTables = true;
                    break;
                case "--clean":
                    opts.CleanOutput = true;
                    break;
                case "--parallel":
                    opts.Parallelism = int.Parse(RequireValue(args, ref i, a));
                    break;
                case "--help":
                case "-h":
                    PrintHelp();
                    Environment.Exit(0);
                    break;
                default:
                    throw new ArgumentException($"Unknown argument: {a}");
            }
        }

        opts.FmodelDir = Path.Combine(opts.OutputRoot, "fmodel");
        opts.IconsDir = Path.Combine(opts.OutputRoot, "icons");
        return opts;
    }

    private static string RequireValue(string[] args, ref int i, string flag)
    {
        if (i + 1 >= args.Length)
            throw new ArgumentException($"Missing value for {flag}");
        return args[++i];
    }

    public static void PrintHelp()
    {
        Console.WriteLine("""
            Palai.Extractor — exporta DataTables + ícones do Palworld para o formato do dump.

            Uso:
              dotnet run --project tools/extractor -- [opções]
              npm run extract -- [opções]

            Opções:
              --game-path <dir>       Pasta de instalação do Palworld
              --pak-dir <dir>         Pasta Paks (padrão: <game>/Pal/Content/Paks)
              --mappings <file>       Arquivo .usmap (obrigatório se não houver local/cache)
              --download-mappings     Baixa o .usmap mais recente (elliotks/Palworld-FModel)
              --output <dir>          Saída (padrão: game_data)
              --clean                 Limpa fmodel/ e icons/ antes de exportar
              --skip-icons            Não exporta texturas
              --skip-tables           Não exporta DataTables
              --all-textures          Exporta todas as Texture2D sob Pal/Content
              --parallel <n>          Grau de paralelismo
              -h, --help              Ajuda
            """);
    }
}
