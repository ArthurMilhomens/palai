import { z } from 'zod';

export const registerBodyDto = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const loginBodyDto = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const tokensDto = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.string(),
});

export type RegisterBodyDto = z.infer<typeof registerBodyDto>;
export type LoginBodyDto = z.infer<typeof loginBodyDto>;
export type TokensDto = z.infer<typeof tokensDto>;
