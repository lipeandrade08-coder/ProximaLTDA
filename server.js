'use strict'

const Fastify = require('fastify')
const { Pool } = require('pg')
const { Resend } = require('resend')

// ─── App ────────────────────────────────────────────────────────────────────
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  },
})

// ─── Env validation ─────────────────────────────────────────────────────────
const REQUIRED_ENV = ['DATABASE_URL', 'ADMIN_SECRET']
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌  Missing required env: ${key}`)
    process.exit(1)
  }
}

const PORT         = Number(process.env.PORT) || 3001
const ADMIN_SECRET = process.env.ADMIN_SECRET
const RESEND_KEY   = process.env.RESEND_API_KEY
const FROM_EMAIL   = process.env.FROM_EMAIL || 'Próximo <oi@proximo.app>'
const CORS_ORIGIN  = process.env.CORS_ORIGIN || '*'

// ─── Database ────────────────────────────────────────────────────────────────
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
})

// ─── Email ──────────────────────────────────────────────────────────────────
const resend = RESEND_KEY ? new Resend(RESEND_KEY) : null

// ─── Plugins ────────────────────────────────────────────────────────────────
app.register(require('@fastify/cors'), {
  origin: CORS_ORIGIN,
  methods: ['GET', 'POST', 'OPTIONS'],
})

app.register(require('@fastify/rate-limit'), {
  global: false,
})

app.register(require('@fastify/helmet'))

// ─── Schemas ────────────────────────────────────────────────────────────────
const signupBody = {
  type: 'object',
  required: ['name', 'email', 'city', 'user_type'],
  properties: {
    name:      { type: 'string', minLength: 2, maxLength: 120 },
    email:     { type: 'string', format: 'email', maxLength: 255 },
    phone:     { type: 'string', maxLength: 20, nullable: true },
    city:      { type: 'string', minLength: 2, maxLength: 100 },
    user_type: { type: 'string', enum: ['provider', 'client'] },
    category:  { type: 'string', maxLength: 80, nullable: true },
    source:    { type: 'string', maxLength: 50, default: 'landing' },
  },
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function requireAdmin(request, reply) {
  const key = request.headers['x-admin-key'] || request.query.key
  if (key !== ADMIN_SECRET) {
    reply.code(401).send({ error: 'Unauthorized' })
    return false
  }
  return true
}

function sanitize(str) {
  if (!str) return null
  return str.trim().replace(/[<>"']/g, '')
}

async function sendConfirmationEmail(entry) {
  if (!resend) return

  const isProvider = entry.user_type === 'provider'
  const subject = isProvider
    ? `${entry.name}, seu perfil no Próximo está reservado ✅`
    : `${entry.name}, você está na lista do Próximo 🎉`

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F2FAF6;font-family:'DM Sans',system-ui,sans-serif">
<div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(11,110,79,.08)">
  <!-- Header -->
  <div style="background:#0B6E4F;padding:32px 40px;text-align:center">
    <div style="display:inline-flex;align-items:center;gap:10px">
      <div style="width:40px;height:40px;background:rgba(255,255,255,.15);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.25)">
        <span style="font-size:22px">P</span>
      </div>
      <span style="font-family:serif;font-size:26px;font-weight:700;color:white;letter-spacing:-.5px">Próximo</span>
    </div>
  </div>
  <!-- Body -->
  <div style="padding:40px">
    <h1 style="font-size:24px;font-weight:700;color:#0D1B13;margin:0 0 12px;letter-spacing:-.5px">
      ${isProvider ? 'Seu espaço está guardado, ' : 'Você está na fila, '}${entry.name.split(' ')[0]}! 🌿
    </h1>
    <p style="font-size:16px;color:#3D5A4A;line-height:1.65;margin:0 0 24px">
      ${isProvider
        ? \`Recebemos seu cadastro como <strong>prestador de serviços</strong> em <strong>\${entry.city}</strong>. Quando o Próximo chegar na sua cidade, você será um dos primeiros a criar seu perfil — sem custo.\`
        : \`Recebemos seu cadastro como <strong>cliente</strong> em <strong>\${entry.city}</strong>. Assim que o Próximo chegar na sua cidade, você vai poder encontrar profissionais incríveis ao seu redor.\`
      }
    </p>
    <!-- Info card -->
    <div style="background:#F2FAF6;border-radius:12px;padding:20px 24px;border:1px solid rgba(11,110,79,.12);margin-bottom:28px">
      <p style="font-size:13px;font-weight:700;color:#0B6E4F;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px">Seus dados</p>
      <table style="width:100%;font-size:14px;color:#3D5A4A">
        <tr><td style="padding:4px 0;color:#6B8A79">Nome</td><td style="font-weight:600;color:#1A2E23">${entry.name}</td></tr>
        <tr><td style="padding:4px 0;color:#6B8A79">Cidade</td><td style="font-weight:600;color:#1A2E23">${entry.city}</td></tr>
        ${isProvider && entry.category ? `<tr><td style="padding:4px 0;color:#6B8A79">Área</td><td style="font-weight:600;color:#1A2E23">${entry.category}</td></tr>` : ''}
      </table>
    </div>
    <!-- CTA -->
    <p style="font-size:14px;color:#6B8A79;margin:0 0 8px">Conhece alguém que poderia se beneficiar? Compartilhe:</p>
    <a href="https://proximo.app" style="display:inline-block;padding:12px 28px;background:#0B6E4F;color:white;text-decoration:none;border-radius:10px;font-size:14px;font-weight:600">
      Compartilhar o Próximo →
    </a>
  </div>
  <!-- Footer -->
  <div style="padding:20px 40px;border-top:1px solid #E8F5EF;text-align:center">
    <p style="font-size:12px;color:#6B8A79;margin:0">
      © 2025 Próximo · Guaratinguetá, SP<br>
      <a href="#" style="color:#0B6E4F;text-decoration:none">Cancelar inscrição</a>
    </p>
  </div>
</div>
</body>
</html>`

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: entry.email,
      subject,
      html,
    })
    app.log.info({ email: entry.email }, 'Confirmation email sent')
  } catch (err) {
    app.log.warn({ err, email: entry.email }, 'Failed to send confirmation email')
    // Não lançar erro — email é nice-to-have, não bloquear o signup
  }
}

