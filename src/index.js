#!/usr/bin/env node

import { program } from '@commander-js/extra-typings';
import inquirer from 'inquirer';

import config from './config.js';
import alias from './alias.js';

// To be used when resuming a halted migration is supported.
// If a failure occurs at the POSTHOG_IMPORT stage the
// config.get('last_json_imported') value can be used.
const MIGRATION_STAGES = {
  INIT: 'INIT',
  AMPLITUDE_EXPORT: 'AMPLITUDE_EXPORT',
  AMPLITUDE_UNZIP: 'AMPLITUDE_UNZIP',
  POSTHOG_IMPORT: 'POSTHOG_IMPORT',
  COMPLETE: 'COMPLETE',
}

import { exportFromAmplitude, unzipExport, sendToPostHog, sendAliasesToPostHog } from './migrate.js'

async function checkRequiredConfig() {
  let setAnyConfig = false

  if(!config.get('AMPLITUDE_API_KEY')) {

    const answers = await inquirer.prompt([{
      type: 'input',
      name: 'AMPLITUDE_API_KEY',
      message: "What is your Amplitude project API key",
      validate: (input) => {
        return input.length > 20
      }
    }])

    setAnyConfig = true
    config.set('AMPLITUDE_API_KEY', answers['AMPLITUDE_API_KEY'])
  }
  
  if(!config.get('AMPLITUDE_API_SECRET')) {
    const answers = await inquirer.prompt([{
      type: 'input',
      name: 'AMPLITUDE_API_SECRET',
      message: "What is your Amplitude project API secret",
      validate: (input) => {
        return input.length > 20
      }
    }])

    setAnyConfig = true
    config.set('AMPLITUDE_API_SECRET', answers['AMPLITUDE_API_SECRET'])
  }
  
  if(!config.get('AMPLITUDE_START_EXPORT_DATE')) {
    const answers = await inquirer.prompt([{
      type: 'input',
      name: 'AMPLITUDE_START_EXPORT_DATE',
      message: "What date do you want your export to start (in the format MM/DD/YYYY)",
      validate: (input) => {
        return /^(\d{2}\/\d{2}\/\d{4})$/.test(input)
      }
    }])

    setAnyConfig = true
    config.set('AMPLITUDE_START_EXPORT_DATE', answers['AMPLITUDE_START_EXPORT_DATE'])
  }
  
  if(!config.get('AMPLITUDE_END_EXPORT_DATE')) {
    const answers = await inquirer.prompt([{
      type: 'input',
      name: 'AMPLITUDE_END_EXPORT_DATE',
      message: "What date do you want your export to end (in the format MM/DD/YYYY)",
      validate: (input) => {
        return /^(\d{2}\/\d{2}\/\d{4})$/.test(input)
      }
    }])

    setAnyConfig = true
    config.set('AMPLITUDE_END_EXPORT_DATE', answers['AMPLITUDE_END_EXPORT_DATE'])
  }
  
  if(!config.get('POSTHOG_API_HOST')) {
    const answers = await inquirer.prompt([{
      type: 'input',
      name: 'POSTHOG_API_HOST',
      message: "What is your PostHog API host",
      validate: (input) => {
        return input.length > 5
      },
      default: 'https://app.posthog.com'
    }])

    setAnyConfig = true
    config.set('POSTHOG_API_HOST', answers['POSTHOG_API_HOST'])
  }
  
  if(!config.get('POSTHOG_PROJECT_API_KEY')) {
    const answers = await inquirer.prompt([{
      type: 'input',
      name: 'POSTHOG_PROJECT_API_KEY',
      message: "What is your PostHog project API key",
      validate: (input) => {
        return input.length > 40 && input.startsWith('phc_')
      },
    }])

    setAnyConfig = true
    config.set('POSTHOG_PROJECT_API_KEY', answers['POSTHOG_PROJECT_API_KEY'])
  }

  if(setAnyConfig) {
    console.log('All configuration is now set')
  }
}

async function setConfig(options) {
  if(options.clearAliases) {
    console.log('Clearing aliases')
    alias.clear()
  }

  await checkRequiredConfig()
}

async function exportFromAmplitudeStep() {
  config.set('migration_step', MIGRATION_STAGES.AMPLITUDE_EXPORT)
  const exportResult = await exportFromAmplitude();
  config.set('migration_directory', exportResult.dirName)

  return exportResult
}

async function unzipStep({jsonDirPath}) {
  config.set('migration_step', MIGRATION_STAGES.AMPLITUDE_UNZIP)
  const unzipResult = await unzipExport(jsonDirPath)

  console.log(`Created ${unzipResult.jsonFileCount} JSON files containing ${unzipResult.eventCount} events`)

  return unzipResult
}

async function postHogImportStep({jsonDirPath, batchSize = 1000}) {
  config.set('migration_step', MIGRATION_STAGES.POSTHOG_IMPORT)
  const postHogResult = await sendToPostHog({jsonDirPath, batchSize})

  console.log(`Sent ${postHogResult.eventCount} events to PostHog (${postHogResult.aliasEventCount} of which were alias events) from ${postHogResult.jsonFileCount} JSON files in ${postHogResult.batchRequestCount} batch requests.`)

  return postHogResult
}

