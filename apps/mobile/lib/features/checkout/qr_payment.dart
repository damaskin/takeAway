import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/network/api_error.dart';
import '../../core/providers.dart';

// Agroprombank's «Мобильный платёж» on the phone: the order's QR invoice,
// shown until the customer pays it in the bank's app
// (docs/agroprombank-payments.md §12).

/// The clock the QR invoice counts down by. Fake time in tests.
final qrClockProvider = Provider<DateTime Function()>((ref) => DateTime.now);

/// Opens Agroprombank's app with the invoice on the same phone. Swapped out
/// in tests.
abstract class BankAppLauncher {
  /// False when nothing on the phone opened [link].
  Future<bool> open(Uri link);
}

class DeviceBankAppLauncher implements BankAppLauncher {
  const DeviceBankAppLauncher();

  @override
  Future<bool> open(Uri link) async {
    try {
      // The bank's own app (or whatever the link belongs to), never a tab
      // inside ours: paying happens there.
      return await launchUrl(link, mode: LaunchMode.externalApplication);
    } on Object {
      return false;
    }
  }
}

final bankAppLauncherProvider = Provider<BankAppLauncher>((ref) => const DeviceBankAppLauncher());

/// Orders this phone saw paid by QR. Until the API names the provider of an
/// order's payment (`payment.provider`, optional), this is how the order
/// screen tells money taken by QR («Оплачено мобильным платежом») from a card hold.
class QrPaidOrders {
  const QrPaidOrders(this._prefs);

  final SharedPreferences _prefs;

  static const prefsKey = 'payments.qrPaidOrders';

  /// The newest ids kept; an order older than that is long over.
  static const keep = 30;

  bool contains(String orderId) => (_prefs.getStringList(prefsKey) ?? const []).contains(orderId);

  Future<void> add(String orderId) async {
    final ids = [...?_prefs.getStringList(prefsKey)]
      ..remove(orderId)
      ..add(orderId);
    await _prefs.setStringList(prefsKey, ids.length > keep ? ids.sublist(ids.length - keep) : ids);
  }
}

final qrPaidOrdersProvider = Provider<QrPaidOrders>((ref) => QrPaidOrders(ref.watch(sharedPreferencesProvider)));

/// Whether the money on [order] came by QR: the API's word when it names the
/// provider, else what this phone saw.
bool orderPaidByQr(Order order, QrPaidOrders seen) {
  final provider = order.payment.provider;
  return provider != null ? provider == PaymentProvider.agroprombankQr : seen.contains(order.id);
}

/// Where the QR screen is.
enum QrPhase {
  /// Asking the API for the invoice.
  starting,

  /// The code is up; waiting for the customer to pay it.
  pending,

  /// Paid: the money is on the order.
  paid,

  /// The invoice lapsed or was closed unpaid; a new one can be issued.
  expired,

  /// Paid, then given back (the order was cancelled meanwhile).
  refunded,

  /// No invoice: the bank refused to issue one, or the API could not be asked.
  failed,

  /// The customer called the invoice off.
  cancelled,
}

class QrPaymentState {
  const QrPaymentState({this.phase = QrPhase.starting, this.payment, this.error, this.cancelling = false});

  final QrPhase phase;

  /// The API's latest answer about the invoice.
  final QrPayment? payment;

  /// Why there is no invoice, when the API said ([QrPhase.failed]); null for
  /// an invoice the bank marked FAILED.
  final ApiError? error;

  /// «Отменить» is on its way.
  final bool cancelling;

  /// The code to show, while there is one.
  QrPaymentCode? get code => payment?.qr;

  QrPaymentState copyWith({QrPhase? phase, bool? cancelling}) => QrPaymentState(
    phase: phase ?? this.phase,
    payment: payment,
    error: error,
    cancelling: cancelling ?? this.cancelling,
  );
}

/// The order's QR invoice ([arg] is the order id), kept up to date while the
/// QR screen is up: polled every [pollEvery] while it waits to be paid,
/// not while the app is in the background, and at once when it comes back
/// (the customer returns from the bank's app). Leaving the screen never calls
/// the invoice off — only [cancel] does.
class QrPaymentController extends AutoDisposeFamilyNotifier<QrPaymentState, String> {
  static const pollEvery = Duration(seconds: 3);

  /// How long a code past its time is still checked: the API closes a lapsed
  /// invoice about two minutes after, and a payment made in its last seconds
  /// may still land.
  static const lapseGrace = Duration(minutes: 2);

  Timer? _poll;
  Timer? _lapse;
  bool _foreground = true;
  bool _asking = false;

  /// Bumped by every new start, a cancel and disposal, so an answer to an
  /// older question is dropped.
  int _generation = 0;

  TakeAwayApi get _api => ref.read(apiProvider);
  DateTime _now() => ref.read(qrClockProvider)();

  @override
  QrPaymentState build(String orderId) {
    ref.onDispose(() {
      _generation++;
      _stopTimers();
    });
    return const QrPaymentState();
  }

  /// Shows [initial] — the invoice checkout has just started — or asks the
  /// API for the order's invoice.
  Future<void> open({QrPayment? initial}) async {
    if (initial != null && initial.orderId == arg) {
      _apply(initial);
      return;
    }
    await start();
  }

