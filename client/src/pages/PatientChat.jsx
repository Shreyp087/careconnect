import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

const SESSION_STORAGE_KEY = 'careconnect-session-id';
const HIDDEN_GREETING_MESSAGE = 'hello';
const RETURNING_USER_SIGNAL = '__RETURNING_USER__';
const OFFICE_PHONE =
  import.meta.env.VITE_OFFICE_PHONE || '(your real number)';
const OFFICE_ADDRESS =
  import.meta.env.VITE_OFFICE_ADDRESS ||
  '123 Wellness Drive, Suite 400, Springfield';
const SLOT_LIST_PATTERN =
  /^\d+\.\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/m;

const buildLocalMessage = (role, content) => ({
  id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  role,
  content,
  createdAt: new Date().toISOString()
});

const cleanMessage = (text = '') =>
  text.replace(/\n?\nPatient SMS consent status:.*$/s, '').trim();

const normalizeConversationHistory = (history = []) => {
  if (!Array.isArray(history)) {
    return [];
  }

  const normalizedHistory = history
    .filter((message) => message && ['assistant', 'user'].includes(message.role) && message.content)
    .filter((message) => message.source !== 'voice')
    .filter((message) => {
      const cleanedContent = cleanMessage(message.content);

      return !(
        message.role === 'user' &&
        cleanedContent === RETURNING_USER_SIGNAL
      );
    })
    .map((message, index) => {
      const cleanedContent = cleanMessage(message.content);

      return {
        id: message.id || message.createdAt || `${message.role}-${index}`,
        role: message.role,
        content: cleanedContent,
        createdAt: message.createdAt || new Date().toISOString()
      };
    })
    .filter((message) => Boolean(message.content));

  if (
    normalizedHistory[0]?.role === 'user' &&
    normalizedHistory[0]?.content?.trim().toLowerCase() === HIDDEN_GREETING_MESSAGE &&
    normalizedHistory[1]?.role === 'assistant'
  ) {
    return normalizedHistory.slice(1);
  }

  return normalizedHistory;
};

const hasSlots = (text = '') => SLOT_LIST_PATTERN.test(text);

const splitSlotDate = (value = '') => {
  const parts = value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const [day, ...dateParts] = parts;

    return {
      day,
      shortDay: day.slice(0, 3).toUpperCase(),
      dateLabel: dateParts.join(', ')
    };
  }

  const fallback = value.trim();

  return {
    day: fallback,
    shortDay: fallback.slice(0, 3).toUpperCase(),
    dateLabel: fallback
  };
};

const parseSlots = (text = '') => {
  const lines = text.split('\n');
  const slots = [];

  for (const line of lines) {
    const match = line.match(/^(\d+)\.\s+(.+?)\s+at\s+(.+?)$/);

    if (match) {
      const rawDate = match[2].trim();
      const { day, shortDay, dateLabel } = splitSlotDate(rawDate);

      slots.push({
        number: Number.parseInt(match[1], 10),
        date: rawDate,
        rawDate,
        day,
        shortDay,
        dateLabel,
        time: match[3].trim(),
        label: line.trim(),
        full: line.trim()
      });
    }
  }

  return slots;
};

const stripSlotListText = (text = '') => {
  const lines = text.split('\n');
  const firstSlotIndex = lines.findIndex((line) =>
    /^\d+\.\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)/.test(line)
  );

  if (firstSlotIndex === -1) {
    return text.trim();
  }

  return lines
    .slice(0, firstSlotIndex)
    .join('\n')
    .trim();
};

const getSlotIntroText = (text = '') => {
  const intro = stripSlotListText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0];

  return intro || "Here are the available appointments:";
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
    throw new Error(data.message || data.error || 'Something went wrong.');
  }

  return data;
};

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

function MenuIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

function LocationPinIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 21s-6-4.35-6-10a6 6 0 1 1 12 0c0 5.65-6 10-6 10Z" />
      <circle cx="12" cy="11" r="2.5" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.4 19.4 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.8.62 2.65a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6.27 6.27l1.25-1.28a2 2 0 0 1 2.11-.45c.86.29 1.75.5 2.65.62A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6l4 2" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4" />
      <path d="M8 3v4" />
      <path d="M3 10h18" />
    </svg>
  );
}

function PaperPlaneIcon() {
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
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22l-4-9-9-4 20-7Z" />
    </svg>
  );
}

function TypingIndicator() {
  return (
    <div className="patient-chat-message-in flex items-end gap-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#67D7C4] text-xs font-semibold text-[#0F2425] shadow-sm">
        A
      </div>
      <div className="rounded-2xl rounded-tl-sm border border-white/80 bg-white/92 px-4 py-3 shadow-[0_12px_30px_rgba(18,37,38,0.08)]">
        <div className="flex items-center gap-1.5">
          {[0, 1, 2].map((dot) => (
            <span
              key={dot}
              className="patient-chat-dot h-2 w-2 rounded-full bg-slate-400"
              style={{ animationDelay: `${dot * 0.12}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ButtonSpinner() {
  return (
    <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
  );
}

function SuggestionPill({ children, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/80 bg-white/82 px-4 py-2 text-sm font-medium text-[#183436] shadow-sm transition-all duration-150 hover:border-[#67D7C4] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function MessageItem({
  message,
  messageKey,
  onDateSelect,
  onDateBack,
  onTimeSelect,
  onShowDifferentDates,
  slotState,
  slotPickerDisabled,
  showDifferentDatesDisabled
}) {
  const isUser = message.role === 'user';
  const timestamp = formatMessageTimestamp(message.createdAt);
  const cleanedContent = cleanMessage(message.content || '');
  const slotMessage = !isUser && hasSlots(cleanedContent);
  const parsedSlots = slotMessage ? parseSlots(cleanedContent) : [];
  const displayContent = slotMessage ? getSlotIntroText(cleanedContent) : cleanedContent;
  const selectedDate = slotState?.selectedDate || null;
  const selectedSlot = slotState?.selectedSlot || null;
  const uniqueDates = [...new Map(parsedSlots.map((slot) => [slot.date, slot])).values()];
  const timeSlotsForDate = selectedDate
    ? parsedSlots.filter((slot) => slot.date === selectedDate)
    : [];
  const timeGridColumns = timeSlotsForDate.length <= 4 ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))';

  if (isUser) {
    return (
      <div className="patient-chat-message-in flex justify-end">
        <div className="max-w-[88%] md:max-w-[75%]">
          <div className="rounded-2xl rounded-tr-sm bg-[linear-gradient(135deg,#67D7C4_0%,#2DCAB3_100%)] px-4 py-3 text-sm leading-6 text-[#0F2425] shadow-[0_16px_34px_rgba(45,202,179,0.24)] whitespace-pre-wrap">
            {cleanedContent}
          </div>
          <p className="mt-1 text-right text-[11px] text-slate-400">{timestamp}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="patient-chat-message-in flex items-end gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#67D7C4] text-xs font-semibold text-[#0F2425] shadow-sm">
        A
      </div>
      <div className="max-w-[92%] md:max-w-[75%]">
        <div className="rounded-2xl rounded-tl-sm border border-white/80 bg-[linear-gradient(180deg,#FFFFFF_0%,#F6FAF7_100%)] px-4 py-3 text-sm leading-6 text-[#1A2B2D] shadow-[0_12px_32px_rgba(18,37,38,0.08)] whitespace-pre-wrap">
          {displayContent}
        </div>
        {slotMessage && parsedSlots.length ? (
          <div className="mt-3 rounded-[24px] border border-white/85 bg-[linear-gradient(180deg,#FFFFFF_0%,#F5F8F4_100%)] p-3 shadow-[0_16px_36px_rgba(18,37,38,0.08)]">
            {selectedSlot ? (
              <div className="mt-2 flex items-center gap-2 rounded-[10px] border border-green-300 bg-green-50 px-3.5 py-2.5">
                <span className="text-base text-green-600">✓</span>
                <span className="text-sm font-medium text-green-700">
                  {selectedSlot.date} at {selectedSlot.time} selected
                </span>
              </div>
            ) : selectedDate ? (
              <div className="mt-1">
                <div className="mb-2.5 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onDateBack(messageKey)}
                    disabled={slotPickerDisabled}
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-[#2A8F84] transition hover:text-[#1D7268] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span aria-hidden="true">←</span>
                    Back
                  </button>
                  <span className="text-[11px] uppercase tracking-[0.05em] text-slate-500">
                    Step 2 of 2 — Choose a time
                  </span>
                </div>

                <div className="mb-2.5 rounded-2xl border border-[#B7EADF] bg-[#ECFAF6] px-3 py-2 text-sm font-medium text-[#246A63]">
                  <span aria-hidden="true" className="mr-2">
                    📅
                  </span>
                  {selectedDate}
                </div>

                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: timeGridColumns }}
                >
                  {timeSlotsForDate.map((slot) => (
                    <button
                      key={`${message.id}-time-${slot.number}`}
                      type="button"
                      onClick={() => onTimeSelect(messageKey, slot)}
                      disabled={slotPickerDisabled}
                      className="rounded-[14px] border border-slate-200 bg-white px-3 py-3 text-center transition-all duration-150 hover:border-[#67D7C4] hover:bg-[#F0FBF8] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="text-base font-bold text-[#2A8F84]">{slot.time}</div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-1">
                <div className="mb-2 text-[11px] uppercase tracking-[0.05em] text-slate-500">
                  Step 1 of 2 — Choose a date
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {uniqueDates.map((slot) => (
                    <button
                      key={`${message.id}-date-${slot.date}`}
                      type="button"
                      onClick={() => onDateSelect(messageKey, slot.date)}
                      disabled={slotPickerDisabled}
                      className="rounded-[18px] border-[1.5px] border-slate-200 bg-white px-4 py-3.5 text-left transition-all duration-150 hover:border-[#67D7C4] hover:bg-[#F0FBF8] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#2A8F84]">
                        {slot.day}
                      </div>
                      <div className="text-[15px] font-semibold text-slate-900">
                        {slot.dateLabel}
                      </div>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={onShowDifferentDates}
                  disabled={showDifferentDatesDisabled}
                  className="mt-2.5 w-full rounded-full border border-slate-200 px-3.5 py-2 text-sm text-slate-500 transition hover:border-[#67D7C4] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Show different dates →
                </button>
              </div>
            )}
          </div>
        ) : null}
        <p className="mt-1 text-[11px] text-slate-400">{timestamp}</p>
      </div>
    </div>
  );
}

export default function PatientChat() {
  const isSendingRef = useRef(false);
  const hasInitialized = useRef(false);
  const [sessionId, setSessionId] = useState('');
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [loadingSession, setLoadingSession] = useState(true);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [toastTone, setToastTone] = useState('neutral');
  const [showCallModal, setShowCallModal] = useState(false);
  const [callError, setCallError] = useState('');
  const [isInitiatingCall, setIsInitiatingCall] = useState(false);
  const [isCallInProgress, setIsCallInProgress] = useState(false);
  const [slotPickerState, setSlotPickerState] = useState({});
  const [intakeComplete, setIntakeComplete] = useState(false);
  const [smsOptedIn, setSmsOptedIn] = useState(true);
  const [patientPhone, setPatientPhone] = useState('');
  const [callPhoneInput, setCallPhoneInput] = useState('');
  const [appointment, setAppointment] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const canInitiateVoiceCall = Boolean(sessionId) && !loadingSession;
  const hasUserMessages = messages.some((message) => message.role === 'user');
  const showWelcomeState = !loadingSession && !isTyping && !hasUserMessages;
  const sessionTail = sessionId ? sessionId.slice(-8) : 'Starting';

  useEffect(() => {
    if (hasInitialized.current) {
      return undefined;
    }

    hasInitialized.current = true;

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

  useEffect(() => {
    if (!isCallInProgress) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setIsCallInProgress(false);
    }, 60000);

    return () => window.clearTimeout(timeoutId);
  }, [isCallInProgress]);

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
    const trimmedMessage = cleanMessage(rawMessage);
    const activeSessionId = options.sessionId || sessionId;

    if (!trimmedMessage || !activeSessionId) {
      return;
    }

    if (isSendingRef.current) {
      console.warn('[CHAT] Message blocked — already sending');
      return;
    }

    isSendingRef.current = true;

    const optimisticMessage = buildLocalMessage('user', trimmedMessage);

    if (!options.silentUserMessage) {
      setMessages((currentMessages) => [...currentMessages, optimisticMessage]);
      setMessageInput('');
    }

    setIsTyping(true);
    setError('');

    try {
      const data = await apiRequest('/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: activeSessionId,
          message: trimmedMessage
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
      console.error('[CHAT ERROR]', messageError);
      setError(messageError.message);

      if (!options.silentUserMessage) {
        setMessages((currentMessages) => [
          ...currentMessages,
          buildLocalMessage(
            'assistant',
            "I'm having a moment of difficulty. Please try again."
          )
        ]);
      }
    } finally {
      setIsTyping(false);
      isSendingRef.current = false;
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (loadingSession || isTyping || isSendingRef.current) {
      return;
    }

    await sendChatMessage(messageInput);
  };

  const handleCallConfirm = async () => {
    if (!sessionId) {
      return;
    }

    const resolvedCallPhone = (callPhoneInput || patientPhone).trim();

    if (!resolvedCallPhone) {
      setCallError('Please enter the best phone number to reach you.');
      return;
    }

    setCallError('');
    setIsInitiatingCall(true);

    try {
      await apiRequest(`/api/session/${sessionId}`, {
        method: 'PATCH',
        body: JSON.stringify({ patientPhone: resolvedCallPhone })
      });

      setPatientPhone(resolvedCallPhone);

      const data = await apiRequest('/api/voice/initiate-call', {
        method: 'POST',
        body: JSON.stringify({ sessionId, phoneNumber: resolvedCallPhone })
      });

      setShowCallModal(false);
      setIsCallInProgress(true);
      setToastMessage('');
      setMessages((currentMessages) => [
        ...currentMessages,
        buildLocalMessage(
          'assistant',
          `Calling you now at ${data.phone || resolvedCallPhone}! Pick up when you see the call - I'll have everything from our chat ready to go.`
        )
      ]);
      await refreshSessionState(sessionId);
    } catch (callRequestError) {
      const fallbackMessage = `Couldn't initiate the call. Please try again or call us at ${OFFICE_PHONE}.`;
      setCallError(callRequestError.message || fallbackMessage);
      setToastTone('error');
      setToastMessage(fallbackMessage);
    } finally {
      setIsInitiatingCall(false);
    }
  };

  const handleCallButtonClick = () => {
    if (!sessionId || isCallInProgress) {
      return;
    }

    setCallError('');
    setCallPhoneInput(patientPhone || '');
    setShowCallModal(true);
    setIsSidebarOpen(false);
  };

  const handleNewConversation = () => {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    window.location.reload();
  };

  const handleComposerKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !isSendingRef.current) {
      event.preventDefault();
      handleSubmit(event);
    }
  };

  const handleDateSelect = (messageId, date) => {
    setSlotPickerState((currentState) => ({
      ...currentState,
      [messageId]: {
        selectedDate: date,
        selectedSlot: null
      }
    }));
  };

  const handleDateBack = (messageId) => {
    setSlotPickerState((currentState) => ({
      ...currentState,
      [messageId]: {
        selectedDate: null,
        selectedSlot: null
      }
    }));
  };

  const handleTimeSelect = async (messageId, slot) => {
    if (!slot || isTyping || isSendingRef.current) {
      return;
    }

    setSlotPickerState((currentState) => ({
      ...currentState,
      [messageId]: {
        selectedDate: slot.date,
        selectedSlot: slot
      }
    }));

    await sendChatMessage(`Option ${slot.number} - ${slot.date} at ${slot.time}`);
  };

  const handleShowDifferentDates = async () => {
    if (isTyping || isSendingRef.current) {
      return;
    }

    await sendChatMessage('Can you show me slots for a different week?');
  };

  const handleSuggestionClick = async (suggestion) => {
    if (isTyping || isSendingRef.current || loadingSession) {
      return;
    }

    await sendChatMessage(suggestion);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(103,215,196,0.18),_transparent_24%),radial-gradient(circle_at_85%_10%,_rgba(204,184,171,0.18),_transparent_22%),linear-gradient(180deg,#F7FAF6_0%,#EEF3EC_100%)] text-slate-900">
      <header className="flex h-14 items-center justify-between border-b border-black/10 bg-[linear-gradient(180deg,#173032_0%,#1E3B3D_100%)] px-4 shadow-[0_14px_36px_rgba(18,37,38,0.22)] md:px-6">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/75 transition hover:bg-white/10 hover:text-white md:hidden"
            aria-label="Open sidebar"
          >
            <MenuIcon />
          </button>
          <div>
            <p className="text-sm font-semibold tracking-[0.18em] text-white">GREENFIELD</p>
            <p className="text-[11px] text-white/55">Medical Practice</p>
          </div>
        </div>

        <Link
          to="/admin"
          className="text-sm font-medium text-white/70 transition hover:text-white"
        >
          Admin Dashboard
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        <div
          className={`fixed inset-0 z-30 bg-slate-950/45 transition-opacity duration-300 md:hidden ${
            isSidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
          onClick={() => setIsSidebarOpen(false)}
          aria-hidden="true"
        />

        <aside
          className={`fixed inset-y-0 left-0 top-14 z-40 flex w-80 max-w-[88vw] flex-col bg-[linear-gradient(180deg,#183133_0%,#223D40_100%)] text-white transition-transform duration-300 md:static md:top-0 md:z-0 md:w-80 md:max-w-none md:translate-x-0 md:border-r md:border-white/10 ${
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-center justify-between px-4 py-4 md:hidden">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-white/45">
              Workspace
            </span>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(false)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
              aria-label="Close sidebar"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="flex h-full flex-col overflow-y-auto pb-6">
            <div className="px-4 pt-5">
              <div className="flex items-center gap-3 rounded-[20px] border border-white/10 bg-white/5 px-4 py-3">
                <span className="relative flex h-3 w-3">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-400" />
                </span>
                <p className="text-sm font-medium text-white">Aria is online</p>
              </div>
            </div>

            <div className="mx-4 my-3 rounded-[24px] border border-white/10 bg-white/6 p-4 shadow-[0_20px_40px_rgba(0,0,0,0.16)]">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/55">
                Greenfield Medical Practice
              </p>
              <div className="mt-4 space-y-3 text-sm text-slate-300">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-sky-400">
                    <LocationPinIcon />
                  </span>
                  <span>{OFFICE_ADDRESS}</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-sky-400">
                    <PhoneIcon />
                  </span>
                  <span>{OFFICE_PHONE}</span>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 text-sky-400">
                    <ClockIcon />
                  </span>
                  <span>
                    Mon-Fri 8:00 AM-6:00 PM
                    <br />
                    Sat 9:00 AM-1:00 PM
                  </span>
                </div>
              </div>
            </div>

            {appointment ? (
              <div className="mx-4 rounded-[24px] bg-[linear-gradient(135deg,#67D7C4_0%,#2DCAB3_100%)] p-4 text-[#0F2425] shadow-[0_18px_36px_rgba(45,202,179,0.28)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#0F2425]/65">
                      Upcoming Visit
                    </p>
                    <p className="mt-2 text-xl font-semibold">{appointment.provider_name}</p>
                    <p className="mt-2 text-sm text-[#0F2425]/75">
                      {formatAppointmentBannerDate(appointment.slot_datetime)}
                    </p>
                    <p className="text-sm text-[#0F2425]/75">
                      {formatAppointmentBannerTime(appointment.slot_datetime)}
                    </p>
                  </div>
                  <span className="rounded-full bg-white/30 p-2 text-[#0F2425]">
                    <CalendarIcon />
                  </span>
                </div>
              </div>
            ) : null}

            <div className="mx-4 mt-4">
              <button
                type="button"
                onClick={handleCallButtonClick}
                title={!patientPhone ? 'Chat first to enable' : undefined}
                disabled={!canInitiateVoiceCall || isCallInProgress}
                className={`w-full rounded-[24px] border px-4 py-4 text-left transition-all duration-200 ${
                  isCallInProgress
                    ? 'border-[#67D7C4]/40 bg-[#67D7C4]/20 text-white'
                    : patientPhone
                      ? 'border-white/20 bg-white/8 text-white hover:bg-white/12'
                      : 'border-white/10 bg-white/[0.04] text-white/75 hover:bg-white/[0.08]'
                } ${
                  !canInitiateVoiceCall ? 'cursor-not-allowed opacity-70' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-[#67D7C4]">
                    <PhoneIcon />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">
                      {isCallInProgress ? 'Call in progress...' : 'Continue by voice call'}
                    </p>
                    <p className="mt-1 text-xs text-white/60">
                      Aria will pick up where we left off
                    </p>
                  </div>
                </div>
              </button>
            </div>

            <div className="mt-auto px-4 pt-6">
              <div className="border-t border-white/10 pt-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/40">Session</p>
                <p className="mt-2 text-sm text-white/80">{sessionTail}</p>
                <button
                  type="button"
                  onClick={handleNewConversation}
                  className="mt-3 text-sm text-white/55 transition hover:text-white hover:underline"
                  disabled={loadingSession || isTyping}
                >
                  New conversation
                </button>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-[rgba(255,255,255,0.46)] backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/80 bg-white/55 px-4 py-4 backdrop-blur md:px-6">
            <div>
              <h1 className="text-lg font-medium text-slate-900">Chat with Aria</h1>
              <p className="text-sm text-slate-500">
                Ask about scheduling, office hours, or refills
              </p>
            </div>
            <button
              type="button"
              onClick={handleNewConversation}
              className="zoox-outline-button min-h-10 px-4"
              disabled={loadingSession || isTyping}
            >
              New conversation
            </button>
          </div>

          <div
            id="patient-chat-thread"
            className="min-h-0 flex-1 overflow-y-auto bg-transparent px-4 py-5 md:px-6"
          >
            <div className="mx-auto flex h-full w-full max-w-5xl flex-col">
              {showWelcomeState ? (
                <div className="flex flex-1 flex-col items-center justify-center px-2 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[linear-gradient(135deg,#67D7C4_0%,#2DCAB3_100%)] text-2xl font-semibold text-[#0F2425] shadow-[0_16px_34px_rgba(45,202,179,0.24)]">
                    A
                  </div>
                  <h2 className="mt-6 text-3xl font-semibold text-slate-900">Hi, I&apos;m Aria</h2>
                  <p className="mt-3 max-w-xl text-sm leading-7 text-slate-500 md:text-base">
                    I&apos;m here to help you schedule appointments and answer questions about
                    Greenfield Medical Practice.
                  </p>

                  <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                    <SuggestionPill
                      onClick={() => handleSuggestionClick('Schedule an appointment')}
                      disabled={loadingSession || isTyping || isSendingRef.current}
                    >
                      Schedule an appointment
                    </SuggestionPill>
                    <SuggestionPill
                      onClick={() => handleSuggestionClick('Office hours & location')}
                      disabled={loadingSession || isTyping || isSendingRef.current}
                    >
                      Office hours &amp; location
                    </SuggestionPill>
                    <SuggestionPill
                      onClick={() => handleSuggestionClick('Prescription refill help')}
                      disabled={loadingSession || isTyping || isSendingRef.current}
                    >
                      Prescription refill help
                    </SuggestionPill>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4 pb-6">
                  {messages.map((message) => (
                    <MessageItem
                      key={message.id}
                      message={message}
                      messageKey={message.id}
                      onDateSelect={handleDateSelect}
                      onDateBack={handleDateBack}
                      onTimeSelect={handleTimeSelect}
                      onShowDifferentDates={handleShowDifferentDates}
                      slotState={slotPickerState[message.id]}
                      slotPickerDisabled={isTyping || isSendingRef.current}
                      showDifferentDatesDisabled={isTyping || isSendingRef.current}
                    />
                  ))}
                  {isTyping ? <TypingIndicator /> : null}
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-white/80 bg-white/70 px-4 py-4 backdrop-blur md:px-6">
            {error ? (
              <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label htmlFor="aria-message-input" className="sr-only">
                    Message Aria
                  </label>
                  <input
                    id="aria-message-input"
                    type="text"
                    value={messageInput}
                    onChange={(event) => setMessageInput(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="Message Aria..."
                    className="min-h-11 w-full rounded-full border border-white/90 bg-white/90 px-5 py-3 text-sm text-slate-900 outline-none transition focus:border-[#67D7C4] focus:ring-4 focus:ring-[#D8F5EE] placeholder:text-slate-400"
                    disabled={loadingSession || isTyping || isSendingRef.current}
                  />
                </div>
                <button
                  type="submit"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#67D7C4_0%,#2DCAB3_100%)] text-[#0F2425] transition-all duration-150 hover:brightness-105 active:scale-95 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                  disabled={
                    !messageInput.trim() ||
                    loadingSession ||
                    isTyping ||
                    isSendingRef.current
                  }
                  aria-label="Send message"
                >
                  <PaperPlaneIcon />
                </button>
              </div>

              {patientPhone ? (
                <label className="ml-1 flex items-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={smsOptedIn}
                    onChange={(event) => setSmsOptedIn(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-sky-500 focus:ring-sky-400"
                  />
                  <span>I consent to SMS updates</span>
                </label>
              ) : null}
            </form>
          </div>
        </main>
      </div>

      {showCallModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
          <div className="w-full max-w-md rounded-[32px] border border-white/80 bg-[linear-gradient(180deg,#FFFFFF_0%,#F6F9F4_100%)] p-6 shadow-[0_28px_80px_rgba(18,37,38,0.18)]">
            <h2 className="text-2xl font-semibold text-slate-900">Continue by phone?</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Enter the best number to reach you and Aria will call right away. She&apos;ll keep
              the chat context and collect anything still missing on the call.
            </p>

            <label className="mt-5 block text-sm font-medium text-slate-700" htmlFor="call-phone-input">
              Phone number
            </label>
            <input
              id="call-phone-input"
              type="tel"
              value={callPhoneInput}
              onChange={(event) => setCallPhoneInput(event.target.value)}
              placeholder="(555) 555-5555"
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#67D7C4] focus:ring-4 focus:ring-[#D8F5EE]"
              disabled={isInitiatingCall}
            />

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
                className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                disabled={isInitiatingCall}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCallConfirm}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[linear-gradient(135deg,#67D7C4_0%,#2DCAB3_100%)] px-4 text-sm font-semibold text-[#0F2425] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isInitiatingCall || !callPhoneInput.trim()}
              >
                {isInitiatingCall ? (
                  <>
                    <ButtonSpinner />
                    Calling...
                  </>
                ) : (
                  'Call me now'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toastMessage ? (
        <div
          className={`fixed bottom-5 right-5 z-50 rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-xl ${
            toastTone === 'error' ? 'bg-rose-600' : 'bg-slate-900'
          }`}
        >
          {toastMessage}
        </div>
      ) : null}
    </div>
  );
}