// ─── Migration: garante que a tabela existe ──────────────────────────────────
async function ensureTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id          SERIAL PRIMARY KEY,
      name        VARCHAR(120)  NOT NULL,
      email       VARCHAR(255)  UNIQUE NOT NULL,
      phone       VARCHAR(20),
      city        VARCHAR(100)  NOT NULL,
      user_type   VARCHAR(20)   NOT NULL DEFAULT 'client',
      category    VARCHAR(80),
      source      VARCHAR(50)   DEFAULT 'landing',
      ip          VARCHAR(45),
      created_at  TIMESTAMPTZ   DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_waitlist_city ON waitlist(city);
    CREATE INDEX IF NOT EXISTS idx_waitlist_type ON waitlist(user_type);
    CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist(created_at DESC);
  `)
  app.log.info('✅  DB table ready')
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// Health check
app.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: require('./package.json').version,
}))

// ── POST /waitlist ─── Cadastro público
app.post('/waitlist', {
  config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  schema: { body: signupBody },
}, async (request, reply) => {
  const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown'

  const entry = {
    name:      sanitize(request.body.name),
    email:     request.body.email.toLowerCase().trim(),
    phone:     sanitize(request.body.phone) || null,
    city:      sanitize(request.body.city),
    user_type: request.body.user_type,
    category:  sanitize(request.body.category) || null,
    source:    sanitize(request.body.source) || 'landing',
    ip,
  }

  try {
    const result = await db.query(
      `INSERT INTO waitlist (name, email, phone, city, user_type, category, source, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, created_at`,
      [entry.name, entry.email, entry.phone, entry.city,
       entry.user_type, entry.category, entry.source, entry.ip]
    )

    const record = { ...entry, ...result.rows[0] }

    // Email em background — não atrasa o response
    sendConfirmationEmail(record).catch(() => {})

    app.log.info({ id: record.id, email: entry.email, city: entry.city }, 'New waitlist signup')

    return reply.code(201).send({
      success: true,
      message: 'Cadastro realizado com sucesso!',
      id: record.id,
    })
  } catch (err) {
    if (err.code === '23505') {
      // unique violation — email já cadastrado
      return reply.code(409).send({
        success: false,
        error: 'Este e-mail já está na lista de espera.',
      })
    }
    app.log.error(err)
    return reply.code(500).send({
      success: false,
      error: 'Erro interno. Tente novamente em instantes.',
    })
  }
})

// ── GET /admin/waitlist ─── Listar leads (admin)
app.get('/admin/waitlist', async (request, reply) => {
  if (!requireAdmin(request, reply)) return

  const page     = Math.max(1, Number(request.query.page) || 1)
  const limit    = Math.min(100, Number(request.query.limit) || 50)
  const offset   = (page - 1) * limit
  const city     = request.query.city || null
  const type     = request.query.type || null
  const search   = request.query.search || null

  const conditions = ['1=1']
  const params = []
  let p = 1

  if (city)   { conditions.push(`city ILIKE $${p++}`)  ; params.push(`%${city}%`) }
  if (type)   { conditions.push(`user_type = $${p++}`)  ; params.push(type) }
  if (search) { conditions.push(`(name ILIKE $${p++} OR email ILIKE $${p++})`); params.push(`%${search}%`, `%${search}%`); p++ }

  const where = conditions.join(' AND ')

  const [rows, countRow] = await Promise.all([
    db.query(
      `SELECT id, name, email, phone, city, user_type, category, source, created_at
       FROM waitlist WHERE ${where}
       ORDER BY created_at DESC LIMIT $${p} OFFSET $${p+1}`,
      [...params, limit, offset]
    ),
    db.query(`SELECT COUNT(*) FROM waitlist WHERE ${where}`, params),
  ])

  return {
    data:  rows.rows,
    total: Number(countRow.rows[0].count),
    page,
    limit,
    pages: Math.ceil(Number(countRow.rows[0].count) / limit),
  }
})

// ── GET /admin/stats ─── Estatísticas (admin)
app.get('/admin/stats', async (request, reply) => {
  if (!requireAdmin(request, reply)) return

  const [total, byType, byCity, byDay] = await Promise.all([
    db.query('SELECT COUNT(*) AS total FROM waitlist'),
    db.query(`SELECT user_type, COUNT(*) AS count FROM waitlist GROUP BY user_type`),
    db.query(`SELECT city, COUNT(*) AS count FROM waitlist GROUP BY city ORDER BY count DESC LIMIT 10`),
    db.query(`
      SELECT DATE(created_at) AS day, COUNT(*) AS count
      FROM waitlist
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY day ORDER BY day ASC
    `),
  ])

  return {
    total:   Number(total.rows[0].total),
    by_type: byType.rows,
    by_city: byCity.rows,
    by_day:  byDay.rows,
  }
})

// ── GET /admin/export ─── Export CSV (admin)
app.get('/admin/export', async (request, reply) => {
  if (!requireAdmin(request, reply)) return

  const { rows } = await db.query(
    `SELECT id, name, email, phone, city, user_type, category, source,
            TO_CHAR(created_at, 'DD/MM/YYYY HH24:MI') AS created_at
     FROM waitlist ORDER BY created_at DESC`
  )

  const header = 'ID,Nome,Email,Telefone,Cidade,Tipo,Categoria,Origem,Cadastrado em'
  const csv = [
    header,
    ...rows.map(r =>
      [r.id, `"${r.name}"`, r.email, r.phone || '', `"${r.city}"`,
       r.user_type, r.category || '', r.source, r.created_at].join(',')
    ),
  ].join('\n')

  return reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename="proximo-waitlist-${Date.now()}.csv"`)
    .send('\uFEFF' + csv) // BOM para Excel abrir certo
})

// ─── Start ──────────────────────────────────────────────────────────────────
async function start() {
  try {
    await db.connect()
    app.log.info('✅  Database connected')
    await ensureTable()
    await app.listen({ port: PORT, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
