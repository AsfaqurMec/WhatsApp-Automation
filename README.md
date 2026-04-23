# Google Drive to WhatsApp Automation

Automatically watches a Google Drive folder and sends a WhatsApp group message whenever a new file appears.

Message format:

`📁 New file uploaded: <file_name>`

## Tech stack

- Node.js + Express
- Google Drive API v3 (`googleapis`)
- `whatsapp-web.js`
- `node-cron`
- `dotenv`

## Project structure

```text
src/
  app.js
  config/
    env.js
  jobs/
    driveWatcher.js
  services/
    googleDriveService.js
    whatsappService.js
  utils/
    logger.js
    retry.js
    stateStore.js
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp .env.example .env
```

Fill all required values in `.env`.

3. Start the app:

```bash
npm start
```

4. On first run, scan WhatsApp QR from the terminal.

## Google Drive credentials guide

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create/select a project.
3. Enable **Google Drive API**.
4. Go to **APIs & Services > Credentials**.
5. Create **OAuth client ID** (Desktop or Web app).
6. Add redirect URI (`https://developers.google.com/oauthplayground` if using OAuth playground).
7. Copy `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI`.
8. Generate a refresh token with Drive scope:
   - Scope: `https://www.googleapis.com/auth/drive.readonly`
   - Use OAuth 2.0 Playground or your own OAuth flow.
9. Put the generated refresh token in `GOOGLE_REFRESH_TOKEN`.

## Drive folder ID

- Open target Drive folder in browser.
- URL looks like:
  `https://drive.google.com/drive/folders/<FOLDER_ID>`
- Copy `<FOLDER_ID>` into `DRIVE_FOLDER_ID`.

## Notes

- Polling runs every minute by default (`DRIVE_POLLING_CRON`).
- Last processed timestamps and notified IDs are saved in `src/data/drive-state.json` to avoid duplicate messages across restarts.
- WhatsApp session is persisted by `LocalAuth`.
