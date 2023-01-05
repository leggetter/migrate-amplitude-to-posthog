import fs from 'fs-extra'
import fetch from 'node-fetch'
import path from 'path'

import AdmZip from 'adm-zip'
import zlib from 'node:zlib'

import Conf from 'conf'
const MIGRATION_STAGES = {
  AMPLITUDE_EXPORT: 0,
  AMPLITUDE_UNZIP: 1,
  POSTHOG_IMPORT: 2,
  COMPLETE: 100,
}
const config = new Conf({
  configName: 'migration',
  // docs warn against changing `cwd`, but we want to store the config in the app directory
  cwd: process.cwd(),
  migration_step: {
    type: 'number'
  },
  migration_directory: {
    type: 'string',
  },
  last_json_imported: {
    type: 'string'
  },
})

import * as dotenv from 'dotenv'
dotenv.config()

if(!process.env.AMPLITUDE_API_KEY) {
  throw new Error('The AMPLITUDE_API_KEY environmental variable is required')
}

if(!process.env.AMPLITUDE_API_SECRET) {
  throw new Error('The AMPLITUDE_API_SECRET environmental variable is required')
}

if(!process.env.START_EXPORT_DATE) {
  throw new Error('The START_EXPORT_DATE environmental variable is required and should be in the format MM/DD/YYYY')
}

if(!process.env.END_EXPORT_DATE) {
  throw new Error('The END_EXPORT_DATE environmental variable is required and should be in the format MM/DD/YYYY')
}

if(!process.env.POSTHOG_API_HOST) {
  throw new Error('The POSTHOG_API_HOST environmental variable is required')
}

if(!process.env.POSTHOG_PROJECT_API_KEY) {
  throw new Error('The POSTHOG_PROJECT_API_KEY environmental variable is required')
}

function stringToAmplitudeDateFormat(dateString, hour) {
  return new Date(dateString).toISOString().replace(/(T\d{2}).*/, `T${hour}`).replace(/-/g, '')
}

