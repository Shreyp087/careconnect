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
  address: process.env.OFFICE_ADDRESS || '123 Wellness Drive, Suite 400, Springfield',
  hours: 'Mon-Fri 8am-6pm, Sat 9am-1pm.',
  phone: process.env.OFFICE_PHONE || '(your real number)',
  pharmacyPhone: '555-0199'
};

export const SYSTEM_PROMPT = `You are Aria, a patient coordinator at Greenfield Medical Practice.
You're warm, competent, and genuinely care about the people you talk to.
You sound like a real person - not a chatbot, not a phone tree.

## YOUR PERSONALITY
- You're calm and unhurried. Never make anyone feel like a burden.
- You use natural, conversational language. No corporate speak.
- When someone shares a health concern, acknowledge it briefly before moving on.
  Good: "Sorry to hear that - let's get you seen."
  Bad: "I understand you are experiencing discomfort. I will now proceed to..."
- Use the patient's first name naturally once you have it - not every message.
- Never say "Absolutely!", "Certainly!", "Of course!", "Great question!" - they sound fake.
- Don't repeat yourself. If something didn't work, don't say the same thing again.
- Keep responses short. 2-4 sentences max unless listing slots.

## WHAT YOU CAN HELP WITH
1. Booking appointments with our 4 specialists
2. Office hours, address, directions
3. Prescription refill questions (direct to pharmacy)
4. General practice questions

## OUR DOCTORS
- Heart, chest, blood pressure, ECG, palpitations -> Dr. Sarah Chen (Cardiology)
- Knee, back, leg, muscle, joint, bone, shoulder, spine -> Dr. Marcus Webb (Orthopedics)
- Skin, rash, acne, hair loss, moles, eczema -> Dr. Priya Nair (Dermatology)
- Headache, migraine, nerve pain, dizziness, memory -> Dr. James Okafor (Neurology)

If someone asks about something outside these specialties (stomach, eyes, dental, mental health, etc.):
Say warmly: "We don't have that specialist here - [condition] is outside our four specialties
(cardiology, orthopedics, dermatology, and neurology). For that, your primary care doctor would
be a great first call. Is there anything else I can help with?"

## BOOKING FLOW
When someone wants an appointment:
1. Figure out which doctor they need from what they describe
2. Confirm the match casually: "Sounds like Dr. Webb would be the right fit - he's our orthopedist."
3. Collect info ONE at a time, naturally:
   - First name (then use it going forward)
   - Last name
   - Date of birth (MM/DD/YYYY)
   - Phone number
   - Email address
4. Call get_available_slots - show 6 options with full date + time + day of week
5. Let them pick - accept numbers, times, or descriptions ("the 1pm one", "Wednesday", "first available")
6. Call book_appointment with option_number + session_id + sms_opted_in + reason
7. Confirm warmly: "Done! You're booked with Dr. [Name] on [day], [date] at [time].
   Confirmation email going to [email] now."

## CRITICAL BOOKING RULES
- NEVER pass slot_id or provider_id to book_appointment - only option_number
- session_id = always "SESSION_ID_FROM_CONTEXT" (backend handles the real ID)
- If booking fails once, call get_available_slots again and show fresh slots
- If patient says "yes" / "confirm" / "that one" after you named a specific slot -> book it
- "anytime" or "first available" -> option_number: 1
- "the last one" -> option_number: 6

## HANDLING RETURNING PATIENTS
If they already have an appointment:
"I see you already have an appointment with Dr. [Name] on [date]. Would you like to
keep that, reschedule, or book a separate visit?"

## PRESCRIPTION REFILLS
"For refills, your best bet is to call your pharmacy directly - they can reach out
to the doctor's office if they need authorization. Our pharmacy line is 555-0199."

## SAFETY - NON-NEGOTIABLE
- Zero medical advice. Zero diagnoses. Zero treatment opinions.
- If asked: "That's really a question for the doctor - I don't want to steer you wrong."
- Emergency: "If this feels urgent or like an emergency, please call 911 or head to
  the nearest ER right away. Don't wait."

## OFFICE INFO
Address: ${process.env.OFFICE_ADDRESS || '123 Wellness Drive, Suite 400, Springfield'}
Phone: ${process.env.OFFICE_PHONE || '555-0100'}
Hours: Monday-Friday 8:00 AM-6:00 PM, Saturday 9:00 AM-1:00 PM`;

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'get_available_slots',
      description:
        "Get available appointment slots. Use preferred_after_date (ISO string) when the patient asks for next week or week after.",
      parameters: {
        type: 'object',
        properties: {
          body_part: {
            type: 'string'
          },
          preferred_day: {
            type: 'string'
          },
          preferred_after_date: {
            type: 'string',
            description:
              'ISO date string. Use when the patient says next week or week after.'
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
          option_number: { type: 'integer' },
          reason: { type: 'string' },
          session_id: { type: 'string' },
          sms_opted_in: { type: 'boolean' }
        },
        required: ['option_number', 'session_id', 'sms_opted_in', 'reason']
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

const VOICE_HANDOFF_REPLY =
  "Of course! I can have our AI assistant call you right now to continue this conversation by voice. Just click the 'Call me instead' button on the left, and you'll receive a call at the phone number you provided. The assistant will have full context of our conversation.";

const recentAvailabilityBySession = new Map();
const WEEKDAY_LABELS = {
  mon: 'Monday',
  monday: 'Monday',
  tue: 'Tuesday',
  tues: 'Tuesday',
  tuesday: 'Tuesday',
  wed: 'Wednesday',
  weds: 'Wednesday',
  wednesday: 'Wednesday',
  thu: 'Thursday',
  thur: 'Thursday',
  thurs: 'Thursday',
  thursday: 'Thursday',
  fri: 'Friday',
  friday: 'Friday',
  sat: 'Saturday',
  saturday: 'Saturday',
  sun: 'Sunday',
  sunday: 'Sunday'
};

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

const SPECIALTY_KEYWORD_MAP = {
  // NEUROLOGY - Dr. James Okafor
  headache: 'neurology',
  headaches: 'neurology',
  migraine: 'neurology',
  migraines: 'neurology',
  dizzy: 'neurology',
  dizziness: 'neurology',
  vertigo: 'neurology',
  brain: 'neurology',
  nerve: 'neurology',
  nerves: 'neurology',
  numbness: 'neurology',
  tingling: 'neurology',
  memory: 'neurology',
  seizure: 'neurology',
  seizures: 'neurology',
  tremor: 'neurology',
  tremors: 'neurology',
  concussion: 'neurology',
  neuropathy: 'neurology',
  neurological: 'neurology',
  ms: 'neurology',
  parkinson: 'neurology',
  stroke: 'neurology',
  fainting: 'neurology',
  blackout: 'neurology',
  blackouts: 'neurology',

  // CARDIOLOGY - Dr. Sarah Chen
  heart: 'cardiology',
  chest: 'cardiology',
  cardiac: 'cardiology',
  cardiovascular: 'cardiology',
  palpitation: 'cardiology',
  palpitations: 'cardiology',
  'blood pressure': 'cardiology',
  hypertension: 'cardiology',
  cholesterol: 'cardiology',
  'shortness of breath': 'cardiology',
  arrhythmia: 'cardiology',
  ecg: 'cardiology',
  ekg: 'cardiology',
  'irregular heartbeat': 'cardiology',
  'heart rate': 'cardiology',
  pulse: 'cardiology',
  angina: 'cardiology',

  // ORTHOPEDICS - Dr. Marcus Webb
  knee: 'orthopedics',
  back: 'orthopedics',
  spine: 'orthopedics',
  spinal: 'orthopedics',
  joint: 'orthopedics',
  joints: 'orthopedics',
  shoulder: 'orthopedics',
  hip: 'orthopedics',
  hips: 'orthopedics',
  bone: 'orthopedics',
  bones: 'orthopedics',
  fracture: 'orthopedics',
  fractures: 'orthopedics',
  wrist: 'orthopedics',
  ankle: 'orthopedics',
  elbow: 'orthopedics',
  arthritis: 'orthopedics',
  tendon: 'orthopedics',
  ligament: 'orthopedics',
  'sports injury': 'orthopedics',
  orthopedic: 'orthopedics',
  musculoskeletal: 'orthopedics',
  neck: 'orthopedics',
  foot: 'orthopedics',
  feet: 'orthopedics',
  leg: 'orthopedics',
  legs: 'orthopedics',
  'leg pain': 'orthopedics',
  muscle: 'orthopedics',
  muscles: 'orthopedics',
  'muscle pain': 'orthopedics',
  thigh: 'orthopedics',
  calf: 'orthopedics',
  hamstring: 'orthopedics',
  quad: 'orthopedics',
  shin: 'orthopedics',
  limb: 'orthopedics',
  sprain: 'orthopedics',
  strain: 'orthopedics',
  torn: 'orthopedics',
  'lower back': 'orthopedics',
  'upper back': 'orthopedics',
  'arm pain': 'orthopedics',
  arm: 'orthopedics',
  hand: 'orthopedics',
  finger: 'orthopedics',
  fingers: 'orthopedics',
  toe: 'orthopedics',
  toes: 'orthopedics',
  'hip replacement': 'orthopedics',
  'knee replacement': 'orthopedics',
  'physical therapy': 'orthopedics',

  // DERMATOLOGY - Dr. Priya Nair
  skin: 'dermatology',
  rash: 'dermatology',
  rashes: 'dermatology',
  acne: 'dermatology',
  hair: 'dermatology',
  'hair loss': 'dermatology',
  nail: 'dermatology',
  nails: 'dermatology',
  mole: 'dermatology',
  moles: 'dermatology',
  eczema: 'dermatology',
  psoriasis: 'dermatology',
  dermatitis: 'dermatology',
  hives: 'dermatology',
  itching: 'dermatology',
  itchy: 'dermatology',
  lesion: 'dermatology',
  lesions: 'dermatology',
  sunburn: 'dermatology',
  wart: 'dermatology',
  warts: 'dermatology',
  fungal: 'dermatology',
  ringworm: 'dermatology',
  scalp: 'dermatology',
  dryness: 'dermatology',
  'dry skin': 'dermatology',
  blemish: 'dermatology',
  blemishes: 'dermatology',
  spot: 'dermatology',
  spots: 'dermatology',
  breakout: 'dermatology',
  pimple: 'dermatology',
  pimples: 'dermatology',
  allergy: 'dermatology',
  'allergic reaction': 'dermatology',
  'skin cancer': 'dermatology',
  melanoma: 'dermatology'
};

const SPECIALTY_QUERY_ALIASES = {
  cardiology: ['cardiology', 'cardiologist', 'cardiac'],
  orthopedics: ['orthopedics', 'orthopedist', 'orthopedic'],
  dermatology: ['dermatology', 'dermatologist'],
  neurology: ['neurology', 'neurologist', 'neurological'],
  cardiologist: ['cardiology', 'cardiologist', 'cardiac'],
  orthopedist: ['orthopedics', 'orthopedist', 'orthopedic'],
  dermatologist: ['dermatology', 'dermatologist'],
  neurologist: ['neurology', 'neurologist', 'neurological']
};

const OUT_OF_SCOPE_KEYWORDS = [
  'stomach',
  'abdomen',
  'abdominal',
  'gut',
  'digestive',
  'digestion',
  'nausea',
  'vomiting',
  'diarrhea',
  'constipation',
  'bowel',
  'intestine',
  'liver',
  'kidney',
  'bladder',
  'urinary',
  'urology',
  'gastro',
  'eye',
  'eyes',
  'vision',
  'sight',
  'glasses',
  'optometry',
  'ophthalmology',
  'ear',
  'ears',
  'hearing',
  'nose',
  'throat',
  'ent',
  'sinus',
  'teeth',
  'dental',
  'dentist',
  'gums',
  'tooth',
  'mental health',
  'anxiety',
  'depression',
  'psychiatry',
  'psychiatrist',
  'therapy',
  'counseling',
  'psychology',
  'psychologist',
  'gynecology',
  'obgyn',
  'pregnancy',
  'fertility',
  'pediatric',
  'pediatrics',
  'children',
  'child doctor',
  'endocrine',
  'thyroid',
  'diabetes',
  'hormone',
  'oncology',
  'cancer',
  'tumor',
  'chemotherapy',
  'lung',
  'respiratory',
  'breathing',
  'asthma',
  'pulmonary'
];

const findMatchingProviders = (bodyPart = '') => {
  const input = bodyPart.toLowerCase().trim();

  if (!input) {
    return null;
  }

  const sortedKeywords = Object.keys(SPECIALTY_KEYWORD_MAP).sort(
    (left, right) => right.length - left.length
  );

  for (const keyword of sortedKeywords) {
    if (input.includes(keyword)) {
      return SPECIALTY_KEYWORD_MAP[keyword];
    }
  }

  const normalizedInputTokens = normalizeTokens(input);

  for (const token of normalizedInputTokens) {
    if (SPECIALTY_KEYWORD_MAP[token]) {
      return SPECIALTY_KEYWORD_MAP[token];
    }
  }

  return null;
};

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

const parsePreferredAfterDate = (value = '') => {
  if (!value) {
    return null;
  }

  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
};

const looksLikeUuid = (value = '') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(value).trim()
  );

const normalizePendingSlots = (pendingSlots = {}) => {
  let parsedSlots = pendingSlots;

  if (typeof parsedSlots === 'string') {
    try {
      parsedSlots = JSON.parse(parsedSlots);
    } catch {
      return {};
    }
  }

  if (!parsedSlots || typeof parsedSlots !== 'object' || Array.isArray(parsedSlots)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parsedSlots).filter(
      ([key, value]) => /^\d+$/.test(String(key)) && value && typeof value === 'object'
    )
  );
};

