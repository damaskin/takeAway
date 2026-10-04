/**
 * End-to-end smoke run for the Agroprombank integration against the sandbox
 * stack. Runs inside the api container, where Prisma and the API are both
 * reachable.
 *
 * Walks the whole customer path — bind a card with the SMS one-time password,
 * put an order together, hold the money, let the kitchen accept (capture),
 * then refund — and the same for Web-платёж: the bank's page, the
 * notification, capture on accept, release on cancel, on the kitchen's
 * rejection and on expiry. Asserts the outcome at every step, so a green run
 * means the wiring genuinely works rather than merely returning 200s.
 *
 *   node smoke.mjs
 */

import { createHmac, randomUUID } from 'node:crypto';

const API = process.env.API_BASE ?? 'http://127.0.0.1:3000/api';
const MOCK = process.env.MOCK_BASE ?? 'http://agro-mock:8899';
const MOCK_WEB = process.env.MOCK_WEB_BASE ?? 'http://agro-mock:8898';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET;

const { PrismaClient } = await import('/app/node_modules/@prisma/client/default.js');
const prisma = new PrismaClient();

let failures = 0;
const step = (name) => console.log(`\n▶ ${name}`);
const ok = (label, detail = '') => console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
function check(condition, label, detail = '') {
  if (condition) return ok(label, detail);
  failures += 1;
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Mints the same access token TokensService issues: { sub, jti }, HS256. */
function mintToken(userId) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      sub: userId,
      jti: randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  );
  const signature = createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

let token = '';
async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      // Only when there really is a body: Fastify rejects an empty body that
      // claims to be JSON, which would make a bodyless DELETE look like a 400.
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }
  return { status: res.status, body: parsed };
}

// ── Fixtures ────────────────────────────────────────────────────────────────
step('Готовим данные: бренд в приднестровских рублях, магазин, товар, покупатель');

const brand = await prisma.brand.findFirst({ where: { moderationStatus: 'APPROVED' } });
if (!brand) throw new Error('seed did not create an approved brand');
await prisma.brand.update({ where: { id: brand.id }, data: { currency: 'RUP' } });

const store = await prisma.store.findFirst({ where: { brandId: brand.id } });
if (!store) throw new Error('seed did not create a store');
await prisma.store.update({ where: { id: store.id }, data: { currency: 'RUP', status: 'OPEN' } });
// Orders are only taken during an open shift.
if (!(await prisma.storeShift.findFirst({ where: { storeId: store.id, closedAt: null } }))) {
  await prisma.storeShift.create({ data: { storeId: store.id } });
}
ok('магазин переведён на RUP, смена открыта', `${store.name} (${store.id})`);

const product = await prisma.product.findFirst({ where: { brandId: brand.id, visible: true } });
if (!product) throw new Error('seed did not create an available product');
ok('товар выбран', `${product.name}, ${product.basePriceCents} коп.`);

const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
if (!admin) throw new Error('seed did not create a super-admin');

const customer = await prisma.user.upsert({
  where: { phone: '77712345' },
  update: { role: 'CUSTOMER', blockedAt: null },
  create: { phone: '77712345', name: 'Sandbox Customer', role: 'CUSTOMER', currency: 'RUP' },
});
token = mintToken(customer.id);
ok('покупатель готов', customer.id);

// Wipe what an earlier run left behind so the script can be re-run as-is.
const priorOrders = await prisma.order.findMany({ where: { userId: customer.id }, select: { id: true } });
const priorOrderIds = priorOrders.map((o) => o.id);
await prisma.pointsLedger.deleteMany({ where: { userId: customer.id } });
await prisma.payment.deleteMany({ where: { orderId: { in: priorOrderIds } } });
await prisma.orderEvent.deleteMany({ where: { orderId: { in: priorOrderIds } } });
await prisma.orderItem.deleteMany({ where: { orderId: { in: priorOrderIds } } });
await prisma.order.deleteMany({ where: { id: { in: priorOrderIds } } });
await prisma.cartItem.deleteMany({ where: { cart: { userId: customer.id } } });
await prisma.cart.deleteMany({ where: { userId: customer.id } });
await prisma.cardBindingRequest.deleteMany({ where: { userId: customer.id } });
await prisma.cardToken.deleteMany({ where: { userId: customer.id } });
ok('состояние прошлого прогона очищено', `заказов: ${priorOrderIds.length}`);

// ── Card binding ────────────────────────────────────────────────────────────
step('Привязка карты: два шага с одноразовым паролем из СМС');

