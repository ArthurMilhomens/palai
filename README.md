# Palai API

REST API for Palworld game data. Extracts dumps uploaded by admins, persists normalized data in PostgreSQL, indexes OpenSearch, and serves authenticated read endpoints.

## Stack

- Node.js LTS + TypeScript + Fastify
- Prisma + PostgreSQL
- Redis (cache + BullMQ)
- OpenSearch
- S3-compatible storage (MinIO locally)
- Vitest

## Gerar dump dos dados do jogo

O script detecta o Palworld instalado via Steam e converte exports do FModel:

```bash
npm run dump:generate
```

1. Localiza `Palworld` + `buildid` no Steam  
2. Lê DataTables JSON em `game_data/fmodel` (ou pasta do FModel)  
3. Gera `game_data/dump.json` e `game_data/dump.zip`

Na primeira vez, exporte as tabelas com o FModel para `game_data/fmodel`  
(veja `game_data/EXPORT_INSTRUCTIONS.md`). Obrigatória: `DT_PalMonsterParameter`.

```bash
# só o sample interno (sem jogo)
npm run dump:fixture

# paths manuais
npm run dump:generate -- --game-path "D:\SteamLibrary\steamapps\common\Palworld"
npm run dump:generate -- --export-dir "C:\FModel\Output\Exports"
```

## Quick start

```bash
docker compose up -d
cp .env.example .env
npm install
npx prisma db push
npm run db:seed
npm run dev
```

> Local Postgres already on `5432`? Compose maps the container to **`5433`** (`DATABASE_URL` in `.env`).

API: `http://localhost:3000`  
Docs: `http://localhost:3000/docs`

Default admin (from `.env`):

- email: `admin@palai.local`
- password: `ChangeMeAdmin123!`

## Auth

```bash
# register
curl -X POST http://localhost:3000/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"user@example.com","password":"password123"}'

# login
curl -X POST http://localhost:3000/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@palai.local","password":"ChangeMeAdmin123!"}'
```

Use `Authorization: Bearer <accessToken>` on all `/v1/*` routes except auth.  
Rotate with `POST /v1/auth/refresh`. Admin role required for `/v1/updates/*`.

## Import dump

Upload a `.zip` (with `dump.json` + optional `icons/`) or `.json`:

```bash
curl -X POST http://localhost:3000/v1/updates/import \
  -H "Authorization: Bearer $TOKEN" \
  -F file=@./fixtures/sample-dump.json \
  -F version=1.0.0 \
  -F build=100
```

## Health

- `GET /health`
- `GET /live`
- `GET /ready`
- `GET /metrics`
