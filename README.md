# Fourth & Found

[Open the hosted dashboard](https://fourth-down-calculator-qhld34-preview.freebuff.page/)

An interactive fourth-down calculator that compares estimated possession-team win probabilities for going for it, kicking, and punting. The probabilities are separate conditional estimates, not parts of a single distribution.

## Model

The model is a simplified approximation fitted to 2022–2024 nflverse play-by-play data: 125,010 plays, 2,418 go attempts and 3,378 field goals. It is not the official nfl4th model, has not undergone out-of-sample calibration, and should not be treated as coaching-grade. Unusual or late-game scenarios can be unreliable.

The model regresses the logit of existing nflfastR win probabilities on score, clock, field position, down, distance and timeouts. Logistic models estimate fourth-down conversions and field-goal success. Simplifying assumptions include 40-yard net punts, seven seconds per play, a seven-point goal-to-go touchdown, and standard post-score possessions. Overtime, halftime, team strength, weather, return touchdowns, penalties, clock management, and many other details are not modeled. Kicks over 75 yards are outside the model's range. The source data is available at [nflverse](https://nflverse.nflverse.com/).

**Repository status:** The complete application and training script are currently in the local project workspace; source upload is not yet complete.
