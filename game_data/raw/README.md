# raw/

Coloque aqui o JSON exportado das DataTables (FModel/UEViewer), por exemplo:

- `dump.json`
- `data.json`
- `manifest.json`

Depois rode:

```bash
npm run dump:generate
```

O script valida o schema Palai e gera `../dump.json` + `../dump.zip`.
