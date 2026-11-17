# Fourth & Found

A browser-based NFL fourth-down calculator. Compare conditional possession-team win probabilities for going for it, attempting a field goal, and punting. The percentages do not add to 100%.

## Run locally

```sh
bun install
bun run dev
```

`bun run build` produces the static site. `deploy.json` and `worker/index.js` serve it on Freebuff Sites.

## Model

`train_model.py` loads the nflverse 2022–2024 regular-season and postseason play-by-play CSV releases. It requires Python, numpy and pandas; files are cached in `data/` (ignored by git). Run `python train_model.py` to regenerate `src/model.json`. It fits a regularized regression to the logit of existing nflfastR win probabilities, conversion and field-goal logistic models, a conditional touchdown model, and empirical punt-outcome distributions by ten-yard field-position bucket. 2025 is not used in training. This is an approximation, **not** the official nfl4th model.

A conversion is a weighted average of a touchdown (estimated conditional on conversion, certain on goal-to-go) and a first down with the median excess yards gained. Failed attempts turn the ball over at the line of scrimmage. A touchdown is assumed to yield seven points and is followed by the opponent taking possession on its 30; a punt return TD gives the ball back to the original offense at its 30. A made FG gives the opponent possession at its 30; a missed FG gives the opponent the kick spot, minimum own 20. Punt distributions reflect net distance, touchbacks, blocks (treated as a turnover at the spot), and return touchdowns. Seven seconds are removed per play. A regulation-ending tie is assigned 50% win probability.

The field slider runs from the offense's own half-yard line to the opponent's half-yard line. The distance slider supports half-yard increments up to the goal line; distances over 30 yards are sparse and involve extrapolation. Scores allow whole numbers from 0 to 9999, and the regulation clock must be between 0:01 and 15:00. Field-goal attempts beyond 75 yards remain unavailable rather than being extrapolated.

## Held-out 2025 evaluation

Run `python evaluate_model.py` with Node.js 22+, numpy and pandas. The script downloads or reads the 2025 release and evaluates the exact browser calculator; it filters to regulation fourth-down run/pass, punt and field-goal plays with complete game state. Final game ties count as half a win. The 2025 season was not used to fit the revised coefficients. **Brier score** is mean squared probability error (lower is better); predictions are observational and not a causal evaluation of counterfactual choices.

| Held-out measure | N | Predicted mean | Observed mean | Brier |
| --- | ---: | ---: | ---: | ---: |
| Current WP, all fourth-down plays | 3,973 | 47.60% | 47.23% | 0.1683 |
| nflfastR WP reference, same plays | 3,973 | 46.81% | 47.23% | 0.1674 |
| Go decision WP, actual go plays | 922 | 36.44% | 37.15% | 0.1387 |
| Kick decision WP, actual kick plays | 1,017 | 55.19% | 55.95% | 0.1776 |
| Punt decision WP, actual punts | 2,034 | 46.95% | 47.44% | 0.1765 |
| Conversion on actual go plays | 922 | 54.52% | 55.21% | 0.2287 |
| TD conditional on conversion | 509 | 19.64% | 18.66% | 0.0737 |
| FG make | 1,017 | 85.76% | 86.23% | 0.1084 |

On the same converted plays, the previous goal-to-go-only TD assumption had Brier 0.1002. For 2,009 punts excluding blocked punts and return TDs, average opponent starting-yard absolute error was 6.28 yards versus 21.18 for the previous fixed formula; observed, revised predicted, and old predicted mean spots were respectively the 23.51, 23.60, and 3.77. Current WP's mean absolute difference from nflfastR WP was 4.11 percentage points. For the 606 situations predicted at 60–80% current WP, mean prediction was 69.75% versus 66.67% observed: calibration varies by situation even if overall means are close. The holdout is one season and informed model fixes, including changes to long-conversion extrapolation and blocked-punt touchdown classification; it is not an independent validation of this revision or future revisions.

## Limitations

Overtime is not modeled; 0:00 is excluded because the quarter has ended. Scoring plays, returns, turnovers, penalties, kick blocks, safeties, timeouts, clock runoff, and non-touchdown conversions use simplified branches, not a complete play simulator. Halftime kickoff possession is unknown; a warning appears for a play that could cross halftime, and the model does not reset possession or timeouts. A seven-point touchdown ignores missed extra points and two-point strategy, including defensive returns. Goal-to-go conversion via defensive penalty is treated as a touchdown. The conversion model excludes no-play penalty decisions, and the punt distribution does not explicitly model fumble recoveries or all blocked-punt returns. Historical actions were selected by teams in different circumstances; action-specific outcome scores do not prove that the recommended option is optimal. Extreme scores, time, distance, half-yard spots, or field positions have little historical support. Kicks over 75 yards are unavailable, not illegal; the 75-yard cutoff is a modeling limitation. Team strength, weather, injuries, pregame odds and matchup effects are not modeled. nflverse data are subject to their respective owners' terms of use.
