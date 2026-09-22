/// Typed client for the takeAway REST API.
///
/// The Angular apps use `libs/api-client`; this is the Dart counterpart used
/// by `apps/mobile`. Models mirror the API DTOs field for field — the
/// controllers in `apps/api` are the source of truth.
library;

export 'src/models/auth.dart';
export 'src/models/cart.dart';
export 'src/models/catalog.dart';
export 'src/models/loyalty.dart';
export 'src/models/misc.dart';
export 'src/models/order.dart';
export 'src/models/payments.dart';
export 'src/takeaway_api.dart';
