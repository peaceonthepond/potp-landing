# Peace on the Pond: Retreat Landing Page

The public landing page for Instagram and QR codes. Plain HTML, no setup needed.

- `index.html` is the page
- `corporate.html` is the corporate retreats and team offsites page, at `/corporate`
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

## Testimonials

Testimonials featured in the admin page (Operations > Feedback and
testimonials) rotate in the testimonial section, after Amanda's.

## Courses and shop

Footer links go to the courses page and shop on the proposals site. The
"Learn with us" section lists published courses automatically and stays
hidden when none are published.

## Copy (September 2026 Master Copy)

Page copy follows the Landing Page Master Copy & Implementation Guide:
primary button "Start Your Retreat Inquiry", secondary "Schedule a Private
Tour", capacity up to 30 day / up to 10 overnight, day retreats from $1,888,
overnight retreats by custom proposal (no public overnight rate), no exact
airport drive times. The testimonial section shows the placeholder quote only
until a testimonial is featured in the admin page (Operations > Feedback and
testimonials); featured ones show as "Name | Retreat | Role".

## Corporate page

`corporate.html` (at `/corporate`) presents the three corporate packages: The
Reset ($4,500 day), The Offsite ($6,500 day), and The Executive Retreat
(overnight, custom proposal, so there's still no public overnight rate). Its
buttons open `/call/?type=corporate` on the proposals site, which books a
corporate discovery call. If you change package prices in the proposals admin
defaults, update the prices on this page too. It's a separate page for a separate
audience: the main page doesn't link to it, and it doesn't link back. Share
its address directly: `https://corporate.peaceonthepond.com` once that
domain is added in Vercel (its home page redirects here; see `vercel.json`), or
`https://<your landing site>/corporate`.