const institutes = await api('GET', '/payments/agroprombank/institutes');
check(
  institutes.status === 200 && institutes.body.length === 3,
  'список банков-эмитентов отдан',
  `${institutes.body?.length} шт.`,
);

const started = await api('POST', '/payments/agroprombank/cards/bind', {
  lastDigits: '0578',
  phone: '77712345',
  institute: '0001',
});
check(
  started.status === 201 || started.status === 200,
  'запрос на привязку принят',
  JSON.stringify(started.body).slice(0, 120),
);
const bindingId = started.body?.bindingId;

const otpRes = await fetch(`${MOCK}/__sandbox/state`).then((r) => r.json());
const pending = otpRes.tokenRequests.at(-1);
check(Boolean(pending?.otp), 'банк отправил одноразовый пароль', pending?.otp);

const wrongCode = await api('POST', `/payments/agroprombank/cards/bind/${bindingId}/confirm`, { code: '000000' });
check(wrongCode.status === 400, 'неверный пароль отклонён', `HTTP ${wrongCode.status}`);

const confirmed = await api('POST', `/payments/agroprombank/cards/bind/${bindingId}/confirm`, { code: pending.otp });
check(confirmed.status === 200 || confirmed.status === 201, 'карта привязана', confirmed.body?.maskedPan);
const cardId = confirmed.body?.id;

const stored = await prisma.cardToken.findUnique({ where: { id: cardId } });
check(
  Boolean(stored?.tokenCipher) && !String(stored?.tokenCipher).match(/^[0-9A-F]{64}$/),
  'токен лежит в базе зашифрованным, а не открытым текстом',
  `${String(stored?.tokenCipher).slice(0, 24)}…`,
);

const cards = await api('GET', '/payments/agroprombank/cards');
check(
  cards.status === 200 && cards.body.length === 1 && cards.body[0].isDefault,
  'карта в списке и назначена основной',
);

// ── Order ───────────────────────────────────────────────────────────────────
step('Заказ: корзина → оформление');

const cart = await api('POST', '/cart/items', { storeId: store.id, productId: product.id, quantity: 2 });
check(cart.status === 200 || cart.status === 201, 'товар добавлен в корзину', `итого ${cart.body?.subtotalCents} коп.`);

const order = await api('POST', '/orders', { cartId: cart.body.id, pickupMode: 'ASAP', fulfillmentType: 'PICKUP' });
check(
  order.status === 200 || order.status === 201,
  'заказ создан',
  `№${order.body?.orderCode}, статус ${order.body?.status}`,
);
check(order.body?.status === 'CREATED', 'заказ пока не оплачен');
const orderId = order.body?.id;

// ── Payment ─────────────────────────────────────────────────────────────────
step('Оплата привязанной картой: сумма блокируется до принятия заказа');

const paid = await api('POST', '/payments/agroprombank/pay', { orderId, cardId });
check(paid.status === 200 || paid.status === 201, 'платёж проведён', `HTTP ${paid.status}`);
check(paid.body?.status === 'REQUIRES_ACTION', 'банк заблокировал сумму', `operationid=${paid.body?.operationId}`);
check(
  Boolean(paid.body?.authCode) && Boolean(paid.body?.rrn),
  'разобран блок карточной транзакции',
  `authcode=${paid.body?.authCode}, rrn=${paid.body?.rrn}`,
);

const held = await prisma.order.findUnique({ where: { id: orderId } });
check(held?.status === 'CREATED', 'заказ ждёт кухню, деньги не списаны');

const payment = await prisma.payment.findFirst({ where: { orderId } });
check(/^9\d+$/.test(payment?.invoiceId ?? ''), 'invoiceid — только цифры, с префиксом окружения', payment?.invoiceId);
check(payment?.provider === 'AGROPROMBANK' && payment?.status === 'REQUIRES_ACTION', 'платёж сохранён как блокировка');

step('Повторная оплата того же заказа не должна заблокировать деньги дважды');
const again = await api('POST', '/payments/agroprombank/pay', { orderId, cardId });
check(
  again.body?.paymentId === paid.body?.paymentId,
  'вернулся тот же платёж, новой операции нет',
  again.body?.paymentId,
);
const paymentCount = await prisma.payment.count({ where: { orderId } });
check(paymentCount === 1, 'в базе по-прежнему один платёж');

