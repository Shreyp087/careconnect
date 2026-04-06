import dotenv from 'dotenv';
import sgMail from '@sendgrid/mail';

dotenv.config();

const PRACTICE_NAME = 'Greenfield Medical Practice';
const PRACTICE_ADDRESS =
  process.env.OFFICE_ADDRESS || '123 Wellness Drive, Suite 400, Springfield';
const PRACTICE_PHONE = process.env.OFFICE_PHONE || '(your real number)';

if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_API_KEY.startsWith('SG.')) {
  console.error('[SENDGRID] WARNING: API key missing or invalid (should start with SG.)');
}

if (!process.env.SENDGRID_FROM_EMAIL) {
  console.error('[SENDGRID] WARNING: SENDGRID_FROM_EMAIL not set');
}

const isConfigured = () =>
  Boolean(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL);

const configureSendGrid = () => {
  if (process.env.SENDGRID_API_KEY) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  }
};

const sendMail = async ({ to, subject, html, text }) => {
  if (!isConfigured()) {
    return { skipped: true, reason: 'SendGrid is not configured.' };
  }

  if (!to) {
    return { skipped: true, reason: 'Recipient email is missing.' };
  }

  configureSendGrid();

  await sgMail.send({
    to,
    from: {
      email: process.env.SENDGRID_FROM_EMAIL,
      name: PRACTICE_NAME
    },
    subject,
    text,
    html
  });

  return {
    sent: true,
    channel: 'email',
    recipient: to
  };
};

const buildDetailRow = (label, value) => `
  <tr>
    <td style="padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e5e7eb; width: 32%; font-size: 14px; font-weight: 600; color: #475569;">
      ${label}
    </td>
    <td style="padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #0f172a;">
      ${value}
    </td>
  </tr>
`;

export const sendAppointmentConfirmation = async ({
  to,
  patientName,
  doctorName,
  specialty,
  appointmentDate,
  appointmentTime,
  address = PRACTICE_ADDRESS
}) => {
  const safePatientName = patientName || 'there';
  const subject = 'Your appointment is confirmed ✓';
  const html = `
    <div style="margin: 0; padding: 24px; background: #f8fafc; font-family: Arial, sans-serif; color: #0f172a;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden; box-shadow: 0 18px 40px rgba(15, 23, 42, 0.08);">
        <div style="background: #0EA5E9; padding: 18px 28px;">
          <div style="font-size: 20px; font-weight: 700; color: #ffffff;">${PRACTICE_NAME}</div>
        </div>
        <div style="padding: 32px 28px;">
          <div style="width: 72px; height: 72px; margin: 0 auto 18px; border-radius: 999px; background: #e0f2fe; color: #0284c7; font-size: 42px; line-height: 72px; text-align: center; font-weight: 700;">
            ✓
          </div>
          <h1 style="margin: 0 0 12px; font-size: 28px; line-height: 1.2; text-align: center; color: #0f172a;">
            Hi ${safePatientName}, your appointment is confirmed!
          </h1>
          <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.7; text-align: center; color: #475569;">
            We are looking forward to seeing you at Greenfield Medical Practice. Here are your visit details.
          </p>

          <table role="presentation" style="width: 100%; border-collapse: separate; border-spacing: 0; border: 1px solid #e5e7eb; border-radius: 14px; overflow: hidden;">
            ${buildDetailRow('Doctor', doctorName)}
            ${buildDetailRow('Specialty', specialty)}
            ${buildDetailRow('Date', appointmentDate)}
            ${buildDetailRow('Time', appointmentTime)}
            ${buildDetailRow('Location', address)}
          </table>

          <p style="margin: 24px 0 0; font-size: 14px; line-height: 1.7; color: #475569;">
            Please arrive a few minutes early so we can get you checked in smoothly.
          </p>
        </div>
        <div style="padding: 20px 28px; background: #f8fafc; border-top: 1px solid #e5e7eb;">
          <p style="margin: 0 0 8px; font-size: 13px; color: #475569;">
            Questions? Call us at ${PRACTICE_PHONE}
          </p>
          <p style="margin: 0; font-size: 12px; color: #94a3b8;">
            You are receiving this message because you requested scheduling updates from ${PRACTICE_NAME}. Reply to future communications to manage your preferences.
          </p>
        </div>
      </div>
    </div>
  `;
  const text = `Hi ${safePatientName}, your appointment is confirmed with ${doctorName} (${specialty}) on ${appointmentDate} at ${appointmentTime}. Location: ${address}. Questions? Call us at ${PRACTICE_PHONE}.`;

  return sendMail({
    to,
    subject,
    html,
    text
  });
};

