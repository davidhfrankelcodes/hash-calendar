<p align="center">
  <img src="logo.png" alt="hash-calendar logo" width="160">
</p>

# hash-calendar

hash-calendar is a lightweight, privacy-first, client-only calendar. Your calendar state lives entirely in the URL hash, so sharing is as simple as copying the link. No backend, no accounts.

Live site: https://hash-calendar.netlify.app/
GitHub: https://github.com/supunlakmal/hash-calendar

## Features

- URL hash storage with LZ-String compression
- Optional password lock with AES-GCM + PBKDF2 (150k SHA-256) encryption
- Day, week, month, year, and agenda views
- Focus mode dashboard with live countdown and "up next" list
- "Up Next" countdown widget for the next event
- Create, edit, and delete events
- All-day events and duration-based events
- Recurring events (daily, weekly, monthly, yearly)
- Event color palette and editable calendar title (saved in the URL)
- Copy-link sharing and QR sharing (with length guard)
- View or copy JSON and URL hash
- Export calendar to JSON
- Import events from .ics files
- World clock sidebar with saved timezones
- Theme toggle (light/dark)
- Week start toggle (Sunday/Monday)
- URL length meter with warnings

## Screenshots

<table>
  <tr>
    <td><img src="demo/demo-1.png" alt="hash-calendar demo 1" width="420"></td>
    <td><img src="demo/demo-2.png" alt="hash-calendar demo 2" width="420"></td>
  </tr>
  <tr>
    <td><img src="demo/demo-3.png" alt="hash-calendar demo 3" width="420"></td>
    <td><img src="demo/demo-4.png" alt="hash-calendar demo 4" width="420"></td>
  </tr>
  <tr>
    <td><img src="demo/demo-5.png" alt="hash-calendar demo 5" width="420"></td>
    <td><img src="demo/demo-6.png" alt="hash-calendar demo 6" width="420"></td>
  </tr>
  <tr>
    <td><img src="demo/demo-7.png" alt="hash-calendar demo 7" width="420"></td>
    <td></td>
  </tr>
</table>

## How it works

- The calendar state is serialized to JSON and compressed into the URL hash.
- If a password is set, the compressed payload is encrypted using AES-GCM with PBKDF2 key derivation.
- No data leaves the browser unless you share the link.

Encrypted links start with `#ENC:`. Clearing the hash resets the calendar.

## Getting started

Open `index.html` in your browser.

For clipboard and file import features, run a local server:

```bash
npx serve .
```

## Project structure

- `index.html` - UI markup and modals
- `styles.css` - Styles
- `script.js` - App logic and state
- `modules/`
  - `calendarRender.js` - Month, week, day, and year grids
  - `agendaRender.js` - Agenda list view
  - `recurrenceEngine.js` - Recurring event expansion
  - `countdownManager.js` - Up next countdown widget
  - `focusMode.js` - Focus mode overlay
  - `timezoneManager.js` - World clock helpers
  - `qrCodeManager.js` - QR sharing
  - `icsImporter.js` - .ics parsing
  - `hashcalUrlManager.js` - URL read/write + compression
  - `cryptoManager.js` - Encryption helpers
  - `lz-string.min.js` - Compression library
- `demo/` - Screenshot assets

## License

MIT. See `LICENSE`.
