# Berry Creek DH Game

A responsive, real-time golf scoring app configured from The Club at Berry Creek's current scorecard.

When installed on an iPhone or Android Home Screen, the app is labeled `DH Game` beneath the icon.

## Start the app

No third-party packages are required. Install Node.js 22.5 or newer, open a terminal in this folder, and run:

```bash
npm start
```

Open `http://localhost:8080`. Other scorekeepers on the same Wi-Fi network can open `http://YOUR-COMPUTER-IP:8080`.

For a hosted event, deploy this folder to any service that runs a persistent Node.js process and provides persistent disk storage. Set `PORT` if the host requires it. On Render, attach a persistent disk at `/var/data`, then set `PLAYERS_DB_FILE` to `/var/data/players.sqlite`. The app automatically stores the active round and historical-round database beside that file so all data survives redeploys and restarts. Set `AUTH_SECRET` to a long, random, stable value so signed login sessions remain valid and private across restarts.

## User accounts and access

Admins and players sign in from the same button with a unique username and private 4–10 digit PIN. PINs are salted and hashed before storage and are never returned by the server. A signed session is remembered on that device for up to 30 days. The main website remains publicly readable, so anyone can browse group scorecards and the live leaderboard without signing in.

Admin-only controls protect the roster, handicaps, reset/import tools, account setup, and final round lock. Change History records the name of the admin responsible for every administrative action. Players can browse every group but cannot change the roster or event settings.

On the first launch, use username `admin` with the existing `ADMIN_PIN` environment value, then open **Settings → Admin access** and create the first named administrator. The setup PIN is disabled as soon as that account is created. Existing named admins upgrading from an earlier release may leave Username blank once and sign in with their existing private PIN; their generated username is then visible under Admin access.

Additional administrators create their own credentials privately. A signed-in admin selects **Create private setup link** and sends the single-use link to the new administrator. The link expires after 24 hours. The recipient enters their own name, username, and PIN over the hosted HTTPS connection; the inviting admin never sees the PIN.

An administrator who also plays can use the same credentials for both roles. In **Settings → Admin access**, choose that administrator's saved profile under **Linked player** and save the change. The link is one-to-one: an admin can have one saved-player profile, and a saved-player profile can belong to only one admin. Linking retires any separate player-only login and unused setup links for that profile. The combined account keeps full admin rights, opens the player's assigned group by default, and can be selected as that group's scorekeeper. Unlinking does not recreate the retired player login; create a new private player setup link only if separate access is later needed.

Every saved player creates their own credentials privately. After an admin saves the profile, the app creates a single-use setup link that expires after 24 hours. The player opens that link and chooses their own unique username and PIN; the admin never sees the PIN. A saved player without a completed login shows **Create login link**. An existing account shows **Create reset link**; its current credentials continue working until the player accepts the reset link. Creating another link invalidates any older unused link for that player. Guests continue to receive round-only temporary credentials when they are added and may use them only during that active round.

The normal website opens on the Scoring page. After a player signs in, it defaults to that player's current group; a player not assigned to the active round starts on Group A. Everyone may use the group selector to browse. The Leaderboard tab is public and always shows the active round when it has players. After the active roster is cleared, it automatically shows the most recently saved round as read-only historical results. Each scoring card has an `SK` checkbox. If a group has no scorekeeper, any signed-in member of that group may choose one of its players. Once selected, only that scorekeeper or an admin may replace or clear the selection. At most one player can be selected per group, and only that account can enter the group's scores. Admins can enter scores and manage scorekeepers for every group.

## Saved player database

The Players tab includes an admin-only reusable player database. It opens with Search by name and the saved roster. The top Add Player button reveals a form at the bottom and saves the golfer's name, GHIN Index, and preferred tee, then prepares their private login setup link; Add Guest reveals a separate bottom form for a one-round player who is not saved. A saved-player entry is rejected unless all three required fields contain valid information. Every editable handicap field includes a `+ HCP` toggle so better-than-scratch indexes can be entered from Android and iPhone decimal keyboards without typing a plus sign. Tee choices are `Championship/Gold/1`, `Member/Blue/2`, `Combo/23`, and `Creek/White/3`. The tee-adjusted HDCP is displayed immediately to the right of the GHIN Index and updates with the selected tee and event allowance. Editing a saved player's GHIN Index, name, or tee also updates their linked entry in the active round. Only the player can create or reset their username and PIN through their private link.

An unlocked admin can select **Update Indexes** to update every matched saved player from the published Google Sheet. The importer supports the sheet's current repeating Name / Club / Index layout, including its `=+0.2` style for plus indexes. It also supports a conventional table with `Player Name`/`Name` plus `GHIN Index`/`Handicap Index` columns, or separate `First Name` and `Last Name` columns. Matching is case-insensitive and exact after normalizing punctuation and spacing; `Last, First` sheet names also match `First Last` saved names. The report shows updated, already-current, not-found, and ambiguous players. Incomplete or malformed sheet rows are ignored rather than shown as an Invalid category. Plus indexes such as `+4.2` are imported with the correct better-than-scratch direction. Linked players already in the open active round receive the new index without changing their group or scores.

