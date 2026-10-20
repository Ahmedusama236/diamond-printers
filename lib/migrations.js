// A database-wide transaction lock protects catalog changes across Vercel workers.
// The persisted marker keeps ordinary requests from repeating DDL and REVOKE.
const pending = new Map();
function runMigration(sql, version, statements) {
  if (!/^[a-z0-9_]+$/.test(version)) throw new Error('Invalid migration version');
  if (pending.has(version)) return pending.get(version);
  const promise = sql.transaction([
    sql.query('SELECT pg_advisory_xact_lock(781351)'),
    sql.query(`CREATE TABLE IF NOT EXISTS app_schema_migrations (
      version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`),
    sql.query('ALTER TABLE app_schema_migrations ENABLE ROW LEVEL SECURITY'),
    sql.query(`DO $migration$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM app_schema_migrations WHERE version='${version}') THEN
        ${statements.map(statement=>statement.trim().replace(/;$/, '')+';').join('\n')}
        INSERT INTO app_schema_migrations(version) VALUES('${version}');
      END IF;
    END $migration$`),
  ]).catch(error=>{pending.delete(version);throw error;});
  pending.set(version,promise);
  return promise;
}
module.exports = {runMigration};
