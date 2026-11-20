from datetime import datetime, timedelta
from pathlib import Path
import warnings
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
    report_date = today if current_time.hour >= 9 else today - timedelta(days=1)
    today_name = today.isoformat()
    report_date_name = report_date.isoformat()

    output_path = Path(output_directory)
    output_path.mkdir(parents=True, exist_ok=True)
    current_players = players_df.copy()
    current_players["fantasy_points"] = pd.to_numeric(
        current_players["fantasy_points"], errors="raise"
    )

    snapshot_directory = output_path / "cutoff-snapshots"
    snapshot_directory.mkdir(exist_ok=True)
    today_snapshot = snapshot_directory / f"{today_name}.csv"
    if current_time.hour == 9 and not today_snapshot.exists():
        current_players[["name", "team", "fantasy_points"]].to_csv(
            today_snapshot, index=False
        )

    baseline_snapshot = snapshot_directory / f"{report_date_name}.csv"
    if not baseline_snapshot.exists():
        baseline_snapshot = output_path / f"{report_date_name}.csv"
        if not baseline_snapshot.exists():
            earlier_stats = []
            for candidate in output_path.glob("????-??-??.csv"):
                try:
                    candidate_date = datetime.strptime(
                        candidate.stem, "%Y-%m-%d"
                    ).date()
                except ValueError:
                    continue
                if candidate_date < report_date:
                    earlier_stats.append((candidate_date, candidate))
            if earlier_stats:
                baseline_snapshot = max(earlier_stats)[1]
            else:
                raise FileNotFoundError(
                    f"No 9 a.m. Eastern cutoff snapshot or dated stats CSV found "
                    f"for {report_date_name}"
                )
        warnings.warn(
            f"No 9 a.m. Eastern cutoff snapshot found for {report_date_name}; "
            f"using {baseline_snapshot} as a recovery baseline. Daily points "
            "may include games since that CSV.",
            RuntimeWarning,
            stacklevel=2,
        )

    previous_players = pd.read_csv(baseline_snapshot)
    previous_players = previous_players[["name", "team", "fantasy_points"]].rename(
        columns={"fantasy_points": "past_points"}
    )
    previous_players["past_points"] = pd.to_numeric(
        previous_players["past_points"], errors="raise"
    )
    report_snapshot = snapshot_directory / f"{report_date_name}.csv"
    if not report_snapshot.exists():
        previous_players.rename(columns={"past_points": "fantasy_points"}).to_csv(
            report_snapshot, index=False
        )

    current_players.to_csv(output_path / f"{report_date_name}.csv", index=False)
    daily_players = current_players[["name", "team", "fantasy_points"]].merge(
        previous_players, how="left", on=["name", "team"]
    )
    daily_players["past_points"] = daily_players["past_points"].fillna(0)
    daily_players["daily_points"] = (
        daily_players["fantasy_points"] - daily_players["past_points"]
    )
    daily_players.sort_values(
        by="daily_points", ascending=False
    ).to_json(
        output_path / f"{report_date_name}_daily.json", orient="records", indent=2
    )