The sheet must also label an **Update Date** (supported labels include `Update Date`, `Last Updated`, and `As Of`). Before writing, the server compares that date with the current date in Central Time. A missing or non-current date produces the warning “Are you sure you want to update, the roster is outdated.” Cancel leaves the database untouched; confirming proceeds. Every actual bulk change first creates a server recovery snapshot and records the admin's name, number of updated players, and sheet date in Change History. Set `INDEX_SHEET_URL` only if the published CSV source changes; otherwise the provided Berry Creek sheet is used automatically.

The guest-entry form in the database panel creates a one-time, independent player for the active round. A name, temporary username and PIN, Handicap Index, tee, and group are required. Guests are not saved to the reusable roster, may be entered repeatedly in different groups, and display `*G` beside their names on the leaderboard. Their login expires when a new round begins.

Enter and display better-than-scratch indexes using standard golf notation, such as `+4.2`. The app stores the value internally in the direction required for stroke calculations, so existing players previously entered as `-4.2` automatically display as `+4.2` after this update.

Deleting a saved player does not delete that golfer's current-round scores. It only removes the reusable database record. A profile linked to an administrator must be unlinked under Admin access before it can be deleted.

## Event workflow

1. Sign in as an admin, save or update golfers in the player database, and send each non-admin golfer their private login setup link. For an admin who is also playing, select their saved profile under **Settings → Admin access → Linked player** instead.
2. Add saved golfers to Groups A-F, use **Add player** for a one-time entry, or submit **Add guest** for an independent guest entry. The round supports up to 30 players, each group is limited to five, and the same saved player cannot be assigned to more than one active group.
3. Send everyone the normal website address. Players sign in, and the app opens their assigned group automatically. No scoring or special leaderboard link is required.
4. If an admin has not selected a scorekeeper, any signed-in member of that group checks `SK` beside the chosen player. That scorekeeper enters all five gross scores for the current hole and marks sand saves and par-3 KPs.
5. Everyone can view the live Leaderboard. A new KP claim on the same hole automatically replaces the previous holder while retaining the earlier player's scorecard mark.
6. Use Show group scorecard at the bottom of the scoring page to open the group's live-updating scorecard. Out, In, and Total show gross/net; incomplete totals are red and final totals are black. The scorecard uses S for skins, KP for the qualifying holder, KPM for marked claims that earned no tic, and an outlined KP while the result is pending.
7. Finalize and lock the round when scoring is complete. Only the admin can unlock it.
8. Select Save current round to preserve a historical snapshot before resetting for the next event.
9. Before play, open Event readiness in Settings, run the checks, and create a current server snapshot.

## Handicap and tic rules

- **Guest:** a one-time player with a manually entered Handicap Index. Guests compete normally, display `*G` on the leaderboard, are not saved to the reusable database, and may be entered independently more than once.
- **Not in the game:** the player's gross and net scores remain on the group scorecard, but the player is excluded from the leaderboard, KPs, skins, tics, segment/overall awards, and points calculations.

- Course Handicap = Handicap Index x (Slope / 113) + (Course Rating - Par), rounded.
- Playing Handicap = Course Handicap x the event allowance, rounded.
- Strokes use the current scorecard's tee-specific stroke-index sequence.
- Birdie tics are automatic for gross birdies or better.
- Front, back, and total net tics are automatic once the relevant holes are complete. The leaderboard labels them FN, BN, and TN. An outright winner receives 2 tics; tied leaders each receive 1 tic.
- Net skins are automatic after every player has a score for the hole. The single lowest handicap-adjusted net score wins; a tie awards no skin.
- A marked sand save at par or better earns one Sandy tic. A Sandy birdie also earns its separate birdie tic.
- Sand Save is available only after a par-or-better gross score. Changing that score to bogey or worse automatically clears the sand save.
- Group scorecards use traditional score shapes: birdies are circled, eagles or better are double-circled, bogeys are squared, and double bogeys or worse are double-squared.
- The selected group's live scorecard can be exported as a high-resolution JPEG or PDF styled after the club's physical card, including front/back panels, par, handicap, tee yardages, gross/net totals, handicap dots, score shapes, and all three KP categories.
- KPs can be marked during play on holes 2, 8, 12, and 17. Each group retains its checked KP claim, while correcting the selected player within the same group replaces that group's mistaken claim. The latest qualifying claim remains **KP Pending** until all competing scores are entered on the hole, then earns 1 tic as **KP**. Earlier, corrected, or over-par claims are **KP Marked** and earn 0 tics. A player cannot be marked for both KP and a sandy on the same par 3.
- Leaderboard KP and KPM values use four digits for holes 2, 8, 12, and 17 in that order. For example, `1100` means the player has that result on holes 2 and 8; `0000` means none.
- On a blank score, the first tap of either score arrow enters par. Additional taps then decrease or increase the score in the arrow's direction.
- Entering a new eagle score plays a locally stored, original 2.9-second eagle call on the scorekeeper's device. The call is bundled for offline play and does not stream or copy audio from YouTube.
- Entering a new birdie score plays a short original two-note tweet sound on the scorekeeper's device.

