# Como obter DataTables do Palworld

## Opção A — Extrator Palai (recomendado)

Requer .NET SDK 8.

```bash
npm run extract -- --download-mappings
npm run dump:generate
# ou
npm run dump:from-game
```

O extrator C# (`tools/extractor`) lê os `.pak` e grava:

- `game_data/fmodel/**/*.json`
- `game_data/icons/**/*.png`

## Opção B — FModel (manual)

1. Instale o FModel: https://fmodel.app/
2. UE Version: GAME_UE5_1 + mappings `.usmap`
3. Diretório do jogo:

```
D:\SteamLibrary\steamapps\common\Palworld
```

Pak:

```
D:\SteamLibrary\steamapps\common\Palworld\Pal\Content\Paks\Pal-Windows.pak
```

4. Exporte DataTables (JSON) para **`game_data/fmodel`** (pode manter subpastas).

Obrigatória:
- `DT_PalMonsterParameter`

Caminhos típicos: `Pal/Content/Pal/DataTable/...`

## Gerar dump

```bash
npm run dump:generate
```

Saída:
- `game_data/dump.json`
- `game_data/dump.zip`
- `game_data/game-info.json`
