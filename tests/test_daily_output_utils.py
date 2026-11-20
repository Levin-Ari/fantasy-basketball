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
                (output_directory / "2026-11-15_daily.json").read_text(
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
                (output_directory / "2026-11-15_daily.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(daily_players[0]["daily_points"], 25)

    def test_missing_cutoff_snapshot_recovers_from_latest_earlier_csv(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            for date, points in (("2026-11-17", 80), ("2026-11-18", 100)):
                pd.DataFrame(
                    [
                        {
                            "name": "Player One",
                            "team": "Team A",
                            "fantasy_points": points,
                        }
                    ]
                ).to_csv(output_directory / f"{date}.csv", index=False)
            players = pd.DataFrame(
                [{"name": "Player One", "team": "Team A", "fantasy_points": 130}]
            )
            afternoon = datetime(
                2026, 11, 19, 13, 0, tzinfo=ZoneInfo("America/New_York")
            )

            with warnings.catch_warnings(record=True) as caught_warnings:
                warnings.simplefilter("always")
                write_daily_outputs(players, output_directory, afternoon)

            self.assertEqual(len(caught_warnings), 1)
            self.assertIn("recovery baseline", str(caught_warnings[0].message))
            snapshot = output_directory / "cutoff-snapshots" / "2026-11-19.csv"
            self.assertEqual(pd.read_csv(snapshot).loc[0, "fantasy_points"], 100)
            daily_path = output_directory / "2026-11-19_daily.json"
            daily_players = json.loads(daily_path.read_text(encoding="utf-8"))
            self.assertEqual(daily_players[0]["daily_points"], 30)

            later_players = players.copy()
            later_players.loc[0, "fantasy_points"] = 140
            write_daily_outputs(
                later_players,
                output_directory,
                datetime(
                    2026, 11, 19, 18, 0, tzinfo=ZoneInfo("America/New_York")
                ),
            )

            self.assertEqual(pd.read_csv(snapshot).loc[0, "fantasy_points"], 100)
            daily_players = json.loads(daily_path.read_text(encoding="utf-8"))
            self.assertEqual(daily_players[0]["daily_points"], 40)

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

            self.assertFalse((output_directory / "2026-11-15_daily.json").exists())

    def test_nine_am_snapshot_becomes_current_days_baseline(self):
        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            players = pd.DataFrame(
                [{"name": "Player One", "team": "Team A", "fantasy_points": 125}]
            )

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
            daily_players = json.loads(
                (output_directory / "2026-11-16_daily.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(daily_players[0]["daily_points"], 0)

    def test_nine_am_cutoff_uses_utc_timestamps_in_both_dst_offsets(self):
        for utc_time, report_date in (
            (datetime(2026, 7, 15, 13, 0, tzinfo=timezone.utc), "2026-07-15"),
            (datetime(2026, 11, 16, 14, 0, tzinfo=timezone.utc), "2026-11-16"),
        ):
            with self.subTest(report_date=report_date):
                with tempfile.TemporaryDirectory() as temporary_directory:
                    output_directory = Path(temporary_directory)
                    players = pd.DataFrame(
                        [
                            {
                                "name": "Player One",
                                "team": "Team A",
                                "fantasy_points": 125,
                            }
                        ]
                    )

                    write_daily_outputs(players, output_directory, utc_time)

                    snapshot = pd.read_csv(
                        output_directory
                        / "cutoff-snapshots"
                        / f"{report_date}.csv"
                    )
                    self.assertEqual(snapshot.loc[0, "fantasy_points"], 125)
                    self.assertTrue(
                        (output_directory / f"{report_date}_daily.json").exists()
                    )

    def test_seven_am_updates_the_previous_eastern_date(self):
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

            self.assertTrue((output_directory / "2026-11-08_daily.json").exists())
            self.assertFalse((output_directory / "2026-11-09_daily.json").exists())
            self.assertFalse((snapshots / "2026-11-09.csv").exists())
            daily_players = json.loads(
                (output_directory / "2026-11-08_daily.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(daily_players[0]["daily_points"], 25)

    def test_report_date_switches_at_nine_am_eastern(self):
        players = pd.DataFrame(
            [{"name": "Player One", "team": "Team A", "fantasy_points": 125}]
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)
            snapshots = output_directory / "cutoff-snapshots"
            snapshots.mkdir()
            pd.DataFrame(
                [{"name": "Player One", "team": "Team A", "fantasy_points": 100}]
            ).to_csv(snapshots / "2026-11-15.csv", index=False)

            write_daily_outputs(
                players,
                output_directory,
                datetime(2026, 11, 16, 13, 59, tzinfo=timezone.utc),
            )

            self.assertTrue((output_directory / "2026-11-15_daily.json").exists())
            self.assertFalse((output_directory / "2026-11-16_daily.json").exists())

        with tempfile.TemporaryDirectory() as temporary_directory:
            output_directory = Path(temporary_directory)

            write_daily_outputs(
                players,
                output_directory,
                datetime(2026, 11, 16, 14, 0, tzinfo=timezone.utc),
            )

            self.assertFalse((output_directory / "2026-11-15_daily.json").exists())
            self.assertTrue((output_directory / "2026-11-16_daily.json").exists())

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
            ).to_csv(snapshots / "2026-11-09.csv", index=False)

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
            self.assertEqual(morning_snapshot.loc[0, "fantasy_points"], 100)


if __name__ == "__main__":
    unittest.main()
