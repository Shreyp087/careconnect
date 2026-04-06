import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

// In production, this page should require admin authentication and authorization.

const SLOT_TIME_OPTIONS = Array.from({ length: 17 }, (_, index) => {
  const totalMinutes = 9 * 60 + index * 30;
  const hour = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const value = `${String(hour).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const label = new Date(`2000-01-01T${value}:00`).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });

  return { value, label };
});

const emptySlotForm = {
  date: '',
  time: '09:00'
};

const PROVIDER_ACCENTS = {
  'Dr. Sarah Chen': 'bg-rose-100 text-rose-700',
  'Dr. Marcus Webb': 'bg-sky-100 text-sky-700',
  'Dr. Priya Nair': 'bg-emerald-100 text-emerald-700',
  'Dr. James Okafor': 'bg-violet-100 text-violet-700'
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
    throw new Error(data.error || 'Unable to complete that admin action.');
  }

  return data;
};

const normalizeStatus = (value = '') => value.toLowerCase();

const formatCalendarDate = (value) =>
  new Date(value).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

const formatDay = (value) =>
  new Date(value).toLocaleDateString('en-US', {
    weekday: 'short'
  });

const formatTime = (value) =>
  new Date(value).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });

const formatDateTime = (value) =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });

const formatRefreshAge = (value, nowValue) => {
  if (!value) {
    return 'Not yet refreshed';
  }

  const diffSeconds = Math.max(
    0,
    Math.floor((nowValue - new Date(value).getTime()) / 1000)
  );

  if (diffSeconds < 10) {
    return 'just now';
  }

  if (diffSeconds < 60) {
    return `${diffSeconds} seconds ago`;
  }

  const minutes = Math.floor(diffSeconds / 60);

  return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
};

const getInitials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

const getProviderAccent = (providerName = '') =>
  PROVIDER_ACCENTS[providerName] || 'bg-slate-200 text-slate-700';

const getAvailabilityBadgeClass = (count) => {
  if (count > 5) {
    return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
  }

  if (count >= 2) {
    return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
  }

  return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200';
};

const getAppointmentStatusBadgeClass = (status) => {
  const normalized = normalizeStatus(status);

  if (normalized === 'confirmed') {
    return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
  }

  if (normalized === 'cancelled') {
    return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200';
  }

  return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
};

const getSlotStatusLabel = (slot) => {
  const normalized = normalizeStatus(slot.status);

  if (normalized === 'available') {
    return 'Available';
  }

  if (normalized === 'cancelled') {
    return 'Cancelled';
  }

  return 'Booked';
};

const getSlotStatusBadgeClass = (slot) => {
  const label = getSlotStatusLabel(slot);

  if (label === 'Available') {
    return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
  }

  if (label === 'Cancelled') {
    return 'bg-rose-50 text-rose-700 ring-1 ring-rose-200';
  }

  return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
};

const getWeekStart = (date = new Date()) => {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = copy.getDate() - day + (day === 0 ? -6 : 1);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(diff);
  return copy;
};

const getWeekEnd = (date = new Date()) => {
  const start = getWeekStart(date);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
};

const groupSlotsByDate = (slots = []) => {
  const grouped = new Map();

  [...slots]
    .sort((left, right) => new Date(left.slot_datetime) - new Date(right.slot_datetime))
    .forEach((slot) => {
      const date = new Date(slot.slot_datetime);
      const key = date.toISOString().slice(0, 10);

      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          dateLabel: date.toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric'
          }),
          dayLabel: date.toLocaleDateString('en-US', {
            weekday: 'short'
          }),
          fullDateLabel: date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
          }),
          slots: []
        });
      }

      grouped.get(key).slots.push(slot);
    });

  return Array.from(grouped.values()).map((group) => ({
    ...group,
    availableCount: group.slots.filter(
      (slot) => getSlotStatusLabel(slot) === 'Available'
    ).length
  }));
};

function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4" />
      <path d="M8 3v4" />
      <path d="M3 10h18" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="4" rx="1" />
      <path d="M9 5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16" />
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.86 19.86 0 0 1-8.63-3.07 19.4 19.4 0 0 1-6-6A19.86 19.86 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.8.62 2.65a2 2 0 0 1-.45 2.11L8 9.73a16 16 0 0 0 6.27 6.27l1.25-1.28a2 2 0 0 1 2.11-.45c.86.29 1.75.5 2.65.62A2 2 0 0 1 22 16.92Z" />
    </svg>
  );
}

function ChevronDownIcon({ open = false }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={`h-4 w-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function PlusIcon() {
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
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/80 p-4 shadow-[0_12px_30px_rgba(15,23,42,0.06)] backdrop-blur">
      <p className="text-2xl font-bold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{label}</p>
    </div>
  );
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('availability');
  const [providers, setProviders] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [expandedProviderId, setExpandedProviderId] = useState('');
  const [openSlotFormProviderId, setOpenSlotFormProviderId] = useState('');
  const [slotForms, setSlotForms] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [statusTick, setStatusTick] = useState(Date.now());
  const [syncState, setSyncState] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setStatusTick(Date.now());
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (syncState !== 'saved') {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setSyncState('idle');
    }, 2000);

    return () => window.clearTimeout(timeoutId);
  }, [syncState]);

  const refreshDashboard = async ({ initialLoad = false } = {}) => {
    if (initialLoad) {
      setLoading(true);
    } else {
      setRefreshing(true);
      setSyncState('saving');
    }

    setError('');

    try {
      const [providerData, appointmentData] = await Promise.all([
        apiRequest('/api/admin/providers'),
        apiRequest('/api/admin/appointments')
      ]);

      setProviders(providerData.providers || []);
      setAppointments(appointmentData.appointments || []);
      setLastUpdated(new Date().toISOString());

      if (!initialLoad) {
        setSyncState('saved');
      }
    } catch (dashboardError) {
      setError(dashboardError.message);
      setSyncState('idle');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refreshDashboard({ initialLoad: true });
  }, []);

  useEffect(() => {
    if (!providers.length) {
      return;
    }

    setExpandedProviderId((current) =>
      current && providers.some((provider) => provider.id === current)
        ? current
        : providers[0].id
    );
  }, [providers]);

  const setProviderSlotForm = (providerId, updates) => {
    setSlotForms((current) => ({
      ...current,
      [providerId]: {
        ...(current[providerId] || emptySlotForm),
        ...updates
      }
    }));
  };

  const handleAddSlot = async (providerId) => {
    const formState = slotForms[providerId] || emptySlotForm;

    if (!formState.date || !formState.time) {
      setError('Choose both a date and time before adding a slot.');
      return;
    }

    const slotDate = new Date(`${formState.date}T${formState.time}:00`);

    if (Number.isNaN(slotDate.getTime())) {
      setError('That slot time could not be parsed. Please try again.');
      return;
    }

    if (slotDate <= new Date()) {
      setError("You can't add availability in the past.");
      return;
    }

    setBusyActionKey(`add-${providerId}`);
    setSyncState('saving');
    setError('');

    try {
      await apiRequest('/api/admin/slots', {
        method: 'POST',
        body: JSON.stringify({
          provider_id: providerId,
          slot_datetime: slotDate.toISOString()
        })
      });

      setSlotForms((current) => ({
        ...current,
        [providerId]: emptySlotForm
      }));
      setOpenSlotFormProviderId('');
      await refreshDashboard();
    } catch (slotError) {
      setError(slotError.message);
      setSyncState('idle');
    } finally {
      setBusyActionKey('');
    }
  };

  const handleBlockSlot = async (slotId) => {
    setBusyActionKey(`block-${slotId}`);
    setSyncState('saving');
    setError('');

    try {
      await apiRequest(`/api/admin/slots/${slotId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          is_available: false
        })
      });

      await refreshDashboard();
    } catch (slotError) {
      setError(slotError.message);
      setSyncState('idle');
    } finally {
      setBusyActionKey('');
    }
  };

  const handleCancelAppointment = async (appointmentId, label = 'this appointment') => {
    if (!appointmentId) {
      return;
    }

    const confirmed = window.confirm(`Cancel ${label}?`);

    if (!confirmed) {
      return;
    }

    setBusyActionKey(`cancel-${appointmentId}`);
    setSyncState('saving');
    setError('');

    try {
      await apiRequest(`/api/admin/appointments/${appointmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: 'cancelled'
        })
      });

      await refreshDashboard();
    } catch (appointmentError) {
      setError(appointmentError.message);
      setSyncState('idle');
    } finally {
      setBusyActionKey('');
    }
  };

  const handleCopy = async (value) => {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setSyncState('saved');
    } catch (_copyError) {
      setError('Could not copy to clipboard on this device.');
    }
  };

  const clearFilters = () => {
    setSelectedDoctor('');
    setStartDate('');
    setEndDate('');
    setSelectedStatus('');
  };

  const allSlots = useMemo(
    () => providers.flatMap((provider) => provider.slots || []),
    [providers]
  );

  const availabilityCount = useMemo(
    () => allSlots.filter((slot) => getSlotStatusLabel(slot) === 'Available').length,
    [allSlots]
  );

  const availabilityStats = useMemo(() => {
    const today = new Date();
    const startOfToday = new Date(today);
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date(startOfToday);
    endOfToday.setHours(23, 59, 59, 999);
    const weekStart = getWeekStart(today);
    const weekEnd = getWeekEnd(today);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    return {
      totalThisWeek: allSlots.filter((slot) => {
        const date = new Date(slot.slot_datetime);
        return date >= weekStart && date <= weekEnd;
      }).length,
      bookedThisWeek: allSlots.filter((slot) => {
        const date = new Date(slot.slot_datetime);
        return (
          date >= weekStart &&
          date <= weekEnd &&
          getSlotStatusLabel(slot) !== 'Available'
        );
      }).length,
      availableToday: allSlots.filter((slot) => {
        const date = new Date(slot.slot_datetime);
        return (
          date >= startOfToday &&
          date <= endOfToday &&
          getSlotStatusLabel(slot) === 'Available'
        );
      }).length,
      nextSevenDays: allSlots.filter((slot) => {
        const date = new Date(slot.slot_datetime);
        return date >= today && date <= nextWeek;
      }).length
    };
  }, [allSlots]);

  const filteredAppointments = useMemo(
    () =>
      appointments.filter((appointment) => {
        if (selectedDoctor && appointment.provider_id !== selectedDoctor) {
          return false;
        }

        const normalized = normalizeStatus(appointment.status);

        if (selectedStatus && normalized !== selectedStatus) {
          return false;
        }

        const appointmentDate = new Date(appointment.slot_datetime);

        if (startDate) {
          const startBoundary = new Date(`${startDate}T00:00:00`);

          if (appointmentDate < startBoundary) {
            return false;
          }
        }

        if (endDate) {
          const endBoundary = new Date(`${endDate}T23:59:59`);

          if (appointmentDate > endBoundary) {
            return false;
          }
        }

        return true;
      }),
    [appointments, selectedDoctor, selectedStatus, startDate, endDate]
  );

  const appointmentStats = useMemo(() => {
    const now = new Date();
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);

    return {
      total: filteredAppointments.length,
      confirmed: filteredAppointments.filter(
        (appointment) => normalizeStatus(appointment.status) === 'confirmed'
      ).length,
      cancelled: filteredAppointments.filter(
        (appointment) => normalizeStatus(appointment.status) === 'cancelled'
      ).length,
      nextSevenDays: filteredAppointments.filter((appointment) => {
        const date = new Date(appointment.slot_datetime);
        return date >= now && date <= nextWeek;
      }).length
    };
  }, [filteredAppointments]);

