import requests
import pandas as pd
from daily_output_utils import write_daily_outputs

# Fetch and combine player stats from each Big Ten team API
teams = (
    ('Illinois', 301),
    ('Indiana', 306),
    ('Iowa', 312),
    ('Maryland', 392),
    ('Michigan', 418),
    ('Michigan State', 416),
    ('Minnesota', 428),
    ('Nebraska', 463),
    ('Northwestern', 509),
    ('Ohio State', 518),
    ('Oregon', 529),
    ('Penn State', 539),
    ('Purdue', 559),
    ('Rutgers', 587),
    ('UCLA', 110),
    ('USC', 657),
    ('Washington', 756),
    ('Wisconsin', 796),
)

all_players = []
for team, team_id in teams:
    response = requests.get(
        'https://bigten.org/services/conf_stats.ashx',
        params={
            'method': 'get_team_stats',
            'team_id': team_id,
            'sport': 'wbball',
            'year': 2026,
            'conf': 'False',
            'postseason': 'False',
        },
        headers={'User-Agent': 'Mozilla/5.0'},
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict) or not isinstance(data.get('players'), list):
        raise ValueError(
            f"Big Ten stats API returned no player list for {team} "
            f"(team_id={team_id}, year=2026, HTTP {response.status_code})."
        )
    team_players = data['players']

    for player in team_players:
        if player['name'] == 'DoNot Use':
            continue

        last_name, separator, first_name = player['name'].partition(',')
        name = f'{first_name.strip()} {last_name.strip()}' if separator else last_name.strip()
        stats = player['stats_stats']
        games = int(stats.get('games_played') or 0)
        row = {
            'name': name,
            'team': team,
            'minutes': int(stats.get('minutes_played') or 0),
            'games': games,
            'points': int(stats.get('points_scored') or 0),
            'rebounds': int(stats.get('total_rebounds') or 0),
            'assists': int(stats.get('assists') or 0),
            'blocks': int(stats.get('blocked_shots') or 0),
            'steals': int(stats.get('steals') or 0),
            'threes': int(stats.get('three_points_made') or 0),
        }
        row['fantasy_points'] = row['points'] + row['threes'] + row['rebounds'] + row['assists'] + (2 * row['steals']) + (2 * row['blocks'])
        row['fpg'] = row['fantasy_points'] / games if games else 0
        all_players.append(row)

players_df = pd.DataFrame(all_players)
players_df = players_df.sort_values(by='fantasy_points', ascending=False)
players_df = players_df.drop_duplicates().reset_index(drop=True)

write_daily_outputs(players_df, 'daily-outputs-27')