import dotenv from 'dotenv';

import pool, { query } from '../db.js';
import {
  sendAppointmentConfirmation,
  sendWaitlistConfirmation
} from './sendgrid.js';
import { sendAppointmentSMS } from './twilio.js';
import { logger } from '../utils/logger.js';

dotenv.config();

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o';
const OPENAI_TIMEOUT_MS = 15000;
const RETURNING_USER_SIGNAL = '__RETURNING_USER__';
const CONVERSATION_SUMMARY_LIMIT = 6;
const OFFICE_INFO = {
  practiceName: 'Greenfield Medical Practice',
  address: '123 Wellness Drive, Suite 400, Springfield',
  hours: 'Mon-Fri 8am-6pm, Sat 9am-1pm.',
  phone: '555-0100',
  pharmacyPhone: '555-0199'
};

export const SYSTEM_PROMPT = `You are a friendly, empathetic patient scheduling assistant for Greenfield Medical Practice. Your name is Aria.

Your ONLY role is to help patients: schedule appointments, check office hours/address, check on prescription refills (tell them to call the pharmacy at 555-0199), and answer general practice questions.

You MUST NEVER provide medical diagnoses, treatment recommendations, dosage advice, or any medical opinion. If asked anything medical, say: 'I'm not able to provide medical advice — please speak with your doctor directly.'

When scheduling an appointment:
1. Collect: first name, last name, date of birth, phone number, email, and reason/body part
2. Date of birth must be in MM/DD/YYYY format. If it is not, ask the patient to re-enter it in MM/DD/YYYY format before booking.
3. Use the get_available_slots tool to find matching providers and slots
4. Present 4-6 slots clearly (date, time, doctor name)
5. Once patient selects a slot, use book_appointment tool
6. Confirm the booking warmly

If get_available_slots returns error "no_slots":
- If next_available_days are provided, explain that the requested day or time is not available for that doctor and offer the next 2 available days.
- If no next_available_days are provided, say: "I'm sorry, Dr. [name] doesn't have any available appointments in the next 45 days. Would you like me to add you to the waitlist, or can I help you with anything else?"
- If the patient wants the waitlist, use the book_waitlist tool.

If book_appointment returns error "duplicate_appointment", explain that the patient already has an appointment on file and ask whether they want to reschedule.

Office info: 123 Wellness Drive, Suite 400, Springfield. Hours: Mon-Fri 8am-6pm, Sat 9am-1pm. Phone: 555-0100.

Always be warm, concise, and professional.`;

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_available_slots',
      description:
        "Retrieves available appointment slots matching the patient's condition. Semantically matches body_part to the correct specialist.",
      parameters: {
        type: 'object',
        properties: {
          body_part: {
            type: 'string'
          },
          preferred_day: {
            type: 'string'
          },
          preferred_time: {
            type: 'string'
          }
        },
        required: ['body_part']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Books the selected appointment slot for the patient.',
      parameters: {
        type: 'object',
        properties: {
          slot_id: { type: 'string' },
          provider_id: { type: 'string' },
          patient_first_name: { type: 'string' },
          patient_last_name: { type: 'string' },
          patient_dob: { type: 'string' },
          patient_phone: { type: 'string' },
          patient_email: { type: 'string' },
          reason: { type: 'string' },
          session_id: { type: 'string' },
          sms_opted_in: { type: 'boolean' }
        },
        required: [
          'slot_id',
          'provider_id',
          'patient_first_name',
          'patient_last_name',
          'patient_dob',
          'patient_phone',
          'patient_email',
          'reason',
          'session_id',
          'sms_opted_in'
        ]
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_session_state',
      description: 'Retrieves existing patient intake data and appointment state for a returning patient.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string' }
        },
        required: ['session_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'book_waitlist',
      description:
        'Adds the patient to the waitlist for a provider and sends a waitlist confirmation email.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string' },
          provider_id: { type: 'string' },
          patient_name: { type: 'string' },
          patient_email: { type: 'string' },
          patient_phone: { type: 'string' },
          reason: { type: 'string' }
        },
        required: ['session_id', 'provider_id', 'reason']
      }
    }
  }
];

