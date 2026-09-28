import type { LegalDocument } from '../legal-document';

export const TERMS_EN: LegalDocument = {
  title: 'Terms of Service',
  description:
    'The rules of the takeAway service: ordering, payment, cancellations and refunds, and what businesses and the platform are responsible for.',
  effective: 'Effective 28 September 2026',
  toc: true,
  sections: [
    {
      blocks: [
        'These terms apply when you use takeAway — the takeaway.md website, the Telegram Mini App or the iOS and Android apps. By using the service you accept them. How we handle your data is described in the [Privacy Policy](/privacy).',
      ],
    },
    {
      id: 'service',
      heading: '1. What takeAway is',
      blocks: [
        'takeAway is a platform for pre-ordering coffee and food. You choose a partner business — a coffee shop, café or other venue — place and pay for your order online, and then pick it up without queuing. Where the business offers delivery, you can have the order delivered.',
        'takeAway provides the ordering platform; the seller is the business, which prepares the order and is responsible for its quality, ingredients and match with the description.',
        'The service is operated by individual developer Ivan Damaschin, Republic of Moldova.',
      ],
    },
    {
      id: 'account',
      heading: '2. Your account',
      blocks: [
        {
          list: [
            'You need an account to order. You sign in with Telegram, Google or Apple, and you are responsible for access to those accounts and for what is done in takeAway in your name.',
            'Give accurate details: the business hands over the order by the name and order code.',
            'The service is not directed to children under 14.',
            'You can delete your account at any time: in the app (**Profile → Delete account**) or by writing to [help@takeaway.md](mailto:help@takeaway.md).',
          ],
        },
      ],
    },
    {
      id: 'menu',
      heading: '3. Menu, prices and availability',
      blocks: [
        'The menu, prices, descriptions, ingredients, availability, opening hours and preparation times are set by the business. We show them as the business provides them.',
        'The ready time is an estimate: it depends on how busy the business is and may change. The current status is always on the order screen.',
        'If the business cannot fulfil an order — for example, an item has run out — it may decline it. The money for the order is then returned to your card.',
      ],
    },
    {
      id: 'payment',
      heading: '4. Orders and payment',
      blocks: [
        'An order is placed once you confirm and pay for it. Its total is fixed at that moment, including discounts, points and gift cards.',
        'You pay by bank card at checkout, in the business\'s currency. Payments are processed by the bank ZAO "Agroprombank". takeAway never receives or stores your full card number.',
        'If your profile has an email address, a receipt is sent to it after payment.',
      ],
    },
    {
      id: 'pickup',
      heading: '5. Picking up your order',
      blocks: [
        'Come at the ready time and give the order code or show the QR code on the order screen. When you reach the store, tap "I\'m here" so the business knows you have arrived.',
        'If the business offers delivery, its terms and fee are shown at checkout.',
      ],
    },
    {
      id: 'refunds',
      heading: '6. Cancellations and refunds',
      blocks: [
        {
          list: [
            'You can cancel an order on the order screen until the business starts preparing it.',
            'Cancellation and refund rules are set by the business, as it is the seller. If the order is already being prepared or you did not come for it, the business decides on a refund.',
            'Refunds go back to the card you paid with; when the money arrives depends on your bank.',
            'If something went wrong — the order was mixed up, it was not prepared or a refund has not arrived — contact [support](/support) with your order code. We will get in touch with the business and help sort it out.',
          ],
        },
      ],
    },
    {
      id: 'rewards',
      heading: '7. Points, promo codes and gift cards',
      blocks: [
        'Points, promo codes, referral bonuses and gift cards are rewards from businesses and the service, not money, and cannot be exchanged for cash. How they are earned and used, and when they expire, is shown in the app and may change.',
        'We may cancel rewards obtained in breach of the rules, for example through fake accounts.',
      ],
    },
    {
      id: 'use',
      heading: '8. Acceptable use',
      blocks: [
        'When using takeAway, do not:',
        {
          list: [
            "place orders you do not intend to collect, or pay with someone else's card without the owner's permission;",
            'create accounts to abuse rewards, promo codes or referrals;',
            "try to access other people's accounts or data, disrupt the service, get around its security or scrape data;",
            'use the service for anything unlawful or leave abusive comments on orders.',
          ],
        },
        'If these rules are broken, we may restrict or block the account.',
      ],
    },
    {
      id: 'liability',
      heading: '9. Liability',
      blocks: [
        'We work to keep takeAway running smoothly, but the service is provided "as is": technical failures and maintenance breaks can happen.',
        'The business is responsible for its goods: their quality, ingredients, safety and timely preparation. Ingredient and allergen information comes from the business — if you have an allergy, check with the business before ordering.',
        'To the extent the law allows, takeAway is not liable for indirect losses or lost profits, and our liability for an order is limited to its amount. Nothing in these terms limits consumer rights that cannot be limited by law.',
      ],
    },
    {
      id: 'changes',
      heading: '10. Changes to these terms',
      blocks: [
        'We may update these terms. The new version is published on this page with its effective date, and we will announce significant changes in the app or on the website. If you keep using the service after the changes take effect, you accept the new terms.',
      ],
    },
    {
      id: 'law',
      heading: '11. Governing law',
      blocks: [
        'These terms are governed by the law of the Republic of Moldova. We first try to resolve any dispute through support; if that fails, it is resolved as provided by the law of the Republic of Moldova.',
      ],
    },
    {
      id: 'contacts',
      heading: '12. Contact',
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
