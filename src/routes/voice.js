import { Router } from 'express';

import { query } from '../db.js';
import { getVoiceSessionContext } from '../services/elevenlabs.js';
import { ariaToolHandlers } from '../services/openai.js';

const router = Router();

const serializeToolResult = (result) => {
  if (typeof result === 'string') {
    return result;
  }

  if (result?.summary) {
    return result.summary;
  }

  if (result?.confirmation_message) {
    return result.confirmation_message;
  }

  if (result?.error) {
    return result.error;
  }

  return JSON.stringify(result);
};

const extractSessionId = (payload = {}) =>
  payload.session_id ||
  payload.sessionId ||
  payload?.dynamic_variables?.session_id ||
  payload?.conversation_initiation_client_data?.dynamic_variables?.session_id ||
  payload?.metadata?.session_id ||
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

router.post('/initiate-call', async (request, response, next) => {
  try {
    const { sessionId } = request.body;

    if (!sessionId) {
      return response.status(400).json({ error: 'sessionId is required.' });
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

    const session = await getVoiceSessionContext(sessionId);

    if (!session.patientPhone) {
      return response.status(400).json({
        error: 'This session does not have a patient phone number yet.'
      });
    }

    const outboundPayload = {
      agent_id: process.env.ELEVENLABS_AGENT_ID,
      agent_phone_number_id: process.env.ELEVENLABS_PHONE_NUMBER_ID,
      to_number: session.patientPhone,
      conversation_initiation_client_data: {
        dynamic_variables: {
          session_id: sessionId,
          patient_name: session.patientFirstName || 'there',
          conversation_summary: session.conversationSummary
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

    if (!elevenLabsResponse.ok) {
      const errorBody = await elevenLabsResponse.text();
      throw new Error(
        `ElevenLabs outbound call request failed (${elevenLabsResponse.status}): ${errorBody}`
      );
    }

    return response.json({
      success: true,
      message: 'Call initiated'
    });
  } catch (error) {
    if (error.message === 'Session not found.') {
      return response.status(404).json({ error: error.message });
    }

    return next(error);
  }
});

router.post('/webhook/tool-call', async (request, response) => {
  const { tool_name, tool_input, session_id } = request.body;

  if (!tool_name) {
    return response.status(400).json({ error: 'tool_name is required.' });
  }

  const handler = ariaToolHandlers[tool_name];

  if (!handler) {
    return response.status(400).json({ error: `Unsupported tool: ${tool_name}` });
  }

  try {
    const parsedToolInput =
      typeof tool_input === 'string' ? JSON.parse(tool_input || '{}') : tool_input || {};
    const mergedToolInput = {
      ...parsedToolInput
    };

    if (!mergedToolInput.session_id && session_id) {
      mergedToolInput.session_id = session_id;
    }

    const toolResult = await handler(mergedToolInput);

    return response.json({
      result: serializeToolResult(toolResult)
    });
  } catch (error) {
    return response.json({
      result: error.message || 'Unable to complete that tool call.'
    });
  }
});

router.post('/webhook/end-of-call', async (request, response, next) => {
  try {
    const sessionId = extractSessionId(request.body);

    if (!sessionId) {
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
