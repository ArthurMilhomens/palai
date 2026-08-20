import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  ImportJobStatus,
  ImportStepName,
  ImportStepStatus,
  Prisma,
  SkillCategory,
} from '@prisma/client';
import { prisma } from '../prisma/client.js';
import { parseGameDump, validateGameDump, type GameDump } from '../parser/game-dump.js';
import { cleanupWorkspace, extractJsonDump, extractZipDump } from '../extractors/dump.js';
import { reindexGameVersion } from '../indexers/opensearch.js';
import { cacheFlushNamespace } from '../shared/cache.js';
import { uploadObject } from '../shared/storage.js';
import { AppError } from '../shared/errors.js';

export type ImportStats = {
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  details: Record<string, unknown>;
};

const STEP_ORDER: ImportStepName[] = [
  ImportStepName.EXTRACT,
  ImportStepName.PARSE,
  ImportStepName.VALIDATE,
  ImportStepName.PERSIST,
  ImportStepName.INDEX,
  ImportStepName.CACHE_CLEAR,
  ImportStepName.ACTIVATE,
];

export class ImportPipeline {
  async createJob(input: {
    version: string;
    build?: string | null;
    releaseDate?: Date | null;
    fileBuffer: Buffer;
    filename: string;
  }) {
    const job = await prisma.importJob.create({
      data: {
        status: ImportJobStatus.PENDING,
        versionLabel: input.version,
        buildLabel: input.build ?? null,
        releaseDate: input.releaseDate ?? null,
        steps: {
          create: STEP_ORDER.map((name) => ({
            name,
            status: ImportStepStatus.PENDING,
          })),
        },
      },
      include: { steps: true },
    });

    const workspace = path.join(process.cwd(), '.tmp', 'imports', job.id);
    const isZip = input.filename.toLowerCase().endsWith('.zip');
    // store buffer path reference in memory via sourcePath
    await prisma.importJob.update({
      where: { id: job.id },
      data: { sourcePath: workspace, startedAt: new Date() },
    });

    // Persist upload to workspace for resumability of extract step
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(workspace, { recursive: true });
    const uploadPath = path.join(
      workspace,
      isZip ? 'upload.zip' : 'upload.json',
    );
    await writeFile(uploadPath, input.fileBuffer);

    return { job, uploadPath, isZip, workspace };
  }

