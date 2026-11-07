-- Estrutura do banco. Pode rodar várias vezes sem problema (só cria o que não existe).

CREATE TABLE IF NOT EXISTS settings (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  shop_name     text     NOT NULL DEFAULT 'Minha Barbearia',
  tagline       text     NOT NULL DEFAULT 'Agende seu horário em poucos toques.',
  address       text     NOT NULL DEFAULT '',
  logo          text,
  color         text     NOT NULL DEFAULT 'latao',
  custom_color  text     NOT NULL DEFAULT '#8c6a2b',
  open_time     text     NOT NULL DEFAULT '09:00',
  close_time    text     NOT NULL DEFAULT '19:00',
  lunch_start   text     NOT NULL DEFAULT '12:00',
  lunch_end     text     NOT NULL DEFAULT '13:00',
  closed_days   smallint[] NOT NULL DEFAULT '{0}',
  book_from     date     NOT NULL DEFAULT CURRENT_DATE,
  book_to       date     NOT NULL DEFAULT ((date_trunc('month', CURRENT_DATE) + interval '2 month' - interval '1 day')::date)
);

CREATE TABLE IF NOT EXISTS barbers (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  email         text NOT NULL DEFAULT '',
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  price      numeric(10,2) NOT NULL CHECK (price >= 0),
  duration   integer NOT NULL CHECK (duration IN (30, 60, 90, 120)),
  active     boolean NOT NULL DEFAULT true,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  phone      text NOT NULL UNIQUE,
  created_at date NOT NULL DEFAULT CURRENT_DATE
);

-- O nome e o preço do serviço ficam gravados no agendamento:
-- se o barbeiro mudar o preço depois, o financeiro antigo não muda.
CREATE TABLE IF NOT EXISTS appointments (
  id           serial PRIMARY KEY,
  client_id    integer NOT NULL REFERENCES clients(id),
  service_id   integer REFERENCES services(id),
  service_name text NOT NULL,
  price        numeric(10,2) NOT NULL,
  duration     integer NOT NULL,
  date         date NOT NULL,
  time         text NOT NULL,
  status       text NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','realizado','faltou','cancelado')),
  origin       text NOT NULL DEFAULT 'site' CHECK (origin IN ('site','painel')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appointments_date_idx   ON appointments(date);
CREATE INDEX IF NOT EXISTS appointments_client_idx ON appointments(client_id);

CREATE TABLE IF NOT EXISTS expenses (
  id          serial PRIMARY KEY,
  description text NOT NULL,
  amount      numeric(10,2) NOT NULL CHECK (amount > 0),
  date        date NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(date);

CREATE TABLE IF NOT EXISTS blocked_days (
  date   date PRIMARY KEY,
  reason text NOT NULL DEFAULT ''
);

-- Avisos do sino do painel (novo agendamento ou cancelamento feito pelo cliente no site)
CREATE TABLE IF NOT EXISTS notifications (
  id             serial PRIMARY KEY,
  type           text NOT NULL CHECK (type IN ('novo','cancelado')),
  appointment_id integer NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  read           boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications(created_at DESC);