step('Кухня принимает заказ — деньги списываются');
token = mintToken(admin.id);
const accepted = await api('POST', `/kds/orders/${orderId}/accept?storeId=${store.id}`);
check(accepted.status === 200 || accepted.status === 201, 'заказ принят', `HTTP ${accepted.status}`);
const captured = await prisma.payment.findUnique({ where: { id: payment.id } });
check(captured?.status === 'SUCCEEDED', 'блокировка списана (CompletePreAuthorizaion)');
const settled = await prisma.order.findUnique({ where: { id: orderId } });
check(settled?.status === 'ACCEPTED', 'заказ в работе');
const events = await prisma.orderEvent.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } });
check(
  events.some((e) => e.type === 'PAYMENT_SUCCEEDED'),
  'записано событие PAYMENT_SUCCEEDED',
);

// ── Refund ──────────────────────────────────────────────────────────────────
step('Частичный возврат из админки');

token = mintToken(admin.id);

const half = Math.floor(payment.amountCents / 2);
const refund = await api('POST', `/admin/payments/agroprombank/${payment.id}/refund`, { amountCents: half });
check(refund.status === 200 || refund.status === 201, 'возврат принят', `HTTP ${refund.status}`);

const afterRefund = await prisma.payment.findUnique({ where: { id: payment.id } });
check(afterRefund?.status === 'PARTIALLY_REFUNDED', 'статус платежа — частично возвращён');
check(afterRefund?.refundedCents === half, 'сумма возврата записана', `${half} коп.`);

const tooMuch = await api('POST', `/admin/payments/agroprombank/${payment.id}/refund`, {
  amountCents: payment.amountCents,
});
check(tooMuch.status === 400, 'возврат сверх остатка отклонён', `HTTP ${tooMuch.status}`);

step('Операция в реестре банка');
const described = await api('GET', `/admin/payments/agroprombank/${payment.id}`);
check(
  described.status === 200 && described.body?.invoiceid === payment.invoiceId,
  'банк отдал свою запись об операции',
  `state=${described.body?.state}`,
);

// ── Declines ────────────────────────────────────────────────────────────────
step('Отказ банка: недостаточно средств');

token = mintToken(customer.id);
const cart2 = await api('POST', '/cart/items', { storeId: store.id, productId: product.id, quantity: 1 });
const order2 = await api('POST', '/orders', { cartId: cart2.body.id, pickupMode: 'ASAP', fulfillmentType: 'PICKUP' });
// The sandbox declines exactly 66600 minor units, so line the order up on it.
await prisma.order.update({ where: { id: order2.body.id }, data: { totalCents: 66600 } });

const declined = await api('POST', '/payments/agroprombank/pay', { orderId: order2.body.id, cardId });
check(declined.status === 400, 'платёж отклонён', declined.body?.message);
const unpaid = await prisma.order.findUnique({ where: { id: order2.body.id } });
check(unpaid?.status === 'CREATED', 'заказ остался неоплаченным');
const failedPayment = await prisma.payment.findFirst({ where: { orderId: order2.body.id } });
check(failedPayment?.status === 'FAILED', 'платёж помечен FAILED');

// ── Unbinding ───────────────────────────────────────────────────────────────
step('Отвязка карты');
const removed = await api('DELETE', `/payments/agroprombank/cards/${cardId}`);
check(removed.status === 204, 'карта отвязана', `HTTP ${removed.status}`);
const afterRemoval = await api('GET', '/payments/agroprombank/cards');
check(afterRemoval.body?.length === 0, 'список карт пуст');

// ── Web-платёж ──────────────────────────────────────────────────────────────
// The API addresses the sandbox page by the host the tester's browser uses;
// from inside the network the same page lives at MOCK_WEB.
const viaMock = (url) => {
  const parsed = new URL(url);
  const mock = new URL(MOCK_WEB);
  parsed.protocol = mock.protocol;
  parsed.host = mock.host;
  return parsed.toString();
};
const viaApi = (url) => {
  const parsed = new URL(url);
  return `${API}${parsed.pathname.replace(/^\/api/, '')}${parsed.search}`;
};

/** A fresh order paid on the sandbox page: start → open page → «Оплатить». */
async function webOrder(label) {
  token = mintToken(customer.id);
  const cartW = await api('POST', '/cart/items', { storeId: store.id, productId: product.id, quantity: 1 });
  const orderW = await api('POST', '/orders', { cartId: cartW.body.id, pickupMode: 'ASAP', fulfillmentType: 'PICKUP' });
  const started = await api('POST', '/payments/agroprombank-web/start', { orderId: orderW.body.id, returnTo: 'web' });
  check(
    (started.status === 200 || started.status === 201) && Boolean(started.body?.page),
    `${label}: банк выдал страницу оплаты`,
    started.body?.invoiceId,
  );
  check(started.body?.page?.fields?.ispreauth === '1', `${label}: страница открыта с блокировкой суммы`);
  const page = await fetch(viaMock(started.body.page.url));
  check(page.status === 200, `${label}: страница банка открылась, подпись запроса принята`, `HTTP ${page.status}`);
  const paidW = await fetch(`${MOCK_WEB}/__sandbox/web/pay/${started.body.invoiceId}`, { method: 'POST' }).then((r) =>
    r.json(),
  );
  const paymentW = await prisma.payment.findUnique({ where: { id: started.body.paymentId } });
  check(paymentW?.status === 'REQUIRES_ACTION', `${label}: оповещение ResultURL принято, сумма заблокирована`);
  return { orderId: orderW.body.id, payment: paymentW, redirect: paidW.redirect };
}

