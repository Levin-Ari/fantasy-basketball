import requests
import pandas as pd
from datetime import datetime, timedelta, timezone
import zoneinfo

# Save today and yesterday's date as variables
est = zoneinfo.ZoneInfo("America/New_York")
now = datetime.now(est)
date = (now - timedelta(days=1)).date() if now.hour < 9 else now.date()
past_date = date - timedelta(days=1)
date_name = date.strftime('%Y-%m-%d')
past_date_name = past_date.strftime('%Y-%m-%d')

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
    'qualifier' : 'default_qualifier'
}

response = requests.get('https://engage-api.boostsport.ai/api/sport/wbb/stats/table', params=params)
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

# Export files
file_name = 'daily-outputs/' + date_name + '.csv'
players_df.to_csv(file_name, index=False)

# Import yesterday's players sheet
past_file_name = 'daily-outputs/' + past_date_name + '.csv'
past_players_df = pd.read_csv(past_file_name)
past_players_df = past_players_df[['name', 'team', 'fantasy_points']].rename(columns={'fantasy_points':'past_points'})

# Create the daily standings
merged_players_df = players_df[['name', 'team', 'fantasy_points']].merge(past_players_df, how='left', on=['name', 'team']).fillna(0)
merged_players_df['daily_points'] = merged_players_df['fantasy_points'] - merged_players_df['past_points']

# Export to the file path
daily_file_name_json = 'daily-outputs/' + date_name + '_daily.json'
merged_players_df.sort_values(by='daily_points', ascending=False).to_json(daily_file_name_json, orient='records', indent=2)