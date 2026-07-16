'use strict';
const path           = require('path');
const express        = require('express');
const cors           = require('cors');
const helmet         = require('helmet');
const morgan         = require('morgan');
const rateLimit      = require('express-rate-limit');
const swaggerUi      = require('swagger-ui-express');
const swaggerSpec    = require('./config/swagger');
const env            = require('./config/env');
const routes         = require('./routes/index');
const { errorHandler, notFoundHandler } = require('./middlewares/error.middleware');

const app = express();

// ── Security ─────────────────────────────────────────────────
// Relax helmet CSP so Swagger UI loads correctly
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS ──────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  env.CLIENT_URL,
  /\.ngrok-free\.app$/,
  /\.ngrok-free\.dev$/,
  /\.ngrok\.io$/,
];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // allow non-browser / same-origin
    const allowed = ALLOWED_ORIGINS.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    allowed ? cb(null, true) : cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods:     ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// ── Rate limiting ─────────────────────────────────────────────
app.use('/api/v1/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      20,
  message:  { success: false, message: 'Too many requests. Try again after 15 minutes.' },
}));

app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max:      100,
  message:  { success: false, message: 'Too many requests.' },
}));

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logger ────────────────────────────────────────────────────
if (env.NODE_ENV !== 'test') {
  app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ── Static files (public/) ────────────────────────────────────
app.use('/public', express.static(path.join(__dirname, '..', 'public')));

// ── Swagger UI ────────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'MatchCreatorz API Docs',
  swaggerOptions:  { persistAuthorization: true },
}));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status:  'OK',
    service: 'MatchCreatorz API',
    version: '1.0.0',
    env:     env.NODE_ENV,
    docs:    `http://localhost:${env.PORT}/api-docs`,
    time:    new Date().toISOString(),
  });
});

// ── API Routes ────────────────────────────────────────────────
app.use('/api/v1', routes);

// ── 404 + Error handlers ──────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