const FALLBACK_SCHEDULING_REPLY =
  'I can help with scheduling. Please share your first name, last name, date of birth in MM/DD/YYYY format, phone number, email, and what body part or concern you need seen.';

const normalizeTokens = (value = '') =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((token) => {
      if (token.length > 4 && token.endsWith('ies')) {
        return `${token.slice(0, -3)}y`;
      }

      if (token.length > 3 && token.endsWith('s')) {
        return token.slice(0, -1);
      }

      return token;
    });

const formatSlotDateTime = (slotDateTime) =>
  new Date(slotDateTime).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

const formatDayLabel = (slotDateTime) =>
  new Date(slotDateTime).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

const buildConversationSummary = (conversationHistory = [], limit = CONVERSATION_SUMMARY_LIMIT) =>
  (Array.isArray(conversationHistory) ? conversationHistory : [])
    .slice(-limit)
    .map((message) => {
      const roleLabel = message.role === 'assistant' ? 'Aria' : 'Patient';
      const content = String(message.content || '')
        .replace(/\s+/g, ' ')
        .trim();

      return `${roleLabel}: ${content}`;
    })
    .join(' | ');

const parseAssistantText = (message) => {
  if (!message) {
    return '';
  }

  if (typeof message.content === 'string') {
    return message.content.trim();
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (part?.type === 'text') {
          return part.text || '';
        }

        return '';
      })
      .join('')
      .trim();
  }

  return '';
};

const matchesPreferredDay = (slotDateTime, preferredDay) => {
  if (!preferredDay) {
    return true;
  }

  const normalizedPreferredDay = preferredDay.trim().toLowerCase();
  const dayName = new Date(slotDateTime).toLocaleDateString('en-US', {
    weekday: 'long'
  });
  const shortDayName = dayName.slice(0, 3).toLowerCase();

  return (
    dayName.toLowerCase() === normalizedPreferredDay ||
    shortDayName === normalizedPreferredDay.slice(0, 3)
  );
};

const matchesPreferredTime = (slotDateTime, preferredTime) => {
  if (!preferredTime) {
    return true;
  }

  const normalizedPreferredTime = preferredTime.trim().toLowerCase();
  const slotDate = new Date(slotDateTime);
  const hour = slotDate.getHours();
  const formattedTime = slotDate
    .toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    })
    .toLowerCase();

  if (normalizedPreferredTime.includes('morning')) {
    return hour < 12;
  }

  if (normalizedPreferredTime.includes('afternoon')) {
    return hour >= 12 && hour < 17;
  }

  if (normalizedPreferredTime.includes('evening')) {
    return hour >= 17;
  }

  if (formattedTime.includes(normalizedPreferredTime)) {
    return true;
  }

  const exactHour = normalizedPreferredTime.match(/(\d{1,2})\s*(am|pm)?/);

  if (!exactHour) {
    return true;
  }

  let preferredHour = Number.parseInt(exactHour[1], 10);
  const meridiem = exactHour[2];

  if (meridiem === 'pm' && preferredHour !== 12) {
    preferredHour += 12;
  }

  if (meridiem === 'am' && preferredHour === 12) {
    preferredHour = 0;
  }

  return hour === preferredHour;
};

const isValidDobFormat = (dob = '') => {
  const match = String(dob).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  if (!match) {
    return false;
  }

  const [, monthString, dayString, yearString] = match;
  const month = Number.parseInt(monthString, 10);
  const day = Number.parseInt(dayString, 10);
  const year = Number.parseInt(yearString, 10);
  const candidateDate = new Date(year, month - 1, day);

  return (
    candidateDate.getFullYear() === year &&
    candidateDate.getMonth() === month - 1 &&
    candidateDate.getDate() === day
  );
};

const createBusinessError = (message, code, details = {}) => {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
};

const isTimeoutError = (error) =>
  error?.name === 'AbortError' ||
  error?.name === 'TimeoutError' ||
  /timed out|timeout|aborted/i.test(error?.message || '');

const buildToolErrorResult = (toolName, error) => ({
  tool: toolName,
  error: error.code || 'tool_error',
  message: error.message || 'The tool failed unexpectedly.',
  ...(error.details || {})
});

