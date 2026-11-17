"""Fit dashboard models from 2022–2024 nflverse play-by-play CSV releases.

Requires numpy and pandas. Downloads data into memory and writes src/model.json.
"""
import json
import numpy as np
import pandas as pd

SEASONS = [2022, 2023, 2024]
COLUMNS = ['down', 'ydstogo', 'yardline_100', 'game_seconds_remaining',
           'score_differential', 'posteam_timeouts_remaining',
           'defteam_timeouts_remaining', 'wp', 'play_type', 'first_down',
           'field_goal_result', 'kick_distance', 'season_type']


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


def main():
    frames = []
    for season in SEASONS:
        url = f'https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_{season}.csv.gz'
        print(f'Loading {season}...', flush=True)
        frames.append(pd.read_csv(url, usecols=COLUMNS, low_memory=False))
    pbp = pd.concat(frames, ignore_index=True)
    pbp = pbp[pbp.season_type.isin(['REG', 'POST'])]
    valid = pbp.dropna(subset=['wp', 'down', 'ydstogo', 'yardline_100', 'game_seconds_remaining',
                                'score_differential', 'posteam_timeouts_remaining', 'defteam_timeouts_remaining'])
    valid = valid[(valid.game_seconds_remaining > 0) & (valid.game_seconds_remaining <= 3600)
                  & valid.down.between(1, 4) & valid.yardline_100.between(1, 99)]
    y = np.clip(valid.wp.to_numpy(), .002, .998)
    wp = ridge(wp_features(valid), np.log(y / (1 - y)))
    fourth = pbp[(pbp.down == 4) & pbp.play_type.isin(['run', 'pass'])].dropna(subset=['first_down', 'ydstogo', 'yardline_100'])
    d = np.minimum(fourth.ydstogo.to_numpy(), 30)
    xgo = np.column_stack([np.ones(len(d)), d / 10, (d / 10) ** 2,
                           (fourth.yardline_100.to_numpy() < 10).astype(float)])
    go = logistic(xgo, fourth.first_down.to_numpy())
    kicks = pbp[(pbp.play_type == 'field_goal') & pbp.field_goal_result.isin(['made', 'missed', 'blocked'])].dropna(subset=['kick_distance'])
    kd = kicks.kick_distance.to_numpy() / 50
    xkick = np.column_stack([np.ones(len(kd)), kd, kd ** 2])
    kick = logistic(xkick, (kicks.field_goal_result == 'made').astype(float).to_numpy())
    result = {'seasons': SEASONS, 'wp': wp.tolist(), 'go': go.tolist(), 'kick': kick.tolist(),
              'counts': {'plays': len(valid), 'go': len(fourth), 'kicks': len(kicks)}}
    with open('src/model.json', 'w', encoding='utf-8') as f:
        json.dump(result, f, separators=(',', ':'))
    print('Wrote src/model.json:', result['counts'], flush=True)


if __name__ == '__main__':
    main()
