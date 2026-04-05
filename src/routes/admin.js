import { Router } from 'express';

import pool, { query } from '../db.js';

const router = Router();

// In production, these admin routes should be protected by authentication and role checks.

const ACTIVE_APPOINTMENT_CONDITION = `appointments.status <> 'cancelled'`;

const groupProvidersWithSlots = (rows) => {
  const providers = new Map();

  rows.forEach((row) => {
    if (!providers.has(row.provider_id)) {
      providers.set(row.provider_id, {
        id: row.provider_id,
        name: row.provider_name,
        specialty: row.provider_specialty,
        bio: row.provider_bio,
        slots: []
      });
    }

    if (!row.slot_id) {
      return;
    }

    if (!row.slot_is_available && !row.appointment_id) {
      return;
    }

    providers.get(row.provider_id).slots.push({
      id: row.slot_id,
      provider_id: row.provider_id,
      slot_datetime: row.slot_datetime,
      status: row.appointment_id ? 'Booked' : 'Available',
      is_available: row.slot_is_available,
      appointment_id: row.appointment_id,
      appointment_status: row.appointment_status,
      patient_name:
        row.patient_first_name && row.patient_last_name
          ? `${row.patient_first_name} ${row.patient_last_name}`
          : null
    });
  });

  return Array.from(providers.values());
};

const fetchProvidersWithSlots = async () => {
  const { rows } = await query(
    `
      SELECT
        providers.id AS provider_id,
        providers.name AS provider_name,
        providers.specialty AS provider_specialty,
        providers.bio AS provider_bio,
        provider_slots.id AS slot_id,
        provider_slots.slot_datetime,
        provider_slots.is_available AS slot_is_available,
        active_appointments.id AS appointment_id,
        active_appointments.status AS appointment_status,
        active_appointments.patient_first_name,
        active_appointments.patient_last_name
      FROM providers
      LEFT JOIN provider_slots
        ON provider_slots.provider_id = providers.id
       AND provider_slots.slot_datetime >= NOW()
       AND provider_slots.slot_datetime < NOW() + INTERVAL '14 days'
      LEFT JOIN LATERAL (
        SELECT
          appointments.id,
          appointments.status,
          appointments.patient_first_name,
          appointments.patient_last_name
        FROM appointments
        WHERE appointments.slot_id = provider_slots.id
          AND ${ACTIVE_APPOINTMENT_CONDITION}
        ORDER BY appointments.created_at DESC
        LIMIT 1
      ) AS active_appointments
        ON TRUE
      ORDER BY providers.specialty, providers.name, provider_slots.slot_datetime
    `
  );

  return groupProvidersWithSlots(rows);
};

