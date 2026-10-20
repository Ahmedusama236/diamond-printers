CREATE TABLE IF NOT EXISTS app_users (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text UNIQUE NOT NULL, password_hash text NOT NULL,
  role text NOT NULL CHECK(role IN ('admin','user')),
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash text PRIMARY KEY, user_id bigint NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS app_login_attempts (
  attempt_key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS printer_sales (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_name text NOT NULL, quantity integer NOT NULL CHECK(quantity>0),
  unit_price numeric NOT NULL CHECK(unit_price>=0), counter bigint CHECK(counter>=0),
  customer_phone text NOT NULL, customer_name text,
  sold_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid UNIQUE NOT NULL
);
-- Account credentials and sessions must not be readable through the optional Data API.
REVOKE ALL ON app_users, app_sessions, app_login_attempts FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anonymous') THEN
    REVOKE ALL ON app_users, app_sessions, app_login_attempts FROM anonymous;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON app_users, app_sessions, app_login_attempts FROM authenticated;
  END IF;
END $$;
