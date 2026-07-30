import {
  cacheGet,
  cacheKey,
  cacheSet,
} from '../../shared/cache.js';
import type { ListQuery } from '../../shared/query.js';
import { palsRepository } from './repository.js';

export class PalsService {
  async list(query: ListQuery) {
    const key = cacheKey({ route: 'pals:list', ...query });
    const cached = await cacheGet<Awaited<ReturnType<typeof palsRepository.list>>>(key);
    if (cached) return cached;
    const result = await palsRepository.list(query);
    await cacheSet(key, result);
    return result;
  }

  getByIdOrSlug(idOrSlug: string, gameVersion?: string) {
    return palsRepository.findByIdOrSlug(idOrSlug, gameVersion);
  }

  getDrops(idOrSlug: string, gameVersion?: string) {
    return palsRepository.drops(idOrSlug, gameVersion);
  }

  getSkills(idOrSlug: string, gameVersion?: string) {
    return palsRepository.skills(idOrSlug, gameVersion);
  }

  getWork(idOrSlug: string, gameVersion?: string) {
    return palsRepository.work(idOrSlug, gameVersion);
  }

  getLocations(idOrSlug: string, gameVersion?: string) {
    return palsRepository.locations(idOrSlug, gameVersion);
  }
}

export const palsService = new PalsService();
