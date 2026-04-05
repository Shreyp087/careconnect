export default function SectionCard({
  eyebrow,
  title,
  description,
  actions,
  className = '',
  children
}) {
  return (
    <section className={`glass-card p-6 md:p-7 ${className}`}>
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="max-w-2xl">
          {eyebrow ? <p className="section-label">{eyebrow}</p> : null}
          {title ? <h2 className="mt-2 text-2xl text-ink md:text-[2rem]">{title}</h2> : null}
          {description ? <p className="mt-3 text-sm leading-6 text-slate-600">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
