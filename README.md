# Berry Creek Tics

A responsive, real-time golf scoring app configured from The Club at Berry Creek's current scorecard.

## Start the app

No packages are required. Install Node.js 18 or newer, open a terminal in this folder, and run:

```bash
node server.js
```

Open `http://localhost:8080`. Other scorekeepers on the same Wi-Fi network can open `http://YOUR-COMPUTER-IP:8080`.

For a hosted event, deploy this folder to any service that runs a persistent Node.js process and provides persistent disk storage. Set `PORT` if the host requires it.

## Event workflow

1. Add up to 30 players on the Players tab.
2. Enter each player's GHIN Handicap Index, tee, and group (A-F). Each group is limited to five.
3. Give each scorekeeper the app URL with their group selected, such as `?group=A`.
4. Each scorekeeper enters all five gross scores for the current hole and marks sand saves and par-3 KPs.
5. Everyone can view the live Leaderboard. A new KP claim on the same hole automatically replaces the previous holder.

## Handicap and tic rules

- Course Handicap = Handicap Index x (Slope / 113) + (Course Rating - Par), rounded.
- Playing Handicap = Course Handicap x the event allowance, rounded.
- Strokes use the current scorecard's tee-specific stroke-index sequence.
- Birdie tics are automatic for gross birdies or better.
- Front, back, and total net tics are automatic once the relevant holes are complete. Tied leaders each get a tic.
- Net skins are automatic after every player has a score for the hole. The single lowest handicap-adjusted net score wins; a tie awards no skin.
- A marked sand save becomes a sandy-par or sandy-birdie tic when the score qualifies.
- KPs can be marked during play on holes 2, 8, 12, and 17. Only one player can hold each KP at a time.

The server saves event data to `data/round.json`. Use Export backup during the round for an additional copy.
