"""Google Play: store listing, graphics and the AAB as a release, through the Play Developer API.

    python apps/mobile/scripts/play-store-publish.py                     # everything
    python apps/mobile/scripts/play-store-publish.py listing images      # only some steps
    python apps/mobile/scripts/play-store-publish.py bundle --status completed

Steps: details (contact e-mail and site), listing (android/play/listing/<lang>),
images (icon, feature graphic, phone screenshots from play-store-compose.py),
bundle (the release AAB onto --track; the release is named after the pubspec
version and carries release_notes.txt). Everything goes into one edit, which is
committed at the end.

The release is a draft by default: it waits in Play Console until someone sends
it for review from Publishing overview. --status completed rolls it out as soon
as review passes. --hold commits with changesNotSentForReview, for apps with
managed publishing on; Play rejects it for an app that was never published.

Needs google-api-python-client and google-auth, and a service account invited
in Play Console (Users and permissions) with release rights, its JSON key at
PLAY_SERVICE_ACCOUNT (default ~/.takeaway/play/play-publisher.json). Set
PYTHONIOENCODING=utf-8 on Windows: the listing is Cyrillic.
"""
import argparse
import glob
import os
import re

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLAY = os.path.join(ROOT, "android", "play")
PACKAGE = "md.takeaway.app"
CONTACT_EMAIL = "help@takeaway.md"
CONTACT_WEBSITE = "https://takeaway.md"
STEPS = ("details", "listing", "images", "bundle")

parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("steps", nargs="*", help="any of %s; default: all" % ", ".join(STEPS))
parser.add_argument("--lang", default="ru-RU")
parser.add_argument("--track", default="production")
parser.add_argument("--status", default="draft", choices=("draft", "completed"))
parser.add_argument("--hold", action="store_true", help="commit with changesNotSentForReview")
parser.add_argument("--aab", default=os.path.join(ROOT, "build", "app", "outputs", "bundle", "release", "app-release.aab"))
parser.add_argument("--screens", default=os.path.join(ROOT, "build", "play-store-screenshots", "phone"))
parser.add_argument("--key", default=os.environ.get(
    "PLAY_SERVICE_ACCOUNT", os.path.join(os.path.expanduser("~"), ".takeaway", "play", "play-publisher.json")))
args = parser.parse_args()
steps = set(args.steps) or set(STEPS)
if steps - set(STEPS):
    parser.error("unknown step: %s" % ", ".join(sorted(steps - set(STEPS))))
listing_dir = os.path.join(PLAY, "listing", args.lang)


def text(name):
    with open(os.path.join(listing_dir, name), encoding="utf-8") as f:
        return f.read().strip()


def version_name():
    with open(os.path.join(ROOT, "pubspec.yaml"), encoding="utf-8") as f:
        return re.search(r"^version:\s*([^+\s]+)", f.read(), re.M).group(1)


creds = service_account.Credentials.from_service_account_file(
    args.key, scopes=["https://www.googleapis.com/auth/androidpublisher"])
edits = build("androidpublisher", "v3", credentials=creds, cache_discovery=False).edits()
edit_id = edits.insert(packageName=PACKAGE, body={}).execute()["id"]
print("edit", edit_id)

try:
    if "details" in steps:
        edits.details().update(packageName=PACKAGE, editId=edit_id, body={
            "defaultLanguage": args.lang,
            "contactEmail": CONTACT_EMAIL,
            "contactWebsite": CONTACT_WEBSITE,
        }).execute()
        print("details")

    if "listing" in steps:
        body = {
            "language": args.lang,
            "title": text("title.txt"),
            "shortDescription": text("short_description.txt"),
            "fullDescription": text("full_description.txt"),
        }
        edits.listings().update(packageName=PACKAGE, editId=edit_id, language=args.lang, body=body).execute()
        print("listing", {k: len(v) for k, v in body.items() if k != "language"})

    if "images" in steps:
        images = edits.images()
        shots = sorted(glob.glob(os.path.join(args.screens, "*.png")))
        if not shots:
            raise SystemExit("no screenshots in %s: run play-store-screenshots.sh and play-store-compose.py" % args.screens)
        for kind, name in (("icon", "icon-512.png"), ("featureGraphic", "feature-1024x500.png")):
            images.deleteall(packageName=PACKAGE, editId=edit_id, language=args.lang, imageType=kind).execute()
            images.upload(packageName=PACKAGE, editId=edit_id, language=args.lang, imageType=kind,
                          media_body=MediaFileUpload(os.path.join(PLAY, "images", name), mimetype="image/png")).execute()
            print("image", kind)
        images.deleteall(packageName=PACKAGE, editId=edit_id, language=args.lang, imageType="phoneScreenshots").execute()
        for path in shots:
            images.upload(packageName=PACKAGE, editId=edit_id, language=args.lang, imageType="phoneScreenshots",
                          media_body=MediaFileUpload(path, mimetype="image/png")).execute()
            print("screenshot", os.path.basename(path))

    if "bundle" in steps:
        request = edits.bundles().upload(packageName=PACKAGE, editId=edit_id, media_body=MediaFileUpload(
            args.aab, mimetype="application/octet-stream", resumable=True, chunksize=8 * 1024 * 1024))
        response = None
        while response is None:
            progress, response = request.next_chunk()
            if progress:
                print("upload %d%%" % int(progress.progress() * 100))
        code = response["versionCode"]
        name = version_name()
        edits.tracks().update(packageName=PACKAGE, editId=edit_id, track=args.track, body={
            "track": args.track,
            "releases": [{
                "name": name,
                "versionCodes": [str(code)],
                "status": args.status,
                "releaseNotes": [{"language": args.lang, "text": text("release_notes.txt")}],
            }],
        }).execute()
        print("release", name, "versionCode", code, "->", args.track, args.status)

    commit = {"changesNotSentForReview": True} if args.hold else {}
    print("committed", edits.commit(packageName=PACKAGE, editId=edit_id, **commit).execute()["id"])
except BaseException:
    # Drop the half-done edit; nothing in it reaches Play without the commit.
    try:
        edits.delete(packageName=PACKAGE, editId=edit_id).execute()
    except Exception:
        pass
    raise
