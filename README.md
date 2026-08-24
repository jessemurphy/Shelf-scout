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

## Hosting
GitHub Pages: deploy from branch `main`, root. The service worker is
network-first with a versioned cache (`sw.js`), so a push shows up on the
next open; the footer version marker confirms which copy you're running.