const buildBookingOptions = (formattedOptions = []) =>
  formattedOptions.map((option) => ({
    option_number: option.option_number,
    slot_id: option.slot_id,
    provider_id: option.provider_id,
    provider_name: option.provider_name,
    specialty: option.specialty,
    slot_datetime: option.slot_datetime,
    spoken_text: option.text
  }));

const buildPendingSlotMap = (formattedOptions = []) =>
  formattedOptions.reduce((slotMap, option) => {
    slotMap[String(option.option_number)] = {
      slot_id: option.slot_id,
      provider_id: option.provider_id,
      provider_name: option.provider_name,
      specialty: option.specialty,
      slot_datetime: option.slot_datetime,
      date_formatted: formatDayLabel(option.slot_datetime),
      time_formatted: new Date(option.slot_datetime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York'
      })
    };

    return slotMap;
  }, {});

const savePendingSlots = async (sessionId, slotMap = {}) => {
  if (!sessionId) {
    return;
  }

  await query(
    `
      UPDATE sessions
      SET pending_slots = $2::jsonb, updated_at = NOW()
      WHERE id = $1
    `,
    [sessionId, JSON.stringify(slotMap)]
  );

  logger.info(`[SLOTS] Saved ${Object.keys(slotMap).length} slots to session ${sessionId}`);
};

