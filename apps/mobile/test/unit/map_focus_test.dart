import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:takeaway_mobile/features/stores/map_focus.dart';

void main() {
  const tiraspol = [
    LatLng(46.838149, 29.624371),
    LatLng(46.837116, 29.586988),
    LatLng(46.838096, 29.660323),
  ];
  const dubai = LatLng(25.078, 55.141);
  const london = LatLng(51.525, -0.087);
  final all = [dubai, london, ...tiraspol];

  test('without a location the map opens on the biggest group of stores', () {
    expect(mapFocus(all, null), tiraspol);
  });

  test('with a location it opens on the stores around the customer, customer included', () {
    const me = LatLng(46.84, 29.63);
    expect(mapFocus(all, me), [...tiraspol, me]);
  });

  test('a customer far from every store gets their nearest store, not themselves', () {
    const me = LatLng(51.5, -0.1);
    expect(mapFocus(all, me), [london, me]);
    const nowhere = LatLng(0, 0);
    expect(mapFocus(all, nowhere).contains(nowhere), isFalse);
  });

  test('no stores: only the customer, if known', () {
    expect(mapFocus(const [], null), isEmpty);
    expect(mapFocus(const [], dubai), [dubai]);
  });
}
