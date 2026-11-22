import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import type { TestProject } from "vitest/node";

// Crea una base desechable, emula lo que Supabase trae de fábrica y aplica las migraciones reales del repo.
const SUPABASE_EMULATION = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema if not exists extensions;
grant usage on schema public, extensions to anon, authenticated;
-- Supabase concede por defecto todo a anon/authenticated en public; las migraciones lo restringen
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
create publication supabase_realtime;
`;

export default async function setup(project: TestProject) {
  const admin = process.env.DATABASE_URL;
  if (!admin) throw new Error("Falta DATABASE_URL. Localmente: source scripts/local-postgres.sh");
  const dbName = `jm_test_${process.pid}`;
  const root = new Client({ connectionString: admin });
  await root.connect();
  await root.query(`drop database if exists ${dbName}`);
  await root.query(`create database ${dbName}`);
  await root.end();

  const url = new URL(admin);
  url.pathname = `/${dbName}`;
  const db = new Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(SUPABASE_EMULATION);
  const dir = join(process.cwd(), "supabase/migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    try {
      await db.query(readFileSync(join(dir, f), "utf8"));
    } catch (e) {
      throw new Error(`Falló la migración ${f}: ${(e as Error).message}`);
    }
  }
  await db.end();
  project.provide("dbUrl", url.toString());

  return async () => {
    const c = new Client({ connectionString: admin });
    await c.connect();
    await c.query(`drop database if exists ${dbName} with (force)`);
    await c.end();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}
