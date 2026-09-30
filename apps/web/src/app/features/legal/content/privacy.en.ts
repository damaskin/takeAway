import type { LegalDocument } from '../legal-document';

export const PRIVACY_EN: LegalDocument = {
  title: 'Privacy Policy',
  description:
    'What data takeAway receives when you order coffee and food, why it is needed, who it is shared with and how to delete your account.',
  effective: 'Effective 28 September 2026',
  toc: true,
  sections: [
    {
      blocks: [
        'takeAway is a service for pre-ordering coffee and food from partner coffee shops, cafés and other businesses. This policy explains what data we receive when you use the takeaway.md website, the Telegram Mini App and the iOS and Android apps, why we need it, who we share it with and how to delete it.',
        'In short: we collect only what we need to take, charge and hand over your order. We do not sell data, show ads or embed advertising trackers.',
      ],
    },
    {
      id: 'operator',
      heading: '1. Who is responsible for your data',
      blocks: [
        'The service is operated by individual developer **Ivan Damaschin**, Republic of Moldova, who is the controller of your personal data.',
        'For any question about your data, including exercising your rights, write to [help@takeaway.md](mailto:help@takeaway.md).',
      ],
    },
    {
      id: 'data',
      heading: '2. What data we receive',
      blocks: ['What exactly we receive depends on how you use the service.'],
    },
    {
      id: 'account',
      level: 3,
      heading: 'Account and sign-in',
      blocks: [
        'takeAway customers have no passwords — you sign in with Telegram, Google or Apple:',
        {
          list: [
            '**Telegram** sends us your Telegram ID, name, username and a link to your profile photo. We keep the Telegram ID, the name and the language to show the service in. We do not store the username or the photo.',
            '**Google** sends your account identifier, name and email address.',
            '**Apple** sends an identifier, an email address and — only on your first sign-in — your name. If you choose Hide My Email, we receive only an Apple relay address and never learn your real one.',
          ],
        },
        'Each time you sign in we record the device: its type (iOS, Android, browser or Telegram), language and the time of sign-in.',
      ],
    },
    {
      id: 'profile',
      level: 3,
      heading: 'Profile',
      blocks: [
        'If you wish, you can add your name, email, phone number and date of birth to your profile and choose the language of the service. We do not upload or store profile photos.',
      ],
    },
    {
      id: 'orders',
      level: 3,
      heading: 'Orders',
      blocks: [
        {
          list: [
            'what you ordered and where: items with the options and comments you chose, the store, how you receive the order and the time it should be ready;',
            'the order code and pickup QR code, amounts, discounts, promo codes, points and gift cards used;',
            'order statuses and when they changed, plus the "customer nearby" and "I\'m here" marks — see [Location](/privacy#location);',
            'the name for handing over the order (your profile name by default) and a phone number if you entered one at checkout;',
            'for delivery, where the business offers it — the address, the coordinates of the delivery point and a note for the courier;',
            'your cart, until you place the order.',
          ],
        },
      ],
    },
    {
      id: 'location',
      level: 3,
      heading: 'Location',
      blocks: [
        'Location access is optional: you can choose a store, order and pick up without it. We ask for your location only while the app or a page of the website is open, never in the background.',
        {
          list: [
            '**Stores nearby.** In the iOS and Android apps the distance to stores is calculated on your device — no coordinates are sent to our server for it. On the website, if you ask to see the nearest stores, your coordinates are sent to the server once for the search and are not saved to your profile or orders.',
            '**"I\'m here".** While an order is active and its screen is open, the iOS and Android app — only if you have already allowed location access — sends your coordinates to our server about once a minute. The server compares them with the store\'s location and keeps no route, only up to two marks per order: "customer nearby" (within 300 m) and "customer here" (within 60 m, or once you tap "I\'m here"). Each mark is saved with the coordinates and distance at that moment; other coordinates are not saved. On the website and in Telegram, coordinates are sent only when you tap "I\'m here". The button also works without location access.',
            '**Delivery.** If you use your location to fill in a delivery address, the coordinates are sent to the server to calculate the delivery fee and saved in the order as the delivery address.',
          ],
        },
        'The business sees the "nearby" or "here" mark and the distance to the store, not your movements. You can turn location access off at any time in your phone or browser settings.',
      ],
    },
    {
      id: 'notifications',
      level: 3,
      heading: 'Notifications and emails',
      blocks: [
        "If you allow notifications, we store your device's push token (Firebase Cloud Messaging or Apple Push Notification service) or your browser's web-push subscription. If you sign in with Telegram, our bot [@takaway_tgbot](https://t.me/takaway_tgbot) may send you order updates.",
        'If your profile has an email address, you receive a receipt after each paid order and a welcome email after your first one. Offers from businesses you have ordered from arrive only until you turn promotions off in your notification settings.',
        'You choose which notifications to get in your profile, under Notifications.',
      ],
    },
    {
      id: 'payments',
      level: 3,
      heading: 'Payments',
      blocks: [
        'Card payments are processed by the bank **ZAO "Agroprombank"**. Your full card number is never sent to or stored by takeAway.',
        'To link a card, you enter its last four digits, the issuing bank and your phone number, to which the bank texts a one-time code. Once you confirm it, the bank issues a card token. We store the token encrypted, together with the masked card number (only the last digits are visible), the masked cardholder name and the name you gave the card. You can remove a card in your profile under Payment methods.',
        "For each payment we keep the amount, currency, status, the card it was made with and the bank's operation identifiers.",
      ],
    },
    {
      id: 'rewards',
      level: 3,
      heading: 'Points, referrals, gift cards and promo codes',
      blocks: [
        {
          list: [
            'your loyalty balance and tier, and the history of points earned and spent;',
            'your referral code, who invited you and whom you invited, and the bonuses credited for it;',
            'the gift card and promo codes you applied, and the amounts taken from gift cards.',
          ],
        },
      ],
    },
    {
      id: 'technical',
      level: 3,
      heading: 'Technical data',
      blocks: [
        'Our servers keep technical request logs: time, requested address, IP address, browser or app type and the result of the request. Account access keys are not written to the logs. Service errors go to the same logs, with technical details of the failure and no payment data.',
        'If you allowed sharing diagnostics with developers in your phone settings, Apple or Google pass us anonymised app crash reports.',
        "The website uses no advertising or analytics cookies. Your browser keeps only what signs you in and the language you chose, plus the site's own files so it works offline.",
      ],
    },
    {
      id: 'purposes',
      heading: '3. Why we use data',
      blocks: [
        {
          list: [
            '**To fulfil your order:** pass it to the business, take payment, show its status and ready time, tell you when it is ready and hand it over.',
            '**To run your account:** sign-in, profile, order history, saved cards, points and referrals.',
            '**To send the notifications and emails** you allowed.',
            '**To help you:** answer your requests and sort out cancellations and refunds.',
            '**To keep the service reliable and secure:** protect accounts and payments from abuse, find and fix errors.',
            '**To meet legal requirements,** such as keeping payment records for accounting.',
          ],
        },
        'We process data because it is needed to perform our contract with you (your orders and account), with your consent (location, notifications and promotional messages — you can withdraw it at any time), in our legitimate interests (security and fixing errors), or because the law requires it.',
        "We do not sell data, use it for advertising, track you across other companies' apps and websites, or embed third-party advertising SDKs.",
      ],
    },
    {
      id: 'sharing',
      heading: '4. Who we share data with',
      blocks: [
        'Only with those the service cannot work without, and only as much as they need:',
        {
          list: [
            '**The business you order from** — the name for handing over the order, the order contents, pickup time, comments, status and the "nearby" or "here" mark with the distance to the store. In the order details the business also sees your phone number and email if you have them, and the address for delivery. If the business has connected its own point-of-sale system (such as Poster or iiko), the order with your name and phone number is passed into it too. The business is an independent seller and is responsible for how it uses this data.',
            '**ZAO "Agroprombank"** — to link cards, take payments and make refunds.',
            '**Telegram, Google and Apple** — to sign you in; Telegram also delivers messages from our bot.',
            "**Google Firebase (Firebase Cloud Messaging) and Apple Push Notification service** — to deliver push notifications; web push is delivered by your browser's push service.",
            '**Hetzner** — hosting: our servers are in Germany (EU).',
            '**Cloudflare** — network infrastructure and content delivery (CDN).',
            '**OpenStreetMap** — maps in the app and on the website are loaded from OpenStreetMap servers straight to your device. They see your IP address and the part of the map shown, but not your account data.',
          ],
        },
        'We may disclose data where the law or a lawful request from a public authority requires it. Some of these companies process data outside the Republic of Moldova — in the European Union and other countries.',
      ],
    },
    {
      id: 'retention',
      heading: '5. How long we keep data',
      blocks: [
        'Account data is kept while your account exists. When you delete it, your personal data is erased. Order records remain only in anonymised form that cannot be linked back to you: businesses need them for accounting and to meet their legal obligations.',
        'Technical logs are kept for a limited time — as long as needed to run and protect the service.',
      ],
    },
    {
      id: 'deletion',
      heading: '6. How to delete your account',
      blocks: [
        {
          list: [
            'In the takeAway app: **Profile → Delete account**.',
            'Or write to [help@takeaway.md](mailto:help@takeaway.md) — we may ask you to confirm that the account is yours.',
          ],
        },
        'Deletion cannot be undone: your points, saved cards and order history go with the account. What remains afterwards is described in [How long we keep data](/privacy#retention).',
      ],
    },
    {
      id: 'rights',
      heading: '7. Your rights',
      blocks: [
        'You can:',
        {
          list: [
            'find out what data we hold about you and get a copy of it;',
            'correct inaccurate data — you can edit most of it in your profile yourself;',
            'delete your account and data;',
            'withdraw consent: turn off notifications and promotional messages in your profile under Notifications, and location or push access in your phone or browser settings;',
            'complain to the National Center for Personal Data Protection of the Republic of Moldova if you believe we are violating your rights.',
          ],
        },
        'To exercise your rights, write to [help@takeaway.md](mailto:help@takeaway.md).',
      ],
    },
    {
      id: 'security',
      heading: '8. Security',
      blocks: [
        "Data travels only over encrypted connections (HTTPS), and card tokens are stored encrypted. Only those who need data to run the service can access it: a business's staff see the orders of their own stores only.",
      ],
    },
    {
      id: 'children',
      heading: '9. Children',
      blocks: [
        'takeAway is not directed to children under 14, and we do not knowingly collect their data. If you believe a child under 14 has given us their data, write to [help@takeaway.md](mailto:help@takeaway.md) and we will delete it.',
      ],
    },
    {
      id: 'changes',
      heading: '10. Changes to this policy',
      blocks: [
        'We may update this policy. The current version is always on this page, with its effective date at the top. We will announce significant changes in the app or on the website.',
      ],
    },
    {
      id: 'contacts',
      heading: '11. Contact',
      blocks: [
        'Ivan Damaschin, Republic of Moldova.',
        {
          list: [
            'Email: [help@takeaway.md](mailto:help@takeaway.md)',
            'Telegram: [@takaway_tgbot](https://t.me/takaway_tgbot)',
          ],
        },
      ],
    },
  ],
};
