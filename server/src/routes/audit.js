// The audit log, read-only. A landlord reads their own business's entries at
// GET /api/audit; the super admin reads everything at GET /api/admin/audit
// (optionally one landlord with ?organizationId=).

import { Router } from 'express';
import { prisma } from '../db.js';
import { parse, z, text, id } from '../validate.js';

const PAGE = 50;

/** One page of audit entries, newest first, limited to `scope` (a Prisma where fragment). */
export async function auditPage(query, scope = {}) {
  const q = parse(
    z.object({
      action: text(100).optional(),
      entityType: text(50).optional(),
      entityId: text(50).optional(),
      userId: id().optional(),
      organizationId: id().optional(),
      page: z.coerce.number().int().min(1).max(10000).optional().default(1),
    }),
    query
  );
  const where = {};
  if (q.action) where.action = { startsWith: q.action };
  if (q.entityType) where.entityType = q.entityType;
  if (q.entityId) where.entityId = q.entityId;
  if (q.userId) where.userId = q.userId;
  if (q.organizationId) where.organizationId = q.organizationId;
  Object.assign(where, scope); // the caller's scope always wins over the query
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: { select: { email: true, name: true } } },
      orderBy: { id: 'desc' },
      skip: (q.page - 1) * PAGE,
      take: PAGE,
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total, page: q.page, pageSize: PAGE };
}

const router = Router();

router.get('/', async (req, res) => {
  res.json(await auditPage(req.query, { organizationId: req.user.organizationId }));
});

export default router;
