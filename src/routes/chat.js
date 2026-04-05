import { Router } from 'express';

import { query } from '../db.js';
import {
  ChatService,
  RETURNING_USER_SIGNAL,
  getSessionState
} from '../services/openai.js';

const router = Router();
const chatService = new ChatService();

const mapProviderRecommendations = (toolOutput) =>
  toolOutput?.providers?.map((provider) => ({
    id: provider.provider_id,
    name: provider.provider_name,
    specialty: provider.specialty,
    bio: provider.bio,
    body_parts: provider.body_parts || [],
    available_slots: (provider.slots || []).map((slot) => ({
      id: slot.slot_id,
      provider_id: slot.provider_id,
      slot_datetime: slot.slot_datetime
    }))
  })) || [];

const createSession = async (_request, response, next) => {
  try {
    const { rows } = await query(
      `
        INSERT INTO sessions DEFAULT VALUES
        RETURNING id
      `
    );

    const sessionId = rows[0].id;

    response.status(201).json({
      sessionId,
      id: sessionId
    });
  } catch (error) {
    next(error);
  }
};

const getSession = async (request, response, next) => {
  try {
    const { sessionId } = request.params;
    const state = await getSessionState({ session_id: sessionId });

    response.json({
      id: state.session_id,
      sessionId: state.session_id,
      patient_first_name: state.patient_first_name,
      patient_last_name: state.patient_last_name,
      patient_dob: state.patient_dob,
      patient_phone: state.patient_phone,
      patient_email: state.patient_email,
      intake_complete: state.intake_complete,
      appointment_id: state.appointment_id,
      conversation_history: state.conversation_history,
      created_at: state.created_at,
      updated_at: state.updated_at,
      appointment: state.appointment
    });
  } catch (error) {
    if (error.message === 'Session not found.') {
      return response.status(404).json({ error: error.message });
    }

    return next(error);
  }
};

const updateSession = async (request, response, next) => {
  try {
    const { sessionId } = request.params;
    const {
      patientFirstName,
      patientLastName,
      patientDob,
      patientPhone,
      patientEmail,
      intakeComplete
    } = request.body;

    const { rows } = await query(
      `
        UPDATE sessions
        SET
          patient_first_name = COALESCE($2, patient_first_name),
          patient_last_name = COALESCE($3, patient_last_name),
          patient_dob = COALESCE($4, patient_dob),
          patient_phone = COALESCE($5, patient_phone),
          patient_email = COALESCE($6, patient_email),
          intake_complete = COALESCE($7, intake_complete),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [
        sessionId,
        patientFirstName || null,
        patientLastName || null,
        patientDob || null,
        patientPhone || null,
        patientEmail || null,
        typeof intakeComplete === 'boolean' ? intakeComplete : null
      ]
    );

    if (!rows.length) {
      return response.status(404).json({ error: 'Session not found.' });
    }

    return response.json(rows[0]);
  } catch (error) {
    return next(error);
  }
};

const postChatMessage = async (request, response, next) => {
  try {
    const { sessionId, message } = request.body;

    if (!sessionId || !message) {
      return response.status(400).json({ error: 'sessionId and message are required.' });
    }

    const reply = await chatService.chat(sessionId, message);
    const latestInteraction = chatService.getLatestInteraction(sessionId);
    const state = await getSessionState({ session_id: sessionId });
    const recommendedProviders = mapProviderRecommendations(
      latestInteraction?.get_available_slots
    );
    const conversationHistory =
      message.trim() === RETURNING_USER_SIGNAL
        ? [
            ...(state.conversation_history || []),
            {
              role: 'assistant',
              content: reply,
              createdAt: new Date().toISOString()
            }
          ]
        : state.conversation_history || [];

    return response.json({
      reply,
      sessionId,
      conversationHistory,
      recommendedProviders
    });
  } catch (error) {
    if (error.message === 'Session not found.') {
      return response.status(404).json({ error: error.message });
    }

    return next(error);
  }
};

router.post('/chat', postChatMessage);
router.post('/chat/message', postChatMessage);

router.post('/session', createSession);
router.post('/chat/session', createSession);

router.get('/session/:sessionId', getSession);
router.get('/chat/session/:sessionId', getSession);

router.patch('/session/:sessionId', updateSession);
router.patch('/chat/session/:sessionId', updateSession);

export default router;
