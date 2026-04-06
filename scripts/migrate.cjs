#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const migrationsDir = path.resolve(process.cwd(), 'migrations');

const bootstrapChecks = {
  '001_init.sql': async (client) => {
    const { rows } = await client.query(`
      SELECT
        to_regclass('public.sessions') IS NOT NULL AS sessions_exists,
        to_regclass('public.providers') IS NOT NULL AS providers_exists,
        to_regclass('public.provider_slots') IS NOT NULL AS provider_slots_exists,
        to_regclass('public.appointments') IS NOT NULL AS appointments_exists
    `);

    const row = rows[0] || {};
    return (
      row.sessions_exists &&
      row.providers_exists &&
      row.provider_slots_exists &&
      row.appointments_exists
    );
  },
  '002_seed.sql': async (client) => {
    const { rows } = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM providers
        WHERE name = ANY($1::text[])
      `,
      [[
        'Dr. Sarah Chen',
        'Dr. Marcus Webb',
        'Dr. Priya Nair',
        'Dr. James Okafor'
      ]]
    );

    return (rows[0]?.count || 0) >= 4;
  },
  '003_waitlist.sql': async (client) => {
    const { rows } = await client.query(`
      SELECT to_regclass('public.waitlist') IS NOT NULL AS waitlist_exists
    `);

    return Boolean(rows[0]?.waitlist_exists);
  }
};

const createPool = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Add it to .env before running npm run migrate.'
    );
  }

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false
  });
};

const getMigrationFiles = () =>
  fs
    .readdirSync(migrationsDir)
    .filter((fileName) => /^\d+.*\.sql$/i.test(fileName))
    .sort((left, right) => left.localeCompare(right));

const ensureMigrationsTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
};

const getAppliedMigrations = async (client) => {
  const { rows } = await client.query(`
    SELECT filename
    FROM schema_migrations
    ORDER BY filename
  `);

  return new Set(rows.map((row) => row.filename));
};

const markAsApplied = async (client, fileName, reason) => {
  await client.query(
    `
      INSERT INTO schema_migrations (filename)
      VALUES ($1)
      ON CONFLICT (filename) DO NOTHING
    `,
    [fileName]
  );

  console.log(`[migrate] Marked ${fileName} as applied (${reason}).`);
};

const applyMigration = async (client, fileName) => {
  const sql = fs.readFileSync(path.join(migrationsDir, fileName), 'utf8');

  console.log(`[migrate] Applying ${fileName}...`);
  await client.query('BEGIN');

  try {
    await client.query(sql);
    await client.query(
      `
        INSERT INTO schema_migrations (filename)
        VALUES ($1)
      `,
      [fileName]
    );
    await client.query('COMMIT');
    console.log(`[migrate] Applied ${fileName}.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
};

const main = async () => {
  const pool = createPool();
  const client = await pool.connect();

  try {
    await ensureMigrationsTable(client);
    const migrationFiles = getMigrationFiles();
    const appliedMigrations = await getAppliedMigrations(client);

    for (const fileName of migrationFiles) {
      if (appliedMigrations.has(fileName)) {
        console.log(`[migrate] Skipping ${fileName}; already applied.`);
        continue;
      }

      const bootstrapCheck = bootstrapChecks[fileName];

      if (bootstrapCheck) {
        const alreadyApplied = await bootstrapCheck(client);

        if (alreadyApplied) {
          await markAsApplied(client, fileName, 'detected existing schema/data');
          continue;
        }
      }

      await applyMigration(client, fileName);
    }

    console.log('[migrate] All migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((error) => {
  console.error('[migrate] Failed:', error.message);
  process.exit(1);
});