async function fullProcess() {
  const batchSize = 1000

  const proceedWithExport = await inquirer.prompt([{
    type: 'confirm',
    name: 'PROCEED_WITH_EXPORT',
    message: `You are about to export data from Amplitude convering the period:

    Start date: ${new Date(config.get('AMPLITUDE_START_EXPORT_DATE')).toISOString()}
    End date:   ${new Date(config.get('AMPLITUDE_END_EXPORT_DATE')).toISOString()}.

    Do you wish to proceed`,
    default: false
  }])

  if(proceedWithExport['PROCEED_WITH_EXPORT'] === false) {
    console.log('Exiting')
    return
  }
  else {
    console.log('Proceeding with the Amplitude export.')
  }

  const exportResult = await exportFromAmplitudeStep()

  const unzipResult = await unzipStep({jsonDirPath: exportResult.filePath})

  const proceedWithImport = await inquirer.prompt([{
    type: 'confirm',
    name: 'PROCEED_WITH_IMPORT',
    message: `You are about to send ${unzipResult.eventCount} events to PostHog batched into ${Math.ceil(unzipResult.eventCount/batchSize)} requests.

    Do you wish to proceed`,
    default: false
  }])

  if(proceedWithImport['PROCEED_WITH_IMPORT'] === false) {
    console.log('Exiting')
    return
  }
  else {
    console.log('Proceeding with the PostHog import.')
  }

  await postHogImportStep({jsonDirPath: unzipResult.jsonDirPath, batchSize: batchSize})

  config.set('migration_step', MIGRATION_STAGES.COMPLETE)
}

async function unzipOnly(exportZipPath) {
  await unzipStep({jsonDirPath: exportZipPath})
}

async function postHogOnly(jsonDirectoryPath) {
  await postHogImportStep({jsonDirPath: jsonDirectoryPath})
}

async function postHogAliasesOnly(jsonDirectoryPath) {
  const existingAliasesCound = Object.keys(config.get('mapped_aliases')).length
  if(existingAliasesCound > 0) {
    console.warn(`${existingAliasesCound} Aliases already exist so existing aliases will not be sent to PostHog`)

    const proceedWithImport = await inquirer.prompt([{
      type: 'confirm',
      name: 'CLEAR_EXISTING_ALIASES',
      message: `Do you wish to clear the existing aliases`,
      default: false
    }])
  
    if(proceedWithImport['CLEAR_EXISTING_ALIASES'] === true) {
      console.log('Clearing existing aliases')
      config.set('mapped_aliases', {})
    }
  }

  const batchSize = 1000
  const {batchRequestCount, eventCount, jsonFileCount} = await sendAliasesToPostHog({jsonDirPath: jsonDirectoryPath, batchSize})
  console.log(`Processed ${jsonFileCount} files and set ${eventCount} new aliases in PostHog in ${batchRequestCount} requests`)
  // console.log(JSON.stringify(config.get('mapped_aliases'), null, 2))
}
async function main() {
  program
    .hook('preAction', async (_thisCommand, _actionCommand) => {
      await checkRequiredConfig()
    })
    .hook('preSubcommand', async (_thisCommand, actionCommand) => {
      // skip since config runs the required config check directly
      if(actionCommand.name() === 'config') return
      await checkRequiredConfig()
    })

  // Note: wrap lines before 60 characters with \n
  program
    .command('config')
    .description('Checks for any missing required configuration. Prompts when\nrequired configuration is missing. Configuration is stored in\nmigration.conf in the working directory.')
    .option('--clear-aliases', 'Clears the alias mapping from the config file.')
    .action(setConfig)

  // TODO: add PostHog batch size option
  program
    .command('full-migration')
    .description('Performs a full Amplitude export, file unzipping and JSON\nfile setup, and PostHog event import.')
    .action(fullProcess)

  program
    .command('unzip-only')
    .description('Unzipped the Amplitude export zip file and sets up the JSON\nfiles ready for the PostHog import. Request an export zip file.')
    .argument('<export-zip-path>', 'The path to the Amplitude exported zip file')
    .action(unzipOnly)

  // TODO: add PostHog batch size option
  program
    .command('posthog-import-only')
    .description('Imports the JSON files from the Amplitude export into\nPostHog. Requires the JSON files.')
    .argument('<json-directory-path>', 'The path to the JSON files generated as part of the Amplitude export unzipping\nprocess')
    .action(postHogOnly)

  program
    .command('posthog-aliases-only')
    .description('Imports the user_id and device_id aliases from JSON files from the Amplitude export into\nPostHog. Requires the JSON files.')
    .argument('<json-directory-path>', 'The path to the JSON files generated as part of the Amplitude export unzipping\nprocess')
    .action(postHogAliasesOnly)

  await program.parseAsync(process.argv);
}

await main()