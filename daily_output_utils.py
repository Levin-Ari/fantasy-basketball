from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd


EASTERN = ZoneInfo("America/New_York")


def write_daily_outputs(players_df: pd.DataFrame, output_directory: str | Path, now: datetime | None = None) -> None:
    current_time = now or datetime.now(EASTERN)
    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=EASTERN)
    else:
        current_time = current_time.astimezone(EASTERN)

    today = current_time.date()
    yesterday = today - timedelta(days=1)
    today_name = today.isoformat()
    yesterday_name = yesterday.isoformat()

    output_path = Path(output_directory)
    output_path.mkdir(parents=True, exist_ok=True)
    current_players = players_df.copy()
    current_players["fantasy_points"] = pd.to_numeric(
        current_players["fantasy_points"], errors="raise"
    )
    current_players.to_csv(output_path / f"{today_name}.csv", index=False)

    snapshot_directory = output_path / "cutoff-snapshots"
    snapshot_directory.mkdir(exist_ok=True)
    yesterday_snapshot = snapshot_directory / f"{yesterday_name}.csv"
    if not yesterday_snapshot.exists():
        yesterday_snapshot = output_path / f"{yesterday_name}.csv"
    if not yesterday_snapshot.exists():
        raise FileNotFoundError(
            f"No previous-day stats snapshot found for {yesterday_name}"
        )

    previous_players = pd.read_csv(yesterday_snapshot)
    previous_players = previous_players[["name", "team", "fantasy_points"]].rename(
        columns={"fantasy_points": "past_points"}
    )
    previous_players["past_points"] = pd.to_numeric(
        previous_players["past_points"], errors="raise"
    )

    daily_players = current_players[["name", "team", "fantasy_points"]].merge(
        previous_players, how="left", on=["name", "team"]
    )
    daily_players["past_points"] = daily_players["past_points"].fillna(0)
    daily_players["daily_points"] = (
        daily_players["fantasy_points"] - daily_players["past_points"]
    )
    daily_players.sort_values(
        by="daily_points", ascending=False
    ).to_json(output_path / f"{today_name}_daily.json", orient="records", indent=2)

    today_snapshot = snapshot_directory / f"{today_name}.csv"
    if current_time.hour == 9 and not today_snapshot.exists():
        current_players[["name", "team", "fantasy_points"]].to_csv(
            today_snapshot, index=False
        )
