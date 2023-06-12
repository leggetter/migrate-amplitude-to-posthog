import fs from 'fs-extra'
import fetch from 'node-fetch'
import path, {dirname} from 'path'
import { fileURLToPath } from 'url';

import AdmZip from 'adm-zip'
import zlib from 'node:zlib'

import config from './config.js'
import alias from './alias.js'
import cache from 'memory-cache'
import ora from 'ora'

import { createRequire } from "module"
const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = require(`${path.resolve(__dirname, '..', 'package.json')}`)

const spinner = ora()

function stringToAmplitudeDateFormat(dateString, hour) {
  return new Date(dateString).toISOString().replace(/(T\d{2}).*/, `T${hour}`).replace(/-/g, '')
}

async function exportFromAmplitude() {
  // GET /api/2/export?start=20220101T00&end=20220127T00

  const auth = Buffer.from(`${config.get('AMPLITUDE_API_KEY')}:${config.get('AMPLITUDE_API_SECRET')}`).toString('base64')

  spinner.start('Making request to the Amplitude Export API. This can take some time.')
  
  const url = `https://amplitude.com/api/2/export?` +
              `start=${stringToAmplitudeDateFormat(config.get('AMPLITUDE_START_EXPORT_DATE'), '00')}` +
              `&end=${stringToAmplitudeDateFormat(config.get('AMPLITUDE_END_EXPORT_DATE'), '23')}`
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`
    },
  })

  spinner.stop()
  console.log('Download complete')
  
  const dirName = path.resolve('exports', new Date().toISOString())
  await fs.ensureDir(dirName)
  
  const filePath = path.resolve(dirName, 'export.zip')
  spinner.start(`Saving the export to ${filePath}`)

  const arrayBuffer = await response.arrayBuffer()
  var buffer = Buffer.from( new Uint8Array(arrayBuffer) )
  await fs.promises.writeFile(filePath, buffer)

  spinner.stop()
  console.log('File saved to', filePath)
  return {dirName, filePath}
}

async function unzipExport(exportZipPath) {
  console.log('Unzipping', exportZipPath)

  let eventCount = 0
  let jsonFileCount = 0

  const zip = new AdmZip(exportZipPath)
  var zipEntries = zip.getEntries()

  const jsonDirPath = path.resolve(path.dirname(exportZipPath), 'json')
  await fs.ensureDir(jsonDirPath)

  spinner.start(`Saving JSON files to ${jsonDirPath}`)

  const batchSize = 24; // Adjust the batch size as per your requirements
  const zipEntriesCount = zipEntries.length;
  let processedCount = 0;

  while (processedCount < zipEntriesCount) {
    const batch = zipEntries.slice(processedCount, processedCount + batchSize);

    await Promise.all(batch.map(async (zipEntry) => {
      if (zipEntry.entryName.endsWith('.gz')) {
        const gzData = zlib.gunzipSync(zipEntry.getCompressedData())
        let perLineStringArray = Buffer.from(gzData).toString().split(/\r?\n/)
        perLineStringArray = perLineStringArray.filter(n => n) // remove empty lines/array elements
        const objectArray = perLineStringArray.map(value => {
          return JSON.parse(value)
        })

        eventCount += objectArray.length

        await fs.writeJson(path.resolve(jsonDirPath, zipEntry.name.replace('.gz', '')), objectArray, { spaces: 2 })
        jsonFileCount++;
      }
    }));

    processedCount += batch.length;
  }


  spinner.stop()

  return {eventCount, jsonDirPath, jsonFileCount}
}

function amplitudeToPostHogEventTypeMap(eventType) {
  if(eventType === 'view_page' || /Viewed\s.*/.test(eventType) || eventType === 'visit_') {
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
        '$lib': pkg.name,
        '$lib_version': pkg.version,
      },
      event: amplitudeToPostHogEventTypeMap(amplitudeEvent.event_type),
      distinct_id: distinctId,
      timestamp: new Date(amplitudeEvent.event_time).toISOString(),
      library: pkg.name,
      library_version: pkg.version,
    }

    return eventMessage
}

function trackAliases(amplitudeEvent) {
  let newAliasEvents = []

  if(amplitudeEvent.device_id && amplitudeEvent.user_id) {
    let user_id_in_cache = cache.get(amplitudeEvent.user_id);

    if (user_id_in_cache === null) {
      user_id_in_cache = [];
    }

    if (user_id_in_cache.includes(amplitudeEvent.device_id) === false) {
      // New device_id for the user_id
      const aliasEvent = {
        properties: {
          distinct_id: amplitudeEvent.user_id,
          alias: amplitudeEvent.device_id,
          '$lib': pkg.name,
          '$lib_version': pkg.version,
        },
        timestamp: new Date(amplitudeEvent.event_time).toISOString(),
        context: {},
        type: 'alias',
        event: '$create_alias',
        library: pkg.name,
        library_version: pkg.version
      }

      newAliasEvents.push(aliasEvent)

      user_id_in_cache.push(amplitudeEvent.device_id)
      cache.put(amplitudeEvent.user_id, user_id_in_cache)
    }
  }

  return newAliasEvents
}

function shouldMakeBatchRequest(eventsMessages, batchSize, filesProcessIndex, filesToProcess) {
  return eventsMessages.length > 0 &&
         (eventsMessages.length >= batchSize || filesProcessIndex + 1 >= filesToProcess)
}

async function sendToPostHog({jsonDirPath, batchSize}) {
  spinner.start('Importing batched events to PostHog')

  await importCacheDataToAliasFile();

  const files = await fs.promises.readdir(jsonDirPath)
  let eventCount = 0
  let aliasEventCount = 0
  let batchRequestCount = 0
  const jsonFileCount = files.length

  // Batch up requests per Amplitude file
  // Presently batches by number of events
  // but we could look at estimated size of the request since there is a limit to that
  let eventsMessages = []

  for (let i = 0; i < jsonFileCount; ++i) {
    const jsonFileName = files[i]
    const nextFileName = path.resolve(jsonDirPath, jsonFileName)
    const json = await fs.readJson(nextFileName)

    for (const ampEvent of json) {
      eventsMessages.push(amplitudeToPostHogEvent(ampEvent))
      const aliasEvents = trackAliases(ampEvent)
      aliasEventCount += aliasEvents.length
      eventsMessages = eventsMessages.concat(aliasEvents)
    }
    
    // Send if batch size has been reached
    // or the last file has just been processed
    if(shouldMakeBatchRequest(eventsMessages, batchSize, i, jsonFileCount)) {
      
      await postHogBatchEventRequest({eventsMessages})

      // Records which JSON file has been successfully processed in case of failure and the need to resume
      config.set('last_json_imported', nextFileName)
      
      batchRequestCount++
      eventCount += eventsMessages.length
      
      // reset event batch
      eventsMessages = []
    }
  }

  await exportCacheDataToAliasFile();
  spinner.stop()

  return {eventCount, batchRequestCount, jsonFileCount, aliasEventCount}
}

async function sendAliasesToPostHog({jsonDirPath, batchSize}) {
  spinner.start('Finding aliases and sending to PostHog')

  const files = await fs.promises.readdir(jsonDirPath)
  const jsonFileCount = files.length

  let aliasEvents = []
  let batchRequestCount = 0
  let eventCount = 0

  for (let i = 0; i < jsonFileCount; ++i) {
    const jsonFileName = files[i]
    const nextFileName = path.resolve(jsonDirPath, jsonFileName)
    const json = await fs.readJson(nextFileName)

    for (const ampEvent of json) {
      aliasEvents = aliasEvents.concat(trackAliases(ampEvent))
    }

    if(shouldMakeBatchRequest(aliasEvents, batchSize, i, jsonFileCount)) {
      await postHogBatchEventRequest({eventsMessages: aliasEvents})

      batchRequestCount++
      eventCount += aliasEvents.length
      aliasEvents = []
    }

  }

  spinner.stop()
  return {batchRequestCount, eventCount, jsonFileCount}
}

async function importCacheDataToAliasFile()
{
  cache.clear();
  let mapped_aliases = alias.get('mapped_aliases');
  if (mapped_aliases !== undefined) {
    cache.importJson(JSON.stringify(mapped_aliases))
  }
}

async function exportCacheDataToAliasFile()
{
  alias.set('mapped_aliases', JSON.parse(cache.exportJson()))
  cache.clear();
}

// function getRequestSize(request) {
//   const size = new TextEncoder().encode(JSON.stringify(request)).length
//   const kiloBytes = size / 1024;
//   const megaBytes = kiloBytes / 1024;

//   return {size, kiloBytes, megaBytes}
// }

async function postHogBatchEventRequest({eventsMessages}) {
  // Create batch per file https://posthog.com/docs/api/post-only-endpoints#batch-events
  const requestBody = {
    api_key: config.get('POSTHOG_PROJECT_API_KEY'),
    batch: eventsMessages,
    '$lib': pkg.name,
    '$lib_version': pkg.version,
  }
  // console.log('>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>')
  // console.log('Request size', getRequestSize(requestBody))
  // console.log(JSON.stringify(requestBody, null, 2))
  
  // Makes sequential requests (rather than parallel)
  // but it may be worth adding a small wait inbetween requests via a config option.
  const response = await fetch(`${config.get('POSTHOG_API_HOST')}/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody)
  })
  
  if(response.status !== 200) {
    throw new Error(`Unexpected response code from PostHog API.\nStatus: ${response.status} \nStatus Text: ${response.statusText}\nBody: ${JSON.stringify(await response.json())}`)
  }
}

export {exportFromAmplitude, unzipExport, sendToPostHog, sendAliasesToPostHog}
