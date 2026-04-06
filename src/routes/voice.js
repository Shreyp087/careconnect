import { Router } from 'express';

import { query } from '../db.js';
import { ariaToolHandlers } from '../services/openai.js';
import { logger } from '../utils/logger.js';

const router = Router();

const serializeToolResult = (result) =>
  typeof result === 'string' ? result : JSON.stringify(result);

const formatToolResultForVoice = (toolName, result) => {
  if (!result || typeof result === 'string') {
    return serializeToolResult(result);
  }

  if (toolName === 'get_available_slots') {
    if (result.error) {
      return serializeToolResult({
        error: result.error,
        provider_name: result.provider_name || null,
        specialty: result.specialty || null,
        next_available_days: result.next_available_days || [],
        message: result.message || result.summary || 'Unable to retrieve slots.'
      });
    }

    return serializeToolResult({
      success: true,
      provider_name: result.provider_name,
      specialty: result.specialty,
      message: result.summary,
      voice_booking_hint:
        'Read the numbered options aloud. When the patient chooses a number, call book_appointment using only option_number from the chosen option.',
      instruction: result.instruction,
      options: (result.slots || []).map((option) => ({
        option_number: option.option_number,
        day: option.day,
        date: option.date,
        time: option.time,
        display: option.display,
        spoken_text: option.display || `${option.option_number}. ${option.date} at ${option.time}`
      }))
    });
  }

  if (toolName === 'book_appointment') {
    if (result.error) {
      return serializeToolResult({
        error: result.error,
        missing: result.missing || [],
        message: result.message || 'Unable to complete booking.'
      });
    }

    return serializeToolResult({
      success: true,
      appointment_id: result.appointment_id,
      doctor: result.doctor || result.provider_name,
      specialty: result.specialty || result.provider_specialty,
      date: result.date,
      time: result.time,
      patient_name: result.patient_name || result.patient_first_name,
      message: result.message || result.confirmation_message
    });
  }

  return serializeToolResult(result);
};

const normalizeBoolean = (value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') {
      return true;
    }

    if (value.toLowerCase() === 'false') {
      return false;
    }
  }

  return value;
};

const buildFallbackToolInput = (payload = {}) => {
  const {
    tool_name,
    tool_input,
    session_id,
    sessionId,
    conversation_id,
    conversationId,
    ...rest
  } = payload;

  return rest;
};

const normalizeToolInput = (payload = {}) => {
  const rawToolInput =
    typeof payload.tool_input === 'string'
      ? JSON.parse(payload.tool_input || '{}')
      : payload.tool_input && typeof payload.tool_input === 'object'
        ? payload.tool_input
        : buildFallbackToolInput(payload);
  const mergedToolInput = {
    ...rawToolInput
  };

  if (!mergedToolInput.session_id && (payload.session_id || payload.sessionId)) {
    mergedToolInput.session_id = payload.session_id || payload.sessionId;
  }

  if ('sms_opted_in' in mergedToolInput) {
    mergedToolInput.sms_opted_in = normalizeBoolean(mergedToolInput.sms_opted_in);
  }

  return mergedToolInput;
};

const extractSessionId = (payload = {}) =>
  payload.session_id ||
  payload.sessionId ||
  payload?.dynamic_variables?.session_id ||
  payload?.conversation_initiation_client_data?.dynamic_variables?.session_id ||
  payload?.data?.dynamic_variables?.session_id ||
  payload?.data?.conversation_initiation_client_data?.dynamic_variables?.session_id ||
  payload?.data?.analysis?.dynamic_variables?.session_id ||
  payload?.data?.metadata?.dynamic_variables?.session_id ||
  payload?.metadata?.session_id ||
  payload?.data?.metadata?.session_id ||
  payload?.data?.session_id ||
  '';

const normalizeTranscriptEntries = (payload = {}) => {
  const transcriptCandidates = [
    payload.transcript,
    payload.conversation_transcript,
    payload.messages,
    payload.data?.transcript,
    payload.data?.messages
  ];

  const transcriptSource = transcriptCandidates.find(
    (candidate) =>
      (Array.isArray(candidate) && candidate.length > 0) ||
      (typeof candidate === 'string' && candidate.trim())
  );

  if (Array.isArray(transcriptSource)) {
    return transcriptSource
      .map((entry, index) => {
        const rawRole =
          entry.role || entry.speaker || entry.source || entry.participant || '';
        const content =
          entry.text ||
          entry.message ||
          entry.transcript ||
          (typeof entry.content === 'string' ? entry.content : entry.content?.text) ||
          '';

        if (!content) {
          return null;
        }

        const normalizedRole = /assistant|agent|aria|ai/i.test(rawRole)
          ? 'assistant'
          : 'user';

        return {
          role: normalizedRole,
          content: String(content).trim(),
          createdAt:
            entry.timestamp ||
            entry.time ||
            entry.created_at ||
            new Date(Date.now() + index).toISOString(),
          source: 'voice'
        };
      })
      .filter(Boolean);
  }

  if (typeof transcriptSource === 'string' && transcriptSource.trim()) {
    return [
      {
        role: 'assistant',
        content: `Voice transcript: ${transcriptSource.trim()}`,
        createdAt: new Date().toISOString(),
        source: 'voice'
      }
    ];
  }

  return [];
};