const buildNextAvailableDays = (slots = []) => {
  const uniqueDays = [];
  const seenDays = new Set();

  slots.forEach((slot) => {
    const dateKey = new Date(slot.slot_datetime).toISOString().slice(0, 10);

    if (seenDays.has(dateKey)) {
      return;
    }

    seenDays.add(dateKey);
    uniqueDays.push(formatDayLabel(slot.slot_datetime));
  });

  return uniqueDays.slice(0, 2);
};

const buildFallbackReply = async (sessionId, userMessage) => {
  const normalized = userMessage.toLowerCase();
  const dobCandidate =
    String(userMessage).match(/\b(\d{1,4}[/-]\d{1,2}[/-]\d{1,4}|\d{8})\b/)?.[1] || '';

  if (
    normalized.includes('prescription') ||
    normalized.includes('refill') ||
    normalized.includes('pharmacy')
  ) {
    return `For prescription refills, please call the pharmacy at ${OFFICE_INFO.pharmacyPhone}.`;
  }

  if (
    normalized.includes('hours') ||
    normalized.includes('open') ||
    normalized.includes('close') ||
    normalized.includes('address') ||
    normalized.includes('located') ||
    normalized.includes('location')
  ) {
    return `${OFFICE_INFO.practiceName} is located at ${OFFICE_INFO.address}. Our hours are ${OFFICE_INFO.hours} Phone: ${OFFICE_INFO.phone}.`;
  }

  if (
    normalized.includes('diagnos') ||
    normalized.includes('treatment') ||
    normalized.includes('dosage') ||
    normalized.includes('medication') ||
    normalized.includes('should i')
  ) {
    return "I'm not able to provide medical advice — please speak with your doctor directly.";
  }

  if (
    /\b(dob|birth|birthday|date of birth)\b/.test(normalized) ||
    Boolean(dobCandidate)
  ) {
    if (!isValidDobFormat(dobCandidate)) {
      return 'Please re-enter your date of birth in MM/DD/YYYY format.';
    }
  }

  const sessionState = await getSessionState({ session_id: sessionId }).catch(() => null);

  if (!sessionState?.patient_first_name || !sessionState?.patient_last_name) {
    return FALLBACK_SCHEDULING_REPLY;
  }

  return 'I can help you schedule. Please tell me the reason for the visit or body part involved, plus any preferred day or time.';
};

