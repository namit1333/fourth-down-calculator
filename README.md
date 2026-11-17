# Fourth & Found

[Open the hosted dashboard](https://fourth-down-calculator-qhld34-preview.freebuff.page/)

An interactive fourth-down calculator comparing possession-team win probabilities for going for it, kicking and punting. The values are separate conditional estimates, not parts of a single distribution.

## Run locally

Install Node.js 22 or later, then `npm install` and `npm run dev`. Build with `npm run build`. The app is a static Vite website. The included Worker and manifest serve the build on Freebuff Sites.

## Model and limitations

`train_model.py` reads 2022–2024 nflverse play-by-play CSV releases (regular season and playoffs) with Python, pandas and numpy, and writes `src/model.json`. It fits a regularized linear regression to the logit of nflfastR `wp`, using score, clock, field position, down, distance and timeouts; logistic regressions estimate fourth-down conversion and field-goal success. Training used 125,010 plays, 2,418 fourth-down attempts and 3,378 field goals. To regenerate, install pandas and numpy and run `python train_model.py`.

The fitted models are approximations, **not** the official nfl4th model. No out-of-sample calibration study has been performed; historical selection biases apply. The browser combines them with simplified outcomes: a conversion gains the necessary distance plus two yards (except goal-to-go touchdowns, assumed to score seven); failure turns the ball over at the line of scrimmage; a made field goal or touchdown gives the opponent the ball at its 30; a missed field goal gives the opponent possession at the kick spot, minimum own 20; and punts net 40 yards with touchbacks at the 20. Seven seconds are removed per play. End-of-regulation ties receive 50% win probability. Overtime, halftime, two-point attempts, turnovers on successful conversions, penalties, returns, safeties, clock management, team strength and weather are not explicitly modeled. Kicks over 75 yards are excluded as outside the model's useful range. Unusual and late-game situations can be particularly inaccurate. This is an exploratory estimate, not a coaching-grade forecast.

Data from [nflverse](https://nflverse.nflverse.com/) are subject to their respective owners’ terms of use.