  /// Asks for the order's invoice: the one still pending (the same code), a
  /// new one once it lapsed, or the order's payment once it is paid. Safe to
  /// repeat.
  Future<void> start() async {
    final generation = ++_generation;
    _stopTimers();
    state = const QrPaymentState();
    try {
      final payment = await _api.startQrPayment(StartQrPaymentRequest(orderId: arg));
      if (generation == _generation) _apply(payment);
    } on Object catch (error) {
      if (generation == _generation) state = QrPaymentState(phase: QrPhase.failed, error: ApiError.from(error));
    }
  }

  /// Reads the invoice again now. A failed read changes nothing: the code
  /// stays up and the next tick asks again.
  Future<void> poll() async {
    final payment = state.payment;
    if (payment == null || payment.status != QrPaymentStatus.pending || _asking || state.cancelling) return;
    final generation = _generation;
    _asking = true;
    try {
      final fresh = await _api.qrPayment(payment.paymentId);
      if (generation == _generation) _apply(fresh);
    } on Object {
      // A lost network or the bank's 503 says nothing about the invoice.
    } finally {
      _asking = false;
    }
  }

  /// The app went to the background (the bank's app is over it): no polling.
  void pause() {
    _foreground = false;
    _sync();
  }

  /// The app is back: check the invoice at once, then keep polling.
  void resume() {
    _foreground = true;
    _markLapsed();
    unawaited(poll());
    _sync();
  }

  /// Calls the invoice off — on the customer's word only. Answers the phase
  /// it ended in: [QrPhase.cancelled], or [QrPhase.paid] when the payment
  /// landed meanwhile. Throws [ApiError] when the API could not be asked;
  /// the code then stays up.
  Future<QrPhase> cancel() async {
    final payment = state.payment;
    if (payment == null || payment.status != QrPaymentStatus.pending) {
      _generation++;
      _stopTimers();
      state = state.copyWith(phase: QrPhase.cancelled);
      return QrPhase.cancelled;
    }
    final generation = ++_generation;
    _stopTimers();
    state = state.copyWith(cancelling: true);
    try {
      final answer = await _api.cancelQrPayment(payment.paymentId);
      if (generation != _generation) return state.phase;
      if (answer.status == QrPaymentStatus.paid) {
        _apply(answer);
        return QrPhase.paid;
      }
      state = QrPaymentState(phase: QrPhase.cancelled, payment: answer);
      return QrPhase.cancelled;
    } on Object catch (error) {
      if (generation == _generation) {
        state = state.copyWith(cancelling: false);
        _sync();
      }
      throw ApiError.from(error);
    }
  }

  void _apply(QrPayment payment) {
    final phase = switch (payment.status) {
      // A pending invoice comes with its code; one without is of no use.
      QrPaymentStatus.pending when payment.qr == null => QrPhase.failed,
      QrPaymentStatus.pending => _lapsed(payment) ? QrPhase.expired : QrPhase.pending,
      QrPaymentStatus.paid => QrPhase.paid,
      QrPaymentStatus.expired => QrPhase.expired,
      QrPaymentStatus.refunded => QrPhase.refunded,
      QrPaymentStatus.failed || QrPaymentStatus.unknown => QrPhase.failed,
    };
    state = QrPaymentState(phase: phase, payment: payment);
    if (phase == QrPhase.paid) unawaited(ref.read(qrPaidOrdersProvider).add(arg));
    _sync();
  }

  bool _lapsed(QrPayment payment) {
    final expiresAt = payment.qr?.expiresAt;
    return expiresAt != null && !_now().isBefore(expiresAt);
  }

  /// The code ran out while the screen was up: «Счёт истёк», still checked
  /// for a while in case it was paid at the last moment.
  void _markLapsed() {
    final payment = state.payment;
    if (state.phase == QrPhase.pending && payment != null && _lapsed(payment)) {
      state = state.copyWith(phase: QrPhase.expired);
    }
  }

  /// Polling runs while the invoice is pending (up to [lapseGrace] past its
  /// time) and the app is in the foreground.
  bool get _watching {
    final payment = state.payment;
    if (!_foreground || state.cancelling || payment == null || payment.status != QrPaymentStatus.pending) {
      return false;
    }
    final expiresAt = payment.qr?.expiresAt;
    return expiresAt == null || _now().isBefore(expiresAt.add(lapseGrace));
  }

  void _sync() {
    if (!_watching) {
      _stopTimers();
      return;
    }
    _poll ??= Timer.periodic(pollEvery, (_) => unawaited(poll()));
    final expiresAt = state.payment?.qr?.expiresAt;
    if (_lapse == null && state.phase == QrPhase.pending && expiresAt != null) {
      _lapse = Timer(expiresAt.difference(_now()), () {
        _lapse = null;
        _markLapsed();
        unawaited(poll());
      });
    }
  }

  void _stopTimers() {
    _poll?.cancel();
    _poll = null;
    _lapse?.cancel();
    _lapse = null;
  }
}

final qrPaymentProvider = NotifierProvider.autoDispose.family<QrPaymentController, QrPaymentState, String>(
  QrPaymentController.new,
);
