# Wedding table games

Two small guest-facing pages, hosted on GitHub Pages, no backend.

- **map/** — "How do you know them?" Guests drop a pin where they came from and write one line about how they know the couple.
- **uno/** — Uno over a link. Two to six phones, private hands, live piles, UNO calls and catches, round scoring. Pass-and-play on one phone with a hand-the-phone curtain.
- **connect4/** — Connect Four over a link. Two phones, one board, live. Pass-and-play fallback on one phone.
- **qr/** — Printable QR codes for each page. Show them full-screen on your phone.

Live at https://johnloira.github.io/wedding-games/

## How state works

Both pages use [ntfy.sh](https://ntfy.sh) as a free pub/sub relay. Each page publishes small JSON events to a topic and
subscribes to it over server-sent events, with a poll fallback. The relay remembers messages for 12 hours.

- Uno: one topic per table (`unow-<code>`). The host's start event carries a random seed; every device shuffles and deals identically from it, so the relay never carries a card. Engine in `uno/game.js`, tests in `uno/game.test.js`.
- Connect Four: one topic per game (`c4w-<code>`). Every device replays the same event log, sorted deterministically,
  so boards converge no matter the arrival order. Engine in `connect4/game.js`, tests in `connect4/game.test.js` (`bun test`).
- Map: one topic from `map/config.js`. The hourly GitHub Action (`.github/workflows/archive-pins.yml`) folds the relay's
  messages into `map/pins.json` so pins outlive the relay's 12-hour memory. Run it by hand from the Actions tab any time.

## Before the wedding

Edit `map/config.js`: the couple's names (adds an "I'm here for" picker), the venue coordinates (enables the
"farthest traveled" stat), and push. Pages redeploys in about a minute.

## Local dev

```
python3 -m http.server 8765
open http://127.0.0.1:8765/
cd connect4 && bun test
```
