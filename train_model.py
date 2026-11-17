"""Train on 2022–2024 nflverse data; 2025 is reserved for evaluation.

Requires numpy and pandas. Cached downloads are kept under data/.
"""
import json
from pathlib import Path
import urllib.request

import numpy as np
import pandas as pd

SEASONS = [2022, 2023, 2024]
COLUMNS = ['game_id', 'play_id', 'season_type', 'down', 'ydstogo', 'yardline_100',
           'game_seconds_remaining', 'score_differential', 'posteam_timeouts_remaining',
           'defteam_timeouts_remaining', 'wp', 'play_type', 'first_down',
           'fourth_down_converted', 'field_goal_result', 'kick_distance', 'posteam',
           'home_team', 'result', 'touchdown', 'td_team', 'yards_gained',
           'return_yards', 'touchback', 'punt_blocked', 'qtr']


def load(seasons):
    Path('data').mkdir(exist_ok=True)
    frames = []
    for season in seasons:
        path = Path('data') / f'play_by_play_{season}.csv.gz'
        if not path.exists():
            url = f'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz'
            print('Downloading', season, flush=True)
            urllib.request.urlretrieve(url, path)
        frames.append(pd.read_csv(path, usecols=COLUMNS, low_memory=False))
    return pd.concat(frames, ignore_index=True)


def ridge(X, y, penalty=30):
    reg = np.eye(X.shape[1]) * penalty
    reg[0, 0] = 0
    return np.linalg.solve(X.T @ X + reg, X.T @ y)


def logistic(X, y, penalty=5):
    beta = np.zeros(X.shape[1])
    reg = np.eye(X.shape[1]) * penalty
    reg[0, 0] = 0
    for _ in range(40):
        p = 1 / (1 + np.exp(-np.clip(X @ beta, -30, 30)))
        w = np.maximum(p * (1 - p), 1e-5)
        delta = np.linalg.solve((X.T * w) @ X + reg, X.T @ (y - p) - reg @ beta)
        beta += delta
        if np.max(np.abs(delta)) < 1e-7:
            break
    return beta


def wp_features(df):
    s = df.score_differential.to_numpy() / 10
    t = df.game_seconds_remaining.to_numpy() / 3600
    urgency = 1 / np.sqrt(np.maximum(t, .015))
    field = (50 - df.yardline_100.to_numpy()) / 50
    dist = np.minimum(df.ydstogo.to_numpy(), 30) / 10
    down = (df.down.to_numpy() - 1) / 3
    to = (df.posteam_timeouts_remaining.to_numpy() - df.defteam_timeouts_remaining.to_numpy()) / 3
    return np.column_stack([np.ones(len(df)), s * urgency, s, field, field * urgency,
                            dist, down, t, to, to * (1 - t)])


def conversion_features(df):
    d = np.minimum(df.ydstogo.to_numpy(), 50) / 10
    return np.column_stack([np.ones(len(d)), d, d ** 2, (df.yardline_100.to_numpy() < 10).astype(float)])


def touchdown_features(df):
    yard = np.minimum(df.yardline_100.to_numpy(), 50) / 20
    remaining = np.clip((df.yardline_100.to_numpy() - df.ydstogo.to_numpy()) / 20, 0, 2.5)
    return np.column_stack([np.ones(len(yard)), remaining, yard])


def main():
    pbp = load(SEASONS)
    pbp = pbp[pbp.season_type.isin(['REG', 'POST'])]
    valid = pbp.dropna(subset=['wp', 'down', 'ydstogo', 'yardline_100', 'game_seconds_remaining',
                                'score_differential', 'posteam_timeouts_remaining', 'defteam_timeouts_remaining'])
    valid = valid[(valid.game_seconds_remaining > 0) & (valid.game_seconds_remaining <= 3600)
                  & valid.down.between(1, 4) & valid.yardline_100.between(1, 99)]
    y = np.clip(valid.wp.to_numpy(), .002, .998)
    wp = ridge(wp_features(valid), np.log(y / (1 - y)))
    fourth = pbp[(pbp.down == 4) & pbp.play_type.isin(['run', 'pass'])].dropna(subset=['fourth_down_converted', 'ydstogo', 'yardline_100'])
    fourth = fourth[(fourth.ydstogo > 0) & fourth.yardline_100.between(1, 99)]
    go = logistic(conversion_features(fourth), fourth.fourth_down_converted.to_numpy())
    converted = fourth[fourth.fourth_down_converted == 1]
    td = logistic(touchdown_features(converted), ((converted.touchdown == 1) & (converted.td_team == converted.posteam)).astype(float).to_numpy())
    gains = converted[(converted.touchdown != 1) & converted.yards_gained.notna()]
    extra_gain = max(0, float(np.median(gains.yards_gained - gains.ydstogo)))
    kicks = pbp[(pbp.play_type == 'field_goal') & pbp.field_goal_result.isin(['made', 'missed', 'blocked'])].dropna(subset=['kick_distance'])
    kd = kicks.kick_distance.to_numpy() / 50
    kick = logistic(np.column_stack([np.ones(len(kd)), kd, kd ** 2]), (kicks.field_goal_result == 'made').astype(float).to_numpy())
    punts = pbp[(pbp.down == 4) & (pbp.play_type == 'punt')].dropna(subset=['yardline_100', 'kick_distance'])
    punts = punts[punts.yardline_100.between(1, 99)].copy()
    # Compact empirical distribution by 10-yard field-position bucket. Returns
    # and touchbacks are separate; blocked punts are treated as turnovers at the spot.
    punts['bucket'] = np.minimum(9, ((punts.yardline_100 - 1) // 10).astype(int))
    punts['outcome'] = np.where((punts.touchdown == 1) & (punts.td_team != punts.posteam), 'return_td',
        np.where(punts.punt_blocked == 1, 'block',
        np.where(punts.touchback == 1, 'touchback',
                 (5 * np.round((punts.kick_distance - punts.return_yards.fillna(0)) / 5)).astype(int).astype(str))))
    distribution = []
    for bucket in range(10):
        sample = punts[punts.bucket == bucket]
        if len(sample) < 30:  # sparse extremes borrow the nearest sufficiently populated bucket
            populated = [b for b in range(10) if (punts.bucket == b).sum() >= 30]
            sample = punts[punts.bucket == min(populated, key=lambda b: abs(b - bucket))]
        counts = sample.outcome.value_counts()
        distribution.append([[key, int(count)] for key, count in counts.items()])
    result = {'seasons': SEASONS, 'wp': wp.tolist(), 'go': go.tolist(), 'td': td.tolist(),
              'kick': kick.tolist(), 'extra_gain': extra_gain, 'punts': distribution,
              'counts': {'plays': len(valid), 'go': len(fourth), 'kicks': len(kicks), 'punts': len(punts)}}
    with open('src/model.json', 'w', encoding='utf-8') as f:
        json.dump(result, f, separators=(',', ':'))
    print('Wrote src/model.json:', result['counts'], flush=True)


if __name__ == '__main__':
    main()
