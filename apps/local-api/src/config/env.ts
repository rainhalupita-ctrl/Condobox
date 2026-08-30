import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  STORAGE_DIR: z.string().default('./data/packages'),
  SUPABASE_URL: z.string().url().optional().default('https://placeholder.supabase.co'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional().default('placeholder_key'),
  CONDO_ID: z.string().optional().default('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
  GEMINI_API_KEY: z.string().optional().default(''),
  EVOLUTION_API_URL: z.string().default('http://127.0.0.1:8080'),
  EVOLUTION_API_KEY: z.string().default('condo_evolution_super_secret_key_2026'),
  EVOLUTION_INSTANCE_NAME: z.string().default('portaria-principal'),
  LOCAL_BASE_URL: z.string().default('http://localhost:3001'),
  WEB_APP_URL: z.string().default('http://localhost:3000'),
});

export const env = envSchema.parse(process.env);

export const ABSOLUTE_STORAGE_DIR = path.isAbsolute(env.STORAGE_DIR)
  ? env.STORAGE_DIR
  : path.resolve(process.cwd(), env.STORAGE_DIR);