router.get('/providers', async (_request, response, next) => {
  try {
    const providers = await fetchProvidersWithSlots();
    response.json({
      providers,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

router.post('/slots', async (request, response, next) => {
  try {
    const { provider_id, slot_datetime } = request.body;

    if (!provider_id || !slot_datetime) {
      return response
        .status(400)
        .json({ error: 'provider_id and slot_datetime are required.' });
    }

    const existingSlot = await query(
      `
        SELECT id
        FROM provider_slots
        WHERE provider_id = $1
          AND slot_datetime = $2
        LIMIT 1
      `,
      [provider_id, slot_datetime]
    );

    if (existingSlot.rows.length) {
      return response
        .status(409)
        .json({ error: 'A slot already exists for that provider at that time.' });
    }

    const { rows } = await query(
      `
        INSERT INTO provider_slots (provider_id, slot_datetime, is_available)
        VALUES ($1, $2, TRUE)
        RETURNING *
      `,
      [provider_id, slot_datetime]
    );

    return response.status(201).json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.patch('/slots/:slotId', async (request, response, next) => {
  try {
    const { slotId } = request.params;
    const { is_available } = request.body;

    if (typeof is_available !== 'boolean') {
      return response.status(400).json({ error: 'is_available must be a boolean.' });
    }

    const slotResult = await query(
      `
        SELECT *
        FROM provider_slots
        WHERE id = $1
      `,
      [slotId]
    );

    if (!slotResult.rows.length) {
      return response.status(404).json({ error: 'Slot not found.' });
    }

    const activeAppointment = await query(
      `
        SELECT id
        FROM appointments
        WHERE slot_id = $1
          AND ${ACTIVE_APPOINTMENT_CONDITION}
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [slotId]
    );

    if (activeAppointment.rows.length) {
      return response.status(409).json({
        error: 'This slot already has an active appointment. Cancel the booking instead.'
      });
    }

    const { rows } = await query(
      `
        UPDATE provider_slots
        SET is_available = $2
        WHERE id = $1
        RETURNING *
      `,
      [slotId, is_available]
    );

    return response.json(rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.delete('/slots/:slotId', async (request, response, next) => {
  try {
    const { slotId } = request.params;

    const slotResult = await query(
      `
        SELECT id
        FROM provider_slots
        WHERE id = $1
      `,
      [slotId]
    );

    if (!slotResult.rows.length) {
      return response.status(404).json({ error: 'Slot not found.' });
    }

    const appointmentHistory = await query(
      `
        SELECT id
        FROM appointments
        WHERE slot_id = $1
        LIMIT 1
      `,
      [slotId]
    );

    if (appointmentHistory.rows.length) {
      return response.status(409).json({
        error: 'This slot has appointment history and cannot be removed.'
      });
    }

    await query(
      `
        DELETE FROM provider_slots
        WHERE id = $1
      `,
      [slotId]
    );

    return response.status(204).send();
  } catch (error) {
    return next(error);
  }
});

router.get('/appointments', async (_request, response, next) => {
  try {
    const { rows } = await query(
      `
        SELECT
          appointments.id,
          appointments.session_id,
          appointments.provider_id,
          appointments.slot_id,
          appointments.patient_first_name,
          appointments.patient_last_name,
          appointments.patient_phone,
          appointments.patient_email,
          appointments.reason,
          appointments.sms_opted_in,
          appointments.status,
          appointments.created_at,
          providers.name AS provider_name,
          providers.specialty,
          provider_slots.slot_datetime
        FROM appointments
        JOIN providers
          ON providers.id = appointments.provider_id
        JOIN provider_slots
          ON provider_slots.id = appointments.slot_id
        ORDER BY provider_slots.slot_datetime DESC, appointments.created_at DESC
      `
    );

    response.json({
      appointments: rows,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/appointments/:id', async (request, response, next) => {
  const client = await pool.connect();

  try {
    const { id } = request.params;
    const { status } = request.body;

    if (!status) {
      return response.status(400).json({ error: 'status is required.' });
    }

    await client.query('BEGIN');

    const appointmentResult = await client.query(
      `
        SELECT *
        FROM appointments
        WHERE id = $1
        FOR UPDATE
      `,
      [id]
    );

    if (!appointmentResult.rows.length) {
      await client.query('ROLLBACK');
      return response.status(404).json({ error: 'Appointment not found.' });
    }

    const appointment = appointmentResult.rows[0];

    const updatedAppointmentResult = await client.query(
      `
        UPDATE appointments
        SET status = $2
        WHERE id = $1
        RETURNING *
      `,
      [id, status]
    );

    if (status.toLowerCase() === 'cancelled') {
      const otherActiveAppointments = await client.query(
        `
          SELECT id
          FROM appointments
          WHERE slot_id = $1
            AND id <> $2
            AND ${ACTIVE_APPOINTMENT_CONDITION}
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [appointment.slot_id, appointment.id]
      );

      if (!otherActiveAppointments.rows.length) {
        await client.query(
          `
            UPDATE provider_slots
            SET is_available = TRUE
            WHERE id = $1
          `,
          [appointment.slot_id]
        );
      }

      await client.query(
        `
          UPDATE sessions
          SET appointment_id = NULL, updated_at = NOW()
          WHERE id = $1
            AND appointment_id = $2
        `,
        [appointment.session_id, appointment.id]
      );
    } else {
      await client.query(
        `
          UPDATE provider_slots
          SET is_available = FALSE
          WHERE id = $1
        `,
        [appointment.slot_id]
      );
    }

    await client.query('COMMIT');

    return response.json(updatedAppointmentResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    return next(error);
  } finally {
    client.release();
  }
});

export default router;
