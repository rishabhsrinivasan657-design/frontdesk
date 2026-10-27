# Connecting Front Desk to Google (Calendar + Gmail)

Front Desk books into a Google Calendar and sends confirmations from your Gmail. This takes about 15 minutes, once. Everything is free.

**Safety rules:**

- Your client secret and refresh token go **only** into the git-ignored `.env` file.
- Never paste them into a chat, an issue, a commit or a screenshot.
- Front Desk uses a separate demo calendar, never your main one.

## 1. Open Google Cloud

1. Go to <https://console.cloud.google.com> and sign in with the Google account that should send the emails.
2. If asked, accept the terms of service.

## 2. Create a project

1. Click the project picker in the top bar (it may say "Select a project").
2. Click **New project**.
3. Name it `Front Desk demo` and click **Create**.
4. When it's ready, click **Select project** in the notification (or choose it in the project picker).

## 3. Turn on the two APIs

1. Open the ☰ menu → **APIs & Services** → **Library**.
2. Search for **Google Calendar API**, open it and click **Enable**.
3. Go back to the Library, search for **Gmail API**, open it and click **Enable**.

## 4. Set up the consent screen

1. Open the ☰ menu → **APIs & Services** → **OAuth consent screen**, then click **Get started**.
2. **App information:** set the app name to `Front Desk (demo)`, pick your email as the support email, and click **Next**.
3. **Audience:** choose **External** and click **Next**.
4. **Contact information:** enter your email and click **Next**.
5. Tick the agreement and click **Create**.
6. In the left menu, click **Audience**. Under **Test users**, click **Add users**, enter your own Gmail address and click **Save**. Leave the publishing status as **Testing** for local development. For the public pilot, publish it (`docs/deploy.md` step 5), or refresh tokens expire every 7 days.
7. In the left menu, click **Data Access** → **Add or remove scopes**. Tick exactly these two, then click **Update** and **Save**:
   - `https://www.googleapis.com/auth/calendar.events`
   - `https://www.googleapis.com/auth/gmail.send`

## 5. Create the OAuth client

1. In the left menu, click **Clients** → **Create client**.
2. Set the application type to **Desktop app**, name it `Front Desk local` and click **Create**.
3. A dialog shows the **Client ID** and **Client secret**. Keep it open for step 7. You can reopen it later from **Clients**.

## 6. Create the demo calendar

1. Go to <https://calendar.google.com>.
2. In the left sidebar, click **+** next to **Other calendars** → **Create new calendar**.
3. Name it `Casa Fiorella (demo)` and click **Create calendar**.
4. Under **My calendars**, hover over **Casa Fiorella (demo)**, click **⋮** → **Settings and sharing**.
5. Scroll to **Integrate calendar** and copy the **Calendar ID**. It ends in `@group.calendar.google.com`.

## 7. Fill in `.env`

1. If the repo has no `.env` file yet, create one from the example. Skip this if `.env` already exists, because it would overwrite your Gemini key:

   ```bash
   cp .env.example .env
   ```

2. Open `.env` in your editor and fill in these four lines, then save:

   ```
   GOOGLE_CLIENT_ID=<Client ID from step 5>
   GOOGLE_CLIENT_SECRET=<Client secret from step 5>
   GOOGLE_CALENDAR_ID=<Calendar ID from step 6>
   GMAIL_TEST_TO=<your own email address>
   ```

## 8. Sign in

1. Run:

   ```bash
   pnpm google:auth
   ```

2. Your browser opens Google's sign-in. Choose the same account.
3. Google warns "Google hasn't verified this app". That's expected for your own app in Testing. Click **Continue**.
4. Tick **both** permission boxes and click **Continue**.
5. The tab says "Front Desk is connected", and the terminal says `Saved a refresh token to .env`.

## 9. Check it works

1. Run:

   ```bash
   pnpm test:google
   ```

2. All 8 tests should pass. The test events are created and deleted again, and two test emails arrive in your inbox.

## If something goes wrong

| You see                                     | Do this                                                                                                                     |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `invalid_grant`                             | In Testing mode the token expires after 7 days. Run `pnpm google:auth` again, or publish the app (`docs/deploy.md` step 5). |
| "Access blocked" / `access_denied`          | Your account isn't a test user. Redo step 4.6.                                                                              |
| "Some permissions were not granted"         | Run `pnpm google:auth` again and tick every box.                                                                            |
| "Google sent no refresh token"              | Remove the app at <https://myaccount.google.com/permissions>, then run `pnpm google:auth` again.                            |
| `GOOGLE_CALENDAR_ID must be the … calendar` | You used `primary`. Use the demo calendar's ID from step 6.                                                                 |

To disconnect Front Desk at any time, remove it at <https://myaccount.google.com/permissions>.
