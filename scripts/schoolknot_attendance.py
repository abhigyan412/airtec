#!/usr/bin/env python3
"""Extract a month of staff attendance from SchoolKnot into a CSV.

The SchoolKnot endpoint returns one day at a time, so this walks every date
in the requested month, posts the same request the browser makes, and
flattens all the days into a single CSV — one row per staff member per day.

Stdlib only; no pip install. Run it directly:

    ./scripts/schoolknot_attendance.py                 # last month, SC3102
    ./scripts/schoolknot_attendance.py --month 2026-08
    ./scripts/schoolknot_attendance.py --school SC3102 --month 2026-08 -o out.csv

Notes
-----
* The captured request carried no auth header — only a content-type and the
  browser's CORS headers. If SchoolKnot ever starts requiring a session
  cookie, pass it with --cookie "name=value; name2=value2" and it will be
  sent on every request.
* "present" here means a biometric punch exists for the day (in_time is set).
  status (1/2) in the payload is an employee *category*, not present/absent —
  plenty of status-2 rows have no punch — so it is copied through verbatim
  and not interpreted.
"""

from __future__ import annotations

import argparse
import calendar
import csv
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

URL = "https://analytics.schoolknot.com/staff_attendance/get_staff_attendance"

# The browser-managed pseudo-headers (:authority, sec-*, content-length,
# accept-encoding) are deliberately omitted — urllib sets what it needs and
# forwarding HTTP/2 pseudo-headers just errors.
BASE_HEADERS = {
    "content-type": "application/json",
    "accept": "application/json, text/plain, */*",
    "origin": "https://schoolknot.com",
    "referer": "https://schoolknot.com/",
    "user-agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
    ),
}

# Columns emitted, in order. Left = CSV header, right = key in the payload
# (None for derived columns filled in below).
COLUMNS = [
    ("date", None),
    ("reg_id", "reg_id"),
    ("biometric_id", "biometric_id"),
    ("name", "first_name"),
    ("present", None),                      # derived: in_time is set
    ("status", "status"),                   # employee category, passed through
    ("scheduled_login", "login_time"),
    ("scheduled_logout", "logout_time_of_emp"),
    ("in_time", "in_time"),
    ("out_time", "out_time"),
    ("worked", "diff"),
    ("late_login", "late_login_minutes"),
    ("early_logout", "early_logout_minutes"),
    ("remarks", "remarks"),
]


def parse_month(s: str) -> tuple[int, int]:
    """'2026-08' -> (2026, 8)."""
    try:
        y, m = s.split("-")
        year, month = int(y), int(m)
        if not 1 <= month <= 12:
            raise ValueError
        return year, month
    except ValueError:
        raise SystemExit(f"--month must look like YYYY-MM, got: {s!r}")


def last_month(today: date) -> tuple[int, int]:
    first_of_this = today.replace(day=1)
    prev = first_of_this - timedelta(days=1)
    return prev.year, prev.month


def days_in(year: int, month: int) -> list[date]:
    n = calendar.monthrange(year, month)[1]
    return [date(year, month, d) for d in range(1, n + 1)]


def fetch_day(school_id: str, day: date, cookie: str | None,
              timeout: float, retries: int) -> list[dict]:
    """POST for one day; return the list of staff rows (possibly empty)."""
    body = json.dumps({
        "school_id": school_id,
        "date": day.isoformat(),
        "status": "",
        "department": "",
    }).encode()

    headers = dict(BASE_HEADERS)
    if cookie:
        headers["cookie"] = cookie

    last_err = None
    for attempt in range(1, retries + 1):
        req = urllib.request.Request(URL, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                payload = json.loads(resp.read().decode())
            if payload.get("status") != "success":
                # A well-formed "not success" is not worth retrying.
                raise RuntimeError(f"endpoint returned status={payload.get('status')!r}")
            return payload.get("data") or []
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last_err = e
            if attempt < retries:
                time.sleep(1.5 * attempt)  # linear backoff between tries
    raise RuntimeError(f"{day}: giving up after {retries} attempts: {last_err}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Extract a month of SchoolKnot staff attendance to CSV.")
    ap.add_argument("--school", default="SC3102", help="school_id (default: SC3102)")
    ap.add_argument("--month", help="YYYY-MM (default: last calendar month)")
    ap.add_argument("-o", "--output", help="CSV path (default: schoolknot_attendance_<school>_<month>.csv)")
    ap.add_argument("--cookie", help="Cookie header value, if the endpoint needs a session")
    ap.add_argument("--delay", type=float, default=0.4, help="seconds between day requests (default: 0.4)")
    ap.add_argument("--timeout", type=float, default=30.0, help="per-request timeout seconds (default: 30)")
    ap.add_argument("--retries", type=int, default=3, help="attempts per day before giving up (default: 3)")
    args = ap.parse_args()

    year, month = parse_month(args.month) if args.month else last_month(date.today())
    out_path = args.output or f"schoolknot_attendance_{args.school}_{year:04d}-{month:02d}.csv"
    dates = days_in(year, month)

    print(f"School {args.school}  month {year:04d}-{month:02d}  ({len(dates)} days)  -> {out_path}",
          file=sys.stderr)

    total_rows = 0
    failed_days: list[str] = []
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow([col for col, _ in COLUMNS])

        for day in dates:
            try:
                rows = fetch_day(args.school, day, args.cookie, args.timeout, args.retries)
            except RuntimeError as e:
                print(f"  ! {e}", file=sys.stderr)
                failed_days.append(day.isoformat())
                continue

            punched = 0
            for r in rows:
                present = 1 if r.get("in_time") else 0
                punched += present
                out = []
                for col, key in COLUMNS:
                    if col == "date":
                        out.append(day.isoformat())
                    elif col == "present":
                        out.append(present)
                    else:
                        v = r.get(key)
                        # Trim the trailing whitespace SchoolKnot pads names with.
                        out.append(v.strip() if isinstance(v, str) else ("" if v is None else v))
                writer.writerow(out)
            total_rows += len(rows)
            print(f"  {day}  {len(rows):3d} staff, {punched:3d} punched in", file=sys.stderr)
            time.sleep(args.delay)

    print(f"\nDone: {total_rows} rows across {len(dates) - len(failed_days)}/{len(dates)} days -> {out_path}",
          file=sys.stderr)
    if failed_days:
        print(f"Days that failed (not in the CSV): {', '.join(failed_days)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