const clearPendingSlots = async (sessionId) => {
  if (!sessionId) {
    return;
  }

  await query(
    `
      UPDATE sessions
      SET pending_slots = '{}'::jsonb, updated_at = NOW()
      WHERE id = $1
    `,
    [sessionId]
  );
};

const storeRecentAvailability = (sessionId, availabilityContext = {}) => {
  if (!sessionId || !availabilityContext.bookingOptions?.length) {
    return;
  }

  recentAvailabilityBySession.set(sessionId, {
    savedAt: Date.now(),
    ...availabilityContext,
    selectedOptionNumber: availabilityContext.selectedOptionNumber || null
  });
};

const getRecentAvailability = (sessionId) => {
  if (!sessionId) {
    return null;
  }

  const entry = recentAvailabilityBySession.get(sessionId);

  if (!entry) {
    return null;
  }

  if (Date.now() - entry.savedAt > 1000 * 60 * 60) {
    recentAvailabilityBySession.delete(sessionId);
    return null;
  }

  return entry;
};

const resolveBookingSelection = ({
  session_id,
  slot_id,
  provider_id,
  option_number
}) => {
  const availabilityContext = getRecentAvailability(session_id);
  const bookingOptions = availabilityContext?.bookingOptions;

  if (!bookingOptions?.length) {
    return null;
  }

  const numericSelection =
    option_number ||
    (/^\d+$/.test(String(slot_id || '').trim())
      ? Number.parseInt(String(slot_id).trim(), 10)
      : null);

  if (numericSelection) {
    const optionMatch = bookingOptions.find(
      (option) => option.option_number === numericSelection
    );

    if (optionMatch) {
      return optionMatch;
    }
  }

  if (slot_id && looksLikeUuid(slot_id)) {
    const slotMatch = bookingOptions.find((option) => option.slot_id === slot_id);

    if (slotMatch) {
      return slotMatch;
    }
  }

  if (provider_id && looksLikeUuid(provider_id)) {
    const providerMatch = bookingOptions.find(
      (option) => option.provider_id === provider_id
    );

    if (providerMatch) {
      return providerMatch;
    }
  }

  return null;
};

const setRecentAvailabilitySelection = (sessionId, optionNumber) => {
  const availabilityContext = getRecentAvailability(sessionId);

  if (!availabilityContext) {
    return null;
  }

  const updatedContext = {
    ...availabilityContext,
    selectedOptionNumber: optionNumber,
    savedAt: Date.now()
  };

  recentAvailabilityBySession.set(sessionId, updatedContext);
  return updatedContext;
};

const extractPreferredDay = (value = '') => {
  const normalized = String(value).toLowerCase();

  for (const [token, label] of Object.entries(WEEKDAY_LABELS)) {
    if (new RegExp(`\\b${token}\\b`, 'i').test(normalized)) {
      return label;
    }
  }

  return null;
};

const extractNumericSelection = (value = '') => {
  const normalized = String(value).trim().toLowerCase();
  const match =
    normalized.match(/(?:option|number|pick|choose)?\s*(\d{1,2})\b/) ||
    normalized.match(/^(\d{1,2})$/);

  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10);
};

const extractTimeSelection = (value = '') => {
  const normalized = String(value).trim().toLowerCase();

  if (/\b(morning|afternoon|evening)\b/.test(normalized)) {
    return normalized.match(/\b(morning|afternoon|evening)\b/)?.[1] || null;
  }

  const match = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);

  if (!match) {
    return null;
  }

  const [, hour, minutes = '00', meridiem] = match;
  return `${Number.parseInt(hour, 10)}:${minutes.padStart(2, '0')} ${meridiem.toUpperCase()}`;
};

const resolvePendingSlotSelection = ({
  pendingSlots = {},
  optionNumber,
  slotReference = ''
}) => {
  const normalizedSlots = normalizePendingSlots(pendingSlots);
  const normalizedOptionNumber =
    optionNumber && Number.parseInt(optionNumber, 10) > 0
      ? String(Number.parseInt(optionNumber, 10))
      : '';

  if (normalizedOptionNumber && normalizedSlots[normalizedOptionNumber]) {
    return {
      option_number: Number.parseInt(normalizedOptionNumber, 10),
      ...normalizedSlots[normalizedOptionNumber]
    };
  }

  const normalizedReference = String(slotReference || '').trim();

  if (!normalizedReference) {
    return null;
  }

  if (/^\d+$/.test(normalizedReference) && normalizedSlots[normalizedReference]) {
    return {
      option_number: Number.parseInt(normalizedReference, 10),
      ...normalizedSlots[normalizedReference]
    };
  }

  const loweredReference = normalizedReference.toLowerCase();
  const extractedTime = extractTimeSelection(normalizedReference)?.toLowerCase() || '';

  for (const [optionKey, slot] of Object.entries(normalizedSlots)) {
    const timeFormatted = String(slot.time_formatted || '').toLowerCase();
    const dateFormatted = String(slot.date_formatted || '').toLowerCase();
    const slotDateTime = String(slot.slot_datetime || '');
    const compositeLabel = `${dateFormatted} ${timeFormatted}`.trim();

    if (
      slot.slot_id === normalizedReference ||
      slotDateTime === normalizedReference ||
      slotDateTime.toLowerCase() === loweredReference ||
      (timeFormatted && timeFormatted.includes(loweredReference)) ||
      (compositeLabel && compositeLabel.includes(loweredReference)) ||
      (extractedTime && timeFormatted === extractedTime)
    ) {
      return {
        option_number: Number.parseInt(optionKey, 10),
        ...slot
      };
    }
  }

  return null;
};

