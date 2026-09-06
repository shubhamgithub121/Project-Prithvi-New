import os
import time
import threading
import logging

import requests

from db.supabase import client as supabase

logger = logging.getLogger(__name__)

BLOG_SYNC_INTERVAL = int(os.environ.get("BLOG_SYNC_INTERVAL", 900))
BLOG_SOURCE_URL = os.environ.get(
    "BLOG_SOURCE_URL", "https://dev.to/api/articles?tag=environment&per_page=6"
)
DEFAULT_BLOG_IMAGE = "https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?auto=format&fit=crop&q=80"


def sync_blogs_once() -> None:
    try:
        resp = requests.get(BLOG_SOURCE_URL, timeout=10)
        resp.raise_for_status()
        articles = resp.json()
    except Exception as e:
        logger.error(f"Failed to fetch blog articles: {e}")
        return

    rows = [
        {
            "id": article["id"],
            "title": article.get("title", ""),
            "url": article.get("url", ""),
            "image": article.get("cover_image") or article.get("social_image") or DEFAULT_BLOG_IMAGE,
            "excerpt": article.get("description") or "",
            "created_at": article.get("published_at") or article.get("created_at"),
        }
        for article in articles
        if article.get("id") is not None
    ]

    if not rows:
        return

    try:
        supabase.table("blogs").upsert(rows).execute()
    except Exception as e:
        logger.error(f"Failed to upsert blog articles: {e}")


def blog_sync_loop() -> None:
    logger.info("Starting blog sync poller loop...")
    while True:
        sync_blogs_once()
        time.sleep(BLOG_SYNC_INTERVAL)


def start_blog_sync_poller() -> None:
    # blog_sync_loop() syncs immediately on entry (before its first sleep),
    # so the table won't sit empty on a cold start.
    threading.Thread(target=blog_sync_loop, daemon=True).start()
