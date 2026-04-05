import dotenv from 'dotenv';

import { query } from '../db.js';
import { SYSTEM_PROMPT } from './openai.js';

dotenv.config();

const SUMMARY_MESSAGE_LIMIT = 6;
const SUMMARY_CHAR_LIMIT = 1400;

const trimSummary = (value) => {
  if (value.length <= SUMMARY_CHAR_LIMIT) {
    return value;
  }

  return `${value.slice(0, SUMMARY_CHAR_LIMIT - 3)}...`;
};

export const buildConversationSummaryFromHistory = (
  conversationHistory = [],
  limit = SUMMARY_MESSAGE_LIMIT
) => {
  const recentMessages = Array.isArray(conversationHistory)
    ? conversationHistory.slice(-limit)
    : [];

  if (!recentMessages.length) {
    return 'No prior web chat context is available yet.';
  }

  const summary = recentMessages
    .map((message) => {
      const roleLabel = message.role === 'assistant' ? 'Aria' : 'Patient';
      const content = String(message.content || '')
        .replace(/\s+/g, ' ')
        .trim();

      return `${roleLabel}: ${content}`;
    })
    .join(' | ');

  return trimSummary(summary);
};

export const getVoiceSessionContext = async (sessionId) => {
  const { rows } = await query(
    `
      SELECT
        id,
        patient_first_name,
        patient_last_name,
        patient_phone,
        conversation_history
      FROM sessions
      WHERE id = $1
    `,
    [sessionId]
  );

  if (!rows.length) {
    throw new Error('Session not found.');
  }

  const session = rows[0];

  return {
    sessionId: session.id,
    patientFirstName: session.patient_first_name || '',
    patientLastName: session.patient_last_name || '',
    patientPhone: session.patient_phone || '',
    conversationHistory: Array.isArray(session.conversation_history)
      ? session.conversation_history
      : [],
    conversationSummary: buildConversationSummaryFromHistory(
      session.conversation_history || []
    )
  };
};

export const getAgentSystemPrompt = async (sessionId) => {
  const session = await getVoiceSessionContext(sessionId);
  const patientName =
    [session.patientFirstName, session.patientLastName].filter(Boolean).join(' ') ||
    'the patient';

  return `${SYSTEM_PROMPT}

You are continuing a conversation that started on the web. The patient's name is ${patientName}.
Here is a summary of what was discussed: ${session.conversationSummary}.
Pick up naturally from where the conversation left off.`;
};