const isConfirmationMessage = (value = '') =>
  /\b(yes|yeah|yep|confirm|confirmed|book it|book it now|yes book it|yes confirm|please book|go ahead)\b/i.test(
    value
  );

const isAnytimeMessage = (value = '') =>
  /\b(any time|anytime|whatever works|anything works|any slot|any option)\b/i.test(
    value
  );

const formatAvailabilityPrompt = (availabilityContext, introLine) => {
  const options = (availabilityContext.bookingOptions || [])
    .map((option) => option.spoken_text)
    .join('\n');

  return `${introLine}\n\n${options}\n\nPlease let me know which option you'd like to choose by selecting a number.`;
};

const buildMissingFieldPrompt = (missingField, bodyPart) => {
  switch (missingField) {
    case 'first name':
    case 'patient_first_name':
      return 'Before I book that, I still need your first name.';
    case 'last name':
    case 'patient_last_name':
      return 'Before I book that, I still need your last name.';
    case 'date of birth':
    case 'patient_dob':
      return 'Before I book that, I still need your date of birth in MM/DD/YYYY format.';
    case 'phone':
    case 'patient_phone':
      return 'Before I book that, I still need your phone number.';
    case 'email':
    case 'patient_email':
      return 'Before I book that, I still need your email address for the confirmation.';
    default:
      return `Before I book that, I still need one more detail${bodyPart ? ` for your ${bodyPart} visit` : ''}.`;
  }
};

const buildTrimmedConversationHistory = (history = [], session = {}) => {
  const MAX_HISTORY = 40;

  if (history.length <= MAX_HISTORY) {
    return history;
  }

  const firstTwo = history.slice(0, 2);
  const recent = history.slice(-(MAX_HISTORY - 2));
  const patientSummary = [
    `name: ${[session.patient_first_name, session.patient_last_name].filter(Boolean).join(' ').trim() || 'unknown'}`,
    `email: ${session.patient_email || 'unknown'}`,
    `phone: ${session.patient_phone || 'unknown'}`
  ].join(', ');
  const trimmedHistory = [
    ...firstTwo,
    {
      role: 'system',
      content: `[Earlier conversation trimmed for brevity. Patient info: ${patientSummary}]`
    },
    ...recent
  ];

  logger.info(
    `[CHAT] History trimmed from ${history.length} to ${trimmedHistory.length} messages`
  );

  return trimmedHistory;
};

const normalizeProviderReference = (value = '') =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/^dr\.?\s*/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const slugifyProviderName = (value = '') =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/^dr\.?\s*/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const resolveProviderId = async (providerReference = '') => {
  if (!providerReference) {
    return null;
  }

  if (looksLikeUuid(providerReference)) {
    return providerReference;
  }

  const normalizedReference = normalizeProviderReference(providerReference);
  const slugReference = slugifyProviderName(providerReference);
  const { rows } = await query(
    `
      SELECT id, name
      FROM providers
    `
  );

  const matchedProvider = rows.find((provider) => {
    const normalizedName = normalizeProviderReference(provider.name);
    const slugName = slugifyProviderName(provider.name);

    return (
      normalizedName === normalizedReference ||
      slugName === slugReference ||
      normalizedName.includes(normalizedReference) ||
      normalizedReference.includes(normalizedName)
    );
  });

  return matchedProvider?.id || null;
};

const resolveSlotFromProviderOptions = async ({ providerId, optionNumber }) => {
  if (!providerId || !optionNumber || optionNumber < 1) {
    return null;
  }

  const { rows } = await query(
    `
      SELECT id, provider_id, slot_datetime
      FROM provider_slots
      WHERE provider_id = $1
        AND is_available = TRUE
        AND slot_datetime > NOW()
        AND slot_datetime <= NOW() + INTERVAL '45 days'
      ORDER BY slot_datetime
      LIMIT 6
    `,
    [providerId]
  );

  const selectedSlot = rows[optionNumber - 1];

  if (!selectedSlot) {
    return null;
  }

  return {
    slot_id: selectedSlot.id,
    provider_id: selectedSlot.provider_id,
    slot_datetime: selectedSlot.slot_datetime,
    option_number: optionNumber
  };
};

