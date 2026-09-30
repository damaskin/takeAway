import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/shared/web_pages.dart';

void main() {
  test('legal and support pages live on the public website', () {
    expect(WebPages.terms.toString(), 'https://takeaway.md/terms');
    expect(WebPages.privacy.toString(), 'https://takeaway.md/privacy');
    expect(WebPages.support.toString(), 'https://takeaway.md/support');
  });
}
