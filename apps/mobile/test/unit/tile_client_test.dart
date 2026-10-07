import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/widgets.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:takeaway_mobile/core/network/tile_client.dart';

const _primary = 'https://takeaway.md/tiles/{z}/{x}/{y}.png';
const _osm = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
final _tile = Uri.parse('https://takeaway.md/tiles/16/38160/23093.png');
final _osmTile = Uri.parse('https://tile.openstreetmap.org/16/38160/23093.png');

/// A 1×1 PNG, as a tile server would send.
final _png = Uint8List.fromList(TileProvider.transparentImage);

/// One scripted answer: a status code, an error to throw, or silence.
typedef _Answer = Object;

const _silence = #silence;

/// Plays [answers] in order and records what was asked. Honours the abort
/// trigger the way package:http's IOClient does.
class _FakeServer extends http.BaseClient {
  _FakeServer(this.answers);

  final List<_Answer> answers;
  final requests = <Uri>[];
  var aborts = 0;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    requests.add(request.url);
    final answer = answers.isEmpty ? 200 : answers.removeAt(0);
    final done = Completer<http.StreamedResponse>();
    if (request case http.Abortable(:final abortTrigger?)) {
      abortTrigger.whenComplete(() {
        if (done.isCompleted) return;
        aborts++;
        done.completeError(http.RequestAbortedException(request.url));
      });
    }
    switch (answer) {
      case final int status:
        done.complete(http.StreamedResponse(Stream.value(status == 200 ? _png : <int>[]), status, request: request));
      case _silence:
        break;
      default:
        scheduleMicrotask(() {
          if (!done.isCompleted) done.completeError(answer);
        });
    }
    return done.future;
  }
}

TileClient _client(_FakeServer server, {bool fallback = true}) => TileClient(
  inner: server,
  fallback: fallback ? TileUrlFallback(from: _primary, to: _osm) : null,
  timeout: const Duration(milliseconds: 50),
  retryDelays: const [Duration.zero, Duration.zero, Duration.zero],
);

void main() {
  final dropped = http.ClientException('Connection closed before full header was received', _tile);

  group('TileClient', () {
    test('rides out a dropped connection', () async {
      final server = _FakeServer([dropped, 200]);
      final response = await _client(server).get(_tile);
      expect(response.statusCode, 200);
      expect(response.bodyBytes, _png);
      expect(server.requests, [_tile, _tile]);
    });

    test('retries 5xx and 429', () async {
      final server = _FakeServer([503, 429, 200]);
      final response = await _client(server, fallback: false).get(_tile);
      expect(response.statusCode, 200);
      expect(server.requests, hasLength(3));
    });

    test('asks OpenStreetMap when the proxy keeps failing', () async {
      final server = _FakeServer([502, dropped, 200]);
      final response = await _client(server).get(_tile);
      expect(response.statusCode, 200);
      expect(server.requests, [_tile, _tile, _osmTile]);
    });

    test('goes straight to the fallback, without a pause, when the proxy has no such tile', () async {
      final server = _FakeServer([404, 200]);
      final client = TileClient(
        inner: server,
        fallback: TileUrlFallback(from: _primary, to: _osm),
        retryDelays: const [Duration(minutes: 1), Duration(minutes: 1), Duration(minutes: 1)],
      );
      final response = await client.get(_tile).timeout(const Duration(seconds: 5));
      expect(response.statusCode, 200);
      expect(server.requests, [_tile, _osmTile]);
    });

    test('hands back a refusal when there is nowhere else to ask', () async {
      final server = _FakeServer([404]);
      final response = await _client(server, fallback: false).get(_tile);
      expect(response.statusCode, 404);
      expect(server.requests, hasLength(1));
    });

    test('gives up a silent server after the timeout, aborting the request', () async {
      final server = _FakeServer([_silence, 200]);
      final response = await _client(server).get(_tile);
      expect(response.statusCode, 200);
      expect(server.aborts, 1);
    });

    test('reports a lost cause as TileLoadException, never as a "closed" ClientException', () async {
      final server = _FakeServer([dropped, dropped, dropped, dropped]);
      await expectLater(
        _client(server).get(_tile),
        throwsA(isA<TileLoadException>().having((e) => e, 'is ClientException', isNot(isA<http.ClientException>()))),
      );
      expect(server.requests, hasLength(4));
    });

    test('an abort by the map is passed through and not retried', () async {
      final server = _FakeServer([_silence, 200]);
      final cancel = Completer<void>();
      final request = http.AbortableRequest('GET', _tile, abortTrigger: cancel.future);
      final sent = _client(server).send(request);
      cancel.complete();
      await expectLater(sent, throwsA(isA<http.RequestAbortedException>()));
      expect(server.requests, hasLength(1));
    });

    test('counts requests on the wire', () async {
      final server = _FakeServer([_silence]);
      final client = TileClient(inner: server, timeout: const Duration(seconds: 5), retryDelays: const []);
      final cancel = Completer<void>();
      final sent = client.send(http.AbortableRequest('GET', _tile, abortTrigger: cancel.future));
      await pumpEventQueue();
      expect(client.inFlight, 1);
      cancel.complete();
      await expectLater(sent, throwsA(isA<http.RequestAbortedException>()));
      expect(client.inFlight, 0);
    });
  });

  group('TileUrlFallback', () {
    test('maps a tile to the same tile on another server', () {
      expect(TileUrlFallback(from: _primary, to: _osm).urlFor(_tile), _osmTile);
    });

    test('leaves URLs of another shape alone', () {
      final fallback = TileUrlFallback(from: _primary, to: _osm);
      expect(fallback.urlFor(Uri.parse('https://takeaway.md/api/stores')), isNull);
      expect(fallback.urlFor(Uri.parse('https://evil.example/tiles/1/2/3.png')), isNull);
    });

    test('copes with other placeholders', () {
      final fallback = TileUrlFallback(from: 'https://{s}.tiles.example/{z}/{x}/{y}{r}.png?key=k', to: _osm);
      expect(
        fallback.urlFor(Uri.parse('https://a.tiles.example/3/4/5@2x.png?key=k')),
        Uri.parse('https://tile.openstreetmap.org/3/4/5.png'),
      );
    });
  });

  group('with flutter_map', () {
    TestWidgetsFlutterBinding.ensureInitialized();

    /// What a tile layer gets for one tile: its image, or the error.
    Future<Object> load(http.Client client) {
      final provider = NetworkTileProvider(httpClient: client, cachingProvider: const DisabledMapCachingProvider());
      final layer = TileLayer(urlTemplate: _primary, tileProvider: provider);
      final image = provider.getImageWithCancelLoadingSupport(
        const TileCoordinates(38160, 23093, 16),
        layer,
        Completer<void>().future,
      );
      final result = Completer<Object>();
      image
          .resolve(ImageConfiguration.empty)
          .addListener(ImageStreamListener((info, _) => result.complete(info), onError: (e, _) => result.complete(e)));
      return result.future;
    }

    testWidgets('a dropped connection is a failed tile, not a blank "loaded" one', (tester) async {
      // flutter_map's own client turns this into a 1×1 transparent image
      // reported as success: the gap stays forever, with nothing in the log.
      final result = await tester.runAsync(() => load(_client(_FakeServer([dropped, dropped, dropped, dropped]))));
      expect(result, isA<TileLoadException>());
    });

    testWidgets('a dropped connection that recovers draws the tile', (tester) async {
      final result = await tester.runAsync(() => load(_client(_FakeServer([dropped, 200]))));
      expect(result, isA<ImageInfo>());
    });
  });
}
