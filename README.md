# Peace on the Pond: Client Proposal Pages

Code-protected proposal pages with an enhancements cart and individual
group payments through Stripe. Built to deploy on Vercel as-is (no build step,
no npm install).

## How it works

- Guests visit the site and enter an access code. The code is checked on the
  server (`/api/unlock`), and the proposal is only sent to the browser after
  the code matches.
- Each proposal lives in its own file in `data/proposals/`. That folder is not
  public; only the server functions can read it.
- Guests pick what to pay (a share of the retainer, a full share, the full
  retainer, the balance, or any amount) and can add enhancements. Prices are
  recalculated on the server, so they can't be changed in the browser.
- Payment happens on Stripe's hosted checkout. Klarna, Afterpay, and Affirm
  appear automatically when they're turned on in your Stripe Dashboard and the
  amount qualifies.
- The "Paid toward the retreat" bar pulls live totals from Stripe
  (`/api/status`). No database needed.

## Deploy to Vercel

1. Create a new GitHub repository and upload everything in this folder.
2. In Vercel, click **Add New > Project**, import the repository, and click
   **Deploy**. Leave the framework preset as **Other**.
3. Add your Stripe key: **Project > Settings > Environment Variables**
   - Name: `STRIPE_SECRET_KEY`
   - Value: your secret key from Stripe (Developers > API keys). Start with the
     test key (`sk_test_...`), then switch to the live key (`sk_live_...`).
4. Redeploy (Deployments > ... > Redeploy) so the key takes effect.

Until the key is added, the page works fully except the pay button, which
shows a "payments open soon" message with your phone and email.

Alternative without GitHub: install Node.js, open a terminal in this folder,
and run `npx vercel`, then `npx vercel --prod`.

## Turn on Klarna, Afterpay, and Affirm

Stripe Dashboard > Settings > Payment methods. Turn on the ones you want.
No code changes needed. Each has its own amount limits, so splitting the
retreat into individual shares makes more guests eligible.

## Admin page (create proposals without GitHub)

Go to `/admin` on your site (for example `proposals.peaceonthepond.com/admin`).

One-time setup:
1. **Password:** Vercel > your project > Settings > Environment Variables.
   Add `ADMIN_PASSWORD` with a strong password only you know.
2. **Database:** Vercel > your project > Storage > Create Database >
   Upstash for Redis (free plan) > connect it to this project. Vercel adds the
   connection details for you.
3. Redeploy (Deployments > ... > Redeploy).

Then, for each client: New proposal > fill in the form > Publish. You get the
access code and a ready-to-send message. From the Proposals list you can view
any proposal as the client sees it, edit it, duplicate it for a new client,
close it (its code stops working), or delete it. Payments per proposal show
when Stripe is connected.

A link like `https://yoursite/?code=RISE42` opens a proposal directly without
typing the code.

Standard text (letter, inclusions, terms, default rate, retainer %) comes from
`data/defaults.json`. Edit that file in GitHub to change what new proposals
start with.

## Home, status, and follow-up

The admin page opens on **Home**: client questions, discovery calls this week,
balances due in the next 30 days (with a one-click reminder email), proposals
waiting on a response, and upcoming confirmed retreats.

