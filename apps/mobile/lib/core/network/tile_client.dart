import 'dart:async';
import 'dart:io' show HttpClient;
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

/// HTTP client for map tiles, built for mobile data.
///
/// flutter_map's own client gives every tile one try with no time limit, and
/// a connection that drops mid-request ("Connection closed before full
/// header was received" — routine on a phone, where a kept-alive socket dies
/// with the radio) is taken for the map being disposed: the tile is
/// "loaded" as a transparent square and never asked for again. This client
/// instead:
///
///  * gives up on a server that has not answered within [timeout] (or whose
///    body stalls for as long), so no tile waits forever;
///  * retries dropped connections, timeouts and 429/5xx after [retryDelays],
///    and spends one of the attempts on [fallback] — the same tile from
///    another server — in case the primary one is down;
///  * reports a final failure as a [TileLoadException], which flutter_map
///    shows as a failed tile, to be asked for again, instead of a blank
///    "success".
///
/// A request flutter_map aborts itself — the tile went off screen — is
/// passed through untouched and never retried.
class TileClient extends http.BaseClient {
  TileClient({
    http.Client? inner,
    this.fallback,
    this.timeout = const Duration(seconds: 15),
    this.retryDelays = const [Duration(seconds: 1), Duration(seconds: 2), Duration(seconds: 4)],
  }) : _inner = inner ?? IOClient(HttpClient()..connectionTimeout = const Duration(seconds: 10));

  final http.Client _inner;

  /// Maps a primary tile URL to the same tile on another server.
  final TileUrlFallback? fallback;

  /// Longest wait for the response headers, and between body chunks.
  final Duration timeout;

  /// Pause before each retry; one retry per entry.
  final List<Duration> retryDelays;

  /// Requests on the wire right now.
  int get inFlight => _inFlight;
  int _inFlight = 0;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final trigger = request is http.Abortable ? request.abortTrigger : null;
    var aborted = false;
    unawaited(trigger?.whenComplete(() => aborted = true));

    // The primary twice, then the fallback, then the primary again: a blip
    // is ridden out where the tile was asked for; a primary that is down
    // costs one retry before the fallback gets its turn.
    final alternate = fallback?.urlFor(request.url);
    final plan = [for (var i = 0; i <= retryDelays.length; i++) i == 2 && alternate != null ? alternate : request.url];

