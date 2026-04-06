import dotenv from 'dotenv';
import twilio from 'twilio';

dotenv.config();

const PRACTICE_ADDRESS =
  process.env.OFFICE_ADDRESS || '123 Wellness Drive, Suite 400, Springfield';

const isConfigured = () =>
  Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER
  );

const getTwilioClient = () =>
  twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

export const sendAppointmentSMS = async ({
  to,
  patientName,
  doctorName,
  appointmentDate,
  appointmentTime
}) => {
  if (!isConfigured()) {
    return { skipped: true, reason: 'Twilio is not configured.' };
  }

  if (!to) {
    return { skipped: true, reason: 'Recipient phone number is missing.' };
  }

  const body = `Hi ${patientName || 'there'}! Reminder: your appt with ${doctorName} is ${appointmentDate} at ${appointmentTime} at Greenfield Medical, ${PRACTICE_ADDRESS}. Reply STOP to opt out.`;
  const client = getTwilioClient();
  const message = await client.messages.create({
    from: process.env.TWILIO_PHONE_NUMBER,
    to,
    body
  });

  return {
    sent: true,
    channel: 'sms',
    recipient: to,
    sid: message.sid
  };
};

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

export const sendAppointmentSms = async (appointment) => {
  if (!appointment.sms_opted_in) {
    return { skipped: true, reason: 'Patient did not opt in to SMS.' };
  }

  return sendAppointmentSMS({
    to: appointment.patient_phone,
    patientName: appointment.patient_first_name,
    doctorName: appointment.provider_name,
    appointmentDate: formatAppointmentDate(appointment.slot_datetime),
    appointmentTime: formatAppointmentTime(appointment.slot_datetime)
  });
};
