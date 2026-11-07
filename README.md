# Sistema da Barbearia

Agendamento online para os clientes (pelo celular, via QR Code) e painel de gestão para o barbeiro (no computador).

- **Site do cliente** (`/`): escolhe dia, horário e serviço; entra só com o WhatsApp; vê e cancela os próprios horários.
- **Painel do barbeiro** (`/painel`): início do dia, agenda (lista, semana e mês), financeiro com despesas, clientes, configurações (nome, logo, cor, horários, período de agendamento, dias bloqueados, serviços e preços) e perfil.
- **Sino de avisos**: quando um cliente marca ou cancela pelo site, o painel recebe o aviso na hora e toca uma campainha.

Feito em Node.js + Express, com banco PostgreSQL no Neon (plano gratuito).

---

## 1. O que precisa ter instalado

- [Node.js](https://nodejs.org) versão 18.18 ou mais nova (recomendado: a versão LTS).

## 2. Criar o banco no Neon (gratuito)

1. Entre em <https://neon.tech> e crie uma conta (pode ser com o Google ou o GitHub).
2. Clique em **New Project**. Nome: `barbearia`. Região: **AWS São Paulo (sa-east-1)**, que fica mais perto do Brasil.
3. No painel do projeto, clique em **Connect** e copie a **connection string**. Ela começa com `postgresql://`. No final, troque `sslmode=require` por `sslmode=verify-full` (é a mesma conexão segura e evita um aviso no terminal).

## 3. Configurar o projeto

Na pasta do projeto, abra o terminal e rode:

```bash
npm install
```

Depois crie na pasta do projeto um arquivo chamado `.env` com estas linhas e preencha cada uma:

```
DATABASE_URL=postgresql://usuario:senha@ep-xxxxx.sa-east-1.aws.neon.tech/neondb?sslmode=verify-full
JWT_SECRET=uma-frase-bem-grande-e-aleatoria
ADMIN_USER=barbeiro
ADMIN_PASSWORD=uma-senha-com-6-ou-mais
ADMIN_NAME=Seu Nome
PORT=3000
TZ_BARBEARIA=America/Sao_Paulo
```

O que vai em cada uma:

| Variável | O que colocar |
|---|---|
| `DATABASE_URL` | A connection string do Neon (passo 2) |
| `JWT_SECRET` | Uma frase grande e aleatória. Serve para proteger os logins |
| `ADMIN_USER` | O usuário do barbeiro (ex.: `barbeiro`) |
| `ADMIN_PASSWORD` | A senha inicial do barbeiro (mínimo 6 caracteres) |
| `ADMIN_NAME` | O nome do barbeiro |
| `PORT` | A porta do servidor (pode deixar 3000) |
| `TZ_BARBEARIA` | O fuso horário (deixe `America/Sao_Paulo`) |

> O `.env` tem senhas. Ele já está no `.gitignore` e nunca deve ir para o GitHub.

## 4. Preparar o banco

```bash
npm run db:setup
```

Isso cria as tabelas, as configurações iniciais, o login do barbeiro e 6 serviços de exemplo. Pode rodar de novo quando quiser: o comando não apaga nada.

Para testar com clientes e agendamentos fictícios, use `npm run db:demo` (num banco vazio) no lugar.

**Esqueceu a senha ou quer trocar o usuário?** Ajuste `ADMIN_USER` e `ADMIN_PASSWORD` no `.env` e rode `npm run db:login`. Isso troca só o login do barbeiro e não mexe em mais nada.

**Apagar os dados de exemplo.** Se rodou o `npm run db:demo` e quer começar a usar de verdade, rode `npm run db:limpar-demo`. Ele apaga só os clientes, agendamentos e despesas de exemplo.

## 5. Rodar

```bash
npm run dev
```

- Site do cliente: <http://localhost:3000>
- Painel do barbeiro: <http://localhost:3000/painel>

Para testar o site do cliente pelo celular na mesma rede Wi-Fi, use o IP do computador, por exemplo `http://192.168.0.10:3000`.

---

## Como as coisas funcionam

**Horários.** A agenda é em blocos de 30 minutos. Um serviço de 60 minutos ocupa dois blocos. O servidor confere tudo de novo antes de gravar: se dois clientes tentarem o mesmo horário ao mesmo tempo, só um consegue e o outro recebe a mensagem "Esse horário acabou de ser ocupado".

**Período de agendamento.** O barbeiro escolhe em Configurações as datas em que os clientes podem marcar (ex.: só até o fim de janeiro). No painel ele pode encaixar clientes fora desse período.

**Financeiro.** Só entra no faturamento o que foi marcado como **Atendido**. O preço fica gravado no agendamento, então mudar o preço de um serviço não altera o histórico. Remover um serviço só esconde ele dos clientes; os atendimentos antigos continuam no financeiro.

**Avisos em tempo real.** O painel fica conectado ao servidor e recebe os avisos na hora. Isso acontece sem consultar o banco a cada poucos segundos, então o Neon gratuito pode "dormir" quando ninguém está usando e não gasta as horas grátis. Os navegadores só deixam tocar som depois de um clique na página: por isso o painel mostra o botão **Ativar som** quando for preciso.

**Cliente sem senha.** O cliente entra só com o WhatsApp, como foi combinado no protótipo. É simples para ele, mas quem souber o número de alguém consegue ver e cancelar os horários dessa pessoa. Uma melhoria futura é mandar um código pelo WhatsApp para confirmar.

**Fuso horário.** Tudo usa o horário de Brasília (`America/Sao_Paulo`). Dá para trocar pela variável `TZ_BARBEARIA`.

## Estrutura

```
src/
  server.js          servidor Express
  db.js              conexão com o PostgreSQL (Neon)
  schema.sql         tabelas do banco
  setup-db.js        prepara o banco (npm run db:setup / db:demo)
  reset-login.js     redefine o login do barbeiro (npm run db:login)
  auth.js            login do barbeiro (cookie) e do cliente (token)
  booking.js         criação de agendamento com todas as conferências
  notify.js          avisos em tempo real para o painel
  repo.js            leitura do banco
  routes/public.js   rotas do site do cliente
  routes/admin.js    rotas do painel
public/
  index.html, cliente.js, cliente.css     site do cliente
  painel/                                 painel do barbeiro (+ som.js da campainha)
  shared/agenda.js                        regras de horário (usadas no navegador e no servidor)
  shared/ui.js, base.css, phone.css       peças visuais comuns
```

## Próximos passos sugeridos

- Colocar no ar num serviço que mantenha o Node rodando o tempo todo (necessário para os avisos em tempo real).
- Gerar o QR Code com o endereço final do site.
- Botão de limpeza do banco que preserve o financeiro (combinado para depois).