    Object? lastError;
    StackTrace? lastStack;
    var pause = Duration.zero;
    for (var attempt = 0; attempt < plan.length; attempt++) {
      if (pause > Duration.zero) await Future.any<void>([Future<void>.delayed(pause), ?trigger]);
      if (aborted) throw http.RequestAbortedException(request.url);
      pause = attempt < retryDelays.length ? retryDelays[attempt] : Duration.zero;

      final url = plan[attempt];
      final http.StreamedResponse response;
      try {
        response = await _attempt(request, url, trigger, () => aborted);
      } on http.RequestAbortedException {
        rethrow;
      } on Object catch (error, stack) {
        if (aborted) throw http.RequestAbortedException(request.url);
        lastError = error;
        lastStack = stack;
        continue;
      }

      final status = response.statusCode;
      if (attempt < plan.length - 1) {
        if (_retryable(status)) {
          lastError = http.ClientException('HTTP $status', url);
          lastStack = StackTrace.current;
          continue;
        }
        // Refused outright (404, 403…): asking the same server again will
        // not help, but the fallback may have the tile.
        final next = alternate == null || status < 400 ? -1 : plan.indexOf(alternate, attempt + 1);
        if (next > attempt) {
          lastError = http.ClientException('HTTP $status', url);
          lastStack = StackTrace.current;
          attempt = next - 1;
          pause = Duration.zero;
          continue;
        }
      }
      return response;
    }
    Error.throwWithStackTrace(TileLoadException(request.url, lastError), lastStack ?? StackTrace.current);
  }

  /// One request, its body read in full. Throws [TimeoutException] when the
  /// server goes quiet, after aborting the request so the socket is let go.
  Future<http.StreamedResponse> _attempt(
    http.BaseRequest original,
    Uri url,
    Future<void>? trigger,
    bool Function() callerAborted,
  ) async {
    final giveUp = Completer<void>();
    final copy =
        http.AbortableRequest(
            original.method,
            url,
            abortTrigger: trigger == null ? giveUp.future : Future.any([trigger, giveUp.future]),
          )
          ..headers.addAll(original.headers)
          ..followRedirects = original.followRedirects
          ..maxRedirects = original.maxRedirects
          ..persistentConnection = original.persistentConnection;

    Timer? watchdog;
    void rearm() {
      watchdog?.cancel();
      watchdog = Timer(timeout, () {
        if (!giveUp.isCompleted) giveUp.complete();
      });
    }

    // Our own abort surfaces as RequestAbortedException too; tell it apart
    // from flutter_map's, which must stay an abort.
    Never fail(Object error, StackTrace stack) {
      if (giveUp.isCompleted && !callerAborted()) {
        Error.throwWithStackTrace(TimeoutException('No answer from the tile server', timeout), stack);
      }
      Error.throwWithStackTrace(error, stack);
    }

    _inFlight++;
    rearm();
    try {
      final http.StreamedResponse response;
      try {
        response = await _inner.send(copy);
      } on Object catch (error, stack) {
        fail(error, stack);
      }
      final body = BytesBuilder(copy: false);
      try {
        await for (final chunk in response.stream) {
          rearm();
          body.add(chunk);
        }
      } on Object catch (error, stack) {
        fail(error, stack);
      }
      final bytes = body.takeBytes();
      return http.StreamedResponse(
        Stream.value(bytes),
        response.statusCode,
        contentLength: bytes.length,
        request: original,
        headers: response.headers,
        reasonPhrase: response.reasonPhrase,
      );
    } finally {
      watchdog?.cancel();
      _inFlight--;
    }
  }

  static bool _retryable(int status) => status == 408 || status == 425 || status == 429 || status >= 500;

  @override
  void close() => _inner.close();
}

/// A tile that could not be fetched from any server, after every retry.
///
/// Deliberately not an [http.ClientException]: flutter_map takes those whose
/// message mentions "closed" for a disposed map and shows nothing — no
/// error, no second try.
class TileLoadException implements Exception {
  TileLoadException(this.url, this.cause);

  final Uri url;
  final Object? cause;

  @override
  String toString() => 'Map tile $url failed: $cause';
}

/// Rewrites a tile URL from one `{z}/{x}/{y}` template to another: the same
/// tile from a different server.
class TileUrlFallback {
  TileUrlFallback({required String from, required this.to}) : _pattern = _compile(from);

  /// Template of the server to fall back to.
  final String to;
  final RegExp _pattern;

  /// The same tile on [to], or null when [url] does not fit the template.
  Uri? urlFor(Uri url) {
    final match = _pattern.firstMatch(url.toString());
    if (match == null || !const ['z', 'x', 'y'].every(match.groupNames.contains)) return null;
    return Uri.parse(
      to
          .replaceAll('{z}', match.namedGroup('z')!)
          .replaceAll('{x}', match.namedGroup('x')!)
          .replaceAll('{y}', match.namedGroup('y')!),
    );
  }

  static RegExp _compile(String template) {
    final source = StringBuffer('^');
    var rest = template;
    final seen = <String>{};
    for (var match = _placeholder.firstMatch(rest); match != null; match = _placeholder.firstMatch(rest)) {
      source.write(RegExp.escape(rest.substring(0, match.start)));
      final name = match.group(1)!;
      // Named groups must be unique; a repeated {z} just has to match again.
      final coordinate = (name == 'z' || name == 'x' || name == 'y') && seen.add(name);
      source.write(coordinate ? '(?<$name>\\d+)' : '[^/?#]*');
      rest = rest.substring(match.end);
    }
    source
      ..write(RegExp.escape(rest))
      ..write(r'$');
    return RegExp(source.toString());
  }

  static final _placeholder = RegExp('{([^{}]*)}');
}
