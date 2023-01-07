# Migrates Amplitude data to PostHog

A small utility that migrates data from an [Amplitude](https://amplitude.com) project to a [PostHog](https://posthog.com) project.

## How it works

1. Exports project data from Amplitude via the [Amplitude Export API](https://www.docs.developers.amplitude.com/analytics/apis/export-api/)
2. Converts the exported data into JSON files and stores them locally
3. Iterates through the stored JSON files, creates PostHog events from the data, and sends those events to PostHog

**See [the TODO section](#todo) for status.**

## Setup

1. Clone the GitHub project:

   ```shell
   git clone git@github.com:leggetter/migrate-amplitude-to-posthog.git && cd migrate-amplitude-to-posthog
   ```

2. Install the project dependencies:

   ```shell
   npm install
   ```

3. Configure the utility via the guided prompts by running the following command:

   ```shell
   node src/index.js config
   ```

   See the [Amplitude docs on getting your API credentials](https://www.docs.developers.amplitude.com/analytics/find-api-credentials/) for the `AMPLITUDE_API_KEY` and `AMPLITUDE_API_SECRET`. 
   
   The Amplitude export start and end dates should be in the format `MM/DD/YYYY`.

   You can find your PostHog project API key within your **Project settings**.

   Configuration is stored in `migration.conf`.

## Usage

Once the utility has been setup with the required configuration you can run additional commands:

```shell
Usage: index [options] [command]

Options:
  -h, --help                                 display help for command

Commands:
  config                                     Checks for any missing required configuration. Prompts when
                                             required configuration is missing. Configuration is stored in
                                             migration.conf in the working directory.
  full-migration                             Performs a full Amplitude export, file unzipping and JSON
                                             file setup, and PostHog event import.
  unzip-only <export-zip-path>               Unzipped the Amplitude export zip file and sets up the JSON
                                             files ready for the PostHog import. Request an export zip file.
  posthog-import-only <json-directory-path>  Imports the JSON files from the Amplitude export into
                                             PostHog. Requires the JSON files.
  help [command]                             display help for command
```

## A guide to migrating data from Amplitude to PostHog

### Fully automated

You can use the `full-migration` command to walk through the full migration from Amplitude to PostHog.

If the Amplitude export times out try the steps in the **Partially automated** section.

### Partially automated

The Amplitude export can timeout for large exports so you may be better taking a multi-step approach to the process.

1. Within the Amplitude dashboard got to your **Organization settings** > **Projects** and select the project you want to export data from.
2. Click the **Export Data** button and select the full date range. Then click the **Save** button. This will begin the export process and your browser will download an `export.zip` file.
3. Move the `export.zip` file to a working directory.
4. Set your terminal working directory to the working directory that the zip file is in (e.g. `cd path/to/dir/containing/export/zip`).
4. Run the command `unzip-only path/to/export.zip`. You will be prompted for some configuration (note: some config isn't require for this command). This will create a `json` directory within that working folder with all the events that are to be imported to PostHog.
5. Run the command `posthog-import-only path/to/json` (the `json` directory that was just created)
6. When completed you will see a message similar to `Sent 61590 events to PostHog (2554 of which were alias events) from 2520 JSON files in 58 batch requests.`

## TODO

### Planned

- [x] Extract the data from Amplitude
- [x] Unzip and convert the data into JSON files and store
- [x] Iterate over the stored JSON files, convert the Amplitude events to PostHog events and send them to PostHog
- [x] Add alias tracking

## Nice to have

- [ ] Store PostHog event capture progress as iterating so that the process can be resumed if a request fails
- [ ] Add some tests around key areas. Everything has been tested manually up until this point.
- [ ] Make PostHog import batch size configurable (it is presently hard-coded as 1000) and fully adhere to the specified batch size

## Acknowledgements

- [Tigris Data: Developer Data Platform](https://tigrisdata.com): this utility was built whilst working for them
- [Aplistorical](https://github.com/vicampuzano/aplistorical): a PHP-based Amplitude to PostHog migration tool the was a useful reference during development