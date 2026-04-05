const formatSlot = (slotDateTime) =>
  new Date(slotDateTime).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

export default function ProviderCard({ provider, selectedSlotId, onSelectSlot }) {
  return (
    <article className="glass-card-strong flex h-full flex-col p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="section-label">{provider.specialty}</p>
          <h3 className="mt-2 text-xl text-ink">{provider.name}</h3>
        </div>
        <div className="rounded-full bg-lagoon-50 px-3 py-1 text-xs font-semibold text-lagoon-800">
          {provider.match_score ? `${provider.match_score} symptom match${provider.match_score > 1 ? 'es' : ''}` : 'Recommended'}
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-600">{provider.bio}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {provider.body_parts.map((bodyPart) => (
          <span
            key={bodyPart}
            className="rounded-full border border-lagoon-100 bg-white/75 px-3 py-1 text-xs font-medium text-slate-600"
          >
            {bodyPart}
          </span>
        ))}
      </div>

      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Next available times
        </p>
        <div className="mt-3 space-y-2">
          {provider.available_slots?.length ? (
            provider.available_slots.map((slot) => (
              <button
                key={slot.id}
                type="button"
                onClick={() => onSelectSlot(provider, slot)}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition ${
                  selectedSlotId === slot.id
                    ? 'border-lagoon-400 bg-lagoon-50 text-lagoon-900'
                    : 'border-white/80 bg-white/75 text-slate-700 hover:border-lagoon-200 hover:bg-white'
                }`}
              >
                <span>{formatSlot(slot.slot_datetime)}</span>
                <span className="text-xs font-semibold uppercase tracking-[0.18em]">Select</span>
              </button>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-lagoon-100 bg-white/65 px-4 py-4 text-sm text-slate-500">
              No open slots right now.
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