const webState = async () => fetch(`${MOCK_WEB}/__sandbox/web/state`).then((r) => r.json());

step('Web-платёж: блокировка на странице банка, списание при принятии');
const web1 = await webOrder('заказ 1');
const back = await fetch(viaApi(web1.redirect), { redirect: 'manual' });
check(
  back.status === 302 && (back.headers.get('location') ?? '').includes(`/orders/${web1.orderId}?payment=success`),
  'покупатель вернулся на страницу заказа',
  back.headers.get('location'),
);
check((await prisma.order.findUnique({ where: { id: web1.orderId } }))?.status === 'CREATED', 'заказ ждёт кухню');
const view = await api('GET', `/orders/${web1.orderId}`);
check(view.body?.payment?.state === 'HELD', 'клиент видит «сумма заблокирована»', view.body?.payment?.cardMask);

token = mintToken(admin.id);
const acceptedW = await api('POST', `/kds/orders/${web1.orderId}/accept?storeId=${store.id}`);
check(acceptedW.status === 200 || acceptedW.status === 201, 'кухня приняла заказ', `HTTP ${acceptedW.status}`);
const capturedW = await prisma.payment.findUnique({ where: { id: web1.payment.id } });
check(capturedW?.status === 'SUCCEEDED', 'платёж списан');
check(
  (await webState()).calls.some((c) => c.startsWith(`ComplitionOperation ${web1.payment.invoiceId}`)),
  'банку отправлен ComplitionOperation',
);
check((await prisma.order.findUnique({ where: { id: web1.orderId } }))?.status === 'ACCEPTED', 'заказ ACCEPTED');

step('Web-платёж: покупатель отменил заказ — блокировка снята');
const web2 = await webOrder('заказ 2');
token = mintToken(customer.id);
const cancelled = await api('POST', `/orders/${web2.orderId}/cancel`);
check(cancelled.body?.status === 'CANCELLED', 'заказ отменён');
check(
  (await prisma.payment.findUnique({ where: { id: web2.payment.id } }))?.status === 'REFUNDED',
  'блокировка снята (CancelOperation)',
);

step('Web-платёж: кухня отклонила заказ — блокировка снята');
const web3 = await webOrder('заказ 3');
token = mintToken(admin.id);
const rejected = await api('POST', `/kds/orders/${web3.orderId}/reject?storeId=${store.id}`, {
  reason: 'OUT_OF_STOCK',
  comment: 'Закончилось молоко',
});
check(rejected.body?.money === 'released', 'заказ отклонён, деньги возвращены', JSON.stringify(rejected.body));
check(
  (await prisma.payment.findUnique({ where: { id: web3.payment.id } }))?.status === 'REFUNDED',
  'платёж помечен REFUNDED',
);

step('Web-платёж: кухня не приняла заказ вовремя — заказ истёк, блокировка снята');
const web4 = await webOrder('заказ 4');
// Back-date the hold and the pickup time past the acceptance window.
await prisma.$executeRaw`UPDATE "Payment" SET "updatedAt" = now() - interval '2 hours' WHERE id = ${web4.payment.id}`;
await prisma.order.update({ where: { id: web4.orderId }, data: { pickupAt: new Date(Date.now() - 2 * 3600_000) } });
let expired = null;
for (let i = 0; i < 15 && expired?.status !== 'EXPIRED'; i += 1) {
  await new Promise((r) => setTimeout(r, 6_000)); // the expiry sweep runs every minute
  expired = await prisma.order.findUnique({ where: { id: web4.orderId } });
}
check(expired?.status === 'EXPIRED', 'заказ истёк');
check(
  (await prisma.payment.findUnique({ where: { id: web4.payment.id } }))?.status === 'REFUNDED',
  'блокировка снята при истечении',
);

console.log(`\n${failures === 0 ? '✅ Все проверки пройдены' : `❌ Провалено проверок: ${failures}`}`);
await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