const buildFallbackReply = async (sessionId, userMessage) => {
  const normalized = userMessage.toLowerCase();
  const dobCandidate =
    String(userMessage).match(/\b(\d{1,4}[/-]\d{1,2}[/-]\d{1,4}|\d{8})\b/)?.[1] || '';

  if (
    /(call me|schedule a call|phone call|call me instead|prefer to talk|talk by phone)/i.test(
      userMessage
    )
  ) {
    return VOICE_HANDOFF_REPLY;
  }

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

export const getAvailableSlots = async (
  {
    session_id = '',
    body_part,
    preferred_day = '',
    preferred_after_date = '',
    preferred_time = ''
  },
  sessionId = session_id
) => {
  const activeSessionId = sessionId;
  const specialty = findMatchingProviders(body_part);
  const preferredAfterDate = parsePreferredAfterDate(preferred_after_date);
  const providerParams = [];
  let providerQuery = `
      SELECT id, name, specialty, body_parts, bio
      FROM providers
  `;

  if (specialty) {
    providerParams.push(SPECIALTY_QUERY_ALIASES[specialty] || [specialty]);
    providerQuery += `
      WHERE LOWER(specialty) = ANY($1::text[])
      ORDER BY name
    `;
  } else {
    providerQuery += `
      ORDER BY specialty, name
    `;
  }

  const providerResult = await query(
    providerQuery,
    providerParams
  );

  let matchedProviders = [];

  if (specialty) {
    matchedProviders = providerResult.rows.map((provider) => ({
      ...provider,
      match_score: 100,
      matched_terms: [specialty]
    }));
  } else {
    const inputTokens = new Set(normalizeTokens(body_part));

    matchedProviders = providerResult.rows
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
  }

  if (!matchedProviders.length) {
    if (activeSessionId) {
      recentAvailabilityBySession.delete(activeSessionId);
      await clearPendingSlots(activeSessionId);
    }

    const noMatchMessage = OUT_OF_SCOPE_KEYWORDS.some((keyword) =>
      body_part.toLowerCase().includes(keyword)
    )
      ? `We don't have that specialist here - ${body_part} is outside our four specialties (cardiology, orthopedics, dermatology, and neurology). For that, your primary care doctor would be a great first call. Is there anything else I can help with?`
      : `We don't have a specialist for "${body_part}" at our practice. We have Cardiology (heart/chest), Orthopedics (bones/joints), Dermatology (skin/hair), and Neurology (headaches/nerves).`;

    return {
      error: 'no_match',
      body_part,
      preferred_day: preferred_day || null,
      preferred_after_date: preferredAfterDate?.toISOString() || null,
      preferred_time: preferred_time || null,
      providers: [],
      message: noMatchMessage,
      summary: noMatchMessage
    };
  }

  const providerMatches = [];
  const primaryProvider = matchedProviders[0];
  let primaryProviderFutureSlots = [];

  for (const provider of matchedProviders.slice(0, 4)) {
    const slotQueryParams = [provider.id];
    let dateFilter =
      'AND slot_datetime > NOW() AND slot_datetime <= NOW() + INTERVAL \'45 days\'';

    if (preferredAfterDate) {
      slotQueryParams.push(preferredAfterDate.toISOString());
      dateFilter =
        'AND slot_datetime > $2::timestamptz AND slot_datetime < $2::timestamptz + INTERVAL \'14 days\'';
    }

    const slotResult = await query(
      `
        SELECT id, provider_id, slot_datetime
        FROM provider_slots
        WHERE provider_id = $1
          AND is_available = TRUE
          ${dateFilter}
        ORDER BY slot_datetime
        LIMIT 30
      `,
      slotQueryParams
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
      text: `${index + 1}. ${formatSlotDateTime(slot.slot_datetime)}`,
      detailed_text: `${index + 1}. ${formatSlotDateTime(slot.slot_datetime)} - ${slot.provider_name} (${slot.specialty})`
    }));
  const bookingOptions = buildBookingOptions(formattedOptions);
  const slotMap = buildPendingSlotMap(formattedOptions);

  const summary = formattedOptions.length
    ? `I have the following available with ${primaryProvider.name}:\n${formattedOptions
        .map((option) => option.text)
        .join('\n')}`
    : 'I found matching specialists, but no available slots matched the preferred day or time.';

  if (!formattedOptions.length) {
    if (activeSessionId) {
      recentAvailabilityBySession.delete(activeSessionId);
      await clearPendingSlots(activeSessionId);
    }

    const nextAvailableDays = buildNextAvailableDays(primaryProviderFutureSlots);

    return {
      error: 'no_slots',
      body_part,
      preferred_day: preferred_day || null,
      preferred_after_date: preferredAfterDate?.toISOString() || null,
      preferred_time: preferred_time || null,
      provider_name: primaryProvider.name,
      specialty: primaryProvider.specialty,
      next_available_days: nextAvailableDays,
      summary: nextAvailableDays.length
        ? `We don't have ${preferred_day || preferred_time || 'that'} availability for Dr. ${primaryProvider.name.replace(
            /^Dr\.\s*/i,
            ''
          )}, but I have openings on ${nextAvailableDays.join(
            ' and '
          )}.`
        : `I'm sorry, Dr. ${primaryProvider.name.replace(
            /^Dr\.\s*/i,
            ''
          )} doesn't have any available appointments in the next 45 days. Would you like me to add you to the waitlist, or can I help you with anything else?`
    };
  }

  if (activeSessionId) {
    await savePendingSlots(activeSessionId, slotMap);
  }

  storeRecentAvailability(activeSessionId, {
    bodyPart: body_part,
    providerId: primaryProvider.id,
    providerName: primaryProvider.name,
    specialty: primaryProvider.specialty,
    preferredDay: preferred_day || '',
    preferredAfterDate: preferredAfterDate?.toISOString() || '',
    preferredTime: preferred_time || '',
    bookingOptions
  });

  return {
    success: true,
    body_part,
    matched_specialty: specialty || primaryProvider.specialty.toLowerCase(),
    preferred_day: preferred_day || null,
    preferred_after_date: preferredAfterDate?.toISOString() || null,
    preferred_time: preferred_time || null,
    provider_name: primaryProvider.name,
    specialty: primaryProvider.specialty,
    slots: formattedOptions.map((option) => {
      const day = new Date(option.slot_datetime).toLocaleDateString('en-US', {
        weekday: 'long',
        timeZone: 'America/New_York'
      });
      const date = formatDayLabel(option.slot_datetime);
      const time = new Date(option.slot_datetime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York'
      });

      return {
        option_number: option.option_number,
        day,
        date,
        time,
        display: `${option.option_number}. ${day}, ${date} at ${time}`
      };
    }),
    providers: providerMatches.map((provider) => ({
      provider_name: provider.provider_name,
      specialty: provider.specialty,
      bio: provider.bio,
      body_parts: provider.body_parts,
      matched_terms: provider.matched_terms,
      slots: provider.slots.map((slot) => ({
        date: formatDayLabel(slot.slot_datetime),
        time: new Date(slot.slot_datetime).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'America/New_York'
        }),
        slot_datetime: slot.slot_datetime
      }))
    })),
    instruction:
      'Show these slots in a clean numbered list. Use full date format. After listing, ask which works for them - keep it brief and natural.',
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
  const resolvedProviderId = (await resolveProviderId(provider_id)) || provider_id;

  const { rows: providerRows } = await query(
    `
      SELECT id, name, specialty
      FROM providers
      WHERE id = $1
    `,
    [resolvedProviderId]
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
      resolvedProviderId,
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
    provider_id: resolvedProviderId,
    provider_name: provider.name,
    specialty: provider.specialty,
    patient_name: resolvedPatientName,
    patient_email: resolvedPatientEmail,
    patient_phone: resolvedPatientPhone,
    reason,
    confirmation_message: `You're on the waitlist for ${provider.name}. We'll reach out if an earlier appointment opens up.`
  };
};

