import json
import tempfile
import unittest
import warnings
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

from daily_output_utils import write_daily_outputs


class DailyOutputTests(unittest.TestCase):
    def test_after_midnight_uses_cutoff_snapshot_for_all_previous_day_games(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            snapshots = output_directory / "cutoff-snapshots"
            snapshots.mkdir()
            pd.DataFrame(
                [
                    {"name": "Player One", "team": "Team A", "fantasy_points": 100},
                    {"name": "Player Two", "team": "Team B", "fantasy_points": 50},
                ]
            ).to_csv(snapshots / "2026-11-15.csv", index=False)
            players = pd.DataFrame(
                [
                    {"name": "Player One", "team": "Team A", "fantasy_points": 130},
                    {"name": "Player Two", "team": "Team B", "fantasy_points": 80},
                ]
            )

            write_daily_outputs(
                players,
                output_directory,
                datetime(2026, 11, 16, 2, 0, tzinfo=ZoneInfo("America/New_York")),
            )

            daily_players = json.loads(
                (output_directory / "2026-11-16_daily.json").read_text(
                    encoding="utf-8"
                )
            )
            daily_scores = {
                player["name"]: player["daily_points"] for player in daily_players
            }
            self.assertEqual(daily_scores, {"Player One": 30, "Player Two": 30})

    def test_missing_cutoff_snapshot_uses_dated_csv_with_warning(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            pd.DataFrame(
                [{"name": "Player One", "team": "Team A", "fantasy_points": 100}]
            ).to_csv(output_directory / "2026-11-15.csv", index=False)
            players = pd.DataFrame(
                [{"name": "Player One", "team": "Team A", "fantasy_points": 125}]
            )

            with warnings.catch_warnings(record=True) as caught_warnings:
                warnings.simplefilter("always")
                write_daily_outputs(
                    players,
                    output_directory,
                    datetime(
                        2026, 11, 16, 2, 0, tzinfo=ZoneInfo("America/New_York")
                    ),
                )

            self.assertEqual(len(caught_warnings), 1)
            self.assertIn("recovery baseline", str(caught_warnings[0].message))
            daily_players = json.loads(
                (output_directory / "2026-11-16_daily.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(daily_players[0]["daily_points"], 25)

    def test_missing_cutoff_snapshot_and_dated_csv_still_fails(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            players = pd.DataFrame(
                [{"name": "Player One", "team": "Team A", "fantasy_points": 125}]
            )

            with self.assertRaisesRegex(
                FileNotFoundError, "cutoff snapshot or dated stats CSV"
            ):
                write_daily_outputs(
                    players,
                    output_directory,
                    datetime(
                        2026, 11, 16, 2, 0, tzinfo=ZoneInfo("America/New_York")
                    ),
                )

            self.assertFalse((output_directory / "2026-11-16_daily.json").exists())

    def test_nine_am_snapshot_is_saved_even_if_previous_snapshot_is_missing(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            players = pd.DataFrame(
                [{"name": "Player One", "team": "Team A", "fantasy_points": 125}]
            )

            with self.assertRaises(FileNotFoundError):
                write_daily_outputs(
                    players,
                    output_directory,
                    datetime(
                        2026, 11, 16, 9, 30, tzinfo=ZoneInfo("America/New_York")
                    ),
                )

            snapshot = pd.read_csv(
                output_directory / "cutoff-snapshots" / "2026-11-16.csv"
            )
            self.assertEqual(snapshot.loc[0, "fantasy_points"], 125)

    def test_seven_am_uses_the_current_eastern_date_and_previous_cutoff(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            snapshots = output_directory / "cutoff-snapshots"
            snapshots.mkdir()
            pd.DataFrame(
                [{"name": "Player One", "team": "Team A", "fantasy_points": 100}]
            ).to_csv(snapshots / "2026-11-08.csv", index=False)
            players = pd.DataFrame(
                [{"name": "Player One", "team": "Team A", "fantasy_points": 125}]
            )

            seven_am_eastern = datetime(
                2026, 11, 9, 12, 0, tzinfo=timezone.utc
            )
            write_daily_outputs(players, output_directory, seven_am_eastern)

            self.assertTrue((output_directory / "2026-11-09_daily.json").exists())
            self.assertFalse((snapshots / "2026-11-09.csv").exists())
            daily_players = json.loads(
                (output_directory / "2026-11-09_daily.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(daily_players[0]["daily_points"], 25)

    def test_daily_scores_keep_the_previous_morning_baseline(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            snapshots = output_directory / "cutoff-snapshots"
            snapshots.mkdir()
            pd.DataFrame(
                [
                    {"name": "Player One", "team": "Team A", "fantasy_points": 100},
                    {"name": "Player Two", "team": "Team B", "fantasy_points": 40},
                ]
            ).to_csv(snapshots / "2026-11-08.csv", index=False)

            players = pd.DataFrame(
                [
                    {"name": "Player One", "team": "Team A", "fantasy_points": 130},
                    {"name": "Player Two", "team": "Team B", "fantasy_points": 55},
                ]
            )
            morning = datetime(2026, 11, 9, 14, 30, tzinfo=timezone.utc)
            write_daily_outputs(players, output_directory, morning)

            daily_path = output_directory / "2026-11-09_daily.json"
            daily_scores = {
                player["name"]: player["daily_points"]
                for player in json.loads(daily_path.read_text(encoding="utf-8"))
            }
            self.assertEqual(daily_scores, {"Player One": 30, "Player Two": 15})

            evening_players = players.copy()
            evening_players.loc[0, "fantasy_points"] = 145
            write_daily_outputs(
                evening_players,
                output_directory,
                datetime(2026, 11, 9, 21, 0, tzinfo=ZoneInfo("America/New_York")),
            )
            daily_scores = {
                player["name"]: player["daily_points"]
                for player in json.loads(daily_path.read_text(encoding="utf-8"))
            }
            self.assertEqual(daily_scores["Player One"], 45)

            morning_snapshot = pd.read_csv(snapshots / "2026-11-09.csv")
            self.assertEqual(morning_snapshot.loc[0, "fantasy_points"], 130)


if __name__ == "__main__":
    unittest.main()
