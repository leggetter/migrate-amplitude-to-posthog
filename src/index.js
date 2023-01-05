
import { program } from '@commander-js/extra-typings';

import config from './config.js'

const MIGRATION_STAGES = {
  INIT: 'INIT',
  AMPLITUDE_EXPORT: 'AMPLITUDE_EXPORT',
  AMPLITUDE_UNZIP: 'AMPLITUDE_UNZIP',
  POSTHOG_IMPORT: 'POSTHOG_IMPORT',
  COMPLETE: 'COMPLETE',
}

import { exportFromAmplitude, unzipExport, sendToPostHog } from './migrate.js'

async function fullProcess () {
  config.set('migration_step', MIGRATION_STAGES.INIT)
  config.set('migration_step', MIGRATION_STAGES.AMPLITUDE_EXPORT)
  const exportResult = await exportFromAmplitude();
  config.set('migration_directory', exportResult.dirName)

  config.set('migration_step', MIGRATION_STAGES.AMPLITUDE_UNZIP)
  const {eventCount, jsonDirPath} = await unzipExport(exportResult)

  console.log(`Will send ${eventCount} events to PostHog`)

  config.set('migration_step', MIGRATION_STAGES.POSTHOG_IMPORT)
  const postHogResult = await sendToPostHog(jsonDirPath)

  console.log(`Sent ${postHogResult.eventCount} events to PostHog`)

  config.set('migration_step', MIGRATION_STAGES.COMPLETE)
}

async function unzipOnly(exportZipPath) {
  config.set('migration_step', MIGRATION_STAGES.AMPLITUDE_UNZIP)
  const {eventCount, jsonFileCount} = await unzipExport(exportZipPath)

  console.log(`Created ${jsonFileCount} JSON files containing ${eventCount} events`)
}

async function postHogOnly(jsonDirectoryPath) {
  config.set('migration_step', MIGRATION_STAGES.INIT)
  config.set('migration_step', MIGRATION_STAGES.POSTHOG_IMPORT)
  const {eventCount} = await sendToPostHog(jsonDirectoryPath)
  config.set('migration_step', MIGRATION_STAGES.COMPLETE)

  console.log(`Sent ${eventCount} events to PostHog`)
}

async function main() {
  program
    .command('full-export')
    .action(fullProcess)

  program
    .command('unzip-only')
    .argument('<export-zip-path>', 'The path to the Amplitude exported zip file')
    .action(unzipOnly)

  program
    .command('posthog-import-only')
    .argument('<json-directory-path>', 'The path to the JSON files generated as part of the Amplitude export unzipping process')
    .action(postHogOnly)

  await program.parseAsync(process.argv);
}

await main()