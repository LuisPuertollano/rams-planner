export interface ApiConfig {
  readonly databaseUrl: string
  readonly port: number
  readonly host: string
  readonly webRoot: string | undefined
}

export function readConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const databaseUrl = env['DATABASE_URL']
  if (databaseUrl === undefined || databaseUrl === '') {
    throw new Error('Falta DATABASE_URL. Copia .env.example a .env o expórtala en el entorno.')
  }
  return {
    databaseUrl,
    port: Number(env['PORT'] ?? 45678),
    host: env['HOST'] ?? '0.0.0.0',
    webRoot: env['WEB_ROOT'],
  }
}
