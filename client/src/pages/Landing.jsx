import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

const OFFICE_PHONE = import.meta.env.VITE_OFFICE_PHONE || '(your real phone number)';
const OFFICE_ADDRESS =
  import.meta.env.VITE_OFFICE_ADDRESS || '123 Wellness Drive, Suite 400, Springfield';

const processSteps = [
  {
    title: 'Describe your concern',
    description:
      'Share what is bothering you in plain language and Aria will guide the next step.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6A2.5 2.5 0 0 1 16.5 15H11l-4 4v-4H7.5A2.5 2.5 0 0 1 5 12.5z" />
      </svg>
    )
  },
  {
    title: 'Meet your specialist',
    description:
      'Get matched with the right doctor based on your symptoms, schedule, and goals.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 13a4 4 0 1 0-4-4 4 4 0 0 0 4 4z" />
        <path d="M5 20a7 7 0 0 1 14 0" />
        <path d="M18 5.5h1.5" />
        <path d="M18.75 4.75V6.25" />
      </svg>
    )
  },
  {
    title: 'Confirmed in seconds',
    description:
      'Choose a time, confirm your details, and leave knowing exactly what comes next.',
    icon: (
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M7 3v3" />
        <path d="M17 3v3" />
        <rect x="4" y="5" width="16" height="15" rx="2.5" />
        <path d="M4 9.5h16" />
        <path d="m9.5 14 1.8 1.8L15.5 12" />
      </svg>
    )
  }
];

const specialists = [
  {
    name: 'Dr. Sarah Chen',
    specialty: 'Cardiology',
    focus: 'Heart, blood pressure, ECG',
    border: '#FF5F6D'
  },
  {
    name: 'Dr. Marcus Webb',
    specialty: 'Orthopedics',
    focus: 'Joints, bones, sports injuries',
    border: '#00C2FF'
  },
  {
    name: 'Dr. Priya Nair',
    specialty: 'Dermatology',
    focus: 'Skin, hair, nail conditions',
    border: '#2ED47A'
  },
  {
    name: 'Dr. James Okafor',
    specialty: 'Neurology',
    focus: 'Headaches, nerve pain, memory',
    border: '#9B6CFF'
  }
];

const mockConversation = [
  { role: 'assistant', text: "Hi, I'm Aria. What would you like help with today?" },
  { role: 'user', text: 'My shoulder has been hurting for a week, and I need the soonest appointment.' },
  {
    role: 'assistant',
    text: "I can help with that. Dr. Marcus Webb is our orthopedist, and he has openings Wednesday at 2:00 PM or Thursday at 9:00 AM."
  }
];

