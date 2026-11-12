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

-- ----- Proteção contra agendamento de trote (v1.3) -----
ALTER TABLE settings ADD COLUMN IF NOT EXISTS max_active  smallint NOT NULL DEFAULT 2;  -- horários marcados ao mesmo tempo por cliente
ALTER TABLE settings ADD COLUMN IF NOT EXISTS max_per_day smallint NOT NULL DEFAULT 1;  -- horários no mesmo dia por cliente
ALTER TABLE settings ADD COLUMN IF NOT EXISTS max_device  smallint NOT NULL DEFAULT 3;  -- agendamentos novos pelo site por aparelho em 24 h
ALTER TABLE settings ADD COLUMN IF NOT EXISTS auto_block  smallint NOT NULL DEFAULT 2;  -- bloqueia depois de N faltas (0 = nunca)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS blocked        boolean NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS blocked_reason text    NOT NULL DEFAULT '';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS device text;   -- código do aparelho (só para contar agendamentos)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS ip_hash text;  -- IP embaralhado, nunca o IP de verdade
CREATE INDEX IF NOT EXISTS appointments_created_idx ON appointments(created_at);

-- ----- Layout novo (v1.4) -----
ALTER TABLE settings ADD COLUMN IF NOT EXISTS phone     text  NOT NULL DEFAULT '';   -- WhatsApp da barbearia (aparece no site)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS day_hours jsonb NOT NULL DEFAULT '{}'; -- horário próprio de cada dia: {"6":{"open":"08:00","close":"14:00"}}
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category  text  NOT NULL DEFAULT 'Outros';

-- ----- Lembrete no WhatsApp (v1.5) -----
ALTER TABLE settings ADD COLUMN IF NOT EXISTS remind_on  boolean  NOT NULL DEFAULT false; -- manda lembrete automático
ALTER TABLE settings ADD COLUMN IF NOT EXISTS remind_min smallint NOT NULL DEFAULT 60;    -- quantos minutos antes do horário
ALTER TABLE settings ADD COLUMN IF NOT EXISTS remind_msg text     NOT NULL DEFAULT '';    -- texto (vazio = texto padrão)
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS remind_status text;        -- vazio, enviando, enviado ou falhou
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS remind_at     timestamptz; -- quando o lembrete saiu
-- Sessão do WhatsApp dos lembretes (fica no banco para sobreviver aos reinícios do servidor)
CREATE TABLE IF NOT EXISTS wa_auth (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- ----- Intervalo dos horários (v1.6) -----
ALTER TABLE settings ADD COLUMN IF NOT EXISTS slot_step smallint NOT NULL DEFAULT 30; -- horários do site de 30 em 30 ou de 60 em 60 minutos

-- ----- Fechar atendimento (v1.7) -----
-- O barbeiro confere o que foi feito ao marcar "Atendido": pode trocar ou somar serviços e dar desconto.
-- items guarda a lista [{serviceId, name, price}] (vazio = só o serviço marcado); price passa a ser o total cobrado.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS items    jsonb;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS discount numeric(10,2) NOT NULL DEFAULT 0;

-- ----- Agendar para a família (v1.8) -----
-- O barbeiro libera, só para alguns clientes, mais horários no mesmo dia (ex.: pai que marca para ele e os filhos).
ALTER TABLE clients ADD COLUMN IF NOT EXISTS per_day smallint CHECK (per_day IS NULL OR per_day BETWEEN 2 AND 10); -- vazio = regra geral
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS for_name text; -- para quem é o horário, quando não é o próprio cliente

-- ----- Remarcar, vários serviços e lista de espera (v1.9) -----
-- Remarcar: guarda de onde o horário saiu ("AAAA-MM-DD HH:MM") para o painel mostrar "Mudou de..."
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS moved_from text;
-- Horário que a lista de espera marcou sozinha tem origem própria; o sino ganha "mudou o horário" e "vaga da lista de espera"
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'appointments_origin_check' AND pg_get_constraintdef(oid) LIKE '%espera%') THEN
    ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_origin_check;
    ALTER TABLE appointments ADD CONSTRAINT appointments_origin_check CHECK (origin IN ('site','painel','espera'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_type_check' AND pg_get_constraintdef(oid) LIKE '%espera%') THEN
    ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
    ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (type IN ('novo','cancelado','remarcado','espera'));
  END IF;
END $$;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS info jsonb; -- detalhes do aviso (ex.: horário antigo de quem remarcou)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS wait_on  boolean  NOT NULL DEFAULT true; -- lista de espera ligada (só aparece com o WhatsApp dos lembretes conectado)
ALTER TABLE settings ADD COLUMN IF NOT EXISTS wait_min smallint NOT NULL DEFAULT 60;   -- só passa a vaga se faltar pelo menos isso para o horário
-- Fila de quem quer um horário num dia lotado. items = [{serviceId, name, price, dur}]
CREATE TABLE IF NOT EXISTS waitlist (
  id             serial PRIMARY KEY,
  client_id      integer NOT NULL REFERENCES clients(id),
  date           date    NOT NULL,
  period         text    NOT NULL DEFAULT 'qualquer' CHECK (period IN ('qualquer','manha','tarde','noite')),
  items          jsonb   NOT NULL,
  duration       integer NOT NULL,
  status         text    NOT NULL DEFAULT 'aguardando' CHECK (status IN ('aguardando','marcado','saiu')),
  appointment_id integer REFERENCES appointments(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS waitlist_date_idx   ON waitlist(date, status);
CREATE INDEX IF NOT EXISTS waitlist_client_idx ON waitlist(client_id);
