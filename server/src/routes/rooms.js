import { Router } from 'express';
import { prisma } from '../db.js';
import { appliedByMonth } from '../tenancyService.js';
import { roomTileStatus } from '../status.js';

const router = Router();
const BEDS = ['A', 'B'];

/**
 * GET /api/rooms?month=&year=
 * Returns all 24 rooms, each with its two beds (A/B) and derived status for the
 * given month (default: current). Summary counts are per bed (out of 48).
 */
router.get('/', async (req, res) => {
  const now = new Date();
  const month = Number(req.query.month) || now.getMonth() + 1;
  const year = Number(req.query.year) || now.getFullYear();

  const rooms = await prisma.room.findMany({ orderBy: { number: 'asc' } });
  const tenancies = await prisma.tenancy.findMany({
    where: { moveOutDate: null },
    include: { tenant: true },
  });
  const byBed = new Map(tenancies.map((t) => [`${t.roomNumber}-${t.bed}`, t]));

  const key = `${year}-${month}`;
  const totalBeds = rooms.length * BEDS.length;
  let occupied = 0;
  let collected = 0;
  let outstanding = 0;

  const roomTiles = [];
  for (const room of rooms) {
    const beds = [];
    for (const bed of BEDS) {
      const tenancy = byBed.get(`${room.number}-${bed}`);
      if (!tenancy) {
        beds.push({
          bed,
          roomNumber: room.number,
          roomLabel: `${room.number}${bed}`,
          defaultRent: room.defaultRent,
          status: 'VACANT',
          tenantFirstName: null,
          tenantName: null,
          tenantId: null,
          tenancyId: null,
          balance: 0,
        });
        continue;
      }
      occupied += 1;
      const { applied, expected } = await appliedByMonth(tenancy.id);
      const exp = expected.has(key) ? expected.get(key) : tenancy.monthlyRent;
      const st = roomTileStatus({
        hasCurrentTenancy: true,
        applied: applied.get(key) || 0,
        expected: exp,
      });
      collected += st.applied;
      outstanding += st.balance;
      beds.push({
        bed,
        roomNumber: room.number,
        roomLabel: `${room.number}${bed}`,
        defaultRent: room.defaultRent,
        status: st.status,
        balance: st.balance,
        tenantFirstName: tenancy.tenant.name.split(' ')[0],
        tenantName: tenancy.tenant.name,
        tenantId: tenancy.tenantId,
        tenancyId: tenancy.id,
      });
    }
    roomTiles.push({ number: room.number, defaultRent: room.defaultRent, beds });
  }

  res.json({
    month,
    year,
    summary: {
      totalBeds,
      occupied,
      vacant: totalBeds - occupied,
      collected,
      outstanding,
    },
    rooms: roomTiles,
  });
});

/** GET /api/rooms/:number/:bed — single bed + its current tenancy. */
router.get('/:number/:bed', async (req, res) => {
  const number = Number(req.params.number);
  const bed = String(req.params.bed).toUpperCase();
  const room = await prisma.room.findUnique({ where: { number } });
  if (!room || !BEDS.includes(bed)) return res.status(404).json({ error: 'Bed not found.' });
  const tenancy = await prisma.tenancy.findFirst({
    where: { roomNumber: number, bed, moveOutDate: null },
    include: { tenant: true },
  });
  res.json({ room, bed, roomLabel: `${number}${bed}`, tenancy });
});

/** PATCH /api/rooms/:number — update default rent (ngwee). */
router.patch('/:number', async (req, res) => {
  const number = Number(req.params.number);
  const { defaultRent } = req.body || {};
  if (defaultRent == null || defaultRent < 0) {
    return res.status(400).json({ error: 'Please enter a valid rent amount.' });
  }
  const room = await prisma.room.update({
    where: { number },
    data: { defaultRent: Math.round(defaultRent) },
  });
  res.json(room);
});

export default router;
