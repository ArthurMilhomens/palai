import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

const PALWORLD_APP_ID = '1623730';

export type SteamGameInfo = {
  appId: string;
  name: string;
  buildId: string;
  installDir: string;
  pakDir: string;
  pakFile: string;
  libraryPath: string;
  manifestPath: string;
};

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function parseAcfObject(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const re = /"([^"]+)"\s+"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content))) {
    result[match[1]!] = match[2]!;
  }
  return result;
}

function extractLibraryPaths(vdf: string): string[] {
  const paths: string[] = [];
  const re = /"path"\s+"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(vdf))) {
    paths.push(match[1]!.replace(/\\\\/g, '\\'));
  }
  return paths;
}

async function readSteamLibraries(): Promise<string[]> {
  const candidates = [
    path.join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'Steam',
      'steamapps',
      'libraryfolders.vdf',
    ),
    path.join(
      process.env.ProgramFiles ?? 'C:\\Program Files',
      'Steam',
      'steamapps',
      'libraryfolders.vdf',
    ),
    path.join(homedir(), '.steam', 'steam', 'steamapps', 'libraryfolders.vdf'),
  ];

  const libraries = new Set<string>();
  for (const file of candidates) {
    if (!(await exists(file))) continue;
    const content = await readFile(file, 'utf8');
    for (const lib of extractLibraryPaths(content)) {
      libraries.add(lib);
    }
    // Always include the folder that contains this vdf
    libraries.add(path.resolve(path.dirname(file), '..'));
  }

  // Common extra libraries
  for (const extra of ['D:\\SteamLibrary', 'E:\\SteamLibrary', 'F:\\SteamLibrary']) {
    if (await exists(extra)) libraries.add(extra);
  }

  return [...libraries];
}

export async function findPalworldInstall(
  explicitGamePath?: string,
): Promise<SteamGameInfo | null> {
  if (explicitGamePath) {
    const installDir = path.resolve(explicitGamePath);
    if (!(await exists(installDir))) {
      throw new Error(`Game path not found: ${installDir}`);
    }
    return buildGameInfo(installDir, path.resolve(installDir, '..', '..'), '');
  }

  const libraries = await readSteamLibraries();
  for (const library of libraries) {
    const steamapps = path.join(library, 'steamapps');
    const manifestPath = path.join(steamapps, `appmanifest_${PALWORLD_APP_ID}.acf`);
    if (!(await exists(manifestPath))) continue;

    const acf = parseAcfObject(await readFile(manifestPath, 'utf8'));
    const installdir = acf.installdir ?? 'Palworld';
    const installDir = path.join(steamapps, 'common', installdir);
    if (!(await exists(installDir))) continue;

    return buildGameInfo(installDir, library, manifestPath, acf);
  }

  return null;
}

async function buildGameInfo(
  installDir: string,
  libraryPath: string,
  manifestPath: string,
  acf?: Record<string, string>,
): Promise<SteamGameInfo> {
  let buildId = acf?.buildid ?? '';
  let name = acf?.name ?? 'Palworld';

  if (!buildId && manifestPath && (await exists(manifestPath))) {
    const parsed = parseAcfObject(await readFile(manifestPath, 'utf8'));
    buildId = parsed.buildid ?? '';
    name = parsed.name ?? name;
  }

  // Try sibling appmanifest if not provided
  if (!buildId) {
    const guessedManifest = path.join(
      installDir,
      '..',
      '..',
      `appmanifest_${PALWORLD_APP_ID}.acf`,
    );
    if (await exists(guessedManifest)) {
      const parsed = parseAcfObject(await readFile(guessedManifest, 'utf8'));
      buildId = parsed.buildid ?? '';
      name = parsed.name ?? name;
      manifestPath = guessedManifest;
    }
  }

  const pakDir = path.join(installDir, 'Pal', 'Content', 'Paks');
  const pakFile = path.join(pakDir, 'Pal-Windows.pak');

  return {
    appId: PALWORLD_APP_ID,
    name,
    buildId: buildId || 'unknown',
    installDir,
    pakDir,
    pakFile,
    libraryPath,
    manifestPath,
  };
}

export async function findExportDirectories(
  projectRoot: string,
  explicitExportDir?: string,
): Promise<string[]> {
  const found: string[] = [];
  const candidates = [
    explicitExportDir,
    path.join(projectRoot, 'game_data', 'fmodel'),
    path.join(projectRoot, 'game_data', 'raw'),
    path.join(projectRoot, 'game_data', 'exports'),
    path.join(process.env.LOCALAPPDATA ?? '', 'FModel', 'Output', 'Exports'),
    path.join(process.env.LOCALAPPDATA ?? '', 'FModel', 'Output', 'Exports', 'Pal'),
    path.join(homedir(), 'FModel', 'Output', 'Exports'),
    path.join(homedir(), 'FModel', 'Output', 'Exports', 'Pal'),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (dir && (await exists(dir))) found.push(path.resolve(dir));
  }
  return [...new Set(found)];
}