const topBarStatus = refreshing || busyActionKey
    ? { tone: 'text-[#2A8F84]', label: 'Syncing...' }
    : syncState === 'saved'
      ? { tone: 'text-[#2A8F84]', label: 'Saved ✓' }
      : { tone: 'text-[#2A8F84]', label: 'Live — changes apply instantly' };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(103,215,196,0.16),_transparent_28%),radial-gradient(circle_at_85%_12%,_rgba(204,184,171,0.16),_transparent_24%),linear-gradient(180deg,#F7FAF6_0%,#EEF3EC_100%)] text-slate-900">
      <header className="flex h-14 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 backdrop-blur md:px-6">
        <div>
          <p className="text-sm font-bold tracking-[0.16em] text-slate-900">GREENFIELD</p>
          <p className="text-[11px] text-slate-400">Admin Console</p>
        </div>

        <div className={`hidden items-center gap-2 text-sm font-medium md:flex ${topBarStatus.tone}`}>
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-35" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-current" />
          </span>
          <span>{topBarStatus.label}</span>
        </div>

        <Link
          to="/patient"
          className="text-sm font-medium text-slate-500 transition hover:text-slate-900"
        >
          ← Patient Portal
        </Link>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[208px] shrink-0 border-r border-slate-200/80 bg-white/55 backdrop-blur md:block">
          <div className="p-4">
            <nav className="space-y-1">
              <button
                type="button"
                onClick={() => setActiveTab('availability')}
                className={`flex w-full items-center justify-between rounded-2xl border border-transparent px-3 py-3 text-sm font-medium transition ${
                  activeTab === 'availability'
                    ? 'border-[#B7EADF] bg-[linear-gradient(135deg,rgba(103,215,196,0.16),rgba(255,255,255,0.9))] text-[#1F6E68] shadow-sm'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2">
                  <CalendarIcon />
                  <span>Provider Availability</span>
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">
                  {availabilityCount}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('appointments')}
                className={`flex w-full items-center justify-between rounded-2xl border border-transparent px-3 py-3 text-sm font-medium transition ${
                  activeTab === 'appointments'
                    ? 'border-[#B7EADF] bg-[linear-gradient(135deg,rgba(103,215,196,0.16),rgba(255,255,255,0.9))] text-[#1F6E68] shadow-sm'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2">
                  <ClipboardIcon />
                  <span>Appointments</span>
                </span>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">
                  {appointments.length}
                </span>
              </button>
            </nav>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-5 md:px-6 md:py-6">
            <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-5 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">
                  {activeTab === 'availability' ? 'Provider Availability' : 'Appointments'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Last refreshed: {formatRefreshAge(lastUpdated, statusTick)}
                </p>
              </div>

              <button
                type="button"
                onClick={() => refreshDashboard()}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/90 px-4 text-sm font-medium text-slate-700 transition hover:border-sky-200 hover:bg-white disabled:opacity-60"
                disabled={refreshing}
              >
                <RefreshIcon />
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            {error ? (
              <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className="mt-6 rounded-[28px] border border-white/80 bg-white/90 px-6 py-16 text-center text-sm text-slate-500 shadow-[0_20px_55px_rgba(15,23,42,0.08)]">
                Loading admin data...
              </div>
            ) : null}

            {!loading && activeTab === 'availability' ? (
              <div className="pb-20 md:pb-0">
                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <StatCard label="Total slots this week" value={availabilityStats.totalThisWeek} />
                  <StatCard label="Booked this week" value={availabilityStats.bookedThisWeek} />
                  <StatCard label="Available today" value={availabilityStats.availableToday} />
                  <StatCard label="Next 7 days" value={availabilityStats.nextSevenDays} />
                </div>

                <div className="mt-6 space-y-5">
                  {providers.map((provider) => {
                    const formState = slotForms[provider.id] || emptySlotForm;
                    const providerSlots = provider.slots || [];
                    const slotGroups = groupSlotsByDate(providerSlots);
                    const previewDays = slotGroups.slice(0, 5);
                    const availableSlots = providerSlots.filter(
                      (slot) => getSlotStatusLabel(slot) === 'Available'
                    ).length;
                    const bookedSlots = providerSlots.filter(
                      (slot) => getSlotStatusLabel(slot) === 'Booked'
                    ).length;
                    const nextAvailableSlot = [...providerSlots]
                      .sort(
                        (left, right) =>
                          new Date(left.slot_datetime) - new Date(right.slot_datetime)
                      )
                      .find((slot) => getSlotStatusLabel(slot) === 'Available');
                    const nextAvailableLabel = nextAvailableSlot
                      ? `${formatDay(nextAvailableSlot.slot_datetime)}, ${formatTime(nextAvailableSlot.slot_datetime)}`
                      : 'No open times';
                    const isOpen = openSlotFormProviderId === provider.id;
                    const isExpanded = expandedProviderId === provider.id;

                    return (
                      <section
                        key={provider.id}
                        className="overflow-hidden rounded-[28px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.98))] shadow-[0_20px_55px_rgba(15,23,42,0.08)]"
                      >
                        <div className="border-b border-slate-200/70 bg-[radial-gradient(circle_at_top_right,rgba(103,215,196,0.14),transparent_28%)] px-5 py-5">
                          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                            <div className="flex items-start gap-4">
                              <div className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold shadow-inner ${getProviderAccent(provider.name)}`}>
                                {getInitials(provider.name)}
                              </div>
                              <div>
                                <div className="flex flex-wrap items-center gap-3">
                                  <h3 className="text-lg font-semibold tracking-tight text-slate-900">
                                    {provider.name}
                                  </h3>
                                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getAvailabilityBadgeClass(availableSlots)}`}>
                                    {availableSlots} available
                                  </span>
                                </div>
                                <p className="mt-1 text-sm text-slate-500">{provider.specialty}</p>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 self-start">
                              <button
                                type="button"
                                onClick={() =>
                                  setOpenSlotFormProviderId((current) =>
                                    current === provider.id ? '' : provider.id
                                  )
                                }
                                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-[linear-gradient(135deg,#67D7C4_0%,#2DCAB3_100%)] px-4 text-sm font-semibold text-[#0F2425] transition hover:brightness-105"
                              >
                                <PlusIcon />
                                Add slot
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedProviderId((current) =>
                                    current === provider.id ? '' : provider.id
                                  )
                                }
                                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/85 px-4 text-sm font-medium text-slate-700 transition hover:border-[#B7EADF] hover:text-[#1F6E68]"
                              >
                                {isExpanded ? 'Collapse' : 'View schedule'}
                                <ChevronDownIcon open={isExpanded} />
                              </button>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-3">
                            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
                              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                                Next open
                              </p>
                              <p className="mt-2 text-sm font-semibold text-slate-900">
                                {nextAvailableLabel}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
                              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                                Booked slots
                              </p>
                              <p className="mt-2 text-sm font-semibold text-slate-900">{bookedSlots}</p>
                            </div>
                            <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm">
                              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                                Visible dates
                              </p>
                              <p className="mt-2 text-sm font-semibold text-slate-900">{slotGroups.length}</p>
                            </div>
                          </div>

                          {previewDays.length ? (
                            <div className="mt-4 flex gap-3 overflow-x-auto pb-1">
                              {previewDays.map((group) => (
                                <div
                                  key={`${provider.id}-${group.key}-preview`}
                                  className="min-w-[140px] rounded-2xl border border-white/70 bg-slate-950/[0.025] px-4 py-3"
                                >
                                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
                                    {group.dayLabel}
                                  </p>
                                  <p className="mt-1 text-sm font-semibold text-slate-900">
                                    {group.dateLabel}
                                  </p>
                                  <p className="mt-2 text-xs text-slate-500">
                                    {group.availableCount} open · {group.slots.length} total
                                  </p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white/70 px-4 py-4 text-sm text-slate-500">
                              No future slots yet. Add a time to get this doctor on the board.
                            </div>
                          )}
                        </div>

                        <div
                          className={`overflow-hidden border-b border-slate-200/70 bg-slate-50/70 px-5 transition-all duration-300 ${
                            isOpen ? 'max-h-48 py-4' : 'max-h-0 py-0'
                          }`}
                        >
                          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
                            <input
                              type="date"
                              value={formState.date}
                              onChange={(event) =>
                                setProviderSlotForm(provider.id, { date: event.target.value })
                              }
                              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#67D7C4] focus:ring-4 focus:ring-[#D8F5EE]"
                            />
                            <select
                              value={formState.time}
                              onChange={(event) =>
                                setProviderSlotForm(provider.id, { time: event.target.value })
                              }
                              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#67D7C4] focus:ring-4 focus:ring-[#D8F5EE]"
                            >
                              {SLOT_TIME_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => handleAddSlot(provider.id)}
                              className="inline-flex min-h-10 items-center justify-center rounded-full bg-[linear-gradient(135deg,#67D7C4_0%,#2DCAB3_100%)] px-4 text-sm font-semibold text-[#0F2425] transition hover:brightness-105 disabled:opacity-60"
                              disabled={busyActionKey === `add-${provider.id}`}
                            >
                              {busyActionKey === `add-${provider.id}` ? 'Adding...' : 'Add'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setOpenSlotFormProviderId('')}
                              className="text-sm font-medium text-slate-500 transition hover:text-slate-900"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>

                        {isExpanded ? (
                          <div className="px-5 py-5">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2A8F84]">
                                  Schedule board
                                </p>
                                <p className="mt-1 text-sm text-slate-500">
                                  Scan dates horizontally and manage slots in-place.
                                </p>
                              </div>
                              <p className="text-xs uppercase tracking-[0.16em] text-slate-400">
                                {providerSlots.length} total slots
                              </p>
                            </div>

                            {slotGroups.length ? (
                              <div className="overflow-x-auto pb-1">
                                <div className="flex min-w-max gap-4">
                                  {slotGroups.map((group) => (
                                    <div
                                      key={`${provider.id}-${group.key}`}
                                      className="w-[270px] rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#FFFFFF_0%,#F8FAFC_100%)] p-4 shadow-sm"
                                    >
                                      <div className="border-b border-slate-200/80 pb-3">
                                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#2A8F84]">
                                          {group.dayLabel}
                                        </p>
                                        <p className="mt-1 text-base font-semibold text-slate-900">
                                          {group.dateLabel}
                                        </p>
                                        <p className="mt-1 text-xs text-slate-500">
                                          {group.availableCount} open · {group.slots.length} total
                                        </p>
                                      </div>

                                      <div className="mt-4 space-y-3">
                                        {group.slots.map((slot) => {
                                          const slotLabel = getSlotStatusLabel(slot);

                                          return (
                                            <div
                                              key={slot.id}
                                              className={`rounded-2xl border px-3.5 py-3 ${
                                                slotLabel === 'Available'
                                                  ? 'border-emerald-200 bg-emerald-50/60'
                                                  : slotLabel === 'Cancelled'
                                                    ? 'border-rose-200 bg-rose-50/60'
                                                    : 'border-slate-200 bg-slate-50'
                                              }`}
                                            >
                                              <div className="flex items-start justify-between gap-3">
                                                <div>
                                                  <p className="text-sm font-semibold text-slate-900">
                                                    {formatTime(slot.slot_datetime)}
                                                  </p>
                                                  <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${getSlotStatusBadgeClass(slot)}`}>
                                                    {slotLabel}
                                                  </span>
                                                </div>
                                                {slotLabel === 'Available' ? (
                                                  <button
                                                    type="button"
                                                    onClick={() => handleBlockSlot(slot.id)}
                                                    className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                                                    disabled={busyActionKey === `block-${slot.id}`}
                                                  >
                                                    {busyActionKey === `block-${slot.id}` ? 'Blocking...' : 'Block'}
                                                  </button>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      handleCancelAppointment(
                                                        slot.appointment_id,
                                                        `the booking on ${group.fullDateLabel} at ${formatTime(slot.slot_datetime)}`
                                                      )
                                                    }
                                                    className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
                                                    disabled={
                                                      !slot.appointment_id ||
                                                      busyActionKey === `cancel-${slot.appointment_id}`
                                                    }
                                                  >
                                                    {busyActionKey === `cancel-${slot.appointment_id}`
                                                      ? 'Cancelling...'
                                                      : 'Cancel'}
                                                  </button>
                                                )}
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-5 py-10 text-center text-sm text-slate-500">
                                No visible available or booked slots in the next 14 days.
                              </div>
                            )}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {!loading && activeTab === 'appointments' ? (
              <div className="pb-20 md:pb-0">
                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <StatCard label="Filtered appointments" value={appointmentStats.total} />
                  <StatCard label="Confirmed" value={appointmentStats.confirmed} />
                  <StatCard label="Cancelled" value={appointmentStats.cancelled} />
                  <StatCard label="Next 7 days" value={appointmentStats.nextSevenDays} />
                </div>

                <div className="mt-6 rounded-[28px] border border-white/80 bg-white/90 p-4 shadow-[0_20px_55px_rgba(15,23,42,0.08)]">
                  <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_1fr_auto]">
                    <select
                      value={selectedDoctor}
                      onChange={(event) => setSelectedDoctor(event.target.value)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#67D7C4] focus:ring-4 focus:ring-[#D8F5EE]"
                    >
                      <option value="">All doctors</option>
                      {providers.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name}
                        </option>
                      ))}
                    </select>

                    <input
                      type="date"
                      value={startDate}
                      onChange={(event) => setStartDate(event.target.value)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#67D7C4] focus:ring-4 focus:ring-[#D8F5EE]"
                    />

                    <input
                      type="date"
                      value={endDate}
                      onChange={(event) => setEndDate(event.target.value)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#67D7C4] focus:ring-4 focus:ring-[#D8F5EE]"
                    />

                    <select
                      value={selectedStatus}
                      onChange={(event) => setSelectedStatus(event.target.value)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition focus:border-[#67D7C4] focus:ring-4 focus:ring-[#D8F5EE]"
                    >
                      <option value="">All statuses</option>
                      <option value="confirmed">Confirmed</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="completed">Completed</option>
                    </select>

                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-sm font-medium text-slate-500 transition hover:text-slate-900 hover:underline"
                    >
                      Clear filters
                    </button>
                  </div>
                </div>

                <div className="mt-5 overflow-hidden rounded-[28px] border border-white/80 bg-white/90 shadow-[0_20px_55px_rgba(15,23,42,0.08)]">
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="border-b border-slate-200 bg-slate-50">
                        <tr className="text-left text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                          <th className="px-5 py-3">Patient</th>
                          <th className="px-5 py-3">Doctor</th>
                          <th className="px-5 py-3">Date &amp; Time</th>
                          <th className="px-5 py-3">Reason</th>
                          <th className="px-5 py-3">Status</th>
                          <th className="px-5 py-3">Contact</th>
                          <th className="px-5 py-3 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredAppointments.length ? (
                          filteredAppointments.map((appointment) => (
                            <tr
                              key={appointment.id}
                              className="border-b border-slate-100 transition hover:bg-slate-50"
                            >
                              <td className="px-5 py-4 text-sm text-slate-700">
                                <p className="font-semibold text-slate-900">
                                  {appointment.patient_first_name} {appointment.patient_last_name}
                                </p>
                              </td>
                              <td className="px-5 py-4 text-sm text-slate-700">
                                <p className="font-medium text-slate-900">{appointment.provider_name}</p>
                                <p className="mt-1 text-xs text-slate-500">{appointment.specialty}</p>
                              </td>
                              <td className="px-5 py-4 text-sm text-slate-700">
                                {formatDateTime(appointment.slot_datetime)}
                              </td>
                              <td className="px-5 py-4 text-sm text-slate-700">
                                {appointment.reason || 'General consultation'}
                              </td>
                              <td className="px-5 py-4">
                                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getAppointmentStatusBadgeClass(appointment.status)}`}>
                                  {appointment.status}
                                </span>
                              </td>
                              <td className="px-5 py-4 text-sm text-slate-700">
                                <div className="space-y-2">
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(appointment.patient_phone)}
                                    className="flex items-center gap-2 text-left text-slate-600 transition hover:text-slate-900"
                                    title={appointment.patient_phone || 'No phone provided'}
                                  >
                                    <PhoneIcon />
                                    <span>{appointment.patient_phone || 'No phone provided'}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(appointment.patient_email)}
                                    className="flex items-center gap-2 text-left text-slate-600 transition hover:text-slate-900"
                                    title={appointment.patient_email || 'No email provided'}
                                  >
                                    <EmailIcon />
                                    <span>{appointment.patient_email || 'No email provided'}</span>
                                  </button>
                                </div>
                              </td>
                              <td className="px-5 py-4 text-right">
                                {normalizeStatus(appointment.status) === 'cancelled' ? (
                                  <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                                    Cancelled
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleCancelAppointment(
                                        appointment.id,
                                        `${appointment.patient_first_name} ${appointment.patient_last_name}'s appointment`
                                      )
                                    }
                                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-60"
                                    disabled={busyActionKey === `cancel-${appointment.id}`}
                                  >
                                    {busyActionKey === `cancel-${appointment.id}`
                                      ? 'Cancelling...'
                                      : 'Cancel'}
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="7" className="px-5 py-16 text-center">
                              <div className="mx-auto flex max-w-sm flex-col items-center text-slate-500">
                                <span className="rounded-full bg-slate-100 p-3 text-slate-400">
                                  <ClipboardIcon />
                                </span>
                                <p className="mt-4 text-sm font-medium text-slate-700">
                                  No appointments match the current filters
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </main>
      </div>

      <nav className="border-t border-slate-200/80 bg-white/90 px-3 py-2 backdrop-blur md:hidden">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('availability')}
            className={`rounded-2xl px-3 py-2 text-sm font-medium ${
              activeTab === 'availability' ? 'bg-[#ECFAF6] text-[#1F6E68]' : 'text-slate-600'
            }`}
          >
            Availability
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('appointments')}
            className={`rounded-2xl px-3 py-2 text-sm font-medium ${
              activeTab === 'appointments' ? 'bg-[#ECFAF6] text-[#1F6E68]' : 'text-slate-600'
            }`}
          >
            Appointments
          </button>
        </div>
      </nav>
    </div>
  );
}
