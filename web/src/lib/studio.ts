import { z } from "zod";

export const alertQuerySchema = z.object({
  severity: z.string().optional().default(""),
  ruleId: z.string().optional().default(""),
  q: z.string().optional().default(""),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export const caseQuerySchema = z.object({
  tier: z.string().optional().default(""),
  status: z.string().optional().default(""),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});

export const entityQuerySchema = z.object({
  q: z.string().optional().default(""),
  kind: z.string().optional().default("customer"),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

export const graphQuerySchema = z.object({
  source: z.string().optional().default(""),
  target: z.string().optional().default(""),
  ego: z.string().optional().default(""),
  depth: z.coerce.number().int().min(1).max(4).optional().default(2),
});

export const simulateRequestSchema = z.object({
  seed: z.number().int().min(1).max(999999).optional().default(7),
  days: z.number().int().min(7).max(60).optional().default(21),
  customers: z.number().int().min(6).max(48).optional().default(12),
  mu: z.number().min(4).max(9).optional().default(6.2),
  sigma: z.number().min(0.2).max(1.6).optional().default(0.85),
  seasonality: z.number().min(0).max(1).optional().default(0.35),
  nightShare: z.number().min(0).max(0.6).optional().default(0.12),
  fxVol: z.number().min(0).max(0.15).optional().default(0.02),
  intensity: z.number().min(0).max(1).optional().default(0.55),
  camouflage: z.number().min(0).max(1).optional().default(0),
  focusCity: z.string().optional().default(""),
  preset: z.string().optional().default(""),
  structuring: z.boolean().optional().default(true),
  layering: z.boolean().optional().default(true),
  mules: z.boolean().optional().default(true),
  trade: z.boolean().optional().default(true),
  offramp: z.boolean().optional().default(true),
  roundTrip: z.boolean().optional().default(true),
  funnel: z.boolean().optional().default(false),
  rapid: z.boolean().optional().default(false),
  professional: z.boolean().optional().default(false),
  payroll: z.boolean().optional().default(true),
  rent: z.boolean().optional().default(true),
});

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(20)
    .optional()
    .default([]),
});

export function queryParams(request: Request) {
  return Object.fromEntries(new URL(request.url).searchParams.entries());
}
