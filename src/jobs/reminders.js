import dotenv from 'dotenv';
import cron from 'node-cron';

import { query } from '../db.js';
import { sendAppointmentReminder } from '../services/sendgrid.js';
import { sendAppointmentSMS } from '../services/twilio.js';
import { logger } from '../utils/logger.js';

dotenv.config();

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

export const runAppointmentReminders = async () => {
  const { rows } = await query(
    `
      SELECT
        appointments.id,
        appointments.patient_first_name,
        appointments.patient_email,
        appointments.patient_phone,
        appointments.sms_opted_in,
        appointments.status,
        providers.name AS provider_name,
        provider_slots.slot_datetime
      FROM appointments
      JOIN provider_slots
        ON provider_slots.id = appointments.slot_id
      JOIN providers
        ON providers.id = appointments.provider_id
      WHERE provider_slots.slot_datetime BETWEEN NOW() + INTERVAL '23 hours' AND NOW() + INTERVAL '25 hours'
        AND appointments.status = 'confirmed'
      ORDER BY provider_slots.slot_datetime
    `
  );

  if (!rows.length) {
    logger.info('[reminders] No appointments due for reminder delivery.');
    return {
      processed: 0,
      emailed: 0,
      smsSent: 0
    };
  }

  let emailed = 0;
  let smsSent = 0;

  for (const appointment of rows) {
    const appointmentDate = formatAppointmentDate(appointment.slot_datetime);
    const appointmentTime = formatAppointmentTime(appointment.slot_datetime);

    try {
      const emailResult = await sendAppointmentReminder({
        to: appointment.patient_email,
        patientName: appointment.patient_first_name,
        doctorName: appointment.provider_name,
        appointmentDate,
        appointmentTime
      });

      if (emailResult.sent) {
        emailed += 1;
      }

      logger.info(
        `[reminders] Email ${emailResult.sent ? 'sent' : 'skipped'} for appointment ${appointment.id}.`
      );
    } catch (error) {
      logger.error(
        `[reminders] Email failed for appointment ${appointment.id}: ${error.message}`
      );
    }

    if (!appointment.sms_opted_in) {
      continue;
    }

    try {
      const smsResult = await sendAppointmentSMS({
        to: appointment.patient_phone,
        patientName: appointment.patient_first_name,
        doctorName: appointment.provider_name,
        appointmentDate,
        appointmentTime
      });

      if (smsResult.sent) {
        smsSent += 1;
      }

      logger.info(
        `[reminders] SMS ${smsResult.sent ? 'sent' : 'skipped'} for appointment ${appointment.id}.`
      );
    } catch (error) {
      logger.error(
        `[reminders] SMS failed for appointment ${appointment.id}: ${error.message}`
      );
    }
  }

  return {
    processed: rows.length,
    emailed,
    smsSent
  };
};

export const startReminderJob = () => {
  const cronEnabled = String(process.env.CRON_ENABLED ?? 'true').toLowerCase() === 'true';

  if (!cronEnabled) {
    logger.info('[reminders] Reminder cron is disabled.');
    return null;
  }

  const task = cron.schedule('0 8 * * *', () => {
    runAppointmentReminders()
      .then((result) => {
        logger.info(
          `[reminders] Daily run complete. Processed ${result.processed}, emailed ${result.emailed}, sent ${result.smsSent} SMS reminders.`
        );
      })
      .catch((error) => {
        logger.error('[reminders] Daily reminder run failed:', error.message);
      });
  });

  logger.info('[reminders] Daily reminder cron scheduled for 8:00 AM.');
  return task;
};
