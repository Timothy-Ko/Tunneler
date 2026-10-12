# Wend

iPhone app for recording trench paths (like Strava) and dropping pins (gates, locks, connections, hot zones), shared live with your crew. Installed for free through AltStore.

**Status:** this code was written without being able to compile or run it (the build environment had no access to the npm package registry). The first GitHub build may fail on a small error. If it does, copy the red error lines from the build log and send them to Claude to fix.

## What it does

- Live map with your GPS dot; Street / Satellite / Muted layer toggle (remembered)
- Record button draws your path live (distance and time shown) and keeps recording with the screen locked, if you allow "Always" location
- Pins: Gate, Lock, Connection, Hot zone, Other, each with a name and note. Press "Pin here" or long-press anywhere on the map
- Projects with invite codes. Everyone's tracks and pins show in their own color and update live
- Works with no signal: new tracks and pins are saved on the phone and upload when you reconnect
- Export everything as a GPX file (opens in Google Earth, QGIS, AllTrails, etc.)

Not included yet: photos on pins, offline map tiles (the map itself needs signal; your tracks and pins do not).

---

## Setup (one time, about 45 minutes)

### 1. Supabase (the shared database), free

1. Go to supabase.com, sign up, and click **New project**. Pick any name and a database password. Save the password somewhere.
2. When it finishes loading, open **SQL Editor -> New query**, paste the entire contents of `supabase/schema.sql`, and click **Run**. It should say "Success".
3. Open **Authentication -> Sign In / Providers -> Email** and turn **off** "Confirm email" so friends can sign up without waiting for an email.
4. Open **Project Settings -> API**. Copy the **Project URL** and the **anon public** key.
5. In this project open `src/lib/supabase.ts` and paste those two values in place of the `PASTE_...` text.

### 2. GitHub (builds the app for free in the cloud)

1. Make a free account at github.com and create a **new repository**. **Public** is the easiest: builds are free and unlimited. (Your Supabase anon key will be visible in the code, which is fine because it is designed to be public and your data is protected by the login rules in `schema.sql`. If you pick Private, GitHub's free plan allows roughly 8 to 13 builds a month.)
2. Upload this whole project to the repository. Make sure the hidden `.github` folder goes up too, since it holds the build instructions. The easiest way is **GitHub Desktop** (desktop.github.com): add the folder, commit, publish.
3. In the repository click the **Actions** tab, choose **Build iOS app**, and click **Run workflow**. The build takes about 15 to 30 minutes.
4. When it finishes, open the run and download **Wend-ipa** from the Artifacts section at the bottom. Unzip it to get `Wend.ipa`.

### 3. Install on iPhone with AltStore, free

You need a Windows PC or Mac for this part, once per person.

1. Install **AltServer** from altstore.io on the computer. (On Windows, install iTunes and iCloud from Apple's website, not from the Microsoft Store.)
2. Plug in the iPhone, trust the computer, and use AltServer's menu to **Install AltStore** onto the phone using your Apple ID.
3. On the iPhone: **Settings -> Privacy & Security -> Developer Mode -> On** (it restarts), and **Settings -> General -> VPN & Device Management** -> trust your Apple ID.
4. Get `Wend.ipa` onto the phone (AirDrop, iCloud Drive, or email). Tap it, choose **Share -> AltStore**, and it installs.

### 4. Keep it alive (every 7 days)

Free Apple ID installs expire after 7 days. AltStore refreshes them automatically if, once a week, the phone is on the same Wi-Fi as the computer while AltServer is running. If an app expires it simply will not open until refreshed; your data stays safe in Supabase. Free accounts can have 3 sideloaded apps per phone.

### 5. First use

1. Open Wend, create an account, then create a project.
2. When asked for location, choose **Allow While Using**. When you first press Record, iOS asks again: choose **Change to Always Allow**. (If you missed it: Settings -> Wend -> Location -> Always.)
3. Menu -> **Share invite code** and text it to your friends. Each friend repeats step 3 above with their own Apple ID, creates an account, and chooses **Join** with the code.

## Tips

- Recording works best with a clear view of the sky. Points with accuracy worse than 30 m are ignored.
- Battery: recording with the screen locked is much lighter than keeping the screen on. The "Keep screen on" switch in the menu is optional.
- Updating the app: change the code, push to GitHub, run the build again, and install the new .ipa over the old one.
