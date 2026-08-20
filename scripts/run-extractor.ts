/**
 * Orquestra o extrator C# (tools/extractor) a partir do Node.
 *
 * Uso:
 *   npm run extract
 *   npm run extract -- --download-mappings --clean
 *   npm run dump:from-game
 */
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROJECT = path.join(ROOT, 'tools', 'extractor', 'Palai.Extractor.csproj');

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function resolveDotnet(): Promise<string> {
  const candidates = [
    process.env.DOTNET_ROOT
      ? path.join(process.env.DOTNET_ROOT, process.platform === 'win32' ? 'dotnet.exe' : 'dotnet')
      : '',
    'C:\\Program Files\\dotnet\\dotnet.exe',
    'dotnet',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'dotnet') return candidate;
    if (await exists(candidate)) return candidate;
  }
  return 'dotnet';
}

function run(cmd: string, args: string[], cwd: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main(): Promise<void> {
  if (!(await exists(PROJECT))) {
    console.error(`Projeto não encontrado: ${PROJECT}`);
    process.exit(1);
  }

  const passthrough = process.argv.slice(2);
  const wantsHelp =
    passthrough.includes('--help') || passthrough.includes('-h');
  // Default: baixar mappings se não houver nenhum local.
  if (
    !wantsHelp &&
    !passthrough.includes('--mappings') &&
    !passthrough.includes('--download-mappings')
  ) {
    const mappingsDir = path.join(ROOT, 'tools', 'extractor', 'mappings');
    const hasLocal =
      (await exists(path.join(mappingsDir, 'Mappings.usmap'))) ||
      (await exists(path.join(mappingsDir, 'Pal-Windows_Mappings.usmap')));
    if (!hasLocal) passthrough.unshift('--download-mappings');
  }

  const dotnet = await resolveDotnet();
  const args = [
    'run',
    '--project',
    PROJECT,
    '-c',
    'Release',
    '--no-launch-profile',
    '--',
    ...passthrough,
  ];

  console.log(`> ${dotnet} ${args.join(' ')}`);
  const code = await run(dotnet, args, ROOT);
  process.exit(code);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
