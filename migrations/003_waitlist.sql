CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID,
  provider_id UUID,
  patient_name TEXT,
  patient_email TEXT,
  patient_phone TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