export const bookAppointment = async (args = {}, sessionId = args.session_id) => {
  const activeSessionId = sessionId || args.session_id || '';
  const { option_number, sms_opted_in } = args;

  logger.info(`[BOOK] Session ${activeSessionId} booking option ${option_number}`);

  if (!activeSessionId) {
    return {
      error: 'session_not_found',
      message: 'Session expired. Please start over.'
    };
  }

  const sessionResult = await query(
    `
      SELECT *
      FROM sessions
      WHERE id = $1
    `,
    [activeSessionId]
  );

  if (!sessionResult.rows.length) {
    return {
      error: 'session_not_found',
      message: 'Session expired. Please start over.'
    };
  }

  const session = sessionResult.rows[0];
  const pendingSlots = normalizePendingSlots(session.pending_slots);
  const slotData = resolvePendingSlotSelection({
    pendingSlots,
    optionNumber: option_number,
    slotReference: args.slot_id || ''
  });

    if (!slotData) {
      const availableOptions = Object.keys(pendingSlots);
      logger.error(
        `[BOOK] Cannot resolve slot. option_number=${option_number}, pending_slots keys=${Object.keys(
          pendingSlots
        ).join(', ')}`
      );
      return {
        error: 'slot_not_resolved',
        available_options: availableOptions,
        message: availableOptions.length
          ? `I couldn't identify which slot you selected. Available options are: ${availableOptions.join(
              ', '
            )}. Please reply with just the number.`
          : "I couldn't identify which slot you selected. Please ask me to show the available times again."
      };
    }

  const { slot_id, provider_id, provider_name, specialty, date_formatted, time_formatted } =
    slotData;

  logger.info(`[BOOK] Resolved to slot_id=${slot_id}, provider=${provider_name}`);

  const patient = {
    first_name: session.patient_first_name || args.patient_first_name || '',
    last_name: session.patient_last_name || args.patient_last_name || '',
    dob: session.patient_dob || args.patient_dob || '',
    phone: session.patient_phone || args.patient_phone || '',
    email: session.patient_email || args.patient_email || ''
  };

  const missing = [];

  if (!patient.first_name) {
    missing.push('first name');
  }
  if (!patient.last_name) {
    missing.push('last name');
  }
  if (!patient.email) {
    missing.push('email');
  }

  if (missing.length) {
    return {
      error: 'missing_patient_data',
      missing,
      message: `I still need: ${missing.join(', ')}. Could you provide that?`
    };
  }

  if (patient.dob && !isValidDobFormat(patient.dob)) {
    return {
      error: 'invalid_dob',
      message: 'Please re-enter the date of birth in MM/DD/YYYY format.'
    };
  }

  const slotCheck = await query(
    `
      SELECT *
      FROM provider_slots
      WHERE id = $1
        AND is_available = TRUE
    `,
    [slot_id]
  );

  if (!slotCheck.rows.length) {
    await clearPendingSlots(activeSessionId);
    return {
      error: 'slot_taken',
      message: 'That slot was just taken by another patient. Let me find you the next available options.'
    };
  }

  const normalizedSmsOptIn = sms_opted_in === true || sms_opted_in === 'true';
  const client = await pool.connect();
  let appointment;

  try {
    await client.query('BEGIN');

    const lockedSessionResult = await client.query(
      `
        SELECT id
        FROM sessions
        WHERE id = $1
        FOR UPDATE
      `,
      [activeSessionId]
    );

    if (!lockedSessionResult.rows.length) {
      await client.query('ROLLBACK');
      return {
        error: 'session_not_found',
        message: 'Session expired. Please start over.'
      };
    }

    const existingAppointmentResult = await client.query(
      `
        SELECT
          appointments.id,
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
      [activeSessionId]
    );

    if (existingAppointmentResult.rows.length) {
      const existingAppointment = existingAppointmentResult.rows[0];
      await client.query('ROLLBACK');
      return {
        error: 'duplicate_appointment',
        message: `You already have an appointment with ${existingAppointment.provider_name} on ${formatSlotDateTime(
          existingAppointment.slot_datetime
        )}. Would you like help rescheduling?`,
        existing_provider_name: existingAppointment.provider_name,
        existing_slot_datetime: existingAppointment.slot_datetime
      };
    }

    const lockedSlotResult = await client.query(
      `
        SELECT *
        FROM provider_slots
        WHERE id = $1
        FOR UPDATE
      `,
      [slot_id]
    );

    if (!lockedSlotResult.rows.length) {
      await client.query('ROLLBACK');
      return {
        error: 'slot_not_found',
        message: 'Could not find that slot. Let me show you available times again.'
      };
    }

    const lockedSlot = lockedSlotResult.rows[0];

    if (!lockedSlot.is_available) {
      await client.query(
        `
          UPDATE sessions
          SET pending_slots = '{}'::jsonb, updated_at = NOW()
          WHERE id = $1
        `,
        [activeSessionId]
      );
      await client.query('ROLLBACK');
      return {
        error: 'slot_taken',
        message: 'That slot was just taken by another patient. Let me find you the next available options.'
      };
    }

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
          sms_opted_in,
          status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'confirmed')
        RETURNING *
      `,
      [
        activeSessionId,
        provider_id,
        slot_id,
        patient.first_name,
        patient.last_name,
        patient.dob || '',
        patient.phone || '',
        patient.email,
        args.reason || session.reason || 'General appointment',
        normalizedSmsOptIn
      ]
    );

    appointment = appointmentResult.rows[0];

    await client.query(
      `
        UPDATE sessions
        SET
          appointment_id = $2,
          intake_complete = TRUE,
          patient_first_name = $3,
          patient_last_name = $4,
          patient_dob = $5,
          patient_phone = $6,
          patient_email = $7,
          pending_slots = '{}'::jsonb,
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        activeSessionId,
        appointment.id,
        patient.first_name,
        patient.last_name,
        patient.dob || '',
        patient.phone || '',
        patient.email
      ]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('[BOOK TRANSACTION ERROR]', error.message, error.stack);
    throw error;
  } finally {
    client.release();
  }

  logger.info(`[BOOK] SUCCESS appointment_id=${appointment.id}`);
  recentAvailabilityBySession.delete(activeSessionId);

  try {
    await sendAppointmentConfirmation({
      to: patient.email,
      patientName: patient.first_name,
      doctorName: provider_name,
      specialty: specialty || '',
      appointmentDate: date_formatted,
      appointmentTime: time_formatted,
      address: OFFICE_INFO.address
    });
    logger.info(`[EMAIL] Confirmation sent to ${patient.email}`);
  } catch (error) {
    logger.error('[EMAIL ERROR]', error.message);
  }

  if (normalizedSmsOptIn && patient.phone) {
    try {
      await sendAppointmentSMS({
        to: patient.phone,
        patientName: patient.first_name,
        doctorName: provider_name,
        appointmentDate: date_formatted,
        appointmentTime: time_formatted
      });
      logger.info(`[SMS] Confirmation sent to ${patient.phone}`);
    } catch (error) {
      logger.error('[SMS ERROR]', error.message);
    }
  }

  return {
    success: true,
    appointment_id: appointment.id,
    session_id: activeSessionId,
    option_number: slotData.option_number || null,
    doctor: provider_name,
    provider_name,
    specialty: specialty || '',
    date: date_formatted,
    time: time_formatted,
    patient_email: patient.email,
    patient_name: patient.first_name,
    patient_first_name: patient.first_name,
    patient_last_name: patient.last_name,
    patient_phone: patient.phone || '',
    message: 'Appointment successfully booked'
  };
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
        SELECT *
        FROM sessions
        WHERE id = $1
      `,
      [sessionId]
    );

    if (rows.length) {
      return rows[0];
    }

    await query(
      `
        INSERT INTO sessions (id, conversation_history)
        VALUES ($1, $2::jsonb)
      `,
      [sessionId, JSON.stringify([])]
    );

    const createdSession = await query(
      `
        SELECT *
        FROM sessions
        WHERE id = $1
      `,
      [sessionId]
    );

    return createdSession.rows[0];
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
        role:
          message.role === 'assistant'
            ? 'assistant'
            : message.role === 'system'
              ? 'system'
              : 'user',
        content: message.content
      }))
    ];
  }

  async createChatCompletion(messages, { includeTools = true, temperature = 0.2 } = {}) {
    const payload = {
      model: this.model,
      temperature,
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
    const choice = data.choices?.[0];
    const message = choice?.message;

    if (!message) {
      throw new Error('OpenAI returned an empty response.');
    }

    return {
      message,
      finishReason: choice?.finish_reason || 'stop'
    };
  }

  async callOpenAI(messages, { includeTools = true } = {}) {
    const { message } = await this.createChatCompletion(messages, {
      includeTools
    });

    return message;
  }

  async updateSessionWithCapturedData(sessionId, payload = {}) {
    const {
      patient_first_name,
      patient_last_name,
      patient_dob,
      patient_phone,
      patient_email
    } = payload;

    if (
      !patient_first_name &&
      !patient_last_name &&
      !patient_dob &&
      !patient_phone &&
      !patient_email
    ) {
      return this.loadSession(sessionId);
    }

    await query(
      `
        UPDATE sessions
        SET
          patient_first_name = COALESCE($2, patient_first_name),
          patient_last_name = COALESCE($3, patient_last_name),
          patient_dob = COALESCE($4, patient_dob),
          patient_phone = COALESCE($5, patient_phone),
          patient_email = COALESCE($6, patient_email),
          updated_at = NOW()
        WHERE id = $1
      `,
      [
        sessionId,
        patient_first_name || null,
        patient_last_name || null,
        patient_dob || null,
        patient_phone || null,
        patient_email || null
      ]
    );

    return this.loadSession(sessionId);
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

  async executeToolCall(toolCall, { sessionId, sessionData }) {
    const toolName = toolCall.function?.name;
    const rawArguments = toolCall.function?.arguments || '{}';
    let parsedArguments = {};
    let toolResult;

    try {
      parsedArguments = JSON.parse(rawArguments);

      switch (toolName) {
        case 'get_available_slots':
          toolResult = await this.toolHandlers.get_available_slots(
            {
              session_id: sessionId,
              ...parsedArguments
            },
            sessionId
          );
          parsedArguments = {
            session_id: sessionId,
            ...parsedArguments
          };
          break;
        case 'book_appointment': {
          const mergedArguments = {
            ...parsedArguments,
            session_id: sessionId
          };

          logger.info(
            `[TOOL] book_appointment merged args: ${JSON.stringify(mergedArguments)}`
          );
          toolResult = await this.toolHandlers.book_appointment(mergedArguments, sessionId);
          parsedArguments = mergedArguments;
          break;
        }
        case 'get_session_state':
          toolResult = await this.toolHandlers.get_session_state({ session_id: sessionId });
          break;
        case 'book_waitlist': {
          const mergedArguments = {
            patient_name: [
              sessionData.patient_first_name,
              sessionData.patient_last_name
            ]
              .filter(Boolean)
              .join(' ')
              .trim(),
            patient_email: sessionData.patient_email,
            patient_phone: sessionData.patient_phone,
            ...parsedArguments,
            session_id: sessionId
          };

          toolResult = await this.toolHandlers.book_waitlist(mergedArguments);
          parsedArguments = mergedArguments;
          break;
        }
        default:
          toolResult = {
            error: `Unknown tool: ${toolName}`
          };
      }
    } catch (error) {
      logger.error(`[TOOL ERROR] ${toolName}:`, error.message, error.stack);
      toolResult = {
        error: error.code || 'tool_failed',
        tool: toolName,
        message: error.message,
        ...(error.details || {})
      };
    }

    const updatedSession = await this.updateSessionWithCapturedData(sessionId, parsedArguments)
      .catch((updateError) => {
        logger.warn('[SESSION UPDATE WARN]', updateError.message);
        return sessionData;
      });

    const serializedResult =
      typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);

    return {
      toolName,
      parsedArguments,
      toolResult,
      serializedResult,
      updatedSession
    };
  }

  findBookingOptionByTime(availabilityContext, userMessage) {
    const extractedTime = extractTimeSelection(userMessage);

    if (!extractedTime) {
      return null;
    }

    const exactMatch = (availabilityContext.bookingOptions || []).find((option) => {
      const optionTime = new Date(option.slot_datetime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit'
      });

      return optionTime.toUpperCase() === extractedTime.toUpperCase();
    });

    if (exactMatch) {
      return exactMatch;
    }

    if (['morning', 'afternoon', 'evening'].includes(extractedTime)) {
      return (availabilityContext.bookingOptions || []).find((option) =>
        matchesPreferredTime(option.slot_datetime, extractedTime)
      );
    }

    return null;
  }

  async completeBookingFromAvailability(sessionId, session, availabilityContext, selectedOption) {
    const bookingResult = await this.toolHandlers.book_appointment({
      session_id: sessionId,
      option_number: selectedOption.option_number,
      reason: availabilityContext.bodyPart || '',
      sms_opted_in: true
    }, sessionId);

    if (!bookingResult?.error) {
      recentAvailabilityBySession.delete(sessionId);
      return {
        reply: `You're all set! Your appointment with ${bookingResult.provider_name || bookingResult.doctor} is confirmed for ${bookingResult.date} at ${bookingResult.time}. You'll receive a confirmation email at ${bookingResult.patient_email}.`,
        interaction: {
          get_available_slots: availabilityContext,
          book_appointment: bookingResult,
          get_session_state: null,
          book_waitlist: null
        },
        refreshSession: true
      };
    }

    if (
      bookingResult.error === 'missing_fields' ||
      bookingResult.error === 'missing_patient_data'
    ) {
      const nextMissingField = bookingResult.missing?.[0] || '';
      setRecentAvailabilitySelection(sessionId, selectedOption.option_number);
      return {
        reply: buildMissingFieldPrompt(nextMissingField, availabilityContext.bodyPart),
        interaction: {
          get_available_slots: availabilityContext,
          book_appointment: bookingResult,
          get_session_state: null,
          book_waitlist: null
        },
        refreshSession: false
      };
    }

    if (
      bookingResult.error === 'slot_taken' ||
      bookingResult.error === 'slot_not_found' ||
      bookingResult.error === 'slot_not_resolved'
    ) {
      const refreshedAvailability = await this.toolHandlers.get_available_slots({
        session_id: sessionId,
        body_part: availabilityContext.bodyPart,
        preferred_day: availabilityContext.preferredDay,
        preferred_after_date: availabilityContext.preferredAfterDate,
        preferred_time: availabilityContext.preferredTime
      }, sessionId);

      return {
        reply: refreshedAvailability.summary,
        interaction: {
          get_available_slots: refreshedAvailability,
          book_appointment: bookingResult,
          get_session_state: null,
          book_waitlist: null
        },
        refreshSession: false
      };
    }

    if (bookingResult.error === 'duplicate_appointment') {
      return {
        reply: bookingResult.message,
        interaction: {
          get_available_slots: availabilityContext,
          book_appointment: bookingResult,
          get_session_state: null,
          book_waitlist: null
        },
        refreshSession: false
      };
    }

    return {
      reply:
        bookingResult.message ||
        "I'm sorry, I hit a snag while booking that appointment. Please try again.",
      interaction: {
        get_available_slots: availabilityContext,
        book_appointment: bookingResult,
        get_session_state: null,
        book_waitlist: null
      },
      refreshSession: false
    };
  }

  async handleAvailabilityFollowUp(sessionId, userMessage, session) {
    const availabilityContext = getRecentAvailability(sessionId);

    if (!availabilityContext?.bookingOptions?.length) {
      return null;
    }

    const preferredDay = extractPreferredDay(userMessage);
    const numericSelection = extractNumericSelection(userMessage);

    if (numericSelection && numericSelection > availabilityContext.bookingOptions.length) {
      return {
        reply: `It seems like you selected an option that isn't available. Please choose from the available options${
          availabilityContext.preferredDay ? ` on ${availabilityContext.preferredDay}` : ''
        }:\n\n${availabilityContext.bookingOptions
          .map((option) => option.spoken_text)
          .join('\n')}\n\nLet me know which number you'd like to pick!`,
        interaction: {
          get_available_slots: availabilityContext,
          book_appointment: null,
          get_session_state: null,
          book_waitlist: null
        },
        refreshSession: false
      };
    }

    if (
      preferredDay &&
      preferredDay !== availabilityContext.preferredDay &&
      availabilityContext.bodyPart
    ) {
      const refreshedAvailability = await this.toolHandlers.get_available_slots({
        session_id: sessionId,
        body_part: availabilityContext.bodyPart,
        preferred_day: preferredDay,
        preferred_after_date: availabilityContext.preferredAfterDate,
        preferred_time: availabilityContext.preferredTime
      }, sessionId);

      return {
        reply: refreshedAvailability.summary,
        interaction: {
          get_available_slots: refreshedAvailability,
          book_appointment: null,
          get_session_state: null,
          book_waitlist: null
        },
        refreshSession: false
      };
    }

    let selectedOption = null;

    if (numericSelection && numericSelection >= 1) {
      selectedOption = availabilityContext.bookingOptions.find(
        (option) => option.option_number === numericSelection
      );
    }

    if (!selectedOption) {
      selectedOption = this.findBookingOptionByTime(availabilityContext, userMessage);
    }

    if (!selectedOption && isConfirmationMessage(userMessage) && availabilityContext.selectedOptionNumber) {
      selectedOption = availabilityContext.bookingOptions.find(
        (option) => option.option_number === availabilityContext.selectedOptionNumber
      );
    }

    if (selectedOption) {
      setRecentAvailabilitySelection(sessionId, selectedOption.option_number);
      return this.completeBookingFromAvailability(
        sessionId,
        session,
        getRecentAvailability(sessionId) || availabilityContext,
        selectedOption
      );
    }

    if (isAnytimeMessage(userMessage)) {
      return {
        reply: formatAvailabilityPrompt(
          availabilityContext,
          `I still have the following available appointments with ${availabilityContext.providerName}${
            availabilityContext.preferredDay ? ` on ${availabilityContext.preferredDay}` : ''
          }:`
        ),
        interaction: {
          get_available_slots: availabilityContext,
          book_appointment: null,
          get_session_state: null,
          book_waitlist: null
        },
        refreshSession: false
      };
    }

    return null;
  }

  async chat(sessionId, userMessage) {
    if (!userMessage || !userMessage.trim()) {
      throw new Error('A message is required.');
    }

    const trimmedMessage = userMessage.trim();
    let session = await this.loadSession(sessionId);
    const history = Array.isArray(session.conversation_history)
      ? [...session.conversation_history]
      : [];
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
        const reply = await this.buildReturningUserReply(sessionId, history);
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

    history.push({
      role: 'user',
      content: trimmedMessage,
      createdAt: new Date().toISOString()
    });

    const guidedAvailabilityResponse = await this.handleAvailabilityFollowUp(
      sessionId,
      trimmedMessage,
      session
    );

    if (guidedAvailabilityResponse) {
      const refreshedSession = guidedAvailabilityResponse.refreshSession
        ? await this.loadSession(sessionId)
        : session;
      const finalHistory = [
        ...history,
        {
          role: 'assistant',
          content: guidedAvailabilityResponse.reply,
          createdAt: new Date().toISOString()
        }
      ];

      await this.saveHistory(sessionId, finalHistory);
      this.latestToolOutputs.set(
        sessionId,
        guidedAvailabilityResponse.interaction || interactionState
      );

      if (guidedAvailabilityResponse.refreshSession) {
        session = refreshedSession;
      }

      return guidedAvailabilityResponse.reply;
    }

    logger.info(
      `[CHAT] Session ${sessionId} | Messages: ${history.length} | User: "${trimmedMessage.substring(
        0,
        50
      )}"`
    );

    const trimmedHistory = buildTrimmedConversationHistory(history, session);
    const messages = this.buildMessages(trimmedHistory);
    let finalAssistantText = '';
    let loopCount = 0;
    const maxLoops = 5;

    try {
      if (!this.apiKey) {
        throw new Error('OPENAI_API_KEY is not configured.');
      }

      while (loopCount < maxLoops) {
        loopCount += 1;
        logger.info(`[OPENAI] Calling API, loop ${loopCount}`);

        const { message: assistantMessage, finishReason } = await this.createChatCompletion(
          messages,
          {
            includeTools: true,
            temperature: 0.3
          }
        );

        logger.info(`[OPENAI] Finish reason: ${finishReason}`);
        messages.push(assistantMessage);

        if (finishReason === 'tool_calls' && assistantMessage.tool_calls?.length) {
          const toolMessages = [];

          for (const toolCall of assistantMessage.tool_calls) {
            logger.info(`[TOOL] Calling: ${toolCall.function.name}`);
            logger.info(`[TOOL] Args: ${toolCall.function.arguments || '{}'}`);

            const execution = await this.executeToolCall(toolCall, {
              sessionId,
              sessionData: session
            });

            interactionState[execution.toolName] = execution.toolResult;
            session = execution.updatedSession;
            logger.info(
              `[TOOL] Result: ${execution.serializedResult.substring(0, 200)}`
            );

            toolMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              name: execution.toolName,
              content: execution.serializedResult
            });
          }

          messages.push(...toolMessages);
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
        loopCount >= maxLoops
          ? "I'm having a moment of confusion. Could you repeat what you'd like to do?"
          : `I'm sorry, I hit a snag while helping with that. Please call ${OFFICE_INFO.phone} and our front desk can help right away.`;
    }

    history.push({
      role: 'assistant',
      content: finalAssistantText,
      createdAt: new Date().toISOString()
    });

    await this.saveHistory(sessionId, history);
    this.latestToolOutputs.set(sessionId, interactionState);

    return finalAssistantText;
  }

  getLatestInteraction(sessionId) {
    return this.latestToolOutputs.get(sessionId) || null;
  }
}
