import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/features/checkout/web_payment.dart';

void main() {
  test('reads the order and the verdict from the return link', () {
    final ok = PaymentReturn.parse(Uri.parse('takeaway://pay?orderId=ord_1&status=success'))!;
    expect(ok.orderId, 'ord_1');
    expect(ok.status, PaymentReturnStatus.success);

    expect(
      PaymentReturn.parse(Uri.parse('takeaway://pay?orderId=ord_1&status=pending'))!.status,
      PaymentReturnStatus.pending,
    );
    expect(
      PaymentReturn.parse(Uri.parse('takeaway://pay?orderId=ord_1&status=fail'))!.status,
      PaymentReturnStatus.fail,
    );
    expect(PaymentReturn.parse(Uri.parse('takeaway://pay?orderId=ord_1'))!.status, PaymentReturnStatus.unknown);
  });

  test('ignores other links on the same scheme and links without an order', () {
    expect(PaymentReturn.parse(Uri.parse('takeaway://tglogin?code=abc')), isNull);
    expect(PaymentReturn.parse(Uri.parse('takeaway://pay?status=success')), isNull);
    expect(PaymentReturn.parse(Uri.parse('https://takeaway.md/pay?orderId=ord_1')), isNull);
  });
}
