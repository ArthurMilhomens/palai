/**
 * Gera dump Palai a partir do Palworld instalado no PC + exports FModel.
 *
 * Fluxo:
 * 1. Localiza Palworld via Steam (libraryfolders.vdf / appmanifest)
 * 2. Procura DataTables exportadas (FModel / game_data/fmodel / raw)
 * 3. Converte para schema Palai e grava game_data/dump.json (+ zip)
 *
 * Uso:
 *   npm run dump:generate
 *   npm run dump:generate -- --game-path "D:\SteamLibrary\steamapps\common\Palworld"
 *   npm run dump:generate -- --export-dir "C:\path\to\FModel\Exports"
 *   npm run dump:generate -- --fixture   # só o sample (sem jogo)
 */
import { mkdir, writeFile, access, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { parseGameDump, type GameDump } from '../src/parser/game-dump.js';
import { findExportDirectories, findPalworldInstall } from './lib/steam.js';
import { convertExportsToPalaiDump } from './lib/map-to-palai.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'game_data');
const FMODEL_DIR = path.join(OUT_DIR, 'fmodel');
const RAW_DIR = path.join(OUT_DIR, 'raw');
const ICONS_DIR = path.join(OUT_DIR, 'icons');
const DEFAULT_FIXTURE = path.join(ROOT, 'fixtures', 'sample-dump.json');

type CliArgs = {
  version?: string;
  build?: string;
  from?: string;
  gamePath?: string;
  exportDir?: string;
  fixture: boolean;
  zip: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { zip: true, fixture: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--version') args.version = argv[++i];
    else if (a === '--build') args.build = argv[++i];
    else if (a === '--from') args.from = argv[++i];
    else if (a === '--game-path') args.gamePath = argv[++i];
    else if (a === '--export-dir') args.exportDir = argv[++i];
    else if (a === '--fixture') args.fixture = true;
    else if (a === '--no-zip') args.zip = false;
  }
  return args;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureLayout(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(FMODEL_DIR, { recursive: true });
  await mkdir(RAW_DIR, { recursive: true });
  await mkdir(ICONS_DIR, { recursive: true });
}

async function writeExportInstructions(gamePath?: string, pakFile?: string): Promise<void> {
  const content = `# Como exportar DataTables do Palworld (FModel)

O script **localiza o jogo no Steam**, mas os \`.pak\` precisam ser exportados
para JSON antes da conversão (Node não lê \`.uasset\` diretamente).

## 1. Instale o FModel
https://fmodel.app/

## 2. Adicione o jogo
Diretório detectado (se houver):

\`\`\`
${gamePath ?? '(rode npm run dump:generate para detectar)'}
\`\`\`

Pak:

\`\`\`
${pakFile ?? 'Pal\\\\Content\\\\Paks\\\\Pal-Windows.pak'}
\`\`\`

## 3. Exporte estas tabelas (JSON)
No FModel, abra e exporte (Save → JSON) para **\`game_data/fmodel\`** (pode manter subpastas):

Obrigatória:
- \`DT_PalMonsterParameter\`

Recomendadas:
- \`DT_WazaDataTable\`
- \`DT_PalPassiveSkill\`
- \`DT_PalDropItem\`
- \`DT_ItemDataTable\` (ou equivalente de items)
- \`DT_PalNameText\` / textos de nome
- \`DT_PalLongDescriptionText\`
- \`DT_PalCombi\` / breeding unique (se existir)

Caminhos típicos no pak:
\`Pal/Content/Pal/DataTable/...\`

## 4. Gere o dump
\`\`\`bash
npm run dump:generate
\`\`\`

Saída:
- \`game_data/dump.json\`
- \`game_data/dump.zip\`
- \`game_data/game-info.json\`
`;
  await writeFile(path.join(OUT_DIR, 'EXPORT_INSTRUCTIONS.md'), content, 'utf8');
}

function printSummary(dump: GameDump): void {
  const counts = {
    elements: dump.elements.length,
    skills: dump.skills.length,
    passives: dump.passives.length,
    items: dump.items.length,
    pals: dump.pals.length,
    recipes: dump.recipes.length,
    technologies: dump.technologies.length,
    locations: dump.locations.length,
    dungeons: dump.dungeons.length,
    bosses: dump.bosses.length,
    breedingOverrides: dump.breedingOverrides.length,
    translations: dump.translations.length,
  };
  console.log('Resumo do dump:');
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(20)} ${value}`);
  }
}

async function writeZip(dumpPath: string, zipPath: string): Promise<void> {
  const zip = new AdmZip();
  zip.addLocalFile(dumpPath, '', 'dump.json');
  if (await exists(ICONS_DIR)) {
    zip.addLocalFolder(ICONS_DIR, 'icons');
  }
  zip.writeZip(zipPath);
}

async function loadFixtureDump(args: CliArgs): Promise<GameDump> {
  const source = args.from
    ? path.isAbsolute(args.from)
      ? args.from
      : path.join(ROOT, args.from)
    : DEFAULT_FIXTURE;
  const raw = JSON.parse(await (await import('node:fs/promises')).readFile(source, 'utf8'));
  const dump = parseGameDump(raw);
  return {
    ...dump,
    version: args.version ?? dump.version,
    build: args.build ?? dump.build ?? '',
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await ensureLayout();

  console.log('Procurando Palworld no Steam...');
  const game = await findPalworldInstall(args.gamePath);
  if (game) {
    console.log(`Jogo encontrado: ${game.installDir}`);
    console.log(`Build Steam: ${game.buildId}`);
    await writeFile(
      path.join(OUT_DIR, 'game-info.json'),
      `${JSON.stringify(game, null, 2)}\n`,
      'utf8',
    );
  } else {
    console.log('Palworld não encontrado via Steam. Use --game-path se estiver instalado fora do Steam.');
  }

  await writeExportInstructions(game?.installDir, game?.pakFile);

  let dump: GameDump;
  let mode: 'game-export' | 'fixture' = 'game-export';

  if (args.fixture || args.from) {
    mode = 'fixture';
    dump = await loadFixtureDump(args);
    console.log(`Modo fixture/origem manual (${mode}).`);
  } else {
    const exportDirs = await findExportDirectories(ROOT, args.exportDir);
    console.log(
      exportDirs.length
        ? `Exports encontrados:\n${exportDirs.map((d) => `  - ${d}`).join('\n')}`
        : 'Nenhuma pasta de export FModel encontrada ainda.',
    );

    try {
      const converted = await convertExportsToPalaiDump({
        exportDirs,
        game,
        version: args.version ?? 'palworld',
        build: args.build ?? game?.buildId,
        iconsDir: ICONS_DIR,
      });
      dump = parseGameDump(converted.dump);
      console.log('\nFontes usadas:');
      for (const src of converted.sources) console.log(`  - ${src}`);
      for (const warning of converted.warnings) console.warn(`  ! ${warning}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('\nNão foi possível montar o dump a partir do jogo/exports:\n');
      console.error(message);
      console.error('\nSiga: game_data/EXPORT_INSTRUCTIONS.md');
      console.error('Ou gere o sample com: npm run dump:generate -- --fixture\n');
      process.exit(1);
    }
  }

  const dumpPath = path.join(OUT_DIR, 'dump.json');
  await writeFile(dumpPath, `${JSON.stringify(dump, null, 2)}\n`, 'utf8');
  console.log(`\nGerado: ${path.relative(ROOT, dumpPath)}`);

  if (mode === 'fixture') {
    await copyFile(dumpPath, path.join(RAW_DIR, 'dump.json'));
  }

  if (args.zip) {
    const zipPath = path.join(OUT_DIR, 'dump.zip');
    await writeZip(dumpPath, zipPath);
    console.log(`Gerado: ${path.relative(ROOT, zipPath)}`);
  }

  printSummary(dump);
  console.log('\nImportar com:');
  console.log(
    `  curl -X POST http://localhost:3000/v1/updates/import -H "Authorization: Bearer $TOKEN" -F "file=@game_data/dump.zip" -F "version=${dump.version}" -F "build=${dump.build ?? ''}"`,
  );
}

main().catch((error) => {
  console.error('Falha ao gerar dump:', error instanceof Error ? error.message : error);
  process.exit(1);
});
