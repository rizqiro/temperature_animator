# Wind Trend Animator

An animated, single-page viewer for wind data over time. Open `index.html` in any browser; no install or build step needed.

## What it shows

- **Values at this time**: a bar chart that glides smoothly between time steps, with a dashed line for the previous step.
- **Whole period**: a colour map (rows = times, columns = positions). Click a row to jump to that time.

Controls: play/pause, step buttons, time slider, speed. Keyboard: `Space` plays/pauses, `←` / `→` step through time.

## Using your own data

Open **Use your own data** at the bottom of the page and paste cells copied from Excel:

- First column: the time (for example `08 Nov 24 16:00`)
- Other columns: one value per position
- Tabs, semicolons or spaces work as separators; commas or dots work as decimal marks

Then set the column name and unit and click **Update chart**.

To change the built-in example data, edit the text inside `<textarea id="raw">` in `index.html`.

## Publish it online (GitHub Pages)

In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose `main` and `/ (root)`, then save. The page appears at `https://<your-username>.github.io/<repo-name>/` after a minute or two.
