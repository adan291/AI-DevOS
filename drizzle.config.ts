import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/persistence/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/ai_devos',
  },
  verbose: true,
  strict: true,
});
