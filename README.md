# Berry Creek DH Game

A responsive, real-time golf scoring app configured from The Club at Berry Creek's current scorecard.

When installed on an iPhone or Android Home Screen, the app is labeled `DH Game` beneath the icon.

## Start the app

No third-party packages are required. Install Node.js 22.5 or newer, open a terminal in this folder, and run:

```bash
npm start
```

Open `http://localhost:8080`. Other scorekeepers on the same Wi-Fi network can open `http://YOUR-COMPUTER-IP:8080`.

For a hosted event, deploy this folder to any service that runs a persistent Node.js process and provides persistent disk storage. Set `PORT` if the host requires it. On Render, attach a persistent disk at `/var/data`, then set `PLAYERS_DB_FILE` to `/var/data/players.sqlite`. The app automatically stores the active round and historical-round database beside that file so all three survive redeploys and restarts.

## Named admin PINs

Admin-only controls protect the roster, handicaps, reset/import tools, and final round lock. Each admin has a name and a unique private PIN. Change History records the name of the admin responsible for every administrative action.

On the first launch after upgrading, the existing `ADMIN_PIN` environment value remains available only as a setup PIN. Sign in with it, open **Settings → Admin access**, and create the first named administrator. The setup PIN is disabled as soon as that account is created.

Additional administrators create their own credentials privately. A signed-in admin selects **Create private setup link** and sends the single-use link to the new administrator. The link expires after 24 hours. The recipient enters their own name and PIN over the hosted HTTPS connection; the inviting admin never sees the PIN. PINs must contain 4–10 digits, are hashed before storage, are never returned by the server, and can be changed only by the admin who owns them.

Scorekeepers do not need an admin PIN; their group links allow scoring only for the assigned fivesome.

## Saved player database

The Players tab includes an admin-only reusable player database. It opens with Search by name and the saved roster. The top Add Player button reveals a form at the bottom and saves the golfer's name, GHIN Index, and preferred tee to the database; Add Guest reveals a separate bottom form for a one-round player who is not saved. Tee choices are `Championship/Gold/1`, `Member/Blue/2`, `Combo/23`, and `Creek/White/3`. The tee-adjusted HDCP is displayed immediately to the right of the GHIN Index and updates with the selected tee and event allowance. Editing a saved player's GHIN Index, name, or tee also updates their linked entry in the active round.

The guest-entry form in the database panel creates a one-time, independent player for the active round. A name, Handicap Index, tee, and group are required. Guests are not saved to the reusable roster, may be entered repeatedly in different groups, and display `*G` beside their names on the leaderboard.

Enter and display better-than-scratch indexes using standard golf notation, such as `+4.2`. The app stores the value internally in the direction required for stroke calculations, so existing players previously entered as `-4.2` automatically display as `+4.2` after this update.

Deleting a saved player does not delete that golfer's current-round scores. It only removes the reusable database record.

## Event workflow

1. Unlock admin controls and save or update golfers in the player database.
2. Add saved golfers to Groups A-F, use **Add player** for a one-time entry, or submit **Add guest** for an independent guest entry. The round supports up to 30 players, each group is limited to five, and the same saved player cannot be assigned to more than one active group.
3. Open the Settings tab and use Copy link, Share, or QR code for each group. Protected group links open directly to scoring, keep the group selector fixed, and authorize changes only for that fivesome. Previously shared v9.4 and older group links must be replaced.
4. Each scorekeeper enters all five gross scores for the current hole and marks sand saves and par-3 KPs.
5. Everyone can view the live Leaderboard. A new KP claim on the same hole automatically replaces the previous holder while retaining the earlier player's scorecard mark.
6. Use Show group scorecard during play to open or close the group's live-updating scorecard. Its Running total column adds every gross score entered so far.
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
- Front, back, and total net tics are automatic once the relevant holes are complete. Tied leaders each get a tic.
- Net skins are automatic after every player has a score for the hole. The single lowest handicap-adjusted net score wins; a tie awards no skin.
- A marked sand save becomes a sandy-par or sandy-birdie tic when the score qualifies.
- Sand Save is available only after a par-or-better gross score. Changing that score to bogey or worse automatically clears the sand save.
- Group scorecards use traditional score shapes: birdies are circled, eagles or better are double-circled, bogeys are squared, and double bogeys or worse are double-squared.
- The selected group's live scorecard can be exported as a high-resolution JPEG or PDF styled after the club's physical card, including front/back panels, par, handicap, tee yardages, gross/net totals, handicap dots, score shapes, and all three KP categories.
- KPs can be marked during play on holes 2, 8, 12, and 17. A current holder with par or better is **KP** and earns 1 tic. A claimant later beaten by another player is **KP Marked** and earns 0 tics. A current closest player who scores over par is **KP 3-Putt** and earns 0 tics. When a KP 3-Putt supplants an earlier qualifying claim, nobody receives the hole's KP tic unless a still-later player marks KP and scores par or better. A blank score is temporarily pending and earns 0 tics. The three categories appear separately on live and saved-round leaderboards, and the scorecards use a filled KP badge or transparent diagonal KP MARKED and KP 3-PUTT stamps so the score remains legible.
- On a blank score, the first tap of either score arrow enters par. Additional taps then decrease or increase the score in the arrow's direction.
- Entering a new eagle score plays an original three-second celebration on the scorekeeper's device.
- Entering a new birdie score plays a short original two-note tweet sound on the scorekeeper's device.

