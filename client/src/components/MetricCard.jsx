export default function MetricCard({ label, value, detail, accent = 'lagoon' }) {
  const accentClasses = {
    lagoon: 'from-lagoon-400/20 to-lagoon-50',
    ember: 'from-ember-400/20 to-ember-50',
    slate: 'from-slate-300/30 to-white'
  };

  return (
    <article
      className={`rounded-[24px] border border-white/70 bg-gradient-to-br ${accentClasses[accent]} p-5 shadow-sm`}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-4xl font-semibold text-ink">{value}</p>
      {detail ? <p className="mt-3 text-sm text-slate-600">{detail}</p> : null}
    </article>
  );
}
