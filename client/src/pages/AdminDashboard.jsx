import { useEffect, useState } from 'react';

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

const formatDate = (value) =>
  new Date(value).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
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

const formatLastUpdated = (value) =>
  value
    ? new Date(value).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit'
      })
    : 'Not yet refreshed';

const getInitials = (name = '') =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

const getStatusBadgeClass = (status) => {
  if (status === 'Available') {
    return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100';
  }

  if (status?.toLowerCase() === 'cancelled') {
    return 'bg-rose-50 text-rose-700 ring-1 ring-rose-100';
  }

  return 'bg-slate-100 text-slate-700 ring-1 ring-slate-200';
};

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState('availability');
  const [providers, setProviders] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [openSlotFormProviderId, setOpenSlotFormProviderId] = useState('');
  const [slotForms, setSlotForms] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [error, setError] = useState('');

  const refreshDashboard = async ({ initialLoad = false } = {}) => {
    if (initialLoad) {
      setLoading(true);
    } else {
      setRefreshing(true);
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
    } catch (dashboardError) {
      setError(dashboardError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refreshDashboard({ initialLoad: true });
  }, []);

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

    setBusyActionKey(`add-${providerId}`);
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
    } finally {
      setBusyActionKey('');
    }
  };

  const handleBlockSlot = async (slotId) => {
    setBusyActionKey(`block-${slotId}`);
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
    } finally {
      setBusyActionKey('');
    }
  };

  const handleCancelAppointment = async (appointmentId) => {
    setBusyActionKey(`cancel-${appointmentId}`);
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
    } finally {
      setBusyActionKey('');
    }
  };

  const filteredAppointments = appointments.filter((appointment) => {
    if (selectedDoctor && appointment.provider_id !== selectedDoctor) {
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
  });

  return (
    <div className="rounded-[32px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
      <div className="grid min-h-[78vh] gap-0 lg:grid-cols-[240px_1fr]">
        <aside className="border-b border-slate-200 bg-slate-50/80 p-5 lg:border-b-0 lg:border-r">
          <div className="lg:sticky lg:top-24">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">
              Internal Tools
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">Greenfield Admin</h1>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Manage live provider availability and appointment operations from one place.
            </p>

            <nav className="mt-8 space-y-2">
              <button
                type="button"
                onClick={() => setActiveTab('availability')}
                className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                  activeTab === 'availability'
                    ? 'bg-sky-500 text-white shadow-[0_12px_24px_rgba(14,165,233,0.22)]'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                <span>Provider Availability</span>
                <span className="text-xs">{providers.length}</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('appointments')}
                className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                  activeTab === 'appointments'
                    ? 'bg-sky-500 text-white shadow-[0_12px_24px_rgba(14,165,233,0.22)]'
                    : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'
                }`}
              >
                <span>Appointments</span>
                <span className="text-xs">{appointments.length}</span>
              </button>
            </nav>
          </div>
        </aside>

        <main className="p-5 md:p-7">
          <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-600">
                {activeTab === 'availability' ? 'Provider Availability' : 'Appointments'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <h2 className="text-3xl font-semibold text-slate-900">
                  {activeTab === 'availability'
                    ? 'Control the next 14 days of scheduling supply'
                    : 'Review and manage all booked visits'}
                </h2>
                <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                  Live - changes apply instantly
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                {activeTab === 'availability'
                  ? 'Add new slots, block open times, or cancel existing bookings. Patient availability updates immediately because Aria reads the database live on each turn.'
                  : 'Filter appointments by provider and date range, then cancel bookings as needed.'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-600 ring-1 ring-slate-200">
                Last updated: <span className="font-semibold text-slate-800">{formatLastUpdated(lastUpdated)}</span>
              </div>
              <button
                type="button"
                onClick={() => refreshDashboard()}
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
                disabled={refreshing}
              >
                {refreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
          </div>

          {error ? (
            <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="mt-6 rounded-3xl border border-slate-200 bg-slate-50 px-6 py-16 text-center text-sm text-slate-500">
              Loading admin data...
            </div>
          ) : null}

          {!loading && activeTab === 'availability' ? (
            <div className="mt-6 grid gap-5 xl:grid-cols-2">
              {providers.map((provider) => {
                const formState = slotForms[provider.id] || emptySlotForm;

                return (
                  <section
                    key={provider.id}
                    className="rounded-3xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-center gap-4">
                        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-sm font-semibold text-sky-700">
                          {getInitials(provider.name)}
                        </div>
                        <div>
                          <h3 className="text-xl font-semibold text-slate-900">{provider.name}</h3>
                          <p className="text-sm text-slate-500">{provider.specialty}</p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setOpenSlotFormProviderId((current) =>
                            current === provider.id ? '' : provider.id
                          )
                        }
                        className="inline-flex items-center justify-center rounded-2xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600"
                      >
                        Add slot
                      </button>
                    </div>

                    {openSlotFormProviderId === provider.id ? (
                      <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
                        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                          <input
                            type="date"
                            value={formState.date}
                            onChange={(event) =>
                              setProviderSlotForm(provider.id, { date: event.target.value })
                            }
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-50"
                          />
                          <select
                            value={formState.time}
                            onChange={(event) =>
                              setProviderSlotForm(provider.id, { time: event.target.value })
                            }
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-50"
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
                            className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
                            disabled={busyActionKey === `add-${provider.id}`}
                          >
                            {busyActionKey === `add-${provider.id}` ? 'Adding...' : 'Add'}
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200">
                        <thead className="bg-slate-50">
                          <tr>
                            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                              Date
                            </th>
                            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                              Time
                            </th>
                            <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                              Status
                            </th>
                            <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                              Action
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {provider.slots.length ? (
                            provider.slots.map((slot) => (
                              <tr key={slot.id} className="transition hover:bg-slate-50">
                                <td className="px-5 py-4 text-sm text-slate-700">
                                  {formatDate(slot.slot_datetime)}
                                </td>
                                <td className="px-5 py-4 text-sm text-slate-700">
                                  {formatTime(slot.slot_datetime)}
                                </td>
                                <td className="px-5 py-4">
                                  <span
                                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClass(
                                      slot.status
                                    )}`}
                                  >
                                    {slot.status}
                                  </span>
                                </td>
                                <td className="px-5 py-4 text-right">
                                  {slot.status === 'Available' ? (
                                    <button
                                      type="button"
                                      onClick={() => handleBlockSlot(slot.id)}
                                      className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                                      disabled={busyActionKey === `block-${slot.id}`}
                                    >
                                      {busyActionKey === `block-${slot.id}` ? 'Blocking...' : 'Block'}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleCancelAppointment(slot.appointment_id)}
                                      className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
                                      disabled={busyActionKey === `cancel-${slot.appointment_id}`}
                                    >
                                      {busyActionKey === `cancel-${slot.appointment_id}`
                                        ? 'Cancelling...'
                                        : 'Cancel booking'}
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td
                                colSpan="4"
                                className="px-5 py-10 text-center text-sm text-slate-500"
                              >
                                No visible available or booked slots in the next 14 days.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}

          {!loading && activeTab === 'appointments' ? (
            <div className="mt-6 space-y-5">
              <div className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1fr_1fr_1fr_auto]">
                <select
                  value={selectedDoctor}
                  onChange={(event) => setSelectedDoctor(event.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-50"
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
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-50"
                />

                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none focus:border-sky-300 focus:ring-4 focus:ring-sky-50"
                />

                <button
                  type="button"
                  onClick={() => {
                    setSelectedDoctor('');
                    setStartDate('');
                    setEndDate('');
                  }}
                  className="rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white"
                >
                  Clear filters
                </button>
              </div>

              <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Patient
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Doctor
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Date / Time
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Reason
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Status
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Contact
                      </th>
                      <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredAppointments.length ? (
                      filteredAppointments.map((appointment) => (
                        <tr key={appointment.id} className="transition hover:bg-slate-50">
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
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getStatusBadgeClass(
                                appointment.status
                              )}`}
                            >
                              {appointment.status}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-sm text-slate-700">
                            <p>{appointment.patient_email || 'No email provided'}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {appointment.patient_phone || 'No phone provided'}
                            </p>
                          </td>
                          <td className="px-5 py-4 text-right">
                            {appointment.status === 'cancelled' ? (
                              <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                                Cancelled
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleCancelAppointment(appointment.id)}
                                className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-60"
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
                        <td
                          colSpan="7"
                          className="px-5 py-12 text-center text-sm text-slate-500"
                        >
                          No appointments match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