const buildRecentConversationSummary = (history = []) => {
  const recentMessages = Array.isArray(history) ? history.slice(-6) : [];

  if (!recentMessages.length) {
    return 'New conversation - patient is starting fresh.';
  }

  return recentMessages
    .map((message) => {
      const roleLabel = message.role === 'user' ? 'Patient' : 'Aria';
      return `${roleLabel}: ${String(message.content || '').trim()}`;
    })
    .join('\n');
};

router.post('/initiate-call', async (request, response) => {
  try {
    const { sessionId } = request.body;

    if (!sessionId) {
      return response.status(400).json({ error: 'sessionId required' });
    }

    if (
      !process.env.ELEVENLABS_API_KEY ||
      !process.env.ELEVENLABS_AGENT_ID ||
      !process.env.ELEVENLABS_PHONE_NUMBER_ID
    ) {
      return response.status(500).json({
        error:
          'ElevenLabs is not fully configured. ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, and ELEVENLABS_PHONE_NUMBER_ID are required.'
      });
    }

    const sessionResult = await query(
      `
        SELECT *
        FROM sessions
        WHERE id = $1
      `,
      [sessionId]
    );

    if (!sessionResult.rows.length) {
      return response.status(404).json({ error: 'Session not found' });
    }

    const {
      patient_phone: patientPhone,
      patient_first_name: patientFirstName,
      conversation_history: conversationHistory
    } = sessionResult.rows[0];

    if (!patientPhone) {
      return response.status(400).json({
        error: 'no_phone',
        message:
          'No phone number on file. Please provide your phone number in the chat first.'
      });
    }

    const summary = buildRecentConversationSummary(conversationHistory);
    const outboundPayload = {
      agent_id: process.env.ELEVENLABS_AGENT_ID,
      agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID,
      to_number: patientPhone,
      conversation_initiation_client_data: {
        dynamic_variables: {
          session_id: sessionId,
          patient_name: patientFirstName || 'there',
          conversation_summary: summary
        }
      }
    };

    const elevenLabsResponse = await fetch(
      'https://api.elevenlabs.io/v1/convai/twilio/outbound-call',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': process.env.ELEVENLABS_API_KEY
        },
        body: JSON.stringify(outboundPayload)
      }
    );

    const rawResponse = await elevenLabsResponse.text();
    let parsedResponse = {};

    try {
      parsedResponse = rawResponse ? JSON.parse(rawResponse) : {};
    } catch {
      parsedResponse = rawResponse ? { raw: rawResponse } : {};
    }

    if (!elevenLabsResponse.ok) {
      logger.error('[VOICE] ElevenLabs error:', parsedResponse);
      return response.status(500).json({
        error: 'call_failed',
        message: 'Could not initiate call. Please try again.',
        details: parsedResponse
      });
    }

    logger.info('[VOICE] Call initiated:', parsedResponse);

    return response.json({
      success: true,
      message: `Calling ${patientPhone}`,
      phone: patientPhone,
      call_id: parsedResponse.call_id || parsedResponse.id || null
    });
  } catch (error) {
    logger.error('[VOICE ERROR]', error.message);
    return response.status(500).json({ error: error.message });
  }
});

router.post('/webhook/tool-call', async (request, response) => {
  const { tool_name } = request.body;

  if (!tool_name) {
    return response.status(400).json({ error: 'tool_name is required.' });
  }

  const handler = ariaToolHandlers[tool_name];

  if (!handler) {
    return response.status(400).json({ error: `Unsupported tool: ${tool_name}` });
  }

  try {
    const mergedToolInput = normalizeToolInput(request.body);
    const sessionId = extractSessionId(request.body) || mergedToolInput.session_id || '';
    logger.info(`[voice-tool] Running ${tool_name}`);

    const toolResult = await handler(mergedToolInput, sessionId);
    logger.info(`[voice-tool] ${tool_name} completed successfully`);

    return response.json({
      result: formatToolResultForVoice(tool_name, toolResult)
    });
  } catch (error) {
    logger.error(`[voice-tool] ${tool_name} failed: ${error.message}`);
    return response.json({
      result: serializeToolResult({
        error: error.message || 'Unable to complete that tool call.'
      })
    });
  }
});