  async run(jobId: string): Promise<ImportStats> {
    const started = Date.now();
    let stats: ImportStats = {
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      details: {},
    };

    try {
      const job = await prisma.importJob.findUniqueOrThrow({
        where: { id: jobId },
        include: { steps: true },
      });

      let dump: GameDump | null = null;
      let workspace = job.sourcePath ?? path.join(process.cwd(), '.tmp', 'imports', jobId);
      let iconsDir: string | null = null;

      for (const stepName of STEP_ORDER) {
        const step = job.steps.find((s) => s.name === stepName);
        if (step?.status === ImportStepStatus.COMPLETED) continue;

        await this.markStep(jobId, stepName, ImportStepStatus.RUNNING);
        await this.setJobStatus(jobId, mapStepToJobStatus(stepName));

        try {
          if (stepName === ImportStepName.EXTRACT) {
            const zipPath = path.join(workspace, 'upload.zip');
            const jsonPath = path.join(workspace, 'upload.json');
            let extracted;
            try {
              const buf = await readFile(zipPath);
              extracted = await extractZipDump(buf, workspace);
            } catch {
              const buf = await readFile(jsonPath);
              extracted = await extractJsonDump(buf, workspace);
            }
            dump = null;
            iconsDir = extracted.iconsDir;
            stats.details.extractedFrom = extracted.manifestPath;
            // stash raw dump for next steps
            await writeSidecar(workspace, 'raw.json', extracted.raw);
          }

          if (stepName === ImportStepName.PARSE) {
            const raw = await readSidecar(workspace, 'raw.json');
            dump = parseGameDump(raw);
            await writeSidecar(workspace, 'parsed.json', dump);
          }

          if (stepName === ImportStepName.VALIDATE) {
            const raw = await readSidecar(workspace, 'parsed.json');
            const validated = validateGameDump(raw);
            if (!validated.success || !validated.data) {
              throw new AppError(400, 'Dump validation failed', 'DUMP_INVALID', validated.errors);
            }
            dump = validated.data;
            await writeSidecar(workspace, 'validated.json', dump);
          }

          if (stepName === ImportStepName.PERSIST) {
            dump = (await readSidecar(workspace, 'validated.json')) as GameDump;
            stats = await this.persistDump(jobId, dump, iconsDir ?? path.join(workspace, 'icons'));
          }

          if (stepName === ImportStepName.INDEX) {
            const freshJob = await prisma.importJob.findUniqueOrThrow({
              where: { id: jobId },
            });
            const gv = await resolveJobGameVersion(freshJob);
            if (gv) {
              const indexed = await reindexGameVersion(gv.id).catch((err) => {
                stats.details.indexError =
                  err instanceof Error ? err.message : String(err);
                return 0;
              });
              stats.details.indexed = indexed;
            }
          }

          if (stepName === ImportStepName.CACHE_CLEAR) {
            const deleted = await cacheFlushNamespace('v1:');
            stats.details.cacheKeysDeleted = deleted;
          }

          if (stepName === ImportStepName.ACTIVATE) {
            const freshJob = await prisma.importJob.findUniqueOrThrow({
              where: { id: jobId },
            });
            const gv = await resolveJobGameVersion(freshJob);
            if (!gv) {
              throw new AppError(
                500,
                `GameVersion not found for job ${jobId} (label=${freshJob.versionLabel})`,
                'GAME_VERSION_MISSING',
              );
            }
            await prisma.$transaction([
              prisma.gameVersion.updateMany({
                data: { isActive: false },
                where: { isActive: true },
              }),
              prisma.gameVersion.update({
                where: { id: gv.id },
                data: { isActive: true },
              }),
              prisma.importJob.update({
                where: { id: jobId },
                data: { gameVersionId: gv.id },
              }),
            ]);
          }

          await this.markStep(jobId, stepName, ImportStepStatus.COMPLETED);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.markStep(jobId, stepName, ImportStepStatus.FAILED, message);
          await prisma.importJob.update({
            where: { id: jobId },
            data: {
              status: ImportJobStatus.FAILED,
              errorMessage: message,
              finishedAt: new Date(),
            },
          });
          throw error;
        }
      }

      const durationMs = Date.now() - started;
      await prisma.importReport.upsert({
        where: { jobId },
        create: {
          jobId,
          durationMs,
          createdCount: stats.createdCount,
          updatedCount: stats.updatedCount,
          skippedCount: stats.skippedCount,
          errorCount: stats.errorCount,
          details: stats.details as Prisma.InputJsonValue,
        },
        update: {
          durationMs,
          createdCount: stats.createdCount,
          updatedCount: stats.updatedCount,
          skippedCount: stats.skippedCount,
          errorCount: stats.errorCount,
          details: stats.details as Prisma.InputJsonValue,
        },
      });

      await prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: ImportJobStatus.COMPLETED,
          finishedAt: new Date(),
          errorMessage: null,
        },
      });

      await cleanupWorkspace(workspace).catch(() => undefined);
      return stats;
    } catch (error) {
      stats.errorCount += 1;
      stats.details.fatal = error instanceof Error ? error.message : String(error);
      return stats;
    }
  }

  private async persistDump(
    jobId: string,
    dump: GameDump,
    iconsDir: string,
  ): Promise<ImportStats> {
    const stats: ImportStats = {
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      errorCount: 0,
      details: {},
    };

    const gameVersion = await prisma.gameVersion.upsert({
      where: {
        version_build: {
          version: dump.version,
          build: dump.build ?? '',
        },
      },
      create: {
        version: dump.version,
        build: dump.build ?? '',
        releaseDate: dump.releaseDate ? new Date(dump.releaseDate) : null,
        isActive: false,
      },
      update: {
        releaseDate: dump.releaseDate ? new Date(dump.releaseDate) : null,
        importedAt: new Date(),
      },
    });

    await prisma.importJob.update({
      where: { id: jobId },
      data: { gameVersionId: gameVersion.id },
    });

    const elementMap = new Map<string, string>();
    for (const el of dump.elements) {
      const existing = await prisma.element.findUnique({
        where: {
          internalName_gameVersionId: {
            internalName: el.internalName,
            gameVersionId: gameVersion.id,
          },
        },
      });
      const iconUrl = el.icon
        ? await maybeUploadIcon(iconsDir, el.icon, dump.version, 'elements')
        : existing?.iconUrl ?? null;
      const row = await prisma.element.upsert({
        where: {
          internalName_gameVersionId: {
            internalName: el.internalName,
            gameVersionId: gameVersion.id,
          },
        },
        create: {
          internalName: el.internalName,
          name: el.name,
          iconUrl,
          gameVersionId: gameVersion.id,
        },
        update: { name: el.name, iconUrl },
      });
      elementMap.set(el.internalName, row.id);
      if (existing) stats.updatedCount += 1;
      else stats.createdCount += 1;
    }

    const skillMap = new Map<string, string>();
    for (const skill of dump.skills) {
      const existing = await prisma.skill.findUnique({
        where: {
          internalName_gameVersionId: {
            internalName: skill.internalName,
            gameVersionId: gameVersion.id,
          },
        },
      });
      const row = await prisma.skill.upsert({
        where: {
          internalName_gameVersionId: {
            internalName: skill.internalName,
            gameVersionId: gameVersion.id,
          },
        },
        create: {
          internalName: skill.internalName,
          name: skill.name,
          description: skill.description ?? null,
          power: skill.power ?? null,
          cooldown: skill.cooldown ?? null,
          range: skill.range ?? null,
          category: skill.category as SkillCategory,
          elementId: skill.element ? elementMap.get(skill.element) ?? null : null,
          gameVersionId: gameVersion.id,
        },
        update: {
          name: skill.name,
          description: skill.description ?? null,
          power: skill.power ?? null,
          cooldown: skill.cooldown ?? null,
          range: skill.range ?? null,
          category: skill.category as SkillCategory,
          elementId: skill.element ? elementMap.get(skill.element) ?? null : null,
        },
      });
      skillMap.set(skill.internalName, row.id);
      if (existing) stats.updatedCount += 1;
      else stats.createdCount += 1;
    }

    const passiveMap = new Map<string, string>();
    for (const passive of dump.passives) {
      const existing = await prisma.passiveSkill.findUnique({
        where: {
          internalName_gameVersionId: {
            internalName: passive.internalName,
            gameVersionId: gameVersion.id,
          },
        },
      });
      const row = await prisma.passiveSkill.upsert({
        where: {
          internalName_gameVersionId: {
            internalName: passive.internalName,
            gameVersionId: gameVersion.id,
          },
        },
        create: {
          internalName: passive.internalName,
          name: passive.name,
          description: passive.description ?? null,
          rarity: passive.rarity ?? null,
          modifiers: (passive.modifiers ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
          gameVersionId: gameVersion.id,
        },
        update: {
          name: passive.name,
          description: passive.description ?? null,
          rarity: passive.rarity ?? null,
          modifiers: (passive.modifiers ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
      passiveMap.set(passive.internalName, row.id);
      if (existing) stats.updatedCount += 1;
      else stats.createdCount += 1;
    }

    const itemMap = new Map<string, string>();
    for (const item of dump.items) {
      const existing = await prisma.item.findUnique({
        where: {
          internalName_gameVersionId: {
            internalName: item.internalName,
            gameVersionId: gameVersion.id,
          },
        },
      });
      const iconUrl = item.icon
        ? await maybeUploadIcon(iconsDir, item.icon, dump.version, 'items')
        : existing?.iconUrl ?? null;
      const row = await prisma.item.upsert({
        where: {
          internalName_gameVersionId: {
            internalName: item.internalName,
            gameVersionId: gameVersion.id,
          },
        },
        create: {
          internalName: item.internalName,
          name: item.name,
          description: item.description ?? null,
          iconUrl,
          kind: item.kind ?? 'item',
          rarity: item.rarity ?? null,
          weight: item.weight ?? null,
          price: item.price ?? null,
          stackSize: item.stackSize ?? null,
          lootSources: item.lootSources ?? [],
          gameVersionId: gameVersion.id,
        },
        update: {
          name: item.name,
          description: item.description ?? null,
          iconUrl,
          kind: item.kind ?? 'item',
          rarity: item.rarity ?? null,
          weight: item.weight ?? null,
          price: item.price ?? null,
          stackSize: item.stackSize ?? null,
          lootSources: item.lootSources ?? [],
        },
      });
      itemMap.set(item.internalName, row.id);
      if (existing) stats.updatedCount += 1;
      else stats.createdCount += 1;
    }

    const locationMap = new Map<string, string>();
    for (const location of dump.locations) {
      const existing = await prisma.location.findUnique({
        where: {
          internalName_gameVersionId: {
            internalName: location.internalName,
            gameVersionId: gameVersion.id,
          },
        },
      });
      const row = await prisma.location.upsert({
        where: {
          internalName_gameVersionId: {
            internalName: location.internalName,
            gameVersionId: gameVersion.id,
          },
        },
        create: {
          internalName: location.internalName,
          name: location.name,
          biome: location.biome ?? null,
          coordX: location.coordinates?.x ?? null,
          coordY: location.coordinates?.y ?? null,
          coordZ: location.coordinates?.z ?? null,
          level: location.level ?? null,
          gameVersionId: gameVersion.id,
        },
        update: {
          name: location.name,
          biome: location.biome ?? null,
          coordX: location.coordinates?.x ?? null,
          coordY: location.coordinates?.y ?? null,
          coordZ: location.coordinates?.z ?? null,
          level: location.level ?? null,
        },
      });
      locationMap.set(location.internalName, row.id);
      if (existing) stats.updatedCount += 1;
      else stats.createdCount += 1;
    }

    const palMap = new Map<string, string>();
    for (const pal of dump.pals) {
      const existing = await prisma.pal.findUnique({
        where: {
          internalName_gameVersionId: {
            internalName: pal.internalName,
            gameVersionId: gameVersion.id,
          },
        },
      });
      const iconUrl = pal.icon
        ? await maybeUploadIcon(iconsDir, pal.icon, dump.version, 'pals')
        : existing?.iconUrl ?? null;
      const row = await prisma.pal.upsert({
        where: {
          internalName_gameVersionId: {
            internalName: pal.internalName,
            gameVersionId: gameVersion.id,
          },
        },
        create: {
          internalName: pal.internalName,
          paldexNumber: pal.paldexNumber ?? null,
          name: pal.name,
          description: pal.description ?? null,
          rarity: pal.rarity ?? null,
          size: pal.size ?? null,
          price: pal.price ?? null,
          hp: pal.hp ?? null,
          attack: pal.attack ?? null,
          defense: pal.defense ?? null,
          stamina: pal.stamina ?? null,
          hunger: pal.hunger ?? null,
          movementSpeed: pal.movementSpeed ?? null,
          sprintSpeed: pal.sprintSpeed ?? null,
          rideSpeed: pal.rideSpeed ?? null,
          genderRatio: pal.genderRatio ?? null,
          captureRate: pal.captureRate ?? null,
          breedingPower: pal.breedingPower ?? null,
          iconUrl,
          gameVersionId: gameVersion.id,
        },
        update: {
          paldexNumber: pal.paldexNumber ?? null,
          name: pal.name,
          description: pal.description ?? null,
          rarity: pal.rarity ?? null,
          size: pal.size ?? null,
          price: pal.price ?? null,
          hp: pal.hp ?? null,
          attack: pal.attack ?? null,
          defense: pal.defense ?? null,
          stamina: pal.stamina ?? null,
          hunger: pal.hunger ?? null,
          movementSpeed: pal.movementSpeed ?? null,
          sprintSpeed: pal.sprintSpeed ?? null,
          rideSpeed: pal.rideSpeed ?? null,
          genderRatio: pal.genderRatio ?? null,
          captureRate: pal.captureRate ?? null,
          breedingPower: pal.breedingPower ?? null,
          iconUrl,
        },
      });
      palMap.set(pal.internalName, row.id);
      if (existing) stats.updatedCount += 1;
      else stats.createdCount += 1;

      await prisma.palElement.deleteMany({ where: { palId: row.id } });
      for (const elName of pal.elements) {
        const elementId = elementMap.get(elName);
        if (!elementId) {
          stats.skippedCount += 1;
          continue;
        }
        await prisma.palElement.create({
          data: { palId: row.id, elementId },
        });
      }

      await prisma.palSkill.deleteMany({ where: { palId: row.id } });
      for (const skillName of pal.activeSkills) {
        const skillId = skillMap.get(skillName);
        if (!skillId) {
          stats.skippedCount += 1;
          continue;
        }
        await prisma.palSkill.create({
          data: { palId: row.id, skillId, isPartner: false },
        });
      }
      if (pal.partnerSkill) {
        const skillId = skillMap.get(pal.partnerSkill);
        if (skillId) {
          await prisma.palSkill.create({
            data: { palId: row.id, skillId, isPartner: true },
          });
        } else {
          stats.skippedCount += 1;
        }
      }

      await prisma.palPassive.deleteMany({ where: { palId: row.id } });
      for (const passiveName of pal.passiveSkills) {
        const passiveSkillId = passiveMap.get(passiveName);
        if (!passiveSkillId) {
          stats.skippedCount += 1;
          continue;
        }
        await prisma.palPassive.create({
          data: { palId: row.id, passiveSkillId },
        });
      }

      await prisma.palWorkSuitability.deleteMany({ where: { palId: row.id } });
      for (const work of pal.workSuitabilities) {
        const ws = await prisma.workSuitability.upsert({
          where: {
            internalName_level_gameVersionId: {
              internalName: work.type,
              level: work.level,
              gameVersionId: gameVersion.id,
            },
          },
          create: {
            internalName: work.type,
            type: work.type,
            level: work.level,
            gameVersionId: gameVersion.id,
          },
          update: { type: work.type },
        });
        await prisma.palWorkSuitability.create({
          data: { palId: row.id, workSuitabilityId: ws.id },
        });
      }

      await prisma.drop.deleteMany({ where: { palId: row.id } });
      for (const drop of pal.drops) {
        const itemId = itemMap.get(drop.item);
        if (!itemId) {
          stats.skippedCount += 1;
          continue;
        }
        await prisma.drop.create({
          data: {
            palId: row.id,
            itemId,
            chance: drop.chance ?? null,
            quantityMin: drop.quantityMin,
            quantityMax: drop.quantityMax,
            gameVersionId: gameVersion.id,
          },
        });
      }

      await prisma.palHabitat.deleteMany({ where: { palId: row.id } });
      for (const habitat of pal.habitats) {
        const locationId = locationMap.get(habitat);
        if (!locationId) {
          stats.skippedCount += 1;
          continue;
        }
        await prisma.palHabitat.create({
          data: { palId: row.id, locationId },
        });
      }
    }

    for (const recipe of dump.recipes) {
      const resultItemId = itemMap.get(recipe.result) ?? null;
      if (!resultItemId) {
        stats.skippedCount += 1;
        continue;
      }
      const existing = await prisma.recipe.findUnique({
        where: {
          internalName_gameVersionId: {
            internalName: recipe.internalName,
            gameVersionId: gameVersion.id,
          },
        },
      });
      const row = await prisma.recipe.upsert({
        where: {
          internalName_gameVersionId: {
            internalName: recipe.internalName,
            gameVersionId: gameVersion.id,
          },
        },
        create: {
          internalName: recipe.internalName,
          craftingStation: recipe.craftingStation ?? null,
          craftTime: recipe.craftTime ?? null,
          resultItemId,
          resultQuantity: recipe.resultQuantity,
          gameVersionId: gameVersion.id,
        },
        update: {
          craftingStation: recipe.craftingStation ?? null,
          craftTime: recipe.craftTime ?? null,
          resultItemId,
          resultQuantity: recipe.resultQuantity,
        },
      });
      await prisma.recipeIngredient.deleteMany({ where: { recipeId: row.id } });
      for (const ingredient of recipe.ingredients) {
        const itemId = itemMap.get(ingredient.item);
        if (!itemId) {
          stats.skippedCount += 1;
          continue;
        }
        await prisma.recipeIngredient.create({
          data: {
            recipeId: row.id,
            itemId,
            quantity: ingredient.quantity,
          },
        });
      }
      if (existing) stats.updatedCount += 1;
      else stats.createdCount += 1;
    }

    for (const tech of dump.technologies) {
      const existing = await prisma.technology.findUnique({
        where: {
          internalName_gameVersionId: {
            internalName: tech.internalName,
            gameVersionId: gameVersion.id,
          },
        },
      });
      await prisma.technology.upsert({
        where: {
          internalName_gameVersionId: {
            internalName: tech.internalName,
            gameVersionId: gameVersion.id,
          },
        },
        create: {
          internalName: tech.internalName,
          name: tech.name,
          description: tech.description ?? null,
          level: tech.level ?? null,
          unlockCost: tech.unlockCost ?? null,
          itemId: tech.item ? itemMap.get(tech.item) ?? null : null,
          gameVersionId: gameVersion.id,
        },
        update: {
          name: tech.name,
          description: tech.description ?? null,
          level: tech.level ?? null,
          unlockCost: tech.unlockCost ?? null,
          itemId: tech.item ? itemMap.get(tech.item) ?? null : null,
        },
      });
      if (existing) stats.updatedCount += 1;
      else stats.createdCount += 1;
    }

    const dungeonMap = new Map<string, string>();
    for (const dungeon of dump.dungeons) {
      const existing = await prisma.dungeon.findUnique({
        where: {
          internalName_gameVersionId: {
            internalName: dungeon.internalName,
            gameVersionId: gameVersion.id,
          },
        },
      });
      const row = await prisma.dungeon.upsert({
        where: {
          internalName_gameVersionId: {
            internalName: dungeon.internalName,
            gameVersionId: gameVersion.id,
          },
        },
        create: {
          internalName: dungeon.internalName,
          name: dungeon.name,
          biome: dungeon.biome ?? null,
          minimumLevel: dungeon.minimumLevel ?? null,
          maximumLevel: dungeon.maximumLevel ?? null,
          locationId: dungeon.location
            ? locationMap.get(dungeon.location) ?? null
            : null,
          gameVersionId: gameVersion.id,
        },
        update: {
          name: dungeon.name,
          biome: dungeon.biome ?? null,
          minimumLevel: dungeon.minimumLevel ?? null,
          maximumLevel: dungeon.maximumLevel ?? null,
          locationId: dungeon.location
            ? locationMap.get(dungeon.location) ?? null
            : null,
        },
      });
      dungeonMap.set(dungeon.internalName, row.id);
      if (existing) stats.updatedCount += 1;
      else stats.createdCount += 1;
    }

    for (const boss of dump.bosses) {
      const existing = await prisma.boss.findUnique({
        where: {
          internalName_gameVersionId: {
            internalName: boss.internalName,
            gameVersionId: gameVersion.id,
          },
        },
      });
      await prisma.boss.upsert({
        where: {
          internalName_gameVersionId: {
            internalName: boss.internalName,
            gameVersionId: gameVersion.id,
          },
        },
        create: {
          internalName: boss.internalName,
          level: boss.level ?? null,
          respawnTime: boss.respawnTime ?? null,
          palId: boss.pal ? palMap.get(boss.pal) ?? null : null,
          locationId: boss.location ? locationMap.get(boss.location) ?? null : null,
          dungeonId: boss.dungeon ? dungeonMap.get(boss.dungeon) ?? null : null,
          gameVersionId: gameVersion.id,
        },
        update: {
          level: boss.level ?? null,
          respawnTime: boss.respawnTime ?? null,
          palId: boss.pal ? palMap.get(boss.pal) ?? null : null,
          locationId: boss.location ? locationMap.get(boss.location) ?? null : null,
          dungeonId: boss.dungeon ? dungeonMap.get(boss.dungeon) ?? null : null,
        },
      });
      if (existing) stats.updatedCount += 1;
      else stats.createdCount += 1;
    }

    for (const override of dump.breedingOverrides) {
      const parentAId = palMap.get(override.parentA);
      const parentBId = palMap.get(override.parentB);
      const childId = palMap.get(override.child);
      if (!parentAId || !parentBId || !childId) {
        stats.skippedCount += 1;
        continue;
      }
      await prisma.breedingOverride.upsert({
        where: {
          parentAId_parentBId_gameVersionId: {
            parentAId,
            parentBId,
            gameVersionId: gameVersion.id,
          },
        },
        create: {
          parentAId,
          parentBId,
          childId,
          gameVersionId: gameVersion.id,
        },
        update: { childId },
      });
      stats.createdCount += 1;
    }

    for (const tr of dump.translations) {
      let entityId: string | undefined;
      if (tr.entityType === 'pal') entityId = palMap.get(tr.entityInternalName);
      else if (tr.entityType === 'item') entityId = itemMap.get(tr.entityInternalName);
      else if (tr.entityType === 'skill') entityId = skillMap.get(tr.entityInternalName);
      else if (tr.entityType === 'passive')
        entityId = passiveMap.get(tr.entityInternalName);
      else if (tr.entityType === 'element')
        entityId = elementMap.get(tr.entityInternalName);
      else if (tr.entityType === 'location')
        entityId = locationMap.get(tr.entityInternalName);
      if (!entityId) {
        stats.skippedCount += 1;
        continue;
      }
      await prisma.translation.upsert({
        where: {
          entityType_entityId_locale_field_gameVersionId: {
            entityType: tr.entityType,
            entityId,
            locale: tr.locale,
            field: tr.field,
            gameVersionId: gameVersion.id,
          },
        },
        create: {
          entityType: tr.entityType,
          entityId,
          locale: tr.locale,
          field: tr.field,
          value: tr.value,
          gameVersionId: gameVersion.id,
        },
        update: { value: tr.value },
      });
    }

    stats.details.gameVersionId = gameVersion.id;
    return stats;
  }

  private async markStep(
    jobId: string,
    name: ImportStepName,
    status: ImportStepStatus,
    errorMessage?: string,
  ) {
    await prisma.importJobStep.update({
      where: { jobId_name: { jobId, name } },
      data: {
        status,
        errorMessage: errorMessage ?? null,
        startedAt:
          status === ImportStepStatus.RUNNING ? new Date() : undefined,
        finishedAt:
          status === ImportStepStatus.COMPLETED ||
          status === ImportStepStatus.FAILED
            ? new Date()
            : undefined,
      },
    });
  }

  private async setJobStatus(jobId: string, status: ImportJobStatus) {
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status },
    });
  }
}

function mapStepToJobStatus(step: ImportStepName): ImportJobStatus {
  switch (step) {
    case ImportStepName.EXTRACT:
      return ImportJobStatus.EXTRACTING;
    case ImportStepName.PARSE:
      return ImportJobStatus.PARSING;
    case ImportStepName.VALIDATE:
      return ImportJobStatus.VALIDATING;
    case ImportStepName.PERSIST:
      return ImportJobStatus.PERSISTING;
    case ImportStepName.INDEX:
      return ImportJobStatus.INDEXING;
    case ImportStepName.CACHE_CLEAR:
      return ImportJobStatus.CACHE_CLEAR;
    case ImportStepName.ACTIVATE:
      return ImportJobStatus.CACHE_CLEAR;
    default:
      return ImportJobStatus.PENDING;
  }
}

async function resolveJobGameVersion(job: {
  gameVersionId: string | null;
  versionLabel: string;
  buildLabel: string | null;
}) {
  if (job.gameVersionId) {
    const byId = await prisma.gameVersion.findUnique({
      where: { id: job.gameVersionId },
    });
    if (byId) return byId;
  }
  return prisma.gameVersion.findFirst({
    where: {
      version: job.versionLabel,
      build: job.buildLabel ?? '',
    },
  });
}

async function writeSidecar(workspace: string, name: string, data: unknown) {
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, name), JSON.stringify(data, null, 2), 'utf8');
}

