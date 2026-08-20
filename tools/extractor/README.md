# Palai.Extractor

Extrator CLI em C# ([CUE4Parse](https://github.com/FabianFG/CUE4Parse)) que lê os `.pak` do Palworld e grava exports no formato esperado pelo dump da API Palai.

**Saída padrão** (relativa à raiz da API):

| Pasta | Conteúdo |
| --- | --- |
| `game_data/fmodel/**/*.json` | DataTables (JSON compatível com FModel / `dump:generate`) |
| `game_data/icons/**/*.png` | Ícones (itens, pals, UI) |
| `game_data/game-info.json` | Caminho do jogo / build Steam detectados |

---

## Requisitos

1. **[.NET SDK 8](https://dotnet.microsoft.com/download/dotnet/8.0)**  
   (`dotnet --version` deve mostrar `8.x`)
2. **Palworld instalado** (Steam) **ou** caminho explícito com `--game-path` / `--pak-dir`
3. **Arquivo `.usmap`** (mappings UE 5.1) compatível com o patch do jogo  
   - Baixar: `--download-mappings`  
   - Ou colocar em `mappings/Mappings.usmap`

Na primeira execução o extrator também baixa as DLLs de compressão (**Oodle** e **zlib-ng**) automaticamente.

---

## Como rodar

### Pela raiz da API (recomendado)

```bash
cd api

# Extrai DataTables + ícones
npm run extract

# Com opções extras (tudo após -- vai para o CLI C#)
npm run extract -- --download-mappings
npm run extract -- --game-path "D:\SteamLibrary\steamapps\common\Palworld"
npm run extract -- --skip-icons --parallel 4

# Extrai e já gera dump.json + dump.zip
npm run dump:from-game
```

### Direto com `dotnet` (desta pasta)

```bash
cd api/tools/extractor

dotnet run -c Release -- --download-mappings
dotnet run -c Release -- --help
dotnet run -c Release -- --game-path "D:\SteamLibrary\steamapps\common\Palworld" --clean
```

Ou, a partir da raiz da API:

```bash
dotnet run --project tools/extractor -c Release -- --download-mappings
```

---

## Fluxo típico após atualização do jogo

```text
1. Atualizar Palworld no Steam
2. Atualizar / gerar Mappings.usmap (ver seção Mappings)
3. npm run extract -- --download-mappings
   # ou, com mappings local confiável:
   npm run extract -- --clean --mappings tools/extractor/mappings/Mappings.usmap
4. npm run dump:generate
5. Importar game_data/dump.zip na API
```

Atalho dos passos 3–4:

```bash
npm run dump:from-game
```

---

## Opções da CLI

| Opção | Descrição |
| --- | --- |
| `--game-path <dir>` | Pasta de instalação do Palworld |
| `--pak-dir <dir>` | Pasta `Paks` (padrão: `<game>/Pal/Content/Paks`) |
| `--mappings <file>` | Caminho do `.usmap` |
| `--download-mappings` | Baixa o `.usmap` mais recente de [elliotks/Palworld-FModel](https://github.com/elliotks/Palworld-FModel) |
| `--output <dir>` | Pasta base de saída (padrão: `game_data` da API) |
| `--clean` | Apaga `fmodel/` e `icons/` antes de exportar |
| `--skip-icons` | Não exporta texturas PNG |
| `--skip-tables` | Não exporta DataTables |
| `--all-textures` | Exporta mais texturas sob `Pal/Content` (mais pesado) |
| `--parallel <n>` | Grau de paralelismo |
| `-h`, `--help` | Ajuda |

Se `npm run extract` for chamado **sem** `--mappings` e **sem** arquivo local em `mappings/`, o script Node adiciona `--download-mappings` automaticamente.

---

## Mappings (`.usmap`)

Os assets cooked do Palworld **exigem** mappings. Sem um `.usmap` alinhado ao patch, várias tabelas falham ao desserializar (ex.: `DT_PalMonsterParameter`).

### Opções

1. **Download automático**

   ```bash
   npm run extract -- --download-mappings
   ```

   Grava em `mappings/Mappings.usmap` (e o arquivo versionado baixado).

2. **Arquivo local**

   Coloque em:

   ```text
   tools/extractor/mappings/Mappings.usmap
   ```

3. **Caminho explícito**

   ```bash
   npm run extract -- --mappings "C:\path\to\Mappings.usmap"
   ```

4. **Gerar o próprio (quando o mappings público atrasar)**  
   Use o **UE4SS Dumper** no jogo e copie o `.usmap` gerado para `mappings/`.

Os `*.usmap` **não são commitados** (ver `mappings/README.md`).

---

## Layout desta pasta

```text
tools/extractor/
  Palai.Extractor.csproj   # projeto .NET 8
  Program.cs               # entrypoint
  CliOptions.cs
  SteamLocator.cs          # detecta Palworld via Steam
  MappingsResolver.cs      # resolve / baixa .usmap
  GameExtractor.cs         # export DataTables + PNGs
  mappings/                # .usmap local (gitignored)
  README.md                # este guia
```

---

## Comportamento importante

- **Detecção do jogo:** Steam (`appmanifest_1623730`) ou `--game-path` / `--pak-dir`.
- **AES:** chave zero (pak do Palworld normalmente não é criptografado).
- **UE:** `GAME_UE5_1`.
- **Sem `--clean`:** não sobrescreve um JSON existente **bem maior** por um parse vazio/fraco (protege exports bons do FModel se o `.usmap` estiver desatualizado).
- **Com `--clean`:** regenere só quando o mappings estiver confiável.
- **L10N:** textos EN/PT vão para `fmodel/l10n/en/` e `fmodel/l10n/pt-BR/`.
- **Ícones UI** (ex. `T_icon_palwork_*`): pasta `icons/UI/`.

---

## Dependências NuGet

Fixadas para **net8**:

- `CUE4Parse` `1.2.2`
- `CUE4Parse-Conversion` `1.2.1`

Versões mais novas no NuGet exigem **net10** e não são usadas neste projeto.

---

## Problemas comuns

| Sintoma | O que fazer |
| --- | --- |
| `Palworld não encontrado` | Passe `--game-path` ou `--pak-dir` |
| `Não foi possível obter oo2core_*.dll` | Rode de novo com rede; ou copie a DLL Oodle para a pasta do executável (`bin/Release/net8.0/`) |
| Muitas tabelas `Missing prop mappings` / `OK` baixo | `.usmap` desatualizado — atualize mappings (UE4SS ou repo público) |
| `DT_PalMonsterParameter` vazio | Mappings atrasado; **não** use `--clean` até corrigir; mantenha o JSON antigo |
| `dotnet` não encontrado | Instale o SDK 8 e reabra o terminal |

---

## Próximo passo (dump Palai)

Depois da extração:

```bash
npm run dump:generate
```

Isso lê `game_data/fmodel` + `game_data/icons` e gera `game_data/dump.zip` para import na API.