export default function Landing() {
  const navigate = useNavigate();
  const processSectionId = useMemo(() => 'landing-process', []);

  useEffect(() => {
    document.body.classList.add('landing-body');

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
          }
        });
      },
      { threshold: 0.1 }
    );

    const elements = document.querySelectorAll('.fade-up');
    elements.forEach((element) => observer.observe(element));

    return () => {
      elements.forEach((element) => observer.unobserve(element));
      observer.disconnect();
      document.body.classList.remove('landing-body');
    };
  }, []);

  const scrollToProcess = () => {
    document.getElementById(processSectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-[#0A0A0F] text-white">
      <section className="landing-grid relative min-h-screen overflow-hidden px-5 pb-10 pt-5 sm:px-8 lg:px-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(0,194,255,0.16),transparent_34%),radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.06),transparent_22%)]" />

        <nav className="relative z-10 mx-auto flex w-full max-w-7xl items-center justify-between py-4">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="text-left"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.36em] text-white/55">
              Greenfield Medical
            </p>
          </button>

          <button
            type="button"
            onClick={() => navigate('/patient')}
            className="min-h-11 rounded-full border border-white/60 px-5 text-sm font-semibold text-white transition hover:bg-white hover:text-black"
          >
            Patient Portal
          </button>
        </nav>

        <div className="relative z-10 mx-auto flex min-h-[calc(100vh-88px)] w-full max-w-7xl flex-col items-center justify-center text-center">
          <div className="fade-up max-w-4xl">
            <p className="mb-6 text-sm font-medium uppercase tracking-[0.34em] text-[#00C2FF]">
              Greenfield Medical Practice
            </p>
            <h1 className="mx-auto max-w-4xl text-[clamp(3.4rem,9vw,7.2rem)] leading-[0.94] text-white">
              Healthcare that
              <br />
              fits your life.
            </h1>
            <p className="mx-auto mt-7 max-w-2xl text-base leading-7 text-gray-400 sm:text-lg">
              Schedule appointments, get answers, and stay connected — all in one place.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <button
                type="button"
                onClick={() => navigate('/patient')}
                className="min-h-11 rounded-full bg-[#00C2FF] px-8 py-4 text-base font-semibold text-[#04131A] transition hover:-translate-y-0.5 hover:bg-[#34d0ff]"
              >
                Get Started
              </button>
              <button
                type="button"
                onClick={scrollToProcess}
                className="min-h-11 rounded-full border border-white/60 px-8 py-4 text-base font-semibold text-white transition hover:-translate-y-0.5 hover:bg-white hover:text-black"
              >
                Learn More
              </button>
            </div>
          </div>

          <div className="fade-up absolute bottom-8 left-1/2 -translate-x-1/2 text-white/50" style={{ transitionDelay: '180ms' }}>
            <div className="flex flex-col items-center gap-3">
              <span className="text-xs uppercase tracking-[0.3em]">Scroll</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="landing-chevron h-6 w-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      <section id={processSectionId} className="px-5 py-20 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="fade-up max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.34em] text-[#00C2FF]">
              The Process
            </p>
            <h2 className="mt-4 text-[clamp(2.4rem,5vw,4.5rem)] leading-[0.98] text-white">
              From concern to care in minutes.
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {processSteps.map((step, index) => (
              <article
                key={step.title}
                className="fade-up rounded-3xl border border-white/6 bg-[#141418] p-6 shadow-[0_20px_40px_rgba(0,0,0,0.35)] transition duration-300 hover:-translate-y-1 hover:border-[#00C2FF] hover:shadow-[0_24px_54px_rgba(0,194,255,0.14)]"
                style={{
                  borderTopWidth: '2px',
                  borderTopColor: '#00C2FF',
                  transitionDelay: `${index * 120}ms`
                }}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0D1B24] text-[#00C2FF]">
                  {step.icon}
                </div>
                <h3 className="mt-6 text-3xl text-white">{step.title}</h3>
                <p className="mt-4 text-sm leading-7 text-gray-400">{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-7xl">
          <div className="fade-up max-w-2xl">
            <h2 className="text-[clamp(2.4rem,5vw,4.5rem)] leading-[0.98] text-white">
              Specialists who listen.
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-2">
            {specialists.map((doctor, index) => (
              <article
                key={doctor.name}
                className="fade-up rounded-3xl border border-white/6 bg-[#141418] p-6 shadow-[0_18px_40px_rgba(0,0,0,0.28)]"
                style={{
                  borderLeftWidth: '4px',
                  borderLeftColor: doctor.border,
                  transitionDelay: `${index * 120}ms`
                }}
              >
                <p className="text-sm font-semibold uppercase tracking-[0.28em] text-[#00C2FF]">
                  {doctor.specialty}
                </p>
                <h3 className="mt-4 text-3xl text-white">{doctor.name}</h3>
                <p className="mt-4 text-base leading-7 text-gray-400">{doctor.focus}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,1fr)_440px] lg:items-center">
          <div className="fade-up max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.34em] text-[#00C2FF]">
              The Assistant
            </p>
            <h2 className="mt-4 text-[clamp(2.4rem,5vw,4.5rem)] leading-[0.98] text-white">
              Meet Aria, your 24/7 coordinator.
            </h2>
            <p className="mt-6 text-base leading-8 text-gray-400 sm:text-lg">
              Aria understands what you&apos;re saying — not just what you type. She&apos;ll match
              you with the right doctor, find available times, and confirm everything instantly.
            </p>
            <button
              type="button"
              onClick={() => navigate('/patient')}
              className="mt-8 inline-flex min-h-11 items-center gap-2 text-base font-semibold text-[#00C2FF] transition hover:translate-x-1"
            >
              Chat with Aria <span aria-hidden="true">→</span>
            </button>
          </div>

          <div
            className="fade-up rounded-[2rem] border border-white/8 bg-[#11131A] p-5 shadow-[0_24px_70px_rgba(0,0,0,0.38)]"
            style={{ transitionDelay: '160ms' }}
          >
            <div className="flex items-center justify-between border-b border-white/8 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-white/45">CareConnect</p>
                <p className="mt-2 text-lg font-semibold text-white">Aria concierge</p>
              </div>
              <div className="rounded-full border border-[#00C2FF]/40 bg-[#06131B] px-3 py-1 text-xs font-medium text-[#00C2FF]">
                Live
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {mockConversation.map((entry) => (
                <div
                  key={`${entry.role}-${entry.text}`}
                  className={`max-w-[85%] rounded-3xl px-4 py-3 text-sm leading-6 shadow-sm ${
                    entry.role === 'user'
                      ? 'ml-auto rounded-br-lg bg-[#00C2FF] text-[#04131A]'
                      : 'rounded-bl-lg bg-[#1A1F27] text-gray-200'
                  }`}
                >
                  {entry.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/8 px-5 py-12 sm:px-8 lg:px-12">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-[1.2fr_1fr]">
          <div className="fade-up">
            <p className="text-sm font-semibold uppercase tracking-[0.34em] text-white/55">
              Greenfield Medical Practice
            </p>
            <p className="mt-4 max-w-xl text-base leading-7 text-gray-400">
              {OFFICE_ADDRESS}
            </p>
          </div>

          <div className="fade-up text-sm leading-7 text-gray-400" style={{ transitionDelay: '120ms' }}>
            <p>Monday–Friday · 8:00 AM–6:00 PM</p>
            <p>Saturday · 9:00 AM–1:00 PM</p>
            <p className="mt-2">{OFFICE_PHONE}</p>
            <p className="mt-6 text-white/45">Powered by AI · Built with care</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