## Settings and admin controls

- The connection badge shows Live, Reconnecting, or Offline. Offline score changes are queued on the device and sent when the connection returns.
- Each score briefly shows Saving, Saved, Waiting to sync, or Sync problem so the scorekeeper can verify that entry.
- Score updates include the score the device last saw. If another device changed the same player and hole first, the scorekeeper must choose whether to keep the server score or replace it, preventing silent overwrites.
- Each group has an Undo last button that safely reverses its most recent score, sand-save, or KP change.
- Once every score on a hole is entered, a large Continue to next hole button appears. Automatic advance can also be enabled per device.
- The Group progress dashboard shows players, completed holes, missing scores, last scoring activity, and connected scorekeepers for every group.
- Missing names, duplicate names, incomplete holes, and unusually high or low scores produce warnings.
- Every score, KP, sand save, roster edit, reset, import, and lock change is recorded in Change history.
- Named admin actions—including player-database changes, saved-round changes, backups, and account management—are attributed to the signed-in administrator.
- Results can be printed or saved as PDF, downloaded as a spreadsheet-compatible CSV, or backed up as JSON.
- The Settings tab can save durable historical snapshots containing the full roster, scorecards, tics, KPs, and results. Saved rounds can be viewed, downloaded, reused as a clean roster for a new round, or deleted without changing the active round.
- Saved-round group scorecards can be exported individually as JPEGs or PDFs, together as JPEGs in one ZIP file, or together as a multi-page PDF.
- The read-only live leaderboard link updates in real time but has no scoring or admin capability. Group scoring links use protected, round-specific tokens and must be created while admin controls are unlocked. Starting a new round invalidates the old links.
- Finalizing a round opens a checklist for missing scores, KPs, unusual scores, and roster-name issues before the admin locks it.
- Celebration sounds can be muted per device. Normal, outdoor high-contrast, and dark display modes are also device-specific.
- The visible app version and Check for updates button make cached versions easier to identify and replace.
- Event readiness checks storage write access, persistent-disk configuration, the admin PIN, backup freshness, roster setup, database access, and secure hosting.
- Complete backup files contain the active event, reusable player database, and every saved historical round. A restore first creates a server-side recovery snapshot of the current data.
- Group QR images require an internet connection; Copy link remains available if the QR image service is unavailable.
- Live and printed scorecards show one dot for every handicap stroke a player receives on each hole.
- The leaderboard uses non-cash points: ordinary tics are 0.5 point; eagles and unique front/back/overall net wins are 1 point; tied net wins are 0.5 point.
- Every leaderboard column is sortable in either direction. Use Reset sort to return to the live standings order.
- Points + credits each earned point once for every other player. Points − shows the corresponding losses from all other players, and Net points shows the difference.

Under Settings, **Start new round** clears the active roster, group assignments, scores, KPs, and tics, then returns the admin to Players and Groups to build the next event. It remains available after a round is finalized and locked. Saved players and historical saved rounds are not deleted.

The Reset button on the Players tab can also clear only scores and tics while keeping the active roster, or clear the entire active event.

By default, the server saves event data to `data/round.json`, the reusable player roster to `data/players.sqlite`, historical rounds to `data/rounds.sqlite`, named admin credentials to `data/admins.sqlite`, and automatic recovery snapshots to `data/backups`. If `PLAYERS_DB_FILE` points to persistent storage, the other files are placed in that same directory. `DATA_DIR`, `ROUND_FILE`, `ROUND_HISTORY_DB_FILE`, `ADMIN_DB_FILE`, and `BACKUP_DIR` can override those locations. Keep `admins.sqlite` on persistent storage so named admin access survives redeploys. For security, downloadable complete backups intentionally exclude admin PIN hashes. The server keeps the 25 newest round-data snapshots and automatically creates one before a round reset, score reset, active-round import, saved-roster reuse, complete restore, or saved player/round deletion.
