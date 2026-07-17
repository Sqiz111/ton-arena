/**
 * Dev-only fallback: runs a local embedded PostgreSQL when Docker is not
 * available. Usage: `npm run db:embedded` (keeps running; Ctrl+C to stop).
 * Data persists in .pgdata/.
 */
import EmbeddedPostgres from 'embedded-postgres'

async function main() {
  const pg = new EmbeddedPostgres({
    databaseDir: '.pgdata',
    user: 'tonarena',
    password: 'tonarena',
    port: 5432,
    persistent: true,
  })

  const alreadyInitialized = await import('fs').then((fs) => fs.existsSync('.pgdata/PG_VERSION'))
  if (!alreadyInitialized) {
    console.log('Initializing embedded PostgreSQL cluster…')
    await pg.initialise()
  }
  await pg.start()
  try {
    await pg.createDatabase('tonarena')
  } catch {
    /* database exists */
  }
  console.log('Embedded PostgreSQL ready on port 5432 (db: tonarena). Ctrl+C to stop.')

  const stop = async () => {
    console.log('\nStopping embedded PostgreSQL…')
    await pg.stop()
    process.exit(0)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  // keep alive
  setInterval(() => {}, 60_000)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
