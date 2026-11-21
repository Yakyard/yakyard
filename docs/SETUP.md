# Set up Yakyard, free

This guide puts Yakyard on your own Cloudflare account. You don't need to know how to code. You type a few commands, one at a time, and copy what the screen tells you.

It takes about 30 minutes the first time. It costs nothing for a small team: see [How free is free](#how-free-is-free) at the end.

You need:
- A computer (Mac, Windows or Linux).
- An email address.
- A payment card. Cloudflare asks for one before it turns on file storage (R2), even on the free plan. Under 10 GB of files, nothing is charged.

If a step goes wrong, look for it in [When something fails](#when-something-fails).

**Shortcut, if you already have a GitHub account:** do steps 1 and 2, then click the **Deploy to Cloudflare** button in the [README](../README.md). It copies Yakyard to your GitHub, creates everything and deploys, without a terminal. When it asks for `SETUP_TOKEN`, type a long random code of at least 24 letters and numbers (a password manager can make one) and keep it: it is your setup code for step 7. Then go straight to step 7.

---

## 1. Make a free Cloudflare account

1. Go to [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up).
2. Enter your email and a password, then confirm your email from the message Cloudflare sends you.
3. You don't need to add a website or a domain. If Cloudflare asks what you want to do, skip it or pick **Workers**.

## 2. Turn on file storage (R2)

Yakyard keeps photos, files and voice notes in Cloudflare R2.

1. In the Cloudflare dashboard, open **Storage & databases**, then **R2**, then **Overview**.
2. Follow the steps to add R2 to your account. It asks for a payment card. R2 includes 10 GB of storage a month for free, and Yakyard stops new uploads at 9 GB unless you change that (see [Storage limits](#storage-limits)).

## 3. Install Node.js

Node.js is the tool that sends Yakyard to Cloudflare.

1. Go to [nodejs.org](https://nodejs.org) and download the version marked **LTS**.
2. Open the file you downloaded and click through the installer.
3. Check it worked. Open a terminal:
   - Mac: press Cmd + Space, type `Terminal`, press Enter.
   - Windows: press the Windows key, type `PowerShell`, press Enter.
4. Type this and press Enter:

   ```
   node --version
   ```

   You should see a number like `v24.11.0`. Anything from `v22.5` up works.

Keep the terminal open. Every command below goes in it.

## 4. Get the code

Pick one:

**With Git** (easier to update later). Type:

```
git clone https://github.com/yakyard/yakyard.git
cd yakyard
```

If your computer says `git` is not found, install it from [git-scm.com](https://git-scm.com/downloads) and try again, or use the ZIP below.

**Without Git.** Open [github.com/yakyard/yakyard](https://github.com/yakyard/yakyard), click **Code**, then **Download ZIP**. Unzip it, then in the terminal go into the folder. The easiest way: type `cd ` (with a space), drag the unzipped folder onto the terminal window, and press Enter.

## 5. Connect your computer to Cloudflare

Type:

```
npx wrangler login
```

If it asks to install `wrangler`, type `y` and press Enter. A browser window opens and asks you to let Wrangler use your Cloudflare account. Click **Allow**. The terminal then says you are logged in.

## 6. Put Yakyard live

Type:

```
npm run deploy
```

This one command does everything: it installs what Yakyard needs, creates your database and file storage, sends the app to Cloudflare and makes a setup code. It takes a minute or two.

- If it asks you to pick a `workers.dev` subdomain, type a short name for your team (letters and dashes). It becomes part of your address.
- At the end it prints two things you need. Copy both somewhere safe for now:
  - your address, like `https://yakyard.your-team.workers.dev`
  - your **setup code**, a long line of letters and numbers. It is shown only once.

The very first time, the address can show an error for a minute while Cloudflare sets it up. Wait a minute and reload.

## 7. Open your Yakyard and claim it

1. Open your address in a browser. You see **Set up Yakyard**.
2. Paste the setup code.
3. Type your name, your email and a password of at least 10 characters.
4. Click **Create workspace**.

You are the owner now. The setup page never opens again, so nobody else can claim your workspace.

## 8. Invite your team

1. In Yakyard, click your workspace name at the top left, then **Invite people**.
2. Type a teammate's email and name. Pick a channel or two for them to start in.
3. Click **Create invite link**. Yakyard doesn't send any email: it gives you a link. Click **Copy with a short message** and send it to them on email, WhatsApp, text, anything.
4. They open the link, pick a password, and they're in. Links work for 14 days.

**Guests** (clients, freelancers) only see the channels you pick for them. Tick **Guest (partner)** in the invite box.

Point your team to the guide for people using Yakyard: [GUIDE.md](GUIDE.md).

## 9. Optional: phone notifications

Without this step, Yakyard works but phones don't buzz for new messages.

1. In the terminal, type:

   ```
   npm run vapid
   ```

   It prints three lines: `VAPID_PUBLIC`, `VAPID_SUBJECT` and a private key.
2. Open the file `wrangler.jsonc` in the Yakyard folder with any text editor (TextEdit on Mac, Notepad on Windows).
3. Find the lines `"VAPID_PUBLIC": ""` and `"VAPID_SUBJECT": ""`. Paste the values from step 1 between the empty quotes. For `VAPID_SUBJECT`, use `mailto:` and your email, like `mailto:you@example.com`. Save the file.
4. Back in the terminal, type:

   ```
   npx wrangler secret put VAPID_PRIVATE
   ```

   Paste the private key line when it asks, then press Enter.
5. Type `npm run deploy` again.

On iPhone, people first add Yakyard to their Home Screen (Share, then **Add to Home Screen**) and turn notifications on from inside the app.

## 10. Optional: Sign in with Google

1. Go to [console.cloud.google.com](https://console.cloud.google.com), make a project, then open **APIs & Services**, **Credentials**, **Create credentials**, **OAuth client ID**, type **Web application**.
2. Under **Authorized redirect URIs**, add your address followed by `/auth/callback`, like `https://yakyard.your-team.workers.dev/auth/callback`.
3. Copy the **Client ID**. In `wrangler.jsonc`, paste it between the quotes of `"GOOGLE_CLIENT_ID": ""` and change `"GOOGLE_ENABLED": "0"` to `"1"`.
4. In the terminal: `npx wrangler secret put GOOGLE_CLIENT_SECRET`, and paste the **Client secret**.
5. Optional: if everyone at your company has a Google Workspace email, put your domain in `"ALLOWED_DOMAINS": "yourcompany.com"`. Then people with that email can join without an invite.
6. `npm run deploy`.

## 11. Optional: bring your Slack history

Each person can copy their own Slack messages (DMs, group DMs, private channels) into Yakyard. It needs a small Slack app that you create once. The steps are in the README, under **Optional**, row **Slack import**. The copy runs in the background, about a thousand messages a minute, slower if Slack asks it to wait. You can close Yakyard while it runs.

## Updates

When a new version comes out, first save a backup (see [Backups](#backups)). Then:

- **With Git:** in the Yakyard folder, type `npm run update`. It keeps your own settings in `wrangler.jsonc`, gets the new version and deploys it.
- **With the ZIP:** download the new ZIP and unzip it. Open your old `wrangler.jsonc` and the new one, and copy your values in the `"vars"` part from the old file to the new one. Then run `npm run deploy` from the new folder.
- **With the Deploy button:** open your copy of Yakyard on GitHub and click **Sync fork** (or merge the update the original suggests). Cloudflare deploys it by itself.

It worked when the last line says `Deployed version` and a number.

Deploying also updates your database (new tables and columns) before the new version goes live. If your Yakyard is from before `wrangler.jsonc` existed, the first deploy moves your settings over from `wrangler.toml` and renames that file to `wrangler.toml.old`. Open apps show **New version of Yakyard** and update in one tap.

After an update, sign in, send a message and open a voice note. If something is broken, go back to the version before:

```
npx wrangler rollback
```

It asks which version to go back to. Pick the one just before. Database updates only add tables and columns, so the older version keeps working with them. You can also do this in the Cloudflare dashboard: **Workers & Pages**, your `yakyard` Worker, **Deployments**.

One exception: Cloudflare can't roll back past an update that adds a new kind of Durable Object, and the update that brings background jobs adds one (`Job`). Going back past it fails with a message about Durable Object migrations. That is why the backup comes first: if that update misbehaves, keep it running, restore the backup if data went wrong, and report the problem.

## Backups

Your messages live in a Cloudflare D1 database. Keep your own copy: once a month, and before every update.

```
npm run backup
```

It saves a file like `backups/yakyard-remote-2026-11-21-09-30.sql` in the Yakyard folder and says how many tables and rows it copied. Open it in a text editor: the first line starts with `-- Yakyard backup` and the last line lists the rows per table. Keep the file somewhere safe, outside the computer too. If it stops with an error about logging in, type `npx wrangler login` and run it again.

Cloudflare's own `wrangler d1 export` doesn't work for this: Yakyard's search uses full-text search tables, and the export either stops on them or writes a file D1 can't load back. `npm run backup` copies every table itself.

To put a backup back:

```
npm run restore -- backups/yakyard-remote-2026-11-21-09-30.sql
```

It asks you to type `yes`, because it replaces everything in your live database with the backup. Then it loads the file, rebuilds the search for messages and voice notes, and recounts the storage in use. It worked when the last line says `Restored`. Sign in, open a channel and search for a word you know is there. If it stops halfway (a lost connection, say), run the same command again: it clears the tables before loading, so a second run is safe.

Practice once: try a restore on the copy on your computer, so you know it works before you need it: `npm run backup`, then `npm run restore -- <that file> --local`, then `npm run dev` and look around.

Cloudflare also keeps a history of the database (7 days on the free plan). It is the quick way to undo a mistake made today. Type the date and time in UTC, the latest moment that was still fine:

```
npx wrangler d1 time-travel restore DB --timestamp=2026-11-20T09:00:00.000+00:00
```

Messages and changes made after that moment disappear. The command prints a bookmark: keep it, it brings them back if you picked the wrong time. More in Cloudflare's [Time Travel guide](https://developers.cloudflare.com/d1/reference/time-travel/).

Files and voice notes stay in R2 and are not in the backup. Cloudflare stores them on several machines, so a lost file is very unlikely.

## Storage limits

So one person can't fill your free 10 GB, each person can store 2 GB of files, and the whole team 9 GB. To change that, edit these two lines in `wrangler.jsonc` and run `npm run deploy`:

```
"STORAGE_PER_PERSON_GB": "5",
"STORAGE_TOTAL_GB": "50",
```

Past 10 GB, R2 costs about $0.015 per GB a month.

## How free is free

Everything Yakyard needs is on Cloudflare's free plan. The Admin page has a **Usage** card with storage and voice transcripts. Cloudflare's dashboard shows the rest (**Workers & Pages**, then your `yakyard` Worker).

For a team of up to about 50 people, you should stay well inside the free plan. Two things run out first:
- **Voice transcripts:** about 214 minutes a day for the whole team. After that, voice notes still send and play, and their transcripts arrive the next day.
- **Photo previews:** 5,000 new previews a month. After that, photos show at full size.

The README section **Free plan** has the full math. If Yakyard gets slow to answer, or the Usage card is often full, upgrade to **Workers Paid** ($5 a month) in the Cloudflare dashboard. Nothing in Yakyard changes.

## Check the CPU limit

Only for people who change Yakyard's code. The free plan stops any single run that uses more than 10 ms of CPU. This check puts a temporary copy of Yakyard online with that limit switched on (it works the same on a paid account), uses every part of it, and reports the CPU of each page, each action and each background job. Allow about 15 minutes.

```
node scripts/cpu-check.mjs prepare
npx wrangler deploy --config wrangler.cpu-check.jsonc
npx wrangler d1 execute DB --remote --config wrangler.cpu-check.jsonc --file schema.sql
npx wrangler secret bulk .cpu-check-secrets.json --config wrangler.cpu-check.jsonc
node scripts/cpu-check.mjs run https://yakyard-cpu-check.YOUR-SUBDOMAIN.workers.dev
```

It waits for one run of the 5-minute check, which can take up to 15 minutes to start on a new Worker, so allow 20 minutes; add `--quick` to skip that wait. Before deploying, `npm run cpu-bench` gives a quick estimate on your own computer. It passes when the last line says `All ... invocations stayed under 10 ms`. If something went over, the list above it names the page or job and its CPU, and `cpu-check-report.json` has the details. Either way, remove the copy, its database and its file storage afterwards:

```
npx wrangler delete --config wrangler.cpu-check.jsonc
npx wrangler d1 delete yakyard-cpu-check -y
npx wrangler r2 bucket delete yakyard-cpu-check
```

If the bucket won't delete because it isn't empty, empty it first in the dashboard (**R2**, `yakyard-cpu-check`, select all, **Delete**).

---

## When something fails

**`node` or `npm` is not found.** Node.js isn't installed, or the terminal was open before you installed it. Close the terminal, open a new one, and try `node --version` again.

**`npx wrangler login` opens nothing, or hangs.** Copy the link it prints and open it in your browser. If you are on a remote or work computer, try `npx wrangler login --device`: it shows a short code you confirm in any browser, even on your phone.

**`npm run deploy` says something about R2 or "bucket".** R2 isn't turned on yet. Do step 2, then run `npm run deploy` again.

**`npm run deploy` asks for a workers.dev subdomain and fails.** Open the Cloudflare dashboard, go to **Workers & Pages** once (this creates the subdomain), then run `npm run deploy` again.

**A scheduled message or reminder is late.** Each one has its own timer and goes out within seconds. If a timer was lost, the 5-minute check sends it at most 5 minutes late. Later than that: run `npx wrangler tail` and look for lines that start with `job failed`.

**The address shows error 523 or "not found".** The first deploy takes a minute to reach everywhere. Wait and reload.

**I lost the setup code.** Make a new one: type `npx wrangler secret put SETUP_TOKEN` and paste a long random line of at least 24 letters and numbers. Then use that line as the setup code. This only matters before you claim the workspace.

**"Wrong setup code".** Copy the code again, without spaces at the start or end.

**"Turn on JavaScript to sign in".** Yakyard stretches your password in the browser, so sign-in needs JavaScript. Turn it back on in the browser settings, or try another browser.

**"Too many tries" or "Too many sign-in tries".** Someone typed a wrong password many times, or many people sign in from one office network at once. Wait 15 minutes. If it keeps happening, an admin can send the person a new link.

**"This account needs a new password, once".** The account was made with an older Yakyard, which kept passwords a way the free plan can't check quickly. The owner sends the person a new link: **Invite people**, type their email, **Create invite link**. They open it and pick a new password. If you are the owner and see this yourself, type `npm run signin-link -- you@example.com` in the Yakyard folder and open the link it prints.

**Someone forgot their password.** An owner or admin opens **Admin**, finds the person, clicks the three dots, then **Reset password (new link)**, and sends them the new link.

**Error 1102 or "Worker exceeded CPU".** A single action needed more computer time than the free plan allows. Run `npx wrangler tail`, do the same thing again, and copy the red lines when you ask for help.

**"Your team used up today's free database allowance".** Cloudflare's free database has a daily limit. It resets at midnight UTC. If it happens often, upgrade to Workers Paid ($5 a month).

**"Your database is full".** The database reached the free plan's size limit. Delete old channels with big histories, or upgrade to Workers Paid.

**`git pull` or `npm run update` says your changes and the update touch the same lines.** Open `wrangler.jsonc`, keep your own values between the `<<<<<<<` and `>>>>>>>` marks, delete the marks, save, then run `npm run deploy`.

**Voice notes say "The transcript comes tomorrow".** Today's free transcribing time is used up. Transcripts start again after midnight UTC, by themselves.

**Something else.** Run `npx wrangler tail` in the terminal while you repeat the problem. It shows what Yakyard is doing. Copy the red lines when you ask for help.