async function readSidecar(workspace: string, name: string): Promise<unknown> {
  const content = await readFile(path.join(workspace, name), 'utf8');
  return JSON.parse(content) as unknown;
}

async function maybeUploadIcon(
  iconsDir: string,
  iconRef: string,
  version: string,
  folder: string,
): Promise<string | null> {
  try {
    let filePath = path.isAbsolute(iconRef)
      ? iconRef
      : path.join(iconsDir, iconRef);

    try {
      await readFile(filePath);
    } catch {
      // Fallback: search by basename under iconsDir (e.g. Yakushima subfolder)
      const { readdir } = await import('node:fs/promises');
      const target = path.basename(iconRef);
      async function find(dir: string): Promise<string | null> {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const nested = await find(full);
            if (nested) return nested;
          } else if (entry.name === target || entry.name === path.basename(target)) {
            return full;
          }
        }
        return null;
      }
      const found = await find(iconsDir);
      if (!found) {
        if (iconRef.startsWith('http://') || iconRef.startsWith('https://')) {
          return iconRef;
        }
        return null;
      }
      filePath = found;
    }

    const buf = await readFile(filePath);
    const ext = path.extname(filePath) || '.png';
    const key = `icons/${version}/${folder}/${path.basename(filePath, ext)}${ext}`;
    const contentType =
      ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : 'image/png';
    return await uploadObject(key, buf, contentType);
  } catch {
    if (iconRef.startsWith('http://') || iconRef.startsWith('https://')) {
      return iconRef;
    }
    return null;
  }
}

export const importPipeline = new ImportPipeline();
