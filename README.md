# Shelf Scout

Standing in a bookstore: does the house already have this?

A tiny installable PWA. **Books**: scan the ISBN barcode (camera, works on
iPhone via a vendored ZXing decoder) or search by title. **Movies**: search
by title. Results check the family collection on familynet — who's read it,
who rated it what — and anything can be kept on a local wishlist.

- Collection checks call familynet's read-only `GET /books/api/scout` and
  `GET /movies/api/scout` (same X-Api-Key device token as Waypoint), set
  under ⚙︎. Without them the wishlist still works offline.
- Book metadata for unknown barcodes comes from Google Books client-side.
- The wishlist never leaves the device.
- **Read / Watched** logs it under the name in ⚙︎ at the score you tap, via
  `POST /{books,movies}/api/scout_add`. The rating sheet also takes an
  optional note, sent as `comment`: familynet turns it into a real comment on
  that title's thread, so it appears on the title's page and in the family's
  Recent activity. The field sits above the number grid because tapping a
  number is what closes the sheet, and it is cleared on every open so one
  book's note can never follow the next one. Blank sends no `comment` key at
  all. familynet dedupes an identical note on the same title from the same
  person, so a retried write cannot post it twice.

## Hosting
GitHub Pages: deploy from branch `main`, root. The service worker is
network-first with a versioned cache (`sw.js`), so a push shows up on the
next open; the footer version marker confirms which copy you're running.
