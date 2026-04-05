import { useEffect, useState } from 'react';

const SESSION_STORAGE_KEY = 'careconnect-session-id';
const HIDDEN_GREETING_MESSAGE = 'hello';
const RETURNING_USER_SIGNAL = '__RETURNING_USER__';

const buildLocalMessage = (role, content) => ({
  id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  role,
  content,
  createdAt: new Date().toISOString()
});

const normalizeConversationHistory = (history = []) => {
  if (!Array.isArray(history)) {
    return [];
  }

  const normalizedHistory = history
    .filter((message) => message && ['assistant', 'user'].includes(message.role) && message.content)
    .filter(
      (message) =>
        !(
          message.role === 'user' &&
          message.content?.trim() === RETURNING_USER_SIGNAL
        )
    )
    .map((message, index) => ({
      id: message.id || message.createdAt || `${message.role}-${index}`,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt || new Date().toISOString()
    }));

  if (
    normalizedHistory[0]?.role === 'user' &&
    normalizedHistory[0]?.content?.trim().toLowerCase() === HIDDEN_GREETING_MESSAGE &&
    normalizedHistory[1]?.role === 'assistant'
  ) {
    return normalizedHistory.slice(1);
  }

  return normalizedHistory;
};

const apiRequest = async (path, options = {}) => {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong.');
  }

  return data;
};

const formatAppointmentDate = (value) =>
  new Date(value).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

const formatAppointmentBannerDate = (value) =>
  new Date(value).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

const formatAppointmentBannerTime = (value) =>
  new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });

const formatMessageTimestamp = (value) =>
  new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });

function MedicalCrossIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-end gap-3 animate-rise transition-all duration-300">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-700">
        A
      </div>
      <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-slate-600 shadow-sm">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="h-2 w-2 rounded-full bg-slate-400 animate-bounce"
              style={{ animationDelay: `${dot * 0.12}s`, animationDuration: '0.9s' }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MessageItem({ message }) {
  const isUser = message.role === 'user';
  const timestamp = formatMessageTimestamp(message.createdAt);

  if (isUser) {
    return (
      <div className="flex justify-end animate-rise transition-all duration-300 ease-out">
        <div className="max-w-[85%]">
          <div className="rounded-2xl rounded-br-md bg-sky-500 px-4 py-3 text-sm leading-6 text-white shadow-sm whitespace-pre-wrap">
            {message.content}
          </div>
          <p className="mt-1 text-right text-xs text-slate-400">{timestamp}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-3 animate-rise transition-all duration-300 ease-out">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-700">
        A
      </div>
      <div className="max-w-[88%]">
        <div className="rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-800 shadow-sm whitespace-pre-wrap">
          {message.content}
        </div>
        <p className="mt-1 text-xs text-slate-400">{timestamp}</p>
      </div>
    </div>
  );
}

export default function PatientChat() {
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [loadingSession, setLoadingSession] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [showCallModal, setShowCallModal] = useState(false);
  const [callError, setCallError] = useState('');
  const [isInitiatingCall, setIsInitiatingCall] = useState(false);
  const [intakeComplete, setIntakeComplete] = useState(false);
  const [smsOptedIn, setSmsOptedIn] = useState(true);
  const [patientPhone, setPatientPhone] = useState('');
  const [appointment, setAppointment] = useState(null);

  useEffect(() => {
    const syncSessionState = async (activeSessionId) => {
      try {
        const state = await apiRequest(`/api/session/${activeSessionId}`);

        setIntakeComplete(Boolean(state.intake_complete || state.appointment));
        setPatientPhone(state.patient_phone || '');
        setAppointment(state.appointment || null);

        return state;
      } catch (_error) {
        return null;
      }
    };

    const sendGreeting = async (activeSessionId) => {
      setIsTyping(true);

      try {
        const data = await apiRequest('/api/chat', {
          method: 'POST',
          body: JSON.stringify({
            sessionId: activeSessionId,
            message: HIDDEN_GREETING_MESSAGE
          })
        });

        if (data.conversationHistory?.length) {
          setMessages(normalizeConversationHistory(data.conversationHistory));
        } else if (data.reply) {
          setMessages([buildLocalMessage('assistant', data.reply)]);
        }

        await syncSessionState(activeSessionId);
      } catch (greetingError) {
        setError(greetingError.message);
      } finally {
        setIsTyping(false);
      }
    };

    const initializeSession = async () => {
      setLoadingSession(true);
      setError('');

      try {
        let activeSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
        let existingState = null;

        if (activeSessionId) {
          try {
            existingState = await apiRequest(`/api/session/${activeSessionId}`);
          } catch (_sessionLookupError) {
            window.localStorage.removeItem(SESSION_STORAGE_KEY);
            activeSessionId = '';
          }
        }

        if (!existingState) {
          const createdSession = await apiRequest('/api/session', {
            method: 'POST'
          });

          activeSessionId = createdSession.sessionId || createdSession.id;
          window.localStorage.setItem(SESSION_STORAGE_KEY, activeSessionId);
        }

        setSessionId(activeSessionId);

        if (existingState) {
          setIntakeComplete(Boolean(existingState.intake_complete || existingState.appointment));
          setPatientPhone(existingState.patient_phone || '');
          setAppointment(existingState.appointment || null);

          const restoredMessages = normalizeConversationHistory(
            existingState.conversation_history
          );

          if (restoredMessages.length) {
            setMessages(restoredMessages);
            await sendChatMessage(RETURNING_USER_SIGNAL, {
              sessionId: activeSessionId,
              silentUserMessage: true,
              injectConsentState: false
            });
          } else {
            await sendGreeting(activeSessionId);
          }
        } else {
          await sendGreeting(activeSessionId);
        }
      } catch (sessionError) {
        setError(sessionError.message);
      } finally {
        setLoadingSession(false);
      }
    };

    initializeSession();
  }, []);

  useEffect(() => {
    const thread = document.getElementById('patient-chat-thread');

    if (!thread) {
      return;
    }

    window.setTimeout(() => {
      thread.scrollTo({
        top: thread.scrollHeight,
        behavior: 'smooth'
      });
    }, 40);
  }, [messages, isTyping]);

  useEffect(() => {
    if (!toastMessage) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setToastMessage('');
    }, 3000);

    return () => window.clearTimeout(timeoutId);
  }, [toastMessage]);

  const refreshSessionState = async (activeSessionId) => {
    try {
      const state = await apiRequest(`/api/session/${activeSessionId}`);

      setIntakeComplete(Boolean(state.intake_complete || state.appointment));
      setPatientPhone(state.patient_phone || '');
      setAppointment(state.appointment || null);

      return state;
    } catch (_error) {
      return null;
    }
  };

  const sendChatMessage = async (rawMessage, options = {}) => {
    const trimmedMessage = rawMessage.trim();
    const activeSessionId = options.sessionId || sessionId;

    if (!trimmedMessage || !activeSessionId) {
      return;
    }

    const optimisticMessage = buildLocalMessage('user', trimmedMessage);

    if (!options.silentUserMessage) {
      setMessages((currentMessages) => [...currentMessages, optimisticMessage]);
      setMessageInput('');
    }

    setIsTyping(true);
    setError('');

    try {
      const shouldInjectConsentState = options.injectConsentState !== false;
      const payloadMessage = intakeComplete && shouldInjectConsentState
        ? `${trimmedMessage}\n\nPatient SMS consent status: ${
            smsOptedIn ? 'Patient consents to SMS updates.' : 'Patient does not consent to SMS updates.'
          }`
        : trimmedMessage;

      const data = await apiRequest('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: activeSessionId,
          message: payloadMessage
        })
      });

      if (data.conversationHistory?.length) {
        setMessages(normalizeConversationHistory(data.conversationHistory));
      } else if (data.reply) {
        setMessages((currentMessages) => [
          ...currentMessages,
          buildLocalMessage('assistant', data.reply)
        ]);
      }

      await refreshSessionState(activeSessionId);

      if (data.recommendedProviders?.length) {
        setIntakeComplete(true);
      }
    } catch (messageError) {
      setError(messageError.message);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (loadingSession || isTyping) {
      return;
    }

    await sendChatMessage(messageInput);
  };

  const handleCallConfirm = async () => {
    if (!sessionId) {
      return;
    }

    setCallError('');
    setIsInitiatingCall(true);

    try {
      const data = await apiRequest('/api/voice/initiate-call', {
        method: 'POST',
        body: JSON.stringify({ sessionId })
      });

      setShowCallModal(false);
      setToastMessage(data.message || 'Calling you now...');
    } catch (callRequestError) {
      setCallError(callRequestError.message);
    } finally {
      setIsInitiatingCall(false);
    }
  };

  const handleNewConversation = () => {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.location.reload();
  };

  const handleComposerKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
  };

  return (
    <div className="mx-auto max-w-7xl">
      <div className="grid gap-6 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
        <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:p-7">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
              <MedicalCrossIcon />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">
                Welcome
              </p>
              <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                Greenfield Medical Practice
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                Aria can help you book an appointment, share office details, and point you in the
                right direction for prescription refill questions.
              </p>
            </div>
          </div>

          <div className="mt-8 space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Address
              </p>
              <p className="mt-1 text-sm text-slate-700">
                123 Wellness Drive, Suite 400
                <br />
                Springfield
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Phone
              </p>
              <p className="mt-1 text-sm text-slate-700">555-0100</p>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                Hours
              </p>
              <p className="mt-1 text-sm text-slate-700">
                Monday to Friday: 8:00 AM to 6:00 PM
                <br />
                Saturday: 9:00 AM to 1:00 PM
              </p>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
            </span>
            <div>
              <p className="text-sm font-semibold text-slate-800">AI Assistant Online</p>
              <p className="text-xs text-slate-600">
                Aria is ready to help you schedule now.
              </p>
            </div>
          </div>

          {appointment ? (
            <div className="mt-6 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
                Upcoming visit
              </p>
              <p className="mt-2 text-sm font-medium text-slate-800">
                {appointment.provider_name} on {formatAppointmentDate(appointment.slot_datetime)}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                We have your appointment on file and Aria can still help with follow-up questions.
              </p>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => {
              setCallError('');
              setShowCallModal(true);
            }}
            className="mt-8 inline-flex w-full items-center justify-center rounded-2xl bg-sky-500 px-4 py-3.5 text-sm font-semibold text-white shadow-[0_12px_24px_rgba(14,165,233,0.25)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-sky-600 focus:outline-none focus:ring-4 focus:ring-sky-100"
            disabled={loadingSession}
          >
            Call me instead
          </button>

          <p className="mt-3 text-sm leading-6 text-slate-500">
            Prefer a phone call? Our assistant can hand the conversation off without losing your
            place.
          </p>
        </aside>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-sky-100 text-base font-semibold text-sky-700">
                A
              </div>
              <div>
                <h1 className="text-xl font-semibold text-slate-900">Chat with Aria</h1>
                <p className="text-sm text-slate-500">
                  Ask about scheduling, office hours, directions, or refill support.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleNewConversation}
                className="inline-flex items-center justify-center rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                disabled={loadingSession || isTyping}
              >
                New conversation
              </button>
              <div className="hidden rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500 sm:block">
                Session {sessionId ? sessionId.slice(0, 8) : 'Starting'}
              </div>
            </div>
          </header>

          {appointment ? (
            <div className="border-b border-sky-100 bg-sky-50/80 px-5 py-3 sm:px-6">
              <p className="text-sm font-medium text-sky-900">
                You have an upcoming appointment with {appointment.provider_name} on{' '}
                {formatAppointmentBannerDate(appointment.slot_datetime)} at{' '}
                {formatAppointmentBannerTime(appointment.slot_datetime)}
              </p>
            </div>
          ) : null}

          <div className="flex min-h-[70vh] flex-col bg-white">
            <div
              id="patient-chat-thread"
              className="h-[54vh] min-h-[420px] flex-1 overflow-y-auto scroll-smooth bg-slate-50/70 px-4 py-5 sm:px-6"
            >
              <div className="flex min-h-full flex-col justify-end gap-4">
                {messages.map((message) => (
                  <MessageItem key={message.id} message={message} />
                ))}
                {isTyping ? <TypingIndicator /> : null}
                {!messages.length && !isTyping ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
                    {loadingSession
                      ? 'Connecting you with Aria...'
                      : 'Start typing whenever you are ready.'}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
              {error ? (
                <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              {intakeComplete ? (
                <label className="mb-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={smsOptedIn}
                    onChange={(event) => setSmsOptedIn(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-sky-500 focus:ring-sky-400"
                  />
                  <span>I consent to SMS updates</span>
                </label>
              ) : null}

              <form onSubmit={handleSubmit} className="flex items-end gap-3">
                <div className="flex-1">
                  <label htmlFor="aria-message-input" className="sr-only">
                    Type your message
                  </label>
                  <textarea
                    id="aria-message-input"
                    value={messageInput}
                    onChange={(event) => setMessageInput(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="Tell Aria what you need help with today..."
                    rows={2}
                    className="w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-sky-300 focus:ring-4 focus:ring-sky-50"
                    disabled={loadingSession || isTyping}
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex h-[50px] items-center justify-center rounded-2xl bg-sky-500 px-5 text-sm font-semibold text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-sky-600 focus:outline-none focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!messageInput.trim() || loadingSession || isTyping}
                >
                  Send
                </button>
              </form>

              <div className="mt-3 flex flex-col gap-1 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
                <p>
                  Aria can help with scheduling, office information, and refill directions.
                </p>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-500 ring-1 ring-slate-200">
                    Powered by AI
                  </span>
                  <p>{patientPhone ? `Phone on file: ${patientPhone}` : 'No phone number on file yet.'}</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {showCallModal ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl animate-rise transition-all duration-300">
            <h2 className="text-2xl font-semibold text-slate-900">Switch to a phone call</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              We&apos;ll call you at the number you provided. The AI will pick up right where we
              left off.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {patientPhone ? `Current number on file: ${patientPhone}` : 'If we do not have your number yet, we will confirm it on the call.'}
            </p>

            {callError ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {callError}
              </div>
            ) : null}

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => {
                  setShowCallModal(false);
                  setCallError('');
                }}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition-colors duration-200 hover:bg-slate-50"
                disabled={isInitiatingCall}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCallConfirm}
                className="inline-flex items-center justify-center rounded-2xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition-colors duration-200 hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isInitiatingCall}
              >
                {isInitiatingCall ? 'Starting call...' : 'Call me now'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toastMessage ? (
        <div className="fixed bottom-5 right-5 z-50 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl transition-all duration-300 animate-rise">
          {toastMessage}
        </div>
      ) : null}
    </div>
  );
}
