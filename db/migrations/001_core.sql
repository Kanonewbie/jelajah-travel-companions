-- Jelajah Smart Travel Companion — PostgreSQL starter schema.
-- Browser MVP does not connect to this schema. Apply only when you provision a backend.
-- Do not store original passport/visa files in these metadata tables.

CREATE TABLE travel_profiles (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  preferred_language TEXT NOT NULL DEFAULT 'id',
  travel_style TEXT NOT NULL DEFAULT 'slow_travel',
  daily_budget BIGINT NOT NULL DEFAULT 0,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT
);
CREATE INDEX idx_travel_profiles_updated ON travel_profiles(updated_at);

CREATE TABLE travel_preferences (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  preference_key TEXT NOT NULL,
  preference_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  consent_state TEXT NOT NULL DEFAULT 'unset',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT,
  UNIQUE(user_id, preference_key)
);
CREATE INDEX idx_travel_preferences_user ON travel_preferences(user_id, updated_at DESC);

CREATE TABLE trips (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  destination TEXT NOT NULL DEFAULT '',
  starts_on DATE,
  ends_on DATE,
  budget_amount BIGINT NOT NULL DEFAULT 0,
  currency_code CHAR(3) NOT NULL DEFAULT 'IDR',
  travel_style TEXT NOT NULL DEFAULT 'slow_travel',
  status TEXT NOT NULL DEFAULT 'planning',
  cover_url TEXT,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT,
  CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX idx_trips_user_updated ON trips(user_id, updated_at DESC);
CREATE INDEX idx_trips_status_dates ON trips(status, starts_on);

CREATE TABLE trip_members (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id TEXT,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','editor','viewer')),
  invite_code TEXT,
  invite_status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT
);
CREATE INDEX idx_trip_members_trip ON trip_members(trip_id);
CREATE INDEX idx_trip_members_user ON trip_members(user_id);

CREATE TABLE itinerary_days (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL,
  trip_date DATE,
  title TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT,
  UNIQUE(trip_id, day_number)
);

CREATE TABLE itinerary_items (
  id BIGSERIAL PRIMARY KEY,
  day_id BIGINT NOT NULL REFERENCES itinerary_days(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  location_name TEXT NOT NULL DEFAULT '',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  estimated_minutes INTEGER,
  estimated_cost BIGINT NOT NULL DEFAULT 0,
  currency_code CHAR(3) NOT NULL DEFAULT 'IDR',
  category TEXT NOT NULL DEFAULT 'other',
  note TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  completion_status TEXT NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT
);
CREATE INDEX idx_itinerary_day_order ON itinerary_items(day_id, sort_order);

CREATE TABLE votes (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  itinerary_item_id BIGINT REFERENCES itinerary_items(id) ON DELETE SET NULL,
  proposed_by TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT
);
CREATE INDEX idx_votes_trip_status ON votes(trip_id, status);

CREATE TABLE vote_responses (
  id BIGSERIAL PRIMARY KEY,
  vote_id BIGINT NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  choice TEXT NOT NULL CHECK (choice IN ('yes','no','abstain')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT,
  UNIQUE(vote_id, user_id)
);

CREATE TABLE trip_notes (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  itinerary_item_id BIGINT REFERENCES itinerary_items(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT
);
CREATE INDEX idx_trip_notes_trip_updated ON trip_notes(trip_id, updated_at DESC);

CREATE TABLE expenses (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  paid_by_member_id BIGINT REFERENCES trip_members(id) ON DELETE SET NULL,
  created_by_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  amount BIGINT NOT NULL CHECK (amount >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'IDR',
  category TEXT NOT NULL DEFAULT 'other',
  spent_on DATE NOT NULL DEFAULT CURRENT_DATE,
  receipt_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT
);
CREATE INDEX idx_expenses_trip_date ON expenses(trip_id, spent_on DESC);

CREATE TABLE expense_splits (
  id BIGSERIAL PRIMARY KEY,
  expense_id BIGINT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  member_id BIGINT NOT NULL REFERENCES trip_members(id) ON DELETE CASCADE,
  share_amount BIGINT NOT NULL CHECK (share_amount >= 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'IDR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT,
  UNIQUE(expense_id, member_id)
);

CREATE TABLE settlements (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  from_member_id BIGINT NOT NULL REFERENCES trip_members(id) ON DELETE CASCADE,
  to_member_id BIGINT NOT NULL REFERENCES trip_members(id) ON DELETE CASCADE,
  amount BIGINT NOT NULL CHECK (amount > 0),
  currency_code CHAR(3) NOT NULL DEFAULT 'IDR',
  status TEXT NOT NULL DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT,
  CHECK (from_member_id <> to_member_id)
);
CREATE INDEX idx_settlements_trip_status ON settlements(trip_id, status);

CREATE TABLE packing_items (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  assigned_member_id BIGINT REFERENCES trip_members(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'other',
  is_packed BOOLEAN NOT NULL DEFAULT false,
  quantity INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT
);
CREATE INDEX idx_packing_trip_packed ON packing_items(trip_id, is_packed);

CREATE TABLE document_metadata (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  trip_id BIGINT REFERENCES trips(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  document_type TEXT NOT NULL,
  expires_on DATE,
  reminder_at TIMESTAMPTZ,
  encrypted_file_local BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT
);
CREATE INDEX idx_document_metadata_user_expiry ON document_metadata(user_id, expires_on);

CREATE TABLE bookings (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  booking_type TEXT NOT NULL,
  provider_name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  reference_hint TEXT NOT NULL DEFAULT '',
  encrypted_file_local BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT
);
CREATE INDEX idx_bookings_trip_time ON bookings(trip_id, starts_at);

CREATE TABLE trip_photos (
  id BIGSERIAL PRIMARY KEY,
  trip_id BIGINT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  local_uri TEXT,
  caption TEXT NOT NULL DEFAULT '',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  taken_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT
);
CREATE INDEX idx_trip_photos_trip_time ON trip_photos(trip_id, taken_at);

CREATE TABLE published_routes (
  id BIGSERIAL PRIMARY KEY,
  creator_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  route_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  moderation_status TEXT NOT NULL DEFAULT 'draft',
  price_amount BIGINT NOT NULL DEFAULT 0,
  currency_code CHAR(3) NOT NULL DEFAULT 'IDR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT
);
CREATE INDEX idx_published_routes_moderation ON published_routes(moderation_status, updated_at DESC);

CREATE TABLE user_badges (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  badge_key TEXT NOT NULL,
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  device_id TEXT,
  UNIQUE(user_id, badge_key)
);

CREATE TABLE sync_operations (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_local_id TEXT NOT NULL,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('create','update','delete','vote','settlement')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  base_version INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  deleted_at TIMESTAMPTZ,
  UNIQUE(user_id, device_id, entity_type, entity_local_id, version)
);
CREATE INDEX idx_sync_operations_pending ON sync_operations(user_id, status, created_at);
