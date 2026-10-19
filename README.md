# Hold'em Friends
Private, two-player, no-money Texas Hold'em. The server handles a cryptographically shuffled deck, hole-card privacy, dealer button rotation, blinds, legal betting, all-ins, showdown, kickers, split pots, and winner payouts. No AI players, ads, accounts, deposits, or payments.

## Fast deployment (GitHub + Render)
1. Create a new public or private GitHub repository, e.g. `holdem-friends`.
2. Upload **the contents of this folder** to the repository root using GitHub's **Add file → Upload files**. Ensure `package.json`, `server.js`, `poker.js`, `render.yaml`, and `public/` are at the root (not nested in another folder). Commit.
3. Log in to https://dashboard.render.com/ with GitHub. Choose **New → Web Service** and connect your repository. Authorize GitHub access if prompted.
4. Choose **Node**, **Free** instance type, **Build Command** `npm install`, **Start Command** `npm start`. Click **Deploy Web Service**. The included `render.yaml` is optional; alternatively use **New → Blueprint** and select the repository.
5. Wait for deployment and open the `https://...onrender.com` URL that Render gives you. Enter a nickname and click **Create private table**.
6. Click **Copy invite link** and send it to your friend. They enter a nickname and click **Join friend's table**. Either player clicks **Deal next hand**.

## Notes
- Play chips only; both start with 2,000 chips and blinds are 10/20. If either player busts, a new hand resets both stacks.
- One table = two players; no spectators. Room codes are random, but the link is a secret: anyone with it can join the empty seat.
- Each seat has a locally stored reconnect token. Refreshing in the same browser restores your seat. Clearing browser storage or switching devices may lose your seat. If a player disconnects, the hand pauses.
- Free Render instances may sleep after inactivity and take time to wake. Server restarts clear games and rooms. This is not a persistent production poker service.
- Designed for two players; because no side pots with three or more players are needed, unmatched all-in contributions are returned at showdown.
- Standard no-limit Hold'em: raises are expressed as **raise-to totals for the current betting street**, not additional chips. Short all-in raises do not reopen a previously closed raise.

## Local development
Install Node.js 20+. In this folder run `npm install` then `npm start`, and visit http://localhost:3000.

## Security / fair play
Deck shuffling uses Node.js `crypto.randomInt` on the server. The server sends hidden cards only to the owning player and reveals active players' cards at showdown. Room IDs are short invite codes, not strong access controls; do not use for wagering or valuable stakes.
