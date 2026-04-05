WITH seeded_providers AS (
  SELECT *
  FROM (
    VALUES
      (
        'Dr. Sarah Chen',
        'Cardiologist',
        ARRAY['heart', 'chest', 'cardiovascular'],
        'Dr. Chen focuses on proactive heart health, chest pain evaluations, and preventive cardiovascular care.'
      ),
      (
        'Dr. Marcus Webb',
        'Orthopedist',
        ARRAY['knee', 'back', 'spine', 'joint', 'shoulder', 'hip', 'bone'],
        'Dr. Webb treats sports injuries, back pain, and joint conditions with a practical recovery-first approach.'
      ),
      (
        'Dr. Priya Nair',
        'Dermatologist',
        ARRAY['skin', 'rash', 'acne', 'hair', 'nail', 'mole'],
        'Dr. Nair specializes in medical dermatology, chronic rashes, acne management, and skin screenings.'
      ),
      (
        'Dr. James Okafor',
        'Neurologist',
        ARRAY['brain', 'headache', 'migraine', 'nerve', 'seizure', 'memory', 'dizziness'],
        'Dr. Okafor cares for patients with migraines, seizure disorders, nerve symptoms, and memory concerns.'
      )
  ) AS provider_data(name, specialty, body_parts, bio)
),
inserted_providers AS (
  INSERT INTO providers (name, specialty, body_parts, bio)
  SELECT name, specialty, body_parts, bio
  FROM seeded_providers
  WHERE NOT EXISTS (
    SELECT 1
    FROM providers existing
    WHERE existing.name = seeded_providers.name
  )
  RETURNING id, name
),
provider_pool AS (
  SELECT id, name
  FROM providers
  WHERE name IN (
    'Dr. Sarah Chen',
    'Dr. Marcus Webb',
    'Dr. Priya Nair',
    'Dr. James Okafor'
  )
),
available_days AS (
  SELECT gs::date AS day
  FROM generate_series(
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '45 days',
    INTERVAL '1 day'
  ) AS gs
  WHERE EXTRACT(ISODOW FROM gs) BETWEEN 1 AND 5
),
slot_hours AS (
  SELECT UNNEST(ARRAY[TIME '09:00', TIME '10:00', TIME '11:00', TIME '14:00', TIME '15:00']) AS slot_time
),
slot_candidates AS (
  SELECT
    provider_pool.id AS provider_id,
    ((available_days.day::timestamp + slot_hours.slot_time) AT TIME ZONE 'America/New_York') AS slot_datetime,
    ROW_NUMBER() OVER (
      PARTITION BY provider_pool.id
      ORDER BY available_days.day, slot_hours.slot_time
    ) AS row_number
  FROM provider_pool
  CROSS JOIN available_days
  CROSS JOIN slot_hours
)
INSERT INTO provider_slots (provider_id, slot_datetime, is_available)
SELECT slot_candidates.provider_id, slot_candidates.slot_datetime, TRUE
FROM slot_candidates
WHERE slot_candidates.row_number <= 20
  AND NOT EXISTS (
    SELECT 1
    FROM provider_slots existing_slots
    WHERE existing_slots.provider_id = slot_candidates.provider_id
      AND existing_slots.slot_datetime = slot_candidates.slot_datetime
  );
