import requests
import pandas as pd
from daily_output_utils import write_daily_outputs

# Import stats from the Big Ten API
params = {
    'split': 'all',
    'level': 'season',
    'teams': 'all',
    'category': 'player',
    'section': 'totals',
    'conference': 'Big Ten',
    'seasons': '2025',
    'view': 'table',
    'type': 'player',
    'limit': '5000',
    'orderBy': 'default_rank',
    'order': 'asc',
    'qualifier' : 'default_qualifier',
}

response = requests.get(
    'https://engage-api.boostsport.ai/api/sport/wbb/stats/table',
    params=params,
    timeout=30,
)
response.raise_for_status()
data = response.json()

# Create dataset of all Big Ten players
all_players = []

for player in data['data']:
    if player['full_name'] == 'DoNot Use':
        pass
    else:
        row = {}
        stats = player['data']
        row['name'] = player['full_name']
        row['team'] = player['team_market']
        row['minutes'] = int(next((item['minutes'] for item in stats if 'minutes' in item), 0))
        row['games'] = int(next((item['gp'] for item in stats if 'gp' in item), 0))
        row['points'] = int(next((item['pts'] for item in stats if 'pts' in item), 0))
        row['rebounds'] = int(next((item['reb'] for item in stats if 'reb' in item), 0))
        row['assists'] = int(next((item['ast'] for item in stats if 'ast' in item), 0))
        row['blocks'] = int(next((item['blk'] for item in stats if 'blk' in item), 0))
        row['steals'] = int(next((item['stl'] for item in stats if 'stl' in item), 0))
        row['threes'] = int(next((item['fg3m'] for item in stats if 'fg3m' in item), 0))
        row['fantasy_points'] = row['points'] + row['threes'] + row['rebounds'] + row['assists'] + (2 * row['steals']) + (2 * row['blocks'])
        row['fpg'] = row['fantasy_points'] / row['games']
        all_players.append(row)

players_df = pd.DataFrame(all_players)
players_df = players_df.sort_values(by='fantasy_points', ascending=False)
players_df = players_df.drop_duplicates().reset_index(drop=True)

write_daily_outputs(players_df, 'daily-outputs')