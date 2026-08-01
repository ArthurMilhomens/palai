# Como exportar DataTables do Palworld (FModel)

O script **localiza o jogo no Steam**, mas os `.pak` precisam ser exportados
para JSON antes da conversão (Node não lê `.uasset` diretamente).

## 1. Instale o FModel
https://fmodel.app/

## 2. Adicione o jogo
Diretório detectado (se houver):

```
D:\SteamLibrary\steamapps\common\Palworld
```

Pak:

```
D:\SteamLibrary\steamapps\common\Palworld\Pal\Content\Paks\Pal-Windows.pak
```

## 3. Exporte estas tabelas (JSON)
No FModel, abra e exporte (Save → JSON) para **`game_data/fmodel`** (pode manter subpastas):

Obrigatória:
- `DT_PalMonsterParameter`

Recomendadas:
- `DT_WazaDataTable`
- `DT_PalPassiveSkill`
- `DT_PalDropItem`
- `DT_ItemDataTable` (ou equivalente de items)
- `DT_PalNameText` / textos de nome
- `DT_PalLongDescriptionText`
- `DT_PalCombi` / breeding unique (se existir)

Caminhos típicos no pak:
`Pal/Content/Pal/DataTable/...`

## 4. Gere o dump
```bash
npm run dump:generate
```

Saída:
- `game_data/dump.json`
- `game_data/dump.zip`
- `game_data/game-info.json`
