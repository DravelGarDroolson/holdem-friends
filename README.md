# Hold'em Friends — Six-player update

Private, free Texas Hold'em for 2–6 human players. Automated dealer, multiway side pots, showdown rankings, chip explanations and optional 2,000-chip replenishment after busting. No bots or payments.

## Update existing GitHub / Render deployment

1. Download and extract `holdem-friends-v2.zip`.
2. Open your existing GitHub repository `holdem-friends`.
3. Replace these ROOT files with the ones from the ZIP: `server.js`, `poker.js`, `package.json`, `render.yaml`, `README.md`.
4. IMPORTANT: Create a folder named `public` at the repository root, containing `index.html`, `app.js`, and `style.css`. Do not upload these three to the root. If your old root copies remain, delete them so only the `public/` copies are used.
5. Commit changes. Render automatically deploys to the same URL.
6. After deployment is Live, reload the game. Start a fresh room (old rooms reset on restart).

### Easier method with GitHub web interface

You can upload the updated root files with **Add file → Upload files**, and use **Add file → Create new file** with the path `public/index.html`, pasting the file contents; repeat for `public/app.js` and `public/style.css`. Commit. Or use GitHub Desktop to drag the extracted files into the cloned repository and push one commit.

### Known limits

- Free Render servers sleep and restart; room state is kept in memory only.
- A disconnected player retains their seat; play pauses if their turn comes up until they reconnect.
- Players can join only between hands. Existing seated players with zero chips can replenish 2,000 play chips between hands.
- This is a recreational project, not a real-money gambling product. Test complicated poker situations before relying on the dealer for competitive events.