async function exportFromAmplitude() {
  // GET /api/2/export?start=20220101T00&end=20220127T00

  const auth = Buffer.from(`${process.env.AMPLITUDE_API_KEY}:${process.env.AMPLITUDE_API_SECRET}`).toString('base64')

  console.log('Making request to Amplitude Export API... this can take some time')
  
  const url = `https://amplitude.com/api/2/export?` +
              `start=${stringToAmplitudeDateFormat(process.env.START_EXPORT_DATE, '00')}` +
              `&end=${stringToAmplitudeDateFormat(process.env.END_EXPORT_DATE, '23')}`
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`
    },
  })

  console.log('Download complete')

  const dirName = path.resolve('exports', new Date().toISOString())
  await fs.ensureDir(dirName)
  
  const filePath = path.resolve(dirName, 'export.zip')
  const arrayBuffer = await response.arrayBuffer()
  var buffer = Buffer.from( new Uint8Array(arrayBuffer) )
  await fs.promises.writeFile(filePath, buffer)

  console.log('File written to', filePath)
  return {dirName, filePath}
}

async function unzipExport({dirName, filePath}) {
  let eventCount = 0

  const zip = new AdmZip(filePath)
  var zipEntries = zip.getEntries()

  const jsonDirPath = path.resolve(dirName, 'json')

  await fs.ensureDir(jsonDirPath)

  await Promise.all(zipEntries.map(async (zipEntry) => {
    if (zipEntry.entryName.endsWith('.gz')) {
      const gzData = zlib.gunzipSync(zipEntry.getCompressedData())
      let perLineStringArray = Buffer.from(gzData).toString().split(/\r?\n/)
      perLineStringArray = perLineStringArray.filter(n => n) // remove empty lines/array elements
      const objectArray = perLineStringArray.map(value => {
        return JSON.parse(value)
      })

      eventCount += objectArray.length

      await fs.writeJson(path.resolve(jsonDirPath, zipEntry.name.replace('.gz', '')), objectArray, {spaces: 2})
    }
  }))

  return {eventCount, jsonDirPath}
}

function amplitudeToPostHogEventTypeMap(eventType) {
  if(eventType === 'view_page' || /Viewed\s.*/.test(eventType)) {
    return '$pageview'
  }
  return eventType
}

// See https://posthog.com/docs/migrate/migrate-from-amplitude
function amplitudeToPostHogEvent(amplitudeEvent) {
    const distinctId = amplitudeEvent.user_id || amplitudeEvent.device_id;
    const eventMessage = {
      properties: {
        ...amplitudeEvent.event_properties,
        // ...other_fields,
        $set: { ...amplitudeEvent.user_properties, ...amplitudeEvent.group_properties },
        $geoip_disable: true,
      },
      event: amplitudeToPostHogEventTypeMap(amplitudeEvent.event_type),
      distinct_id: distinctId,
      timestamp: new Date(amplitudeEvent.event_time).toISOString(),
    }

    return eventMessage
}

function aliasMapped(aliasId) {
  // TODO: lookup to see if the alias has already been registered in PostHog
  return true
}

async function trackAliases(amplitudeEvent) {
  if(amplitudeEvent.device_id && amplitudeEvent.user_id) {
    const aliasId = `${amplitudeEvent.device_id}:${amplitudeEvent.user_id}`
    if(!aliasMapped(aliasId)) {
      // TODO: make alias request to PostHog
      // await fetch request
      // register that the alisas has now been mapped
    }
  }
}

async function sendToPostHog(jsonDirPath) {
  const files = await fs.promises.readdir(jsonDirPath)

  let eventCount = 0

  for (const jsonFileName of files) {
    const nextFileName = path.resolve(jsonDirPath, jsonFileName)
    const json = await fs.readJson(nextFileName)

    // Batch up requests per Amplitude file
    const eventsMessages = []
    for (const ampEvent of json) {
      eventsMessages.push(amplitudeToPostHogEvent(ampEvent))
      await trackAliases(ampEvent)
    }

    eventCount += eventsMessages.length

    // Create batch per file https://posthog.com/docs/api/post-only-endpoints#batch-events
    const requestBody = {
      api_key: process.env.POSTHOG_PROJECT_API_KEY,
      batch: eventsMessages,
    }

    const response = await fetch(`${process.env.POSTHOG_API_HOST}/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    })

    if(response.status !== 200) {
      throw new Error(`Unexpected response code from PostHog API.\nStatus: ${response.status} \nStatus Text: ${response.statusText}\nBody: ${JSON.stringify(await response.json())}`)
    }

    // Record which JSON file has been successfully processes in case of failure and the need to resume
    config.set('last_json_imported', nextFileName)
  }

  return {eventCount}
}

// Full process
// (async () => {
//   config.set('migration_step', MIGRATION_STAGES.AMPLITUDE_EXPORT)
//   const exportResult = await exportFromAmplitude();
//   config.set('migration_directory', exportResult.dirName)

//   config.set('migration_step', MIGRATION_STAGES.AMPLITUDE_UNZIP)
//   const {eventCount, jsonDirPath} = await unzipExport(exportResult)

//   console.log(`Will send ${eventCount} events to PostHog`)

//   config.set('migration_step', MIGRATION_STAGES.POSTHOG_IMPORT)
//   const postHogResult = await sendToPostHog(jsonDirPath)

//   console.log(`Sent ${postHogResult.eventCount} events to PostHog`)

//   config.set('migration_step', MIGRATION_STAGES.COMPLETE)
// })()

// Unzip only from test directory
// (async () => {
//   const fakeResult = {dirName: 'test-exports/1000-plus-events', filePath: 'test-exports/1000-plus-events/export.zip' }

//   config.set('migration_step', MIGRATION_STAGES.AMPLITUDE_UNZIP)
//   const {eventCount, jsonDirPath} = await unzipExport(fakeResult)

//   console.log(`Will send ${eventCount} events to PostHog`)
// })()

// Send to PostHog only
(async () => {

  config.set('migration_step', MIGRATION_STAGES.POSTHOG_IMPORT)
  const jsonDirPath  = 'test-exports/1000-plus-events/json'
  const {eventCount} = await sendToPostHog(jsonDirPath)
  config.set('migration_step', MIGRATION_STAGES.COMPLETE)

  console.log(`Sent ${eventCount} events to PostHog`)
})()
