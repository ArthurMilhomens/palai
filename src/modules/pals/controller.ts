import type { FastifyReply, FastifyRequest } from 'fastify';
import { idOrSlugParamsSchema, listQuerySchema } from '../../shared/query.js';
import { resolveLocale } from '../../shared/i18n.js';
import { palsService } from './service.js';

export class PalsController {
  async list(request: FastifyRequest, reply: FastifyReply) {
    const query = listQuerySchema.parse(request.query);
    const lang = resolveLocale(request, query.lang);
    const result = await palsService.list({
      ...query,
      lang,
      acceptLanguage: request.headers['accept-language'],
    });
    return reply.send(result);
  }

  async get(request: FastifyRequest, reply: FastifyReply) {
    const { idOrSlug } = idOrSlugParamsSchema.parse(request.params);
    const query = listQuerySchema.pick({ gameVersion: true, lang: true }).parse(request.query);
    const lang = resolveLocale(request, query.lang);
    const data = await palsService.getByIdOrSlug(idOrSlug, {
      gameVersion: query.gameVersion,
      lang,
      acceptLanguage: request.headers['accept-language'],
    });
    return reply.send({ data });
  }

  async drops(request: FastifyRequest, reply: FastifyReply) {
    const { idOrSlug } = idOrSlugParamsSchema.parse(request.params);
    const query = listQuerySchema.pick({ gameVersion: true }).parse(request.query);
    const data = await palsService.getDrops(idOrSlug, query.gameVersion);
    return reply.send({ data });
  }

  async skills(request: FastifyRequest, reply: FastifyReply) {
    const { idOrSlug } = idOrSlugParamsSchema.parse(request.params);
    const query = listQuerySchema.pick({ gameVersion: true }).parse(request.query);
    const data = await palsService.getSkills(idOrSlug, query.gameVersion);
    return reply.send({ data });
  }

  async work(request: FastifyRequest, reply: FastifyReply) {
    const { idOrSlug } = idOrSlugParamsSchema.parse(request.params);
    const query = listQuerySchema.pick({ gameVersion: true }).parse(request.query);
    const data = await palsService.getWork(idOrSlug, query.gameVersion);
    return reply.send({ data });
  }

  async locations(request: FastifyRequest, reply: FastifyReply) {
    const { idOrSlug } = idOrSlugParamsSchema.parse(request.params);
    const query = listQuerySchema.pick({ gameVersion: true }).parse(request.query);
    const data = await palsService.getLocations(idOrSlug, query.gameVersion);
    return reply.send({ data });
  }
}

export const palsController = new PalsController();
