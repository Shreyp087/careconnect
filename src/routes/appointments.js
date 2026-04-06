import { Router } from 'express';

import { query } from '../db.js';
import { bookAppointment } from '../services/openai.js';
import { sendAppointmentConfirmation } from '../services/sendgrid.js';
import { sendAppointmentSMS } from '../services/twilio.js';

const router = Router();
const OFFICE_ADDRESS =
  process.env.OFFICE_ADDRESS || '123 Wellness Drive, Suite 400, Springfield';

const formatAppointmentDate = (value) =>
  new Date(value).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

const formatAppointmentTime = (value) =>
  new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });

const loadAppointmentDetails = async ({ appointmentId, sessionId }) => {
  if (!appointmentId && !sessionId) {
    throw new Error('appointmentId or sessionId is required.');
  }

  const field = appointmentId ? 'appointments.id' : 'appointments.session_id';
  const value = appointmentId || sessionId;

  const { rows } = await query(
    `
      SELECT
        appointments.*,
        providers.name AS provider_name,
        providers.specialty,
        provider_slots.slot_datetime
      FROM appointments
      JOIN providers
        ON providers.id = appointments.provider_id
      JOIN provider_slots
        ON provider_slots.id = appointments.slot_id
      WHERE ${field} = $1
      ORDER BY appointments.created_at DESC
      LIMIT 1
    `,
    [value]
  );

  if (!rows.length) {
    throw new Error('Appointment not found.');
  }

  return rows[0];
};

router.get('/', async (request, response, next) => {
  try {
    const { sessionId } = request.query;

    const params = [];
    let whereClause = '';

    if (sessionId) {
      params.push(sessionId);
      whereClause = 'WHERE appointments.session_id = $1';
    }

    const { rows } = await query(
      `
        SELECT
          appointments.*,
          providers.name AS provider_name,
          providers.specialty,
          provider_slots.slot_datetime
        FROM appointments
        JOIN providers
          ON providers.id = appointments.provider_id
        JOIN provider_slots
          ON provider_slots.id = appointments.slot_id
        ${whereClause}
        ORDER BY provider_slots.slot_datetime DESC
      `,
      params
    );

    response.json(rows);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (request, response, next) => {
  try {
    const payload = {
      session_id: request.body.sessionId || request.body.session_id,
      provider_id: request.body.providerId || request.body.provider_id,
      slot_id: request.body.slotId || request.body.slot_id,
      patient_first_name:
        request.body.patientFirstName || request.body.patient_first_name,
      patient_last_name: request.body.patientLastName || request.body.patient_last_name,
      patient_dob: request.body.patientDob || request.body.patient_dob,
      patient_phone: request.body.patientPhone || request.body.patient_phone,
      patient_email: request.body.patientEmail || request.body.patient_email,
      reason: request.body.reason,
      sms_opted_in:
        typeof request.body.smsOptedIn === 'boolean'
          ? request.body.smsOptedIn
          : Boolean(request.body.sms_opted_in)
    };

    const appointment = await bookAppointment(payload);

    if (appointment?.error) {
      if (appointment.error === 'missing_fields' || appointment.error === 'invalid_dob') {
        return response.status(400).json(appointment);
      }

      if (appointment.error === 'session_not_found') {
        return response.status(404).json(appointment);
      }

      if (
        appointment.error === 'slot_taken' ||
        appointment.error === 'slot_not_found' ||
        appointment.error === 'duplicate_appointment'
      ) {
        return response.status(409).json(appointment);
      }

      return response.status(400).json(appointment);
    }

    response.status(201).json({
      id: appointment.appointment_id,
      ...appointment
    });
  } catch (error) {
    if (
      error.message ===
      'slot_id, provider_id, patient_first_name, patient_last_name, and session_id are required.'
    ) {
      return response.status(400).json({ error: error.message });
    }

    if (error.message === 'Session not found.') {
      return response.status(404).json({ error: error.message });
    }

    if (error.code === 'invalid_dob') {
      return response.status(400).json({ error: error.message });
    }

    if (
      error.code === 'slot_unavailable' ||
      error.code === 'duplicate_appointment' ||
      error.message === 'The selected appointment slot is no longer available.'
    ) {
      return response.status(409).json({ error: error.message });
    }

    return next(error);
  }
});

router.post('/confirm-email', async (request, response, next) => {
  try {
    const appointment = await loadAppointmentDetails({
      appointmentId: request.body.appointmentId || request.body.appointment_id,
      sessionId: request.body.sessionId || request.body.session_id
    });

    const result = await sendAppointmentConfirmation({
      to: appointment.patient_email,
      patientName: appointment.patient_first_name,
      doctorName: appointment.provider_name,
      specialty: appointment.specialty,
      appointmentDate: formatAppointmentDate(appointment.slot_datetime),
      appointmentTime: formatAppointmentTime(appointment.slot_datetime),
      address: OFFICE_ADDRESS
    });

    response.json({
      appointmentId: appointment.id,
      ...result
    });
  } catch (error) {
    if (
      error.message === 'appointmentId or sessionId is required.' ||
      error.message === 'Appointment not found.'
    ) {
      return response.status(400).json({ error: error.message });
    }

    return next(error);
  }
});

router.post('/confirm-sms', async (request, response, next) => {
  try {
    const appointment = await loadAppointmentDetails({
      appointmentId: request.body.appointmentId || request.body.appointment_id,
      sessionId: request.body.sessionId || request.body.session_id
    });

    if (!appointment.sms_opted_in) {
      return response.json({
        appointmentId: appointment.id,
        skipped: true,
        reason: 'Patient did not opt in to SMS.'
      });
    }

    const result = await sendAppointmentSMS({
      to: appointment.patient_phone,
      patientName: appointment.patient_first_name,
      doctorName: appointment.provider_name,
      appointmentDate: formatAppointmentDate(appointment.slot_datetime),
      appointmentTime: formatAppointmentTime(appointment.slot_datetime)
    });

    response.json({
      appointmentId: appointment.id,
      ...result
    });
  } catch (error) {
    if (
      error.message === 'appointmentId or sessionId is required.' ||
      error.message === 'Appointment not found.'
    ) {
      return response.status(400).json({ error: error.message });
    }

    return next(error);
  }
});

export default router;
