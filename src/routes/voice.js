import { Router } from 'express';

import { query } from '../db.js';
import { ariaToolHandlers } from '../services/openai.js';
import { logger } from '../utils/logger.js';

const router = Router();

const serializeToolResult = (result) =>
  typeof result === 'string' ? result : JSON.stringify(result);

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
    logger.info(`[voice-tool] Running ${tool_name}`);

    const toolResult = await handler(mergedToolInput);
    logger.info(`[voice-tool] ${tool_name} completed successfully`);

    return response.json({
      result: serializeToolResult(toolResult)
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