export const sendWaitlistConfirmation = async ({
  to,
  patientName,
  doctorName,
  specialty
}) => {
  const safePatientName = patientName || 'there';
  const subject = "You're on the waitlist — Greenfield Medical";
  const html = `
    <div style="margin: 0; padding: 24px; background: #f8fafc; font-family: Arial, sans-serif; color: #0f172a;">
      <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden;">
        <div style="background: #0EA5E9; padding: 18px 24px; color: #ffffff; font-size: 20px; font-weight: 700;">
          ${PRACTICE_NAME}
        </div>
        <div style="padding: 28px 24px;">
          <h1 style="margin: 0 0 12px; font-size: 24px; color: #0f172a;">You are on the waitlist</h1>
          <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.7; color: #475569;">
            Hi ${safePatientName}, we added you to the waitlist for ${doctorName} (${specialty}).
          </p>
          <p style="margin: 0; font-size: 15px; line-height: 1.7; color: #475569;">
            If an earlier opening becomes available, our team will reach out right away.
          </p>
        </div>
      </div>
    </div>
  `;
  const text = `Hi ${safePatientName}, we added you to the waitlist for ${doctorName} (${specialty}). If an earlier opening becomes available, our team will contact you.`;

  return sendMail({
    to,
    subject,
    html,
    text
  });
};

export const sendAppointmentReminder = async ({
  to,
  patientName,
  doctorName,
  appointmentDate,
  appointmentTime
}) => {
  const safePatientName = patientName || 'there';
  const subject = 'Reminder: Your appointment is tomorrow';
  const html = `
    <div style="margin: 0; padding: 24px; background: #f8fafc; font-family: Arial, sans-serif; color: #0f172a;">
      <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden;">
        <div style="background: #0EA5E9; padding: 18px 24px; color: #ffffff; font-size: 20px; font-weight: 700;">
          ${PRACTICE_NAME}
        </div>
        <div style="padding: 28px 24px;">
          <h1 style="margin: 0 0 12px; font-size: 24px; color: #0f172a;">Appointment reminder</h1>
          <p style="margin: 0 0 14px; font-size: 15px; line-height: 1.7; color: #475569;">
            Hi ${safePatientName}, this is a friendly reminder that you have an appointment with ${doctorName} tomorrow.
          </p>
          <p style="margin: 0; font-size: 15px; line-height: 1.7; color: #475569;">
            Date: <strong>${appointmentDate}</strong><br />
            Time: <strong>${appointmentTime}</strong><br />
            Location: <strong>${PRACTICE_ADDRESS}</strong>
          </p>
        </div>
      </div>
    </div>
  `;
  const text = `Hi ${safePatientName}, reminder that your appointment with ${doctorName} is tomorrow, ${appointmentDate} at ${appointmentTime}, at ${PRACTICE_ADDRESS}.`;

  return sendMail({
    to,
    subject,
    html,
    text
  });
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

export const sendAppointmentEmail = async (appointment) =>
  sendAppointmentConfirmation({
    to: appointment.patient_email,
    patientName: appointment.patient_first_name,
    doctorName: appointment.provider_name,
    specialty: appointment.specialty || appointment.provider_specialty,
    appointmentDate: formatAppointmentDate(appointment.slot_datetime),
    appointmentTime: formatAppointmentTime(appointment.slot_datetime),
    address: appointment.address || PRACTICE_ADDRESS
  });

export const sendWaitlistConfirmationEmail = async (waitlistEntry) =>
  sendWaitlistConfirmation({
    to: waitlistEntry.patient_email,
    patientName: waitlistEntry.patient_name,
    doctorName: waitlistEntry.provider_name,
    specialty: waitlistEntry.specialty
  });
