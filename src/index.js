#!/usr/bin/env node

import { program } from '@commander-js/extra-typings';
import inquirer from 'inquirer'

import config from './config.js'

const MIGRATION_STAGES = {
  INIT: 'INIT',
  AMPLITUDE_EXPORT: 'AMPLITUDE_EXPORT',
  AMPLITUDE_UNZIP: 'AMPLITUDE_UNZIP',
  POSTHOG_IMPORT: 'POSTHOG_IMPORT',
  COMPLETE: 'COMPLETE',
}

import { exportFromAmplitude, unzipExport, sendToPostHog } from './migrate.js'

async function checkRequiredConfig() {
  if(!config.get('AMPLITUDE_API_KEY')) {

    const answers = await inquirer.prompt([{
      type: 'input',
      name: 'AMPLITUDE_API_KEY',
      message: "What is your Amplitude project API key",
      validate: (input) => {
        return input.length > 20
      }
    }])

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

    config.set('POSTHOG_PROJECT_API_KEY', answers['POSTHOG_PROJECT_API_KEY'])
  }

  console.log('All configuration is now set')
}

async function setConfig() {
  await checkRequiredConfig()
}

async function fullProcess() {
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
    .action(setConfig)

  program
    .command('full-export')
    .description('Performs a full Amplitude export, file unzipping and JSON\nfile setup, and PostHog event import.')
    .action(fullProcess)

  program
    .command('unzip-only')
    .description('Unzipped the Amplitude export zip file and sets up the JSON\nfiles ready for the PostHog import. Request an export zip file.')
    .argument('<export-zip-path>', 'The path to the Amplitude exported zip file')
    .action(unzipOnly)

  program
    .command('posthog-import-only')
    .description('Imports the JSON files from the Amplitude export into\nPostHog. Requires the JSON files.')
    .argument('<json-directory-path>', 'The path to the JSON files generated as part of the Amplitude export unzipping\nprocess')
    .action(postHogOnly)

  await program.parseAsync(process.argv);
}

await main()