import { Router } from 'express';
import { prisma } from '../db.js';
import { requireRole, ROLES } from '../auth.js';
import { propertyFilter, resolvePropertyId, loadTenant, assertPropertyAccess } from '../access.js';
import { audit } from '../audit.js';
import { parse, z, text, optionalEmail, email } from '../validate.js';
import { httpError } from '../httpError.js';

const router = Router();

const tenantFields = {
  name: text().min(1, 'Please enter the tenant name.'),
  phone: text(50).optional().default(''),
  email: optionalEmail(),
  notes: text(191).optional().default(''),
};

/** GET /api/tenants?search=&propertyId= — tenants the user may see (with current room). */
router.get('/', async (req, res) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  const filter = await propertyFilter(req);
  let propertyId;
  if (req.query.propertyId) {
    propertyId = Number(req.query.propertyId);
    await assertPropertyAccess(req, propertyId);
  }
  const tenants = await prisma.tenant.findMany({
    where: {
      deletedAt: null,
      propertyId: propertyId ?? (filter.in ? filter : undefined),
      ...(search
        ? { OR: [{ name: { contains: search } }, { phone: { contains: search } }, { email: { contains: search } }] }
        : {}),
    },
    include: { tenancies: { where: { moveOutDate: null }, include: { room: true } } },
    orderBy: { name: 'asc' },
    take: 500,
  });
  res.json(
    tenants.map((t) => ({
      id: t.id,
      propertyId: t.propertyId,
      name: t.name,
      phone: t.phone,
      email: t.email,
      notes: t.notes,
      currentRoom: t.tenancies[0]?.room.number ?? null,
      currentTenancyId: t.tenancies[0]?.id ?? null,
    }))
  );
});

router.get('/:id', async (req, res) => {
  const tenant = await loadTenant(req, req.params.id);
  const tenancies = await prisma.tenancy.findMany({
    where: { tenantId: tenant.id },
    include: { room: true },
    orderBy: { id: 'desc' },
  });
  res.json({ ...tenant, tenancies });
});

router.post('/', async (req, res) => {
  const propertyId = await resolvePropertyId(req);
  const body = parse(z.object(tenantFields), req.body);
  const tenant = await prisma.tenant.create({ data: { propertyId, ...body } });
  await audit(req, 'tenant.create', { type: 'tenant', id: tenant.id, after: tenant });
  res.status(201).json(tenant);
});

router.patch('/:id', async (req, res) => {
  const tenant = await loadTenant(req, req.params.id);
  const body = parse(
    z.object({
      name: tenantFields.name.optional(),
      phone: text(50).optional(),
      email: z.union([z.literal(''), email()]).optional(),
      notes: text(191).optional(),
    }),
    req.body
  );
  const updated = await prisma.tenant.update({ where: { id: tenant.id }, data: body });
  await audit(req, 'tenant.update', { type: 'tenant', id: tenant.id, before: tenant, after: updated });
  res.json(updated);
});

/**
 * DELETE /api/tenants/:id — admin: remove a tenant from all lists. Their
 * tenancies, payments and receipts are KEPT (financial records); the tenant
 * row is soft-deleted.
 */
router.delete('/:id', requireRole(ROLES.ADMIN), async (req, res) => {
  const tenant = await loadTenant(req, req.params.id);
  const current = await prisma.tenancy.count({ where: { tenantId: tenant.id, moveOutDate: null } });
  if (current) throw httpError(409, 'Move this tenant out before deleting them.');
  await prisma.$transaction([
    prisma.tenant.update({ where: { id: tenant.id }, data: { deletedAt: new Date() } }),
    // Hide their past tenancies from the Past Tenants list too.
    prisma.tenancy.updateMany({ where: { tenantId: tenant.id, archivedAt: null }, data: { archivedAt: new Date() } }),
  ]);
  await audit(req, 'tenant.delete', { type: 'tenant', id: tenant.id, before: tenant });
  res.json({ ok: true });
});

export default router;
