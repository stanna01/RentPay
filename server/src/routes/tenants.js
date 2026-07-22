import { Router } from 'express';
import { prisma } from '../db.js';

const router = Router();

function isValidEmail(email) {
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** GET /api/tenants?search= — list tenants (with current room if any). */
router.get('/', async (req, res) => {
  const search = String(req.query.search || '').trim();
  const tenants = await prisma.tenant.findMany({
    where: search
      ? {
          OR: [
            { name: { contains: search } },
            { phone: { contains: search } },
            { email: { contains: search } },
          ],
        }
      : undefined,
    include: { tenancies: { where: { moveOutDate: null }, include: { room: true } } },
    orderBy: { name: 'asc' },
  });
  res.json(
    tenants.map((t) => ({
      id: t.id,
      name: t.name,
      phone: t.phone,
      email: t.email,
      notes: t.notes,
      currentRoom: t.tenancies[0]?.roomNumber ?? null,
      currentTenancyId: t.tenancies[0]?.id ?? null,
    }))
  );
});

/** GET /api/tenants/:id */
router.get('/:id', async (req, res) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: Number(req.params.id) },
    include: { tenancies: { include: { room: true }, orderBy: { id: 'desc' } } },
  });
  if (!tenant) return res.status(404).json({ error: 'Tenant not found.' });
  res.json(tenant);
});

/** POST /api/tenants */
router.post('/', async (req, res) => {
  const { name, phone, email, notes } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Please enter the tenant name.' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  const tenant = await prisma.tenant.create({
    data: {
      name: String(name).trim(),
      phone: String(phone || '').trim(),
      email: String(email || '').trim().toLowerCase(),
      notes: String(notes || '').trim(),
    },
  });
  res.status(201).json(tenant);
});

/** PATCH /api/tenants/:id */
router.patch('/:id', async (req, res) => {
  const { name, phone, email, notes } = req.body || {};
  if (name != null && !String(name).trim()) {
    return res.status(400).json({ error: 'Name cannot be empty.' });
  }
  if (email != null && !isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  const data = {};
  if (name != null) data.name = String(name).trim();
  if (phone != null) data.phone = String(phone).trim();
  if (email != null) data.email = String(email).trim().toLowerCase();
  if (notes != null) data.notes = String(notes).trim();
  const tenant = await prisma.tenant.update({ where: { id: Number(req.params.id) }, data });
  res.json(tenant);
});

export default router;