export const getSessionState = async ({ session_id }) => {
  const { rows } = await query(
    `
      SELECT
        sessions.*,
        appointments.id AS booked_appointment_id,
        appointments.provider_id AS booked_provider_id,
        appointments.slot_id AS booked_slot_id,
        appointments.reason AS booked_reason,
        appointments.status AS booked_status,
        appointments.sms_opted_in AS booked_sms_opted_in,
        providers.name AS provider_name,
        providers.specialty AS provider_specialty,
        provider_slots.slot_datetime AS appointment_slot_datetime
      FROM sessions
      LEFT JOIN appointments
        ON appointments.id = sessions.appointment_id
      LEFT JOIN providers
        ON providers.id = appointments.provider_id
      LEFT JOIN provider_slots
        ON provider_slots.id = appointments.slot_id
      WHERE sessions.id = $1
    `,
    [session_id]
  );

  if (!rows.length) {
    throw new Error('Session not found.');
  }

  const row = rows[0];

  return {
    session_id: row.id,
    patient_first_name: row.patient_first_name,
    patient_last_name: row.patient_last_name,
    patient_dob: row.patient_dob,
    patient_phone: row.patient_phone,
    patient_email: row.patient_email,
    intake_complete: row.intake_complete,
    appointment_id: row.appointment_id,
    conversation_history: row.conversation_history || [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    appointment: row.booked_appointment_id
      ? {
          id: row.booked_appointment_id,
          provider_id: row.booked_provider_id,
          slot_id: row.booked_slot_id,
          provider_name: row.provider_name,
          provider_specialty: row.provider_specialty,
          slot_datetime: row.appointment_slot_datetime,
          reason: row.booked_reason,
          status: row.booked_status,
          sms_opted_in: row.booked_sms_opted_in
        }
      : null
  };
};

export const getAvailableSlots = async ({
  body_part,
  preferred_day = '',
  preferred_time = ''
}) => {
  const inputTokens = new Set(normalizeTokens(body_part));

  const providerResult = await query(
    `
      SELECT id, name, specialty, body_parts, bio
      FROM providers
      ORDER BY specialty, name
    `
  );

  const matchedProviders = providerResult.rows
    .map((provider) => {
      const providerTokens = new Set(
        provider.body_parts.flatMap((part) => normalizeTokens(part))
      );
      const overlap = Array.from(inputTokens).filter((token) => providerTokens.has(token));

      return {
        ...provider,
        match_score: overlap.length,
        matched_terms: overlap
      };
    })
    .filter((provider) => provider.match_score > 0)
    .sort((left, right) => {
      if (right.match_score !== left.match_score) {
        return right.match_score - left.match_score;
      }

      return left.name.localeCompare(right.name);
    });

  if (!matchedProviders.length) {
    return {
      body_part,
      preferred_day: preferred_day || null,
      preferred_time: preferred_time || null,
      providers: [],
      formatted_options: [],
      summary:
        'I could not find a direct specialist match for that concern yet. Ask the patient for a clearer body part or offer the office phone number for help.'
    };
  }

  const providerMatches = [];
  const primaryProvider = matchedProviders[0];
  let primaryProviderFutureSlots = [];

  for (const provider of matchedProviders.slice(0, 4)) {
    const slotResult = await query(
      `
        SELECT id, provider_id, slot_datetime
        FROM provider_slots
        WHERE provider_id = $1
          AND is_available = TRUE
          AND slot_datetime > NOW()
          AND slot_datetime <= NOW() + INTERVAL '45 days'
        ORDER BY slot_datetime
        LIMIT 30
      `,
      [provider.id]
    );

    const unfilteredSlots = slotResult.rows.map((slot) => ({
      slot_id: slot.id,
      provider_id: provider.id,
      provider_name: provider.name,
      specialty: provider.specialty,
      slot_datetime: slot.slot_datetime
    }));

    if (provider.id === primaryProvider.id) {
      primaryProviderFutureSlots = unfilteredSlots;
    }

    const slots = unfilteredSlots
      .filter(
        (slot) =>
          matchesPreferredDay(slot.slot_datetime, preferred_day) &&
          matchesPreferredTime(slot.slot_datetime, preferred_time)
      )
      .slice(0, 6)
      .map((slot) => ({
        slot_id: slot.id,
        provider_id: provider.id,
        provider_name: provider.name,
        specialty: provider.specialty,
        slot_datetime: slot.slot_datetime,
        display_text: `${formatSlotDateTime(slot.slot_datetime)} with ${provider.name}`
      }));

    if (slots.length) {
      providerMatches.push({
        provider_id: provider.id,
        provider_name: provider.name,
        specialty: provider.specialty,
        bio: provider.bio,
        body_parts: provider.body_parts,
        matched_terms: provider.matched_terms,
        slots
      });
    }
  }

  const formattedOptions = providerMatches
    .flatMap((provider) => provider.slots)
    .sort(
      (left, right) =>
        new Date(left.slot_datetime).getTime() - new Date(right.slot_datetime).getTime()
    )
    .slice(0, 6)
    .map((slot, index) => ({
      option_number: index + 1,
      slot_id: slot.slot_id,
      provider_id: slot.provider_id,
      provider_name: slot.provider_name,
      specialty: slot.specialty,
      slot_datetime: slot.slot_datetime,
      text: `${index + 1}. ${formatSlotDateTime(slot.slot_datetime)} - ${slot.provider_name} (${slot.specialty})`
    }));

  const summary = formattedOptions.length
    ? `Available options:\n${formattedOptions.map((option) => option.text).join('\n')}`
    : 'I found matching specialists, but no available slots matched the preferred day or time.';

  if (!formattedOptions.length) {
    const nextAvailableDays = buildNextAvailableDays(primaryProviderFutureSlots);

    return {
      error: 'no_slots',
      body_part,
      preferred_day: preferred_day || null,
      preferred_time: preferred_time || null,
      provider_id: primaryProvider.id,
      provider_name: primaryProvider.name,
      specialty: primaryProvider.specialty,
      next_available_days: nextAvailableDays,
      summary: nextAvailableDays.length
        ? `We don't have ${preferred_day || preferred_time || 'that'} availability for ${primaryProvider.name}, but I have openings on ${nextAvailableDays.join(
            ' and '
          )}.`
        : `I'm sorry, ${primaryProvider.name} doesn't have any available appointments in the next 45 days. Would you like me to add you to the waitlist, or can I help you with anything else?`
    };
  }

  return {
    body_part,
    preferred_day: preferred_day || null,
    preferred_time: preferred_time || null,
    providers: providerMatches,
    formatted_options: formattedOptions,
      summary
  };
};

export const bookWaitlist = async ({
  session_id,
  provider_id,
  patient_name,
  patient_email,
  patient_phone,
  reason
}) => {
  if (!session_id || !provider_id || !reason) {
    throw new Error('session_id, provider_id, and reason are required.');
  }

  const state = await getSessionState({ session_id });

  const { rows: providerRows } = await query(
    `
      SELECT id, name, specialty
      FROM providers
      WHERE id = $1
    `,
    [provider_id]
  );

  if (!providerRows.length) {
    throw new Error('Provider not found.');
  }

  const provider = providerRows[0];
  const resolvedPatientName =
    patient_name ||
    [state.patient_first_name, state.patient_last_name].filter(Boolean).join(' ').trim();
  const resolvedPatientEmail = patient_email || state.patient_email || null;
  const resolvedPatientPhone = patient_phone || state.patient_phone || null;

  const { rows } = await query(
    `
      INSERT INTO waitlist (
        session_id,
        provider_id,
        patient_name,
        patient_email,
        patient_phone,
        reason
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [
      session_id,
      provider_id,
      resolvedPatientName || null,
      resolvedPatientEmail,
      resolvedPatientPhone,
      reason
    ]
  );

  const waitlistEntry = rows[0];

  await query(
    `
      UPDATE sessions
      SET
        patient_phone = COALESCE($2, patient_phone),
        patient_email = COALESCE($3, patient_email),
        updated_at = NOW()
      WHERE id = $1
    `,
    [session_id, resolvedPatientPhone, resolvedPatientEmail]
  );

  try {
    await sendWaitlistConfirmation({
      to: resolvedPatientEmail,
      patientName: resolvedPatientName,
      doctorName: provider.name,
      specialty: provider.specialty
    });
  } catch (error) {
    logger.error('Waitlist confirmation email failed:', error.message);
  }

  return {
    waitlist_id: waitlistEntry.id,
    session_id,
    provider_id,
    provider_name: provider.name,
    specialty: provider.specialty,
    patient_name: resolvedPatientName,
    patient_email: resolvedPatientEmail,
    patient_phone: resolvedPatientPhone,
    reason,
    confirmation_message: `You're on the waitlist for ${provider.name}. We'll reach out if an earlier appointment opens up.`
  };
};

export const bookAppointment = async ({
  slot_id,
  provider_id,
  patient_first_name,
  patient_last_name,
  patient_dob,
  patient_phone,
  patient_email,
  reason,
  session_id,
  sms_opted_in
}) => {
  if (
    !slot_id ||
    !provider_id ||
    !patient_first_name ||
    !patient_last_name ||
    !session_id
  ) {
    throw new Error(
      'slot_id, provider_id, patient_first_name, patient_last_name, and session_id are required.'
    );
  }

  if (patient_dob && !isValidDobFormat(patient_dob)) {
    throw createBusinessError(
      'Please re-enter the date of birth in MM/DD/YYYY format.',
      'invalid_dob'
    );
  }

  const client = await pool.connect();
  let confirmationPayload = null;

  try {
    await client.query('BEGIN');

    const sessionResult = await client.query(
      `
        SELECT id
        FROM sessions
        WHERE id = $1
        FOR UPDATE
      `,
      [session_id]
    );

    if (!sessionResult.rows.length) {
      throw new Error('Session not found.');
    }

    const existingAppointmentResult = await client.query(
      `
        SELECT
          appointments.id,
          appointments.status,
          providers.name AS provider_name,
          provider_slots.slot_datetime
        FROM appointments
        JOIN providers
          ON providers.id = appointments.provider_id
        JOIN provider_slots
          ON provider_slots.id = appointments.slot_id
        WHERE appointments.session_id = $1
          AND appointments.status <> 'cancelled'
          AND provider_slots.slot_datetime > NOW()
        ORDER BY appointments.created_at DESC
        LIMIT 1
      `,
      [session_id]
    );

    if (existingAppointmentResult.rows.length) {
      const existingAppointment = existingAppointmentResult.rows[0];

      throw createBusinessError(
        `You already have an appointment with ${existingAppointment.provider_name} on ${formatSlotDateTime(
          existingAppointment.slot_datetime
        )}. Would you like help rescheduling?`,
        'duplicate_appointment',
        {
          existing_provider_name: existingAppointment.provider_name,
          existing_slot_datetime: existingAppointment.slot_datetime
        }
      );
    }

    const slotResult = await client.query(
      `
        SELECT
          provider_slots.id,
          provider_slots.provider_id,
          provider_slots.slot_datetime,
          providers.name AS provider_name,
          providers.specialty
        FROM provider_slots
        JOIN providers
          ON providers.id = provider_slots.provider_id
        WHERE provider_slots.id = $1
          AND provider_slots.provider_id = $2
          AND provider_slots.is_available = TRUE
          AND provider_slots.slot_datetime > NOW()
        FOR UPDATE
      `,
      [slot_id, provider_id]
    );

    if (!slotResult.rows.length) {
      throw createBusinessError(
        'The selected appointment slot is no longer available.',
        'slot_unavailable'
      );
    }

    const selectedSlot = slotResult.rows[0];

    await client.query(
      `
        UPDATE provider_slots
        SET is_available = FALSE
        WHERE id = $1
      `,
      [slot_id]
    );

    const appointmentResult = await client.query(
      `
        INSERT INTO appointments (
          session_id,
          provider_id,
          slot_id,
          patient_first_name,
          patient_last_name,
          patient_dob,
          patient_phone,
          patient_email,
          reason,
          sms_opted_in
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `,
      [
        session_id,
        provider_id,
        slot_id,
        patient_first_name,
        patient_last_name,
        patient_dob || null,
        patient_phone || null,
        patient_email || null,
        reason || null,
        Boolean(sms_opted_in)
      ]
    );

    const appointment = appointmentResult.rows[0];

    await client.query(
      `
        UPDATE sessions
        SET
          patient_first_name = $2,
          patient_last_name = $3,
          patient_dob = $4,
          patient_phone = $5,
          patient_email = $6,
          appointment_id = $7,
          intake_complete = TRUE,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        session_id,
        patient_first_name,
        patient_last_name,
        patient_dob || null,
        patient_phone || null,
        patient_email || null,
        appointment.id
      ]
    );

    await client.query('COMMIT');

    confirmationPayload = {
      appointment_id: appointment.id,
      session_id,
      provider_id,
      provider_name: selectedSlot.provider_name,
      provider_specialty: selectedSlot.specialty,
      slot_id,
      slot_datetime: selectedSlot.slot_datetime,
      patient_first_name,
      patient_last_name,
      patient_dob,
      patient_phone,
      patient_email,
      reason,
      sms_opted_in: Boolean(sms_opted_in),
      address: OFFICE_INFO.address,
      office_phone: OFFICE_INFO.phone,
      confirmation_message: `Booked with ${selectedSlot.provider_name} on ${formatSlotDateTime(
        selectedSlot.slot_datetime
      )}.`
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  try {
    await sendAppointmentConfirmation({
      to: confirmationPayload.patient_email,
      patientName: confirmationPayload.patient_first_name,
      doctorName: confirmationPayload.provider_name,
      specialty: confirmationPayload.provider_specialty,
      appointmentDate: new Date(confirmationPayload.slot_datetime).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      }),
      appointmentTime: new Date(confirmationPayload.slot_datetime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit'
      }),
      address: confirmationPayload.address
    });
  } catch (error) {
    logger.error('Appointment confirmation email failed:', error.message);
  }

  if (confirmationPayload.sms_opted_in) {
    try {
      await sendAppointmentSMS({
        to: confirmationPayload.patient_phone,
        patientName: confirmationPayload.patient_first_name,
        doctorName: confirmationPayload.provider_name,
        appointmentDate: new Date(confirmationPayload.slot_datetime).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric'
        }),
        appointmentTime: new Date(confirmationPayload.slot_datetime).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit'
        })
      });
    } catch (error) {
      logger.error('Appointment confirmation SMS failed:', error.message);
    }
  }

  return confirmationPayload;
};