## Settings and admin controls

- The connection badge shows Live, Reconnecting, or Offline. Offline score changes are queued on the device and sent when the connection returns.
- Each score briefly shows Saving, Saved, Waiting to sync, or Sync problem so the scorekeeper can verify that entry.
- Score updates include the score the device last saw. If another device changed the same player and hole first, the scorekeeper must choose whether to keep the server score or replace it, preventing silent overwrites.
- Scorekeeper and admin permissions are enforced by the server; hiding or enabling a browser control cannot grant access.
- Once every score on a hole is entered, a large Continue to next hole button appears. Automatic advance can also be enabled per device.
- The Group progress dashboard shows players, completed holes, missing scores, last scoring activity, and connected scorekeepers for every group.
- Missing names, duplicate names, incomplete holes, and unusually high or low scores produce warnings.
- Every score, KP, sand save, roster edit, reset, import, and lock change is recorded in Change history.
- Named admin actions—including player-database changes, saved-round changes, backups, and account management—are attributed to the signed-in administrator.
- Results can be printed or saved as PDF, downloaded as a spreadsheet-compatible CSV, or backed up as JSON.
- The Settings tab can save durable historical snapshots containing the full roster, scorecards, tics, KPs, and results. Saved rounds can be viewed, downloaded, reused as a clean roster for a new round, or deleted without changing the active round.
- Saved-round group scorecards can be exported individually as JPEGs or PDFs, together as JPEGs in one ZIP file, or together as a multi-page PDF.
- The normal website provides public, read-only group browsing and a leaderboard without requiring a separate viewing link. The Leaderboard tab displays the active round live, then falls back to the newest saved round after the active event is cleared. Signing in activates only the controls allowed for that account, so separate scoring and leaderboard links are no longer necessary.
- Finalizing a round opens a checklist for missing scores, KPs, unusual scores, and roster-name issues before the admin locks it.
- Celebration sounds can be muted per device. Normal, outdoor high-contrast, and dark display modes are also device-specific.
- The visible app version, automatic startup check, and update banner make cached versions easier to identify and replace without a separate manual check button.
- Event readiness checks storage write access, persistent-disk configuration, the session secret, admin setup, player logins, group scorekeepers, backup freshness, roster setup, database access, and secure hosting.
- Complete backup files contain the active event, reusable player database, hashed player-login credentials, temporary active-round guest logins, and every saved historical round. Pending single-use invitation links are intentionally excluded and can be recreated afterward. A restore first creates a server-side recovery snapshot of the current data.
- Group QR images require an internet connection; Copy link remains available if the QR image service is unavailable.
- Live and printed scorecards show one dot for every handicap stroke a player receives on each hole.
- The leaderboard uses non-cash points: ordinary tics are 0.5 point; eagles and unique front/back/overall net wins are 1 point; tied net wins are 0.5 point.
- Every leaderboard column is sortable in either direction. Use Reset sort to return to the live standings order.
- Points + credits each earned point once for every other player. Points − shows the corresponding losses from all other players, and Net points shows the difference.

Under Settings, **Start new round** clears the active roster, group assignments, scores, KPs, and tics, then returns the admin to Players and Groups to build the next event. It remains available after a round is finalized and locked. Saved players and historical saved rounds are not deleted.

The Reset button on the Players tab can also clear only scores and tics while keeping the active roster, or clear the entire active event.

By default, the server saves event data to `data/round.json`, the reusable player roster, player logins, and short-lived player invitations to `data/players.sqlite`, historical rounds to `data/rounds.sqlite`, named admin credentials to `data/admins.sqlite`, and automatic recovery snapshots to `data/backups`. If `PLAYERS_DB_FILE` points to persistent storage, the other files are placed in that same directory. `DATA_DIR`, `ROUND_FILE`, `ROUND_HISTORY_DB_FILE`, `ADMIN_DB_FILE`, and `BACKUP_DIR` can override those locations. Keep every database on persistent storage so user access survives redeploys. For security, downloadable complete backups include only salted player PIN hashes, exclude pending invitation links, and intentionally exclude admin PIN hashes. The server keeps the 25 newest round-data snapshots and automatically creates one before a round reset, score reset, active-round import, saved-roster reuse, complete restore, or saved player/round deletion.
