// Request validation with zod. Each route declares the shape it accepts; bad
// input gets a clear 400 message instead of reaching the database.

import { z } from 'zod';
import { badRequest } from './httpError.js';

export { z };

/** Parse `data` with `schema` or throw a 400 with the first problem's message. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(issue?.message || 'That request was not valid.');
  }
  return result.data;
}

// --- Reusable field schemas -------------------------------------------------
export const email = (msg = 'Please enter a valid email address.') =>
  z.string().trim().toLowerCase().max(191, msg).email(msg);

/** Optional email: "" is allowed and means "none". */
export const optionalEmail = () =>
  z.union([z.literal(''), email()]).optional().default('');

export const text = (max = 191) => z.string().trim().max(max, `Please keep this under ${max} characters.`);

/** Integer ngwee amount ≥ 0 (accepts numeric strings). */
export const ngwee = (msg = 'Please enter a valid amount.') =>
  z.coerce.number({ error: msg }).int(msg).min(0, msg).max(1_000_000_000, msg);

/** A calendar date (YYYY-MM-DD or ISO string) that parses to a real Date. */
export const date = (msg = 'Please enter a valid date.') =>
  z
    .union([z.string(), z.date()])
    .transform((v) => new Date(v))
    .refine((d) => !Number.isNaN(d.getTime()) && d.getFullYear() >= 2000 && d.getFullYear() <= 2100, msg);

export const id = (msg = 'Invalid id.') => z.coerce.number().int(msg).positive(msg);

export const reason = () =>
  z.string({ error: 'Please give a reason.' }).trim().min(3, 'Please give a reason (at least 3 characters).').max(191, 'Please keep the reason under 191 characters.');