router.post('/webhook/inbound-call', async (request, response) => {
  try {
    const callerNumber =
      request.body?.caller_number ||
      request.body?.callerNumber ||
      request.body?.data?.caller_number ||
      '';
    logger.info('[VOICE INBOUND] Call from:', callerNumber);

    if (!callerNumber) {
      return response.json({
        dynamic_variables: {
          patient_name: 'there',
          conversation_summary: 'New caller - no prior session found.',
          session_id: 'none'
        }
      });
    }

    const normalizedPhone = String(callerNumber).replace(/\D/g, '');
    const result = await query(
      `
        SELECT
          s.id AS session_id,
          s.patient_first_name,
          s.patient_last_name,
          s.conversation_history,
          s.appointment_id,
          a.slot_id,
          p.name AS doctor_name,
          ps.slot_datetime
        FROM sessions s
        LEFT JOIN appointments a
          ON a.session_id = s.id
         AND a.status = 'confirmed'
        LEFT JOIN providers p
          ON p.id = a.provider_id
        LEFT JOIN provider_slots ps
          ON ps.id = a.slot_id
        WHERE REGEXP_REPLACE(COALESCE(s.patient_phone, ''), '[^0-9]', '', 'g') LIKE $1
        ORDER BY s.updated_at DESC
        LIMIT 1
      `,
      [`%${normalizedPhone.slice(-10)}%`]
    );

    if (!result.rows.length) {
      logger.info('[VOICE INBOUND] No session found for', normalizedPhone);
      return response.json({
        dynamic_variables: {
          patient_name: 'there',
          conversation_summary: 'New caller - no prior session found.',
          session_id: 'none'
        }
      });
    }

    const session = result.rows[0];
    const history = Array.isArray(session.conversation_history)
      ? session.conversation_history
      : [];
    const recent = history
      .slice(-6)
      .map((message) => `${message.role === 'user' ? 'Patient' : 'Aria'}: ${message.content}`)
      .join('\n');

    let summary = recent || 'Returning patient, no recent messages.';

    if (session.doctor_name && session.slot_datetime) {
      const appointmentDate = new Date(session.slot_datetime).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC'
      });
      const appointmentTime = new Date(session.slot_datetime).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'UTC'
      });
      summary = `Patient has a confirmed appointment with ${session.doctor_name} on ${appointmentDate} at ${appointmentTime}.\n\n${summary}`;
    }

    logger.info('[VOICE INBOUND] Found session for', session.patient_first_name || 'there');

    return response.json({
      dynamic_variables: {
        patient_name: session.patient_first_name || 'there',
        conversation_summary: summary,
        session_id: session.session_id
      }
    });
  } catch (error) {
    logger.error('[VOICE INBOUND ERROR]', error.message);
    return response.json({
      dynamic_variables: {
        patient_name: 'there',
        conversation_summary: 'Error loading session.',
        session_id: 'none'
      }
    });
  }
});

router.post('/webhook/end-of-call', async (request, response, next) => {
  try {
    const sessionId = extractSessionId(request.body);

    if (!sessionId) {
      logger.warn(
        `[voice-end-of-call] Missing session_id. Top-level keys: ${Object.keys(
          request.body || {}
        ).join(', ')}`
      );
      return response.status(400).json({ error: 'session_id is required.' });
    }

    const transcriptEntries = normalizeTranscriptEntries(request.body);
    const conversationId =
      request.body.conversation_id ||
      request.body.conversationId ||
      request.body.data?.conversation_id ||
      null;

    const sessionResult = await query(
      `
        SELECT conversation_history
        FROM sessions
        WHERE id = $1
      `,
      [sessionId]
    );

    if (!sessionResult.rows.length) {
      return response.status(404).json({ error: 'Session not found.' });
    }

    const existingHistory = Array.isArray(sessionResult.rows[0].conversation_history)
      ? sessionResult.rows[0].conversation_history
      : [];
    const voiceHistory = transcriptEntries.map((entry) => ({
      ...entry,
      conversationId
    }));
    const updatedHistory = [...existingHistory, ...voiceHistory];

    await query(
      `
        UPDATE sessions
        SET conversation_history = $2::jsonb, updated_at = NOW()
        WHERE id = $1
      `,
      [sessionId, JSON.stringify(updatedHistory)]
    );

    return response.json({
      success: true,
      appended_messages: voiceHistory.length
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
