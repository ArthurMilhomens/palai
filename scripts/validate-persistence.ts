/**
 * Valida persistência no Postgres e leitura via API.
 * Uso: npx tsx scripts/validate-persistence.ts
 */
import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const prisma = new PrismaClient();
const API = process.env.API_URL ?? 'http://localhost:3000';
const EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@palai.local';
const PASSWORD = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'ChangeMeAdmin123!';

type Check = { name: string; ok: boolean; detail?: string };

const checks: Check[] = [];

function pass(name: string, detail?: string) {
  checks.push({ name, ok: true, detail });
  console.log(`✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name: string, detail?: string) {
  checks.push({ name, ok: false, detail });
  console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
}

async function api<T>(
  method: string,
  urlPath: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, json };
}

async function main() {
  console.log('=== 1) Banco de dados ===\n');

  const versions = await prisma.gameVersion.findMany({
    orderBy: { importedAt: 'desc' },
  });
  if (versions.length === 0) {
    fail('gameVersion', 'nenhuma versão importada');
  } else {
    pass(
      'gameVersion',
      versions
        .map((v) => `${v.version}/${v.build} active=${v.isActive}`)
        .join('; '),
    );
  }

  const active = versions.find((v) => v.isActive) ?? versions[0];
  if (!active) {
    fail('activeVersion', 'sem versão para validar');
    printSummary();
    process.exit(1);
  }
  if (!active.isActive) {
    fail('activeVersion', `versão ${active.version} existe mas isActive=false`);
    await prisma.gameVersion.update({
      where: { id: active.id },
      data: { isActive: true },
    });
    pass('activeVersion.fixed', `ativada ${active.id}`);
  } else {
    pass('activeVersion', `${active.version} build=${active.build}`);
  }

  const gid = active.id;
  const counts = {
    pals: await prisma.pal.count({ where: { gameVersionId: gid } }),
    items: await prisma.item.count({ where: { gameVersionId: gid } }),
    skills: await prisma.skill.count({ where: { gameVersionId: gid } }),
    passives: await prisma.passiveSkill.count({ where: { gameVersionId: gid } }),
    recipes: await prisma.recipe.count({ where: { gameVersionId: gid } }),
    technologies: await prisma.technology.count({ where: { gameVersionId: gid } }),
    locations: await prisma.location.count({ where: { gameVersionId: gid } }),
    dungeons: await prisma.dungeon.count({ where: { gameVersionId: gid } }),
    bosses: await prisma.boss.count({ where: { gameVersionId: gid } }),
    elements: await prisma.element.count({ where: { gameVersionId: gid } }),
    breedingOverrides: await prisma.breedingOverride.count({
      where: { gameVersionId: gid },
    }),
    drops: await prisma.drop.count({ where: { gameVersionId: gid } }),
  };

  console.log('\nContagens (versão ativa):');
  console.log(JSON.stringify(counts, null, 2));

  const expectMin: Record<string, number> = {
    pals: 100,
    items: 100,
    skills: 50,
    passives: 50,
    recipes: 50,
    technologies: 50,
    locations: 20,
    dungeons: 5,
    bosses: 50,
    elements: 5,
    breedingOverrides: 50,
    drops: 500,
  };

  for (const [key, min] of Object.entries(expectMin)) {
    const value = counts[key as keyof typeof counts];
    if (value >= min) pass(`count.${key}`, `${value} >= ${min}`);
    else fail(`count.${key}`, `${value} < ${min}`);
  }

  console.log('\n=== 2) Amostras e relações ===\n');

  const anubis = await prisma.pal.findFirst({
    where: { gameVersionId: gid, internalName: 'Anubis' },
    include: {
      elements: { include: { element: true } },
      workSuitabilities: { include: { workSuitability: true } },
      drops: { include: { item: true } },
    },
  });
  if (!anubis) fail('sample.Anubis', 'não encontrado');
  else {
    pass(
      'sample.Anubis',
      `dex=${anubis.paldexNumber} bp=${anubis.breedingPower} hp=${anubis.hp} elements=${anubis.elements.map((e) => e.element.name).join(',')}`,
    );
    if (anubis.breedingPower !== 480) {
      fail('sample.Anubis.breedingPower', `esperado 480, veio ${anubis.breedingPower}`);
    } else pass('sample.Anubis.breedingPower', '480');
    if ((anubis.paldexNumber ?? 0) <= 0) {
      fail('sample.Anubis.paldex', String(anubis.paldexNumber));
    } else pass('sample.Anubis.paldex', String(anubis.paldexNumber));
  }

  const sheep = await prisma.pal.findFirst({
    where: { gameVersionId: gid, internalName: 'SheepBall' },
    include: { drops: { include: { item: true } } },
  });
  if (!sheep) fail('sample.SheepBall', 'não encontrado');
  else {
    pass(
      'sample.SheepBall',
      `dex=${sheep.paldexNumber} bp=${sheep.breedingPower}`,
    );
    const dropNames = sheep.drops.map((d) => d.item.internalName).sort();
    if (sheep.drops.length >= 1 && dropNames.includes('Wool')) {
      pass(
        'sample.SheepBall.drops',
        sheep.drops
          .map(
            (d) =>
              `${d.item.internalName}@${d.chance}(${d.quantityMin}-${d.quantityMax})`,
          )
          .join(', '),
      );
    } else {
      fail(
        'sample.SheepBall.drops',
        `esperado Wool+, veio [${dropNames.join(',')}]`,
      );
    }
  }

  if (anubis && anubis.drops.length > 0) {
    pass(
      'sample.Anubis.drops',
      anubis.drops.map((d) => d.item.internalName).join(', '),
    );
  } else if (anubis) {
    fail('sample.Anubis.drops', 'nenhum drop persistido');
  }

  const wood = await prisma.item.findFirst({
    where: { gameVersionId: gid, internalName: 'Wood' },
  });
  if (!wood) fail('sample.Wood', 'não encontrado');
  else pass('sample.Wood', `price=${wood.price} stack=${wood.stackSize}`);

  const recipe = await prisma.recipe.findFirst({
    where: { gameVersionId: gid },
    include: { ingredients: true, resultItem: true },
  });
  if (!recipe?.resultItem) fail('sample.recipe', 'sem recipe com resultItem');
  else
    pass(
      'sample.recipe',
      `${recipe.internalName} -> ${recipe.resultItem.internalName} x${recipe.resultQuantity} ingredients=${recipe.ingredients.length}`,
    );

  const tech = await prisma.technology.findFirst({
    where: { gameVersionId: gid, internalName: 'Workbench' },
  });
  if (!tech) fail('sample.Workbench', 'technology não encontrada');
  else pass('sample.Workbench', `level=${tech.level} cost=${tech.unlockCost}`);

  const boss = await prisma.boss.findFirst({
    where: { gameVersionId: gid },
    include: { pal: true, location: true },
  });
  if (!boss) fail('sample.boss', 'nenhum boss');
  else
    pass(
      'sample.boss',
      `${boss.internalName} pal=${boss.pal?.internalName ?? boss.palId} loc=${boss.location?.internalName ?? 'null'}`,
    );

  const override = await prisma.breedingOverride.findFirst({
    where: { gameVersionId: gid },
    include: { parentA: true, parentB: true, child: true },
  });
  if (!override) fail('sample.breedingOverride', 'nenhum override');
  else
    pass(
      'sample.breedingOverride',
      `${override.parentA.internalName} + ${override.parentB.internalName} => ${override.child.internalName}`,
    );

  // Compare a few pals against dump.json if present
  try {
    const dumpPath = path.join(process.cwd(), 'game_data', 'dump.json');
    const dump = JSON.parse(await readFile(dumpPath, 'utf8')) as {
      pals: Array<{ internalName: string }>;
      items: Array<{ internalName: string }>;
      recipes: Array<{ internalName: string }>;
    };
    const dumpPalCount = dump.pals?.length ?? 0;
    const dumpItemCount = dump.items?.length ?? 0;
    if (Math.abs(dumpPalCount - counts.pals) <= 5) {
      pass('parity.pals', `dump=${dumpPalCount} db=${counts.pals}`);
    } else {
      fail('parity.pals', `dump=${dumpPalCount} db=${counts.pals}`);
    }
    if (Math.abs(dumpItemCount - counts.items) <= 5) {
      pass('parity.items', `dump=${dumpItemCount} db=${counts.items}`);
    } else {
      fail('parity.items', `dump=${dumpItemCount} db=${counts.items}`);
    }
  } catch {
    fail('parity.dump', 'game_data/dump.json ausente ou inválido');
  }

  console.log('\n=== 3) API (auth + leitura) ===\n');

  const unauth = await api<{ error?: { code?: string } }>('GET', '/v1/items');
  if (unauth.status === 401) pass('api.unauth.401', 'protegido corretamente');
  else fail('api.unauth.401', `status=${unauth.status}`);

  const login = await api<{
    data?: { tokens?: { accessToken?: string } };
    error?: unknown;
  }>('POST', '/v1/auth/login', undefined, {
    email: EMAIL,
    password: PASSWORD,
  });
  const token = login.json.data?.tokens?.accessToken;
  if (login.status !== 200 || !token) {
    fail('api.login', JSON.stringify(login.json));
    printSummary();
    process.exit(1);
  }
  pass('api.login', 'token ok');

  const itemsRes = await api<{
    data?: unknown[];
    meta?: { total?: number };
  }>('GET', '/v1/items?limit=5', token);
  if (itemsRes.status === 200 && (itemsRes.json.meta?.total ?? 0) > 0) {
    pass(
      'api.items',
      `total=${itemsRes.json.meta?.total} pageSize=${itemsRes.json.data?.length}`,
    );
  } else {
    fail('api.items', `status=${itemsRes.status} body=${JSON.stringify(itemsRes.json).slice(0, 300)}`);
  }

  const palsRes = await api<{
    data?: unknown[];
    meta?: { total?: number };
  }>('GET', '/v1/pals?limit=5', token);
  if (palsRes.status === 200 && (palsRes.json.meta?.total ?? 0) > 0) {
    pass('api.pals', `total=${palsRes.json.meta?.total}`);
  } else {
    fail('api.pals', `status=${palsRes.status}`);
  }

  const anubisRes = await api<{ data?: { internalName?: string; breedingPower?: number } }>(
    'GET',
    '/v1/pals/Anubis',
    token,
  );
  if (
    anubisRes.status === 200 &&
    anubisRes.json.data?.internalName === 'Anubis'
  ) {
    pass(
      'api.pals.Anubis',
      `bp=${anubisRes.json.data.breedingPower}`,
    );
  } else {
    fail('api.pals.Anubis', `status=${anubisRes.status}`);
  }

  const recipesRes = await api<{ meta?: { total?: number } }>(
    'GET',
    '/v1/recipes?limit=5',
    token,
  );
  if (recipesRes.status === 200 && (recipesRes.json.meta?.total ?? 0) > 0) {
    pass('api.recipes', `total=${recipesRes.json.meta?.total}`);
  } else {
    fail('api.recipes', `status=${recipesRes.status}`);
  }

  const bossesRes = await api<{ meta?: { total?: number } }>(
    'GET',
    '/v1/bosses?limit=5',
    token,
  );
  if (bossesRes.status === 200 && (bossesRes.json.meta?.total ?? 0) > 0) {
    pass('api.bosses', `total=${bossesRes.json.meta?.total}`);
  } else {
    fail('api.bosses', `status=${bossesRes.status}`);
  }

  const versionRes = await api<{
    data?: { active?: { version?: string; isActive?: boolean } };
  }>('GET', '/v1/updates/version', token);
  if (versionRes.status === 200 && versionRes.json.data?.active?.isActive) {
    pass(
      'api.updates.version',
      versionRes.json.data.active.version ?? 'active',
    );
  } else {
    fail('api.updates.version', `status=${versionRes.status}`);
  }

  printSummary();
}

function printSummary() {
  const failed = checks.filter((c) => !c.ok);
  console.log('\n=== Resumo ===');
  console.log(`pass=${checks.length - failed.length} fail=${failed.length}`);
  if (failed.length) {
    console.log('Falhas:');
    for (const f of failed) console.log(` - ${f.name}: ${f.detail ?? ''}`);
    process.exitCode = 1;
  } else {
    console.log('Persistência e API OK.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
