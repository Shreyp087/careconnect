-- =============================================================================
-- CareConnect — Complete Doctor Seed with Profiles & Slots
-- Run: psql $DATABASE_URL -f migrations/002_seed.sql
-- =============================================================================

-- Clear existing seed data (safe to re-run)
TRUNCATE provider_slots CASCADE;
TRUNCATE providers CASCADE;

-- =============================================================================
-- INSERT PROVIDERS
-- =============================================================================

INSERT INTO providers (id, name, specialty, body_parts, bio) VALUES
(
  'a1b2c3d4-0001-0001-0001-000000000001',
  'Dr. Sarah Chen',
  'Cardiology',
  ARRAY['heart','chest','cardiovascular','cardiac','palpitation','palpitations','blood pressure','hypertension','cholesterol','shortness of breath','arrhythmia','ecg','ekg'],
  'Dr. Sarah Chen is a board-certified cardiologist with over 15 years of experience treating heart conditions. She completed her fellowship at Johns Hopkins and specializes in preventive cardiology and heart rhythm disorders.'
),
(
  'a1b2c3d4-0002-0002-0002-000000000002',
  'Dr. Marcus Webb',
  'Orthopedics',
  ARRAY['knee','back','spine','spinal','joint','shoulder','hip','bone','bones','fracture','fractures','wrist','ankle','elbow','arthritis','tendon','ligament','sports injury','orthopedic','musculoskeletal','neck','foot','feet'],
  'Dr. Marcus Webb is a fellowship-trained orthopedic surgeon specializing in sports medicine and joint replacement. He has treated athletes at all levels and focuses on minimally invasive techniques to get patients back to their active lifestyle.'
),
(
  'a1b2c3d4-0003-0003-0003-000000000003',
  'Dr. Priya Nair',
  'Dermatology',
  ARRAY['skin','rash','rashes','acne','hair','nail','nails','mole','moles','eczema','psoriasis','dermatitis','hives','itching','itchy','lesion','lesions','sunburn','wart','warts','fungal','ringworm','scalp','dryness','dry skin'],
  'Dr. Priya Nair is a double board-certified dermatologist and dermatopathologist. She specializes in medical, surgical, and cosmetic dermatology, with particular expertise in skin cancer detection and inflammatory skin conditions.'
),
(
  'a1b2c3d4-0004-0004-0004-000000000004',
  'Dr. James Okafor',
  'Neurology',
  ARRAY['brain','headache','headaches','migraine','migraines','nerve','nerves','seizure','seizures','memory','dizziness','dizzy','numbness','tingling','tremor','tremors','ms','multiple sclerosis','stroke','concussion','vertigo','neuropathy','parkinson'],
  'Dr. James Okafor is a neurologist with specialized training in headache medicine and movement disorders. He completed his residency at UCSF and has published research on migraine treatment. He takes a holistic, patient-centered approach to neurological care.'
);

-- =============================================================================
-- GENERATE SLOTS — next 45 days, weekdays only, 5 times per day per doctor
-- =============================================================================
-- Slot times: 9:00, 10:00, 11:00, 14:00, 15:00

INSERT INTO provider_slots (provider_id, slot_datetime, is_available)
SELECT
  p.id AS provider_id,
  (CURRENT_DATE + s.day_offset + t.slot_time::interval) AS slot_datetime,
  true AS is_available
FROM providers p
CROSS JOIN (
  SELECT generate_series(1, 45) AS day_offset
) s
CROSS JOIN (
  SELECT unnest(ARRAY['09:00', '10:00', '11:00', '14:00', '15:00']) AS slot_time
) t
WHERE
  -- Weekdays only (1=Mon, 5=Fri in ISO)
  EXTRACT(isodow FROM CURRENT_DATE + s.day_offset) BETWEEN 1 AND 5
ORDER BY p.id, slot_datetime;

-- Verify counts
SELECT
  p.name,
  p.specialty,
  COUNT(ps.id) AS total_slots,
  COUNT(ps.id) FILTER (WHERE ps.is_available = true) AS available_slots
FROM providers p
LEFT JOIN provider_slots ps ON ps.provider_id = p.id
GROUP BY p.id, p.name, p.specialty
ORDER BY p.name;