Each proposal shows a status that updates on its own: Draft, Sent (when you
use the Email button, or Mark as sent), Viewed (the first time the client opens
it; your own View as client doesn't count), Accepted, Retainer paid, and Paid
in full. Open a proposal to see its **Activity**: views, acceptance, questions,
and payments. Record checks, Zelle, cash, or transfers there under **Record a
payment received outside Stripe**; they count toward totals and progress bars.

Clients can **Accept** their proposal (typed name plus agreeing to the terms,
organizer code only) and **Ask a question** from their proposal page.

## Booking discovery calls and tours (your hours)

- **Discovery calls:** clients book an open time at `/call/`. A discovery record
  is created automatically (marked "booked online"), shows on Home, Calendar,
  and Outlook, and the confirmation screen links to the client's prep form.
- **Tours:** clients choose up to three open times at `/tour/`; you confirm.
- Your hours, call length (30 minutes), tour length (60 minutes), minimum
  notice (24 hours), and how far ahead people can book (45 days) are in
  `data/availability.json`. Times already taken by a call or confirmed tour
  are hidden, and tours are never offered on booked retreat days.
- To send landing page buttons to call booking: admin > Landing page events >
  Contact links > **Use my call booking page** > Save.

## Calendar, tours, and Outlook

**Calendar** shows booked retreats (added automatically once the retainer is
paid, online or offline), proposed retreats not yet paid, discovery calls, and
private tours. Click anything to open it.

**Private tours:** clients suggest up to three times at `/tour/` (linked from
their proposal and from the discovery record's Email tour invite button). Dates
during booked retreats can't be chosen. Review requests on Home or Calendar,
pick a time, and Confirm; a confirmation email opens ready to send. You can
also add a tour yourself with Add a tour.

**Outlook:** on the Calendar tab, click Copy calendar link, then in Outlook.com
go to Calendar > Add calendar > Subscribe from web and paste it. It's one-way
(admin to Outlook) and Outlook refreshes it every few hours. Keep the link
private; Make a new link replaces it if needed.

The proposal editor warns you if new dates overlap a booked retreat.

## Discovery calls

In the admin page, **Discovery calls** holds a record for each call:
contact, retreat details, intention, food and dietary needs, look and feel,
experiences, logistics, and open notes. Everything saves as you type.

- **Prep form:** each record has its own private link (Copy prep form link or
  Email prep form). The client's answers fill any blank fields and appear in a
  banner at the top of the record.
- **Transcript:** paste your note taker's transcript or summary into the box on the right to keep it with the record.
- **Hospitality sheet:** a printable one-page summary for your team, with
  dietary needs and accessibility called out at the top.
- **Create proposal:** starts a proposal with the client's details, a "What we
  heard from you" recap, and suggested enhancements already filled in. The
  record's status changes to Proposal sent when you publish.

The questions themselves live in `data/discovery-schema.json`.

## How a proposal is paid

In the admin page, under Payment terms, choose **How is this retreat paid?**

- **One payer covers the full cost** (the default): the organizer pays the
  retainer, the balance, the full amount, or any amount. No shares and no
  guest code.
- **Split between several people**: for birthdays, co-facilitators, or
  groups paying their own way. Set how many ways it splits. Each person can
  pay their share, and a guest code is created.

## Organizer and guest codes (split proposals)

Every proposal has two codes. The organizer code shows everything. The guest
code shows the retreat and total, and lets each guest pay their full share or
any amount up to it, without the retainer, balance, or payment progress.
Both are set in the admin page.

## Emailing a proposal

Add the client's email in the admin form (it stays private). After you
publish, click **Open in my email**, or use **Email** on the Proposals list
any time. Your own email app opens with the message written; review it and
send.

## Partner lodging

In the admin page, each proposal has an optional **Partner lodging** section.
Add a partner's name, location, description, price, and booking link. Guests
see a "Where you'll stay" section where they can book on the partner's site,
pay through Peace on the Pond (if you allow it), or both. Lodging payments are
labeled in Stripe with a separate lodging amount.

## Landing page events and contact links

In the admin page, open **Landing page events** to add, edit, or delete the
events shown on your landing page, and to change the phone number and
pre-booking form link its buttons use. Events hide themselves after their
date passes. The landing page reads them from `/api/events` on this site.

## Add a proposal as a file (optional)

1. Copy `data/proposals/peacock-55.json` to a new file, e.g.
   `data/proposals/smith-wellness.json`.
2. Change `id` (must be unique), `accessCode` (must be unique), and the
   client, retreat, package, payment, and terms details.
3. Commit the file. Vercel redeploys automatically.

To close a proposal, set `"active": false`.
To hide who has paid from the group, set `"showPayerNames": false`.

## Edit enhancements and prices

All enhancements, intentions (Restore, Reflect, Connect, Lead, Dining,
Support), and pairings are in `data/catalog.json`.

- `"unit": "session"` is a flat group price (can be paid in full or split)
- `"unit": "person"` is priced per guest
- `"unit": "hour"` is priced per hour (`"min"` sets the minimum)
- `"price": null` shows "Ask about this"; those requests are attached to the
  guest's payment in Stripe (see the payment's metadata) or sent by email

An enhancement listed under a proposal's `includedEnhancements` (by
`catalogId`) shows as "Included in your package" and can't be charged.

## Where to see payments

Stripe Dashboard > Payments. Each payment shows the guest's name, the proposal
id, the retreat and enhancement amounts, and any "ask about" requests in its
metadata.

## Files

- `public/` the page (index.html, styles.css, app.js, media/)
- `api/unlock.js` checks the access code
- `api/checkout.js` creates the Stripe checkout
- `api/status.js` totals payments for the progress bar
- `api/events.js` public list of upcoming events for the landing page
- `api/call.js` discovery call booking
- `public/call/` the call booking page
- `data/availability.json` your hours for calls and tours
- `api/tour.js` private tour requests
- `api/calendar.js` the private calendar feed for Outlook
- `public/tour/` the tour request page
- `api/accept.js` records a client accepting their proposal
- `api/question.js` saves client questions
- `api/prep.js` the client prep form's questions and answers
- `public/prep/` the client prep form page
- `public/admin/sheet.html` the printable hospitality sheet
- `api/admin.js` the admin page's sign-in, save, list, close, and delete
- `public/admin/` the admin page
- `data/` file proposals, the enhancements catalog, and admin defaults (private)
