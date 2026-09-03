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

## Admin PIN

Admin-only controls protect the roster, handicaps, reset/import tools, and final round lock. The default PIN is `2468`.

Before an event on Render, add an environment variable named `ADMIN_PIN` with your own private PIN and redeploy. Scorekeepers do not need the PIN; their group links allow scoring only for the assigned fivesome.

## Saved player database

The Players tab includes an admin-only reusable player database. Save each golfer's name, GHIN Index, and preferred tee once, then search the list and add that golfer to any Group A-F for a new round. Editing a saved player's GHIN Index, name, or tee also updates their linked entry in the active round.

Enter and display better-than-scratch indexes using standard golf notation, such as `+4.2`. The app stores the value internally in the direction required for stroke calculations, so existing players previously entered as `-4.2` automatically display as `+4.2` after this update.

Deleting a saved player does not delete that golfer's current-round scores. It only removes the reusable database record.

## Event workflow

1. Unlock admin controls and save or update golfers in the player database.
2. Add saved golfers to Groups A-F, or use Add player for a one-time entry. The round supports up to 30 players and each group is limited to five.
3. Open the Settings tab and use Copy link, Share, or QR code for each group. Protected group links open directly to scoring, keep the group selector fixed, and authorize changes only for that fivesome. Previously shared v9.4 and older group links must be replaced.
4. Each scorekeeper enters all five gross scores for the current hole and marks sand saves and par-3 KPs.
5. Everyone can view the live Leaderboard. A new KP claim on the same hole automatically replaces the previous holder while retaining the earlier player's scorecard mark.
6. Use Show group scorecard during play to open or close the group's live-updating scorecard. Its Running total column adds every gross score entered so far.
7. Finalize and lock the round when scoring is complete. Only the admin can unlock it.
8. Select Save current round to preserve a historical snapshot before resetting for the next event.

## Handicap and tic rules

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
- KPs can be marked during play on holes 2, 8, 12, and 17. A current holder with par or better is **KP** and earns 1 tic. A claimant later beaten by another player is **KP Marked** and earns 0 tics. A current closest player who scores over par is **KP 3-Putt** and earns 0 tics. A blank score is temporarily pending and earns 0 tics. The three categories appear separately on live and saved-round leaderboards, and the scorecards use a filled KP badge or transparent diagonal KP MARKED and KP 3-PUTT stamps so the score remains legible.
- On a blank score, the first tap of either score arrow enters par. Additional taps then decrease or increase the score in the arrow's direction.
- Entering a new eagle score plays an original three-second celebration on the scorekeeper's device.
- Entering a new birdie score plays a short original two-note tweet sound on the scorekeeper's device.

## Settings and admin controls

- The connection badge shows Live, Reconnecting, or Offline. Offline score changes are queued on the device and sent when the connection returns.
- Each score briefly shows Saving, Saved, Waiting to sync, or Sync problem so the scorekeeper can verify that entry.
- Each group has an Undo last button that safely reverses its most recent score, sand-save, or KP change.
- Once every score on a hole is entered, a large Continue to next hole button appears. Automatic advance can also be enabled per device.
- The Group progress dashboard shows players, completed holes, missing scores, last scoring activity, and connected scorekeepers for every group.
- Missing names, duplicate names, incomplete holes, and unusually high or low scores produce warnings.
- Every score, KP, sand save, roster edit, reset, import, and lock change is recorded in Change history.
- Results can be printed or saved as PDF, downloaded as a spreadsheet-compatible CSV, or backed up as JSON.
- The Settings tab can save durable historical snapshots containing the full roster, scorecards, tics, KPs, and results. Saved rounds can be viewed, downloaded, reused as a clean roster for a new round, or deleted without changing the active round.
- Saved-round group scorecards can be exported individually as JPEGs or PDFs, together as JPEGs in one ZIP file, or together as a multi-page PDF.
- The read-only live leaderboard link updates in real time but has no scoring or admin capability. Group scoring links use protected, round-specific tokens and must be created while admin controls are unlocked. Starting a new round invalidates the old links.
- Finalizing a round opens a checklist for missing scores, KPs, unusual scores, and roster-name issues before the admin locks it.
- Celebration sounds can be muted per device. Normal, outdoor high-contrast, and dark display modes are also device-specific.
- The visible app version and Check for updates button make cached versions easier to identify and replace.
- Group QR images require an internet connection; Copy link remains available if the QR image service is unavailable.
- Live and printed scorecards show one dot for every handicap stroke a player receives on each hole.
- The leaderboard uses non-cash points: ordinary tics are 0.5 point; eagles and unique front/back/overall net wins are 1 point; tied net wins are 0.5 point.
- Every leaderboard column is sortable in either direction. Use Reset sort to return to the live standings order.
- Points + credits each earned point once for every other player. Points − shows the corresponding losses from all other players, and Net points shows the difference.

Under Settings, **Start new round** clears the active roster, group assignments, scores, KPs, and tics, then returns the admin to Players and Groups to build the next event. It remains available after a round is finalized and locked. Saved players and historical saved rounds are not deleted.

The Reset button on the Players tab can also clear only scores and tics while keeping the active roster, or clear the entire active event.

By default, the server saves event data to `data/round.json`, the reusable player roster to `data/players.sqlite`, and historical rounds to `data/rounds.sqlite`. If `PLAYERS_DB_FILE` points to persistent storage, the other two files are placed in that same directory. `DATA_DIR`, `ROUND_FILE`, and `ROUND_HISTORY_DB_FILE` can also override those locations individually. Use Export backup during the round for an additional copy of the event data.
