import { Router } from 'express';

import { query } from '../db.js';

const router = Router();

router.get('/', async (_request, response, next) => {
  try {
    const { rows } = await query(
      `
        SELECT
          providers.*,
          (
            SELECT COUNT(*)
            FROM provider_slots
            WHERE provider_id = providers.id
              AND is_available = TRUE
              AND slot_datetime >= NOW()
          )::int AS open_slots
        FROM providers
        ORDER BY specialty, name
      `
    );

    response.json(rows);
  } catch (error) {
    next(error);
  }
});

router.get('/:providerId/slots', async (request, response, next) => {
  try {
    const { providerId } = request.params;
    const limit = Number.parseInt(request.query.limit, 10) || 10;
    const days = Number.parseInt(request.query.days, 10);
    const includeUnavailable = request.query.includeUnavailable === 'true';
    const params = [providerId];
    let dateClause = '';
    let availabilityClause = 'AND is_available = TRUE';

    if (Number.isInteger(days) && days > 0) {
      params.push(days);
      dateClause = `AND slot_datetime < NOW() + ($${params.length} * INTERVAL '1 day')`;
    }

    if (includeUnavailable) {
      availabilityClause = '';
    }

    params.push(limit);

    const { rows } = await query(
      `
        SELECT id, provider_id, slot_datetime, is_available
        FROM provider_slots
        WHERE provider_id = $1
          ${availabilityClause}
          AND slot_datetime >= NOW()
          ${dateClause}
        ORDER BY slot_datetime
        LIMIT $${params.length}
      `,
      params
    );

    response.json(rows);
  } catch (error) {
    next(error);
  }
});

export default router;
