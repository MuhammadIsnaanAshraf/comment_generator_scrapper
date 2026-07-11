import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { generateCommentsRouter } from './routes/generate-comments';
import { authRouter } from './routes/auth';

const app = express();
const PORT = process.env.PORT ?? 3333;

// Extension popup pages run under a chrome-extension:// origin, not http(s),
// so a permissive CORS policy is fine here — auth uses stateless Bearer tokens
// (no cookies/credentials), and secrets (Supabase/Groq/Apify keys) never leave
// the server.
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Public auth endpoints (signup/login/refresh) + protected ones (logout/me).
app.use('/api/auth', authRouter);

// Comment generation now requires a valid session.
app.use('/api', generateCommentsRouter);

app.listen(PORT, () => {
  console.log(`LinkedIn Comment Assistant backend listening on http://localhost:${PORT}`);
});
