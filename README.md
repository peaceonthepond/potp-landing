# Peace on the Pond: Retreat Landing Page

The public landing page for Instagram and QR codes. Plain HTML, no setup needed.

- `index.html` is the page
- `media/` holds the video, photos, and logos

## Put it on Vercel

1. On GitHub, make a new repository (Public or Private both work), for example
   `potp-landing`, and upload everything in this folder.
2. In Vercel: Add New > Project > Import `potp-landing` > Deploy.

## Update it later

Replace a file on GitHub (for example a photo in `media/` with the same
name) and Vercel updates the site automatically.

## Private tours

The "Book a private tour" buttons open the tour request page on your proposals
site (`PROPOSALS_SITE` + `/tour/`). Requests appear in your admin page.

## Events and contact links

Events, the phone number, and the pre-booking form link are managed in your
proposals admin page (Landing page events). This page loads them from the
proposals site. If your proposals site's address is not
`https://potp-proposals.vercel.app`, edit the line near the bottom of
`index.html` that starts with `const PROPOSALS_SITE =` and put your
proposals site's address between the quotes.
