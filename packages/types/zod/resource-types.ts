import { z } from 'zod';

export const zResourceUnit = z.enum(['ru', 'mu', 'eu', 'vu']);

export const zResourceBudget = z.object({
  ru: z.number().nonnegative(),
  mu: z.number().nonnegative(),
  eu: z.number().nonnegative(),
  vu: z.number().nonnegative(),
});

export const zResourceConsumption = z.object({
  ru: z.number().nonnegative(),
  mu: z.number().nonnegative(),
  eu: z.number().nonnegative(),
  vu: z.number().nonnegative(),
});