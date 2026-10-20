const crypto = require('crypto');
const {runMigration} = require('./migrations');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const cookieName = 'diamond_session';
async function hashPassword(password) {
  if (String(password).length < 8) throw new Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل');
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(String(password), salt, 64)).toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const actual = await scrypt(String(password), salt, 64);
  return crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'));
}
function tokenHash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
async function ensureAuth(database) {
  const statements=[];
  const sql={query:async(statement)=>{statements.push(statement);}};
  await sql.query(`CREATE TABLE IF NOT EXISTS app_users (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, username text UNIQUE NOT NULL,
    password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','user')),
    active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now())`);
  await sql.query(`CREATE TABLE IF NOT EXISTS app_sessions (
    token_hash text PRIMARY KEY, user_id bigint NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL)`);
  await sql.query(`CREATE TABLE IF NOT EXISTS app_login_attempts (
    attempt_key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 1,
    window_start timestamptz NOT NULL DEFAULT now())`);
  await sql.query(`REVOKE ALL ON app_users, app_sessions, app_login_attempts FROM PUBLIC`);
  await sql.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anonymous') THEN
      REVOKE ALL ON app_users, app_sessions, app_login_attempts FROM anonymous;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
      REVOKE ALL ON app_users, app_sessions, app_login_attempts FROM authenticated;
    END IF;
  END $$`);
  await runMigration(database,'auth_schema_v1',statements);
}
async function currentUser(sql, req) {
  const token = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!token) return null;
  const rows = await sql.query(`SELECT u.id,u.username,u.role FROM app_sessions s JOIN app_users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`, [tokenHash(token)]);
  return rows[0] || null;
}
function setCookie(res, token, req, clear = false) {
  res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : 43200}${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
}
module.exports = { hashPassword, verifyPassword, tokenHash, ensureAuth, currentUser, setCookie };
