#!/usr/bin/env python3
"""Google Search Console diagnostic script for https://narrax.fun.

Checks:
  1. URL Inspection API (`urlInspection().index().inspect()`) for homepage indexing/crawl status.
  2. Sitemaps API (`sitemaps().list()`) for sitemap read status, warnings, and errors.

Install dependencies:
  pip install google-api-python-client google-auth

Usage:
  set GOOGLE_APPLICATION_CREDENTIALS=C:\\path\\to\\narrax-gsc-sa.json
  python scripts/gsc-inspect.py

  # Or pass flags explicitly:
  python scripts/gsc-inspect.py --credentials C:\\path\\to\\narrax-gsc-sa.json --site-url sc-domain:narrax.fun --inspect-url https://narrax.fun/
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SCOPES = ["https://www.googleapis.com/auth/webmasters"]


def build_client(credentials_path: str):
    path = Path(credentials_path)
    if not path.is_file():
        sys.exit(f"Credentials file not found: {path}")
    creds = service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)
    return build("searchconsole", "v1", credentials=creds, cache_discovery=False)


def resolve_site_url(service, requested_site_url: str | None) -> str:
    sites_resp = service.sites().list().execute()
    entries = sites_resp.get("siteEntry", [])
    available = [entry.get("siteUrl") for entry in entries if entry.get("siteUrl")]

    if requested_site_url:
        if available and requested_site_url not in available:
            print(
                f"Warning: '{requested_site_url}' was not found in accessible GSC properties: {available}",
                file=sys.stderr,
            )
        return requested_site_url

    for candidate in ("sc-domain:narrax.fun", "https://narrax.fun/"):
        if candidate in available:
            return candidate

    if available:
        return available[0]

    sys.exit(
        "No GSC properties accessible to this service account. "
        "Verify the service account email is added to narrax.fun in Google Search Console."
    )


def inspect_homepage(service, site_url: str, inspect_url: str) -> dict:
    body = {
        "inspectionUrl": inspect_url,
        "siteUrl": site_url,
        "languageCode": "en-US",
    }
    response = service.urlInspection().index().inspect(body=body).execute()
    result = response.get("inspectionResult", {})
    index_status = result.get("indexStatusResult", {})

    summary = {
        "siteUrl": site_url,
        "inspectionUrl": inspect_url,
        "verdict": index_status.get("verdict"),
        "coverageState": index_status.get("coverageState"),
        "robotsTxtState": index_status.get("robotsTxtState"),
        "indexingState": index_status.get("indexingState"),
        "pageFetchState": index_status.get("pageFetchState"),
        "lastCrawlTime": index_status.get("lastCrawlTime"),
        "crawledAs": index_status.get("crawledAs"),
        "googleCanonical": index_status.get("googleCanonical"),
        "userCanonical": index_status.get("userCanonical"),
        "referringUrls": index_status.get("referringUrls", []),
        "sitemap": index_status.get("sitemap", []),
    }
    return {"summary": summary, "raw": result}


def list_sitemaps(service, site_url: str) -> list[dict]:
    response = service.sitemaps().list(siteUrl=site_url).execute()
    sitemaps = response.get("sitemap", [])
    return [
        {
            "path": sm.get("path"),
            "type": sm.get("type"),
            "lastSubmitted": sm.get("lastSubmitted"),
            "lastDownloaded": sm.get("lastDownloaded"),
            "isPending": sm.get("isPending"),
            "isSitemapsIndex": sm.get("isSitemapsIndex"),
            "warnings": sm.get("warnings"),
            "errors": sm.get("errors"),
            "contents": sm.get("contents", []),
        }
        for sm in sitemaps
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect narrax.fun indexing & sitemaps via GSC API.")
    parser.add_argument(
        "--credentials",
        default=os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", ""),
        help="Path to Google Cloud Service Account JSON key (defaults to GOOGLE_APPLICATION_CREDENTIALS).",
    )
    parser.add_argument(
        "--site-url",
        default=None,
        help="GSC property identifier (e.g. 'sc-domain:narrax.fun' or 'https://narrax.fun/'). Auto-detected if omitted.",
    )
    parser.add_argument(
        "--inspect-url",
        default="https://narrax.fun/",
        help="Exact URL to inspect (default: https://narrax.fun/).",
    )
    parser.add_argument(
        "--submit-sitemap",
        default=None,
        help="Submit a sitemap URL to GSC before listing sitemaps (e.g. https://narrax.fun/sitemap.xml).",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Include full raw inspectionResult payload in output.",
    )
    args = parser.parse_args()

    if not args.credentials:
        sys.exit(
            "Missing credentials path. Set GOOGLE_APPLICATION_CREDENTIALS or pass --credentials C:\\path\\to\\key.json"
        )

    service = build_client(args.credentials)

    try:
        site_url = resolve_site_url(service, args.site_url)
        submitted_sitemap = None
        if args.submit_sitemap:
            service.sitemaps().submit(siteUrl=site_url, feedpath=args.submit_sitemap).execute()
            submitted_sitemap = args.submit_sitemap
        inspection = inspect_homepage(service, site_url, args.inspect_url)
        sitemaps = list_sitemaps(service, site_url)
    except HttpError as err:
        sys.exit(f"GSC API error ({err.status_code}): {err.error_details or err}")

    output = {
        "property": site_url,
        **({"submittedSitemap": submitted_sitemap} if submitted_sitemap else {}),
        "urlInspection": inspection["raw"] if args.raw else inspection["summary"],
        "sitemaps": sitemaps,
    }
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
