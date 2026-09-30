import type { LegalDocument } from '../legal-document';

export const SUPPORT_EN: LegalDocument = {
  title: 'Support',
  description: 'How to contact takeAway, and answers to common questions about orders, payment and your account.',
  toc: false,
  sections: [
    {
      blocks: ['Have a question about an order, payment or your account? Write to us and we will help.'],
    },
    {
      id: 'contact',
      heading: 'How to reach us',
      blocks: [
        {
          list: [
            'Email: [help@takeaway.md](mailto:help@takeaway.md)',
            'Telegram: [@takaway_tgbot](https://t.me/takaway_tgbot)',
          ],
        },
        'If it is about an order, include its code — the four digits on the order screen — so we can find it faster.',
      ],
    },
    {
      id: 'faq',
      heading: 'Frequently asked questions',
      blocks: [],
    },
    {
      id: 'how-to-order',
      level: 3,
      heading: 'How do I place an order?',
      blocks: [
        'Order on the takeaway.md website, in Telegram through the [@takaway_tgbot](https://t.me/takaway_tgbot) bot, or in the iOS and Android app. Choose a store, add items to your cart, decide when you will pick the order up — as soon as possible or at a set time — and pay by card. The business receives your order right away.',
      ],
    },
    {
      id: 'order-status',
      level: 3,
      heading: 'Where do I see my order status, and how do I say "I\'m here"?',
      blocks: [
        'After payment the order screen opens, showing the status, ready time and order code. You can return to it from your list of orders. If you allowed notifications, we will tell you when the order is ready.',
        'When you reach the store, tap "I\'m here" on the order screen so the barista knows you have arrived. Give the order code or show the QR code.',
      ],
    },
    {
      id: 'cancel-refund',
      level: 3,
      heading: 'How do I cancel an order or get a refund?',
      blocks: [
        'Until the business starts preparing your order, you can cancel it on the order screen. Refund rules are set by the business, and refunds go back to the card you paid with.',
        'If the order is already being prepared, something went wrong or a refund has not arrived, write to [help@takeaway.md](mailto:help@takeaway.md) or on [Telegram](https://t.me/takaway_tgbot) with your order code, and we will sort it out with the business.',
      ],
    },
    {
      id: 'sign-in-methods',
      level: 3,
      heading: 'How do I link Telegram, Google or Apple sign-in?',
      blocks: [
        'Open **Profile → Sign-in methods** and connect the method you want. Then whichever way you sign in, you land in the same account with your order history and points. You can also disconnect Google or Apple there, as long as the account keeps another way to sign in.',
      ],
    },
    {
      id: 'delete-account',
      level: 3,
      heading: 'How do I delete my account?',
      blocks: [
        "In the app, open **Profile → Delete account**, or write to [help@takeaway.md](mailto:help@takeaway.md). Your personal data is erased, and order records remain only in anonymised form for the businesses' accounting. See the [Privacy Policy](/privacy#deletion) for details.",
      ],
    },
  ],
};