export const ariaToolHandlers = {
  get_available_slots: getAvailableSlots,
  book_appointment: bookAppointment,
  get_session_state: getSessionState,
  book_waitlist: bookWaitlist
};

export { RETURNING_USER_SIGNAL, buildConversationSummary };

export class ChatService {
  constructor({ apiKey = process.env.OPENAI_API_KEY, model = DEFAULT_MODEL } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.systemPrompt = SYSTEM_PROMPT;
    this.tools = TOOL_DEFINITIONS;
    this.latestToolOutputs = new Map();
    this.toolHandlers = ariaToolHandlers;
  }

  async loadSession(sessionId) {
    const { rows } = await query(
      `
        SELECT id, conversation_history
        FROM sessions
        WHERE id = $1
      `,
      [sessionId]
    );

    if (!rows.length) {
      throw new Error('Session not found.');
    }

    return rows[0];
  }

  async saveHistory(sessionId, conversationHistory) {
    await query(
      `
        UPDATE sessions
        SET conversation_history = $2::jsonb, updated_at = NOW()
        WHERE id = $1
      `,
      [sessionId, JSON.stringify(conversationHistory)]
    );
  }

  buildMessages(conversationHistory) {
    return [
      {
        role: 'system',
        content: this.systemPrompt
      },
      ...conversationHistory.map((message) => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content
      }))
    ];
  }

  async callOpenAI(messages, { includeTools = true } = {}) {
    const payload = {
      model: this.model,
      temperature: 0.2,
      messages
    };

    if (includeTools) {
      payload.tools = this.tools;
      payload.tool_choice = 'auto';
    }

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI request failed (${response.status}): ${errorBody}`);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;

    if (!message) {
      throw new Error('OpenAI returned an empty response.');
    }

    return message;
  }

  async buildReturningUserReply(sessionId, conversationHistory) {
    const sessionState = await this.toolHandlers.get_session_state({
      session_id: sessionId
    });
    const patientName = sessionState.patient_first_name || 'there';
    const conversationSummary = buildConversationSummary(conversationHistory);
    const appointmentNote = sessionState.appointment
      ? `Current appointment: ${sessionState.appointment.provider_name} on ${formatSlotDateTime(
          sessionState.appointment.slot_datetime
        )}.`
      : 'No appointment is currently booked.';

    if (!this.apiKey) {
      if (sessionState.appointment) {
        return `Welcome back, ${patientName}. I still have your appointment with ${sessionState.appointment.provider_name} on ${formatSlotDateTime(
          sessionState.appointment.slot_datetime
        )}. How can I help today?`;
      }

      return `Welcome back, ${patientName}. I reviewed our earlier conversation${
        conversationSummary ? ` about ${conversationSummary}.` : '.'
      } How can I help you continue today?`;
    }

    const promptMessages = [
      {
        role: 'system',
        content: `${this.systemPrompt}

You are welcoming back a returning patient who previously started on the web chat.
Write one short, warm welcome-back reply.
Mention any booked appointment if one exists.
Use the conversation summary and session context to pick up naturally from where the conversation left off.
Do not mention internal tools, JSON, or system details.`
      },
      {
        role: 'user',
        content: `Patient name: ${patientName}
${appointmentNote}
Conversation summary: ${conversationSummary || 'No prior summary available.'}
Write a concise welcome-back message that feels natural and ready to continue the scheduling conversation.`
      }
    ];

    const assistantMessage = await this.callOpenAI(promptMessages, {
      includeTools: false
    });

    return (
      parseAssistantText(assistantMessage) ||
      `Welcome back, ${patientName}. How can I help you today?`
    );
  }

  async executeToolCall(toolCall) {
    const toolName = toolCall.function?.name;
    const rawArguments = toolCall.function?.arguments || '{}';
    const handler = this.toolHandlers[toolName];

    if (!handler) {
      return buildToolErrorResult(toolName, new Error('Tool is not implemented.'));
    }

    try {
      const parsedArguments = JSON.parse(rawArguments);
      return await handler(parsedArguments);
    } catch (error) {
      return buildToolErrorResult(toolName, error);
    }
  }

  async chat(sessionId, userMessage) {
    if (!userMessage || !userMessage.trim()) {
      throw new Error('A message is required.');
    }

    const session = await this.loadSession(sessionId);
    const conversationHistory = Array.isArray(session.conversation_history)
      ? session.conversation_history
      : [];
    const trimmedMessage = userMessage.trim();
    const interactionState = {
      get_available_slots: null,
      book_appointment: null,
      get_session_state: null,
      book_waitlist: null
    };

    if (trimmedMessage === RETURNING_USER_SIGNAL) {
      const sessionState = await this.toolHandlers.get_session_state({
        session_id: sessionId
      });
      interactionState.get_session_state = sessionState;

      try {
        const reply = await this.buildReturningUserReply(sessionId, conversationHistory);
        this.latestToolOutputs.set(sessionId, interactionState);
        return reply;
      } catch (error) {
        logger.warn('Returning-user welcome fallback activated:', error.message);

        if (sessionState.appointment) {
          const fallbackReply = `Welcome back, ${
            sessionState.patient_first_name || 'there'
          }. I still have your appointment with ${
            sessionState.appointment.provider_name
          } on ${formatSlotDateTime(sessionState.appointment.slot_datetime)}. How can I help today?`;
          this.latestToolOutputs.set(sessionId, interactionState);
          return fallbackReply;
        }

        const fallbackReply = `Welcome back, ${
          sessionState.patient_first_name || 'there'
        }. I'm here to help you pick up where we left off.`;
        this.latestToolOutputs.set(sessionId, interactionState);
        return fallbackReply;
      }
    }

    const updatedHistory = [
      ...conversationHistory,
      {
        role: 'user',
        content: trimmedMessage,
        createdAt: new Date().toISOString()
      }
    ];

    let finalAssistantText = '';

    try {
      if (!this.apiKey) {
        throw new Error('OPENAI_API_KEY is not configured.');
      }

      const messages = this.buildMessages(updatedHistory);

      for (let iteration = 0; iteration < 6; iteration += 1) {
        const assistantMessage = await this.callOpenAI(messages);

        if (assistantMessage.tool_calls?.length) {
          messages.push({
            role: 'assistant',
            content: assistantMessage.content || '',
            tool_calls: assistantMessage.tool_calls
          });

          for (const toolCall of assistantMessage.tool_calls) {
            const toolResult = await this.executeToolCall(toolCall);
            interactionState[toolCall.function.name] = toolResult;

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: JSON.stringify(toolResult)
            });
          }

          continue;
        }

        finalAssistantText = parseAssistantText(assistantMessage);
        break;
      }
    } catch (error) {
      logger.warn('ChatService fallback activated:', error.message);

      if (isTimeoutError(error)) {
        finalAssistantText = "I'm having trouble connecting, please try again in a moment.";
      } else {
        finalAssistantText = await buildFallbackReply(sessionId, trimmedMessage).catch(
          () => ''
        );
      }
    }

    if (!finalAssistantText) {
      finalAssistantText =
        "I'm sorry, I hit a snag while helping with that. Please call 555-0100 and our front desk can help right away.";
    }

    const finalHistory = [
      ...updatedHistory,
      {
        role: 'assistant',
        content: finalAssistantText,
        createdAt: new Date().toISOString()
      }
    ];

    await this.saveHistory(sessionId, finalHistory);
    this.latestToolOutputs.set(sessionId, interactionState);

    return finalAssistantText;
  }

  getLatestInteraction(sessionId) {
    return this.latestToolOutputs.get(sessionId) || null;
  }
}
