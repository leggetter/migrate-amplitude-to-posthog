# Migrates Amplitude data to PostHog

A small utility that migrates data from an [Amplitude](https://amplitude.com) project to a [PostHog](https://posthog.com) project.

## How it works

1. Exports project data from Amplitude via the [Amplitude Export API](https://www.docs.developers.amplitude.com/analytics/apis/export-api/)
2. Converts the exported data into JSON files and stores them locally
3. Iterates through the stored JSON files, creates PostHog events from the data, and sends those events to PostHog

**See [the TODO section](#todo) for status.**

## Usage

1. Clone the GitHub project
2. Install the project dependencies:

   ```shell
   npm install
   ```
3. Create a `.env` file
   
   ```shell
   cp .env.example .env
   ```

   Update the values in the new `.env` file:

   ```shell
   AMPLITUDE_API_KEY=
   AMPLITUDE_API_SECRET=
   START_EXPORT_DATE=
   END_EXPORT_DATE=
   ```

   See the [Amplitude docs on getting your API credentials](https://www.docs.developers.amplitude.com/analytics/find-api-credentials/) for the `AMPLITUDE_API_KEY` and `AMPLITUDE_API_SECRET`. 
   
   The dates should be in the format `MM/DD/YYYY`.
4. Run the utility:

   ```shell
   npm start
   ```

## TODO

- [x] Extract the data from Amplitude
- [x] Unzip and convert the data into JSON files and store
- [ ] Iterate over the stored JSON files, convert the Amplitude events to PostHog events and send them to PostHog
- [ ] Store PostHog event capture progress as iterating so that the process can be resumed if a request fails