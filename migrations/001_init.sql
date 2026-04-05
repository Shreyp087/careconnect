CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_first_name TEXT,
  patient_last_name TEXT,
  patient_dob TEXT,
  patient_phone TEXT,
  patient_email TEXT,
  intake_complete BOOLEAN DEFAULT FALSE,
  appointment_id UUID,
  conversation_history JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE providers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  body_parts TEXT[] NOT NULL,
  bio TEXT
);

CREATE TABLE provider_slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_id UUID REFERENCES providers(id),
  slot_datetime TIMESTAMPTZ NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE appointments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id UUID REFERENCES sessions(id),
  provider_id UUID REFERENCES providers(id),
  slot_id UUID REFERENCES provider_slots(id),
  patient_first_name TEXT,
  patient_last_name TEXT,
  patient_dob TEXT,
  patient_phone TEXT,
  patient_email TEXT,
  reason TEXT,
  sms_opted_in BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'confirmed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
