import { Client } from '@opensearch-project/opensearch';
import { env } from '../config/env.js';
import { prisma } from '../prisma/client.js';

let client: Client | null = null;

export function getOpenSearch(): Client {
  if (!client) {
    client = new Client({ node: env().OPENSEARCH_NODE });
  }
  return client;
}

export const SEARCH_ALIAS = 'palai-current';

export type SearchDocument = {
  id: string;
  entityType: string;
  name: string;
  description?: string | null;
  aliases: string[];
  category: string;
  rarity?: number | null;
  element?: string[];
  biome?: string | null;
  level?: number | null;
  work?: string[];
  gameVersionId: string;
};

export async function ensureSearchIndex(indexName: string): Promise<void> {
  const os = getOpenSearch();
  const exists = await os.indices.exists({ index: indexName });
  if (exists.body) return;
  await os.indices.create({
    index: indexName,
    body: {
      settings: {
        analysis: {
          analyzer: {
            autocomplete: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase', 'autocomplete_filter'],
            },
            autocomplete_search: {
              type: 'custom',
              tokenizer: 'standard',
              filter: ['lowercase'],
            },
          },
          filter: {
            autocomplete_filter: {
              type: 'edge_ngram',
              min_gram: 2,
              max_gram: 20,
            },
          },
        },
      },
      mappings: {
        properties: {
          id: { type: 'keyword' },
          entityType: { type: 'keyword' },
          name: {
            type: 'text',
            analyzer: 'autocomplete',
            search_analyzer: 'autocomplete_search',
            fields: { keyword: { type: 'keyword' } },
          },
          description: { type: 'text' },
          aliases: {
            type: 'text',
            analyzer: 'autocomplete',
            search_analyzer: 'autocomplete_search',
          },
          category: { type: 'keyword' },
          rarity: { type: 'integer' },
          element: { type: 'keyword' },
          biome: { type: 'keyword' },
          level: { type: 'integer' },
          work: { type: 'keyword' },
          gameVersionId: { type: 'keyword' },
        },
      },
    },
  });
}

export async function reindexGameVersion(gameVersionId: string): Promise<number> {
  const indexName = `palai-${gameVersionId.toLowerCase()}`;
  const os = getOpenSearch();
  await ensureSearchIndex(indexName);

  const docs: SearchDocument[] = [];

  const pals = await prisma.pal.findMany({
    where: { gameVersionId },
    include: {
      elements: { include: { element: true } },
      workSuitabilities: { include: { workSuitability: true } },
    },
  });
  for (const pal of pals) {
    docs.push({
      id: pal.id,
      entityType: 'pal',
      name: pal.name,
      description: pal.description,
      aliases: [pal.internalName],
      category: 'pal',
      rarity: pal.rarity,
      element: pal.elements.map((e) => e.element.name),
      work: pal.workSuitabilities.map((w) => w.workSuitability.type),
      gameVersionId,
    });
  }

  const items = await prisma.item.findMany({ where: { gameVersionId } });
  for (const item of items) {
    docs.push({
      id: item.id,
      entityType: 'item',
      name: item.name,
      description: item.description,
      aliases: [item.internalName],
      category: 'item',
      rarity: item.rarity,
      gameVersionId,
    });
  }

  const skills = await prisma.skill.findMany({
    where: { gameVersionId },
    include: { element: true },
  });
  for (const skill of skills) {
    docs.push({
      id: skill.id,
      entityType: 'skill',
      name: skill.name,
      description: skill.description,
      aliases: [skill.internalName],
      category: 'skill',
      element: skill.element ? [skill.element.name] : [],
      gameVersionId,
    });
  }

  const passives = await prisma.passiveSkill.findMany({ where: { gameVersionId } });
  for (const passive of passives) {
    docs.push({
      id: passive.id,
      entityType: 'passive',
      name: passive.name,
      description: passive.description,
      aliases: [passive.internalName],
      category: 'passive',
      rarity: passive.rarity,
      gameVersionId,
    });
  }

  const locations = await prisma.location.findMany({ where: { gameVersionId } });
  for (const location of locations) {
    docs.push({
      id: location.id,
      entityType: 'location',
      name: location.name,
      description: null,
      aliases: [location.internalName],
      category: 'location',
      biome: location.biome,
      level: location.level,
      gameVersionId,
    });
  }

  if (docs.length > 0) {
    const body = docs.flatMap((doc) => [
      { index: { _index: indexName, _id: `${doc.entityType}:${doc.id}` } },
      doc,
    ]);
    await os.bulk({ refresh: true, body });
  }

  const aliasExists = await os.indices.existsAlias({ name: SEARCH_ALIAS }).catch(() => ({
    body: false,
  }));
  const actions: Array<Record<string, unknown>> = [
    { add: { index: indexName, alias: SEARCH_ALIAS } },
  ];
  if (aliasExists.body) {
    const current = await os.indices.getAlias({ name: SEARCH_ALIAS });
    for (const idx of Object.keys(current.body)) {
      if (idx !== indexName) {
        actions.unshift({ remove: { index: idx, alias: SEARCH_ALIAS } });
      }
    }
  }
  await os.indices.updateAliases({ body: { actions } });
  return docs.length;
}

export async function searchDocuments(params: {
  q: string;
  category?: string;
  element?: string;
  rarity?: number;
  type?: string;
  level?: number;
  biome?: string;
  work?: string;
  from?: number;
  size?: number;
}) {
  const os = getOpenSearch();
  const filters: object[] = [];
  if (params.category || params.type) {
    filters.push({ term: { category: params.category ?? params.type } });
  }
  if (params.element) filters.push({ term: { element: params.element } });
  if (params.rarity !== undefined) filters.push({ term: { rarity: params.rarity } });
  if (params.level !== undefined) filters.push({ term: { level: params.level } });
  if (params.biome) filters.push({ term: { biome: params.biome } });
  if (params.work) filters.push({ term: { work: params.work } });

  const result = await os.search({
    index: SEARCH_ALIAS,
    body: {
      from: params.from ?? 0,
      size: params.size ?? 20,
      query: {
        bool: {
          must: params.q
            ? [
                {
                  multi_match: {
                    query: params.q,
                    fields: ['name^3', 'aliases^2', 'description'],
                    fuzziness: 'AUTO',
                  },
                },
              ]
            : [{ match_all: {} }],
          filter: filters,
        },
      },
      suggest: params.q
        ? {
            name_suggest: {
              prefix: params.q,
              completion: undefined,
              text: params.q,
              term: {
                field: 'name',
              },
            },
          }
        : undefined,
    },
  });

  const hits = (
    result.body.hits.hits as unknown as Array<{
      _source: SearchDocument;
      _score: number;
    }>
  ).map((hit) => ({
      ...hit._source,
      score: hit._score,
    }));

  return {
    data: hits,
    meta: {
      total:
        typeof result.body.hits.total === 'number'
          ? result.body.hits.total
          : result.body.hits.total?.value ?? hits.length,
      from: params.from ?? 0,
      size: params.size ?? 20,
    },
  };
}
