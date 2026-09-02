# Berry Creek DH Game

A responsive, real-time golf scoring app configured from The Club at Berry Creek's current scorecard.

## Start the app

No third-party packages are required. Install Node.js 22.5 or newer, open a terminal in this folder, and run:

```bash
npm start
```

Open `http://localhost:8080`. Other scorekeepers on the same Wi-Fi network can open `http://YOUR-COMPUTER-IP:8080`.

For a hosted event, deploy this folder to any service that runs a persistent Node.js process and provides persistent disk storage. Set `PORT` if the host requires it. On Render, attach a persistent disk and mount it to the app's `data` directory; otherwise the round and player database can reset during a redeploy.

## Organizer PIN

Organizer-only controls protect the roster, handicaps, reset/import tools, and final round lock. The default PIN is `2468`.

Before an event on Render, add an environment variable named `ADMIN_PIN` with your own private PIN and redeploy. Scorekeepers do not need the PIN; their group links allow scoring only for the assigned fivesome.

## Saved player database

The Players tab includes an organizer-only reusable player database. Save each golfer's name, GHIN Index, and preferred tee once, then search the list and add that golfer to any Group A-F for a new round. Editing a saved player's GHIN Index, name, or tee also updates their linked entry in the active round.

Deleting a saved player does not delete that golfer's current-round scores. It only removes the reusable database record.

## Event workflow

1. Unlock organizer controls and save or update golfers in the player database.
2. Add saved golfers to Groups A-F, or use Add player for a one-time entry. The round supports up to 30 players and each group is limited to five.
3. Open the Tournament tab and use Copy link, Share, or QR code for each group. Group links open directly to scoring and keep the group selector fixed.
4. Each scorekeeper enters all five gross scores for the current hole and marks sand saves and par-3 KPs.
5. Everyone can view the live Leaderboard. A new KP claim on the same hole automatically replaces the previous holder.
6. Use Show group scorecard during play to open or close the group's live-updating scorecard. Its Running total column adds every gross score entered so far.
7. Finalize and lock the round when scoring is complete. Only the organizer can unlock it.

## Handicap and tic rules

- Course Handicap = Handicap Index x (Slope / 113) + (Course Rating - Par), rounded.
- Playing Handicap = Course Handicap x the event allowance, rounded.
- Strokes use the current scorecard's tee-specific stroke-index sequence.
- Birdie tics are automatic for gross birdies or better.
- Front, back, and total net tics are automatic once the relevant holes are complete. Tied leaders each get a tic.
- Net skins are automatic after every player has a score for the hole. The single lowest handicap-adjusted net score wins; a tie awards no skin.
- A marked sand save becomes a sandy-par or sandy-birdie tic when the score qualifies.
- Sand Save is available only after a par-or-better gross score. Changing that score to bogey or worse automatically clears the sand save.
- KPs can be marked during play on holes 2, 8, 12, and 17. Only one player can hold each KP at a time.
- Entering a new eagle score plays an original three-second celebration on the scorekeeper's device.
- Entering a new birdie score plays a short original two-note tweet sound on the scorekeeper's device.

## Tournament controls

- The connection badge shows Live, Reconnecting, or Offline. Offline score changes are queued on the device and sent when the connection returns.
- Missing names, duplicate names, incomplete holes, and unusually high or low scores produce warnings.
- Every score, KP, sand save, roster edit, reset, import, and lock change is recorded in Change history.
- Results can be printed or saved as PDF, downloaded as a spreadsheet-compatible CSV, or backed up as JSON.
- Celebration sounds can be muted per device. Normal, outdoor high-contrast, and dark display modes are also device-specific.
- The visible app version and Check for updates button make cached versions easier to identify and replace.
- Group QR images require an internet connection; Copy link remains available if the QR image service is unavailable.
- Live and printed scorecards show one dot for every handicap stroke a player receives on each hole.
- The leaderboard uses non-cash points: ordinary tics are 0.5 point; eagles and unique front/back/overall net wins are 1 point; tied net wins are 0.5 point.
- Every leaderboard column is sortable in either direction. Use Reset sort to return to the live standings order.
- Points + credits each earned point once for every other player. Points − shows the corresponding losses from all other players, and Net points shows the difference.

The Reset button can clear only scores and tics while keeping the roster, or clear the entire app for a new event.

The server saves event data to `data/round.json` and the reusable player roster to `data/players.sqlite`. Use Export backup during the round for an additional copy of the event data.
