"""Evaluate the dashboard on 2025 NFL play-by-play, never used for training.

Requires pandas, numpy and Node.js 22+. Run from the project root. Brier scores
on historically selected actions are observational, not causal estimates.
"""
import json
import subprocess
from pathlib import Path

import numpy as np
import pandas as pd
from train_model import load, wp_features


def metrics(name, y, p):
    y = np.asarray(y, dtype=float)
    p = np.asarray(p, dtype=float)
    print(f'{name}: n={len(y)}, observed={y.mean():.4f}, predicted={p.mean():.4f}, Brier={np.mean((p-y)**2):.4f}')


def main():
    df = load([2025])
    df = df[df.season_type.isin(['REG', 'POST']) & (df.qtr <= 4)]
    cols = ['posteam', 'home_team', 'result', 'score_differential', 'game_seconds_remaining',
            'yardline_100', 'ydstogo', 'posteam_timeouts_remaining', 'defteam_timeouts_remaining']
    df = df[(df.down == 4) & df.play_type.isin(['run', 'pass', 'punt', 'field_goal'])].dropna(subset=cols + ['wp'])
    df = df[(df.game_seconds_remaining > 0) & (df.game_seconds_remaining <= 3600)
            & df.yardline_100.between(1, 99) & (df.ydstogo > 0) & (df.ydstogo <= df.yardline_100)]
    df = df.copy()
    df['action'] = np.where(df.play_type.isin(['run', 'pass']), 'go',
                            np.where(df.play_type == 'punt', 'punt', 'kick'))
    home_result = df.result.to_numpy()
    win = np.where(df.posteam == df.home_team, np.sign(home_result), -np.sign(home_result))
    df['won'] = (win + 1) / 2
    records = []
    for row in df.itertuples():
        clock = row.game_seconds_remaining - (4 - int(row.qtr)) * 900
        records.append({'score': row.score_differential, 'quarter': int(row.qtr), 'clock': clock,
                        'yard': row.yardline_100, 'distance': row.ydstogo,
                        'ourTO': int(row.posteam_timeouts_remaining), 'theirTO': int(row.defteam_timeouts_remaining)})
    Path('data/eval-input.json').write_text(json.dumps(records), encoding='utf-8')
    # Use the identical JS calculation as the application; Node loads the JSON model directly.
    code = Path('src/calculator.js').read_text(encoding='utf-8').replace(
        "import model from './model.json'", "import model from '../src/model.json' with { type: 'json' }")
    Path('data/eval-calculator.mjs').write_text(code, encoding='utf-8')
    runner = """import { readFileSync } from 'node:fs';
import { calculate, wp } from './eval-calculator.mjs';
const rows = JSON.parse(readFileSync('data/eval-input.json'));
console.log(JSON.stringify(rows.map(r => ({...calculate(r), current:wp(r.score,(4-r.quarter)*900+r.clock,r.yard,4,r.distance,r.ourTO,r.theirTO)}))));
"""
    Path('data/eval-runner.mjs').write_text(runner, encoding='utf-8')
    output = subprocess.check_output(['node', 'data/eval-runner.mjs'], text=True, encoding='utf-8')
    prediction = pd.DataFrame(json.loads(output), index=df.index)
    print('Held-out 2025 REG + POST, regulation only; final ties count as 0.5')
    metrics('Current WP vs observed winner (all 4th-down plays)', df.won, prediction.current)
    metrics('nflfastR WP vs observed winner (reference)', df.won, df.wp)
    print(f'Current WP vs nflfastR WP: MAE={np.mean(abs(df.wp - prediction.current)):.4f}')
    for action in ['go', 'kick', 'punt']:
        mask = (df.action == action) & prediction[action].notna()
        metrics(f'{action} decision WP vs observed winner', df.loc[mask, 'won'], prediction.loc[mask, action])
    go = (df.action == 'go') & df.fourth_down_converted.notna()
    metrics('Go conversion', df.loc[go, 'fourth_down_converted'], prediction.loc[go, 'conversion'])
    converted = go & (df.fourth_down_converted == 1)
    td = ((df.touchdown == 1) & (df.td_team == df.posteam)).astype(int)
    metrics('Touchdown conditional on conversion', td[converted], prediction.loc[converted, 'tdProb'])
    # The previous implementation predicted 100% TD for goal-to-go and 0% otherwise.
    metrics('Previous touchdown assumption', td[converted], (df.loc[converted, 'ydstogo'] == df.loc[converted, 'yardline_100']).astype(int))
    kick = (df.action == 'kick') & prediction.kickProb.notna() & df.field_goal_result.isin(['made', 'missed', 'blocked'])
    metrics('Field goal make', (df.loc[kick, 'field_goal_result'] == 'made').astype(int), prediction.loc[kick, 'kickProb'])
    punts = (df.action == 'punt') & df.kick_distance.notna() & (df.punt_blocked == 0) & (df.touchdown == 0) & prediction.puntAverageOwn.notna()
    actual_own = np.where(df.loc[punts, 'touchback'] == 1, 20,
                          np.clip(df.loc[punts, 'yardline_100'] - df.loc[punts, 'kick_distance'] + df.loc[punts, 'return_yards'].fillna(0), .5, 99.5))
    new = prediction.loc[punts, 'puntAverageOwn'].to_numpy()
    old = np.where(df.loc[punts, 'yardline_100'] <= 40, 20, np.maximum(1, 100 - df.loc[punts, 'yardline_100'] - 40))
    print(f'Punt opponent starting yard (non-blocked, no TD): n={punts.sum()}, actual mean={actual_own.mean():.2f}, new predicted mean={new.mean():.2f}, previous predicted mean={old.mean():.2f}, new MAE={np.mean(abs(new-actual_own)):.2f}, previous MAE={np.mean(abs(old-actual_own)):.2f}')
    late = df.game_seconds_remaining <= 120
    metrics('Current WP vs winner, last 2 minutes', df.loc[late, 'won'], prediction.loc[late, 'current'])
    for low, high in [(0, .2), (.2, .4), (.4, .6), (.6, .8), (.8, 1.01)]:
        bucket = (prediction.current >= low) & (prediction.current < high)
        if bucket.sum(): metrics(f'Current WP bin {low:.1f}–{min(high, 1):.1f}', df.loc[bucket, 'won'], prediction.loc[bucket, 'current'])
    unavailable = (df.action == 'punt') & prediction.punt.isna()
    print(f'Actual punts excluded because field position has insufficient training data: {unavailable.sum()}')
    print('Note: decision-specific comparisons describe selected real-world plays, not randomized counterfactual decisions.')


if __name__ == '__main__':
    main()
