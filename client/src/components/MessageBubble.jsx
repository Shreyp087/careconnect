export default function MessageBubble({ role, content }) {
  const isAssistant = role === 'assistant';

  return (
    <div className={`flex ${isAssistant ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[85%] rounded-[24px] px-4 py-3 text-sm leading-6 shadow-sm ${
          isAssistant
            ? 'bg-white text-slate-700 ring-1 ring-white/70'
            : 'bg-ink text-white ring-1 ring-slate-900/5'
        }`}
      >
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] opacity-70">
          {isAssistant ? 'CareConnect Guide' : 'Patient'}
        </p>
        <p>{content}</p>
      </div>
    </div>
  );
}
