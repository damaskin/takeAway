import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// Last-known-good copies of catalog responses (stores, menus).
///
/// Only public, non-personal data goes here. The app renders the cached
/// copy immediately and replaces it when the network answers, which also
/// keeps the menu browsable offline — the same promise the PWA makes.
abstract interface class JsonCache {
  Future<Object?> read(String key);
  Future<void> write(String key, Object? json);
}

class FileJsonCache implements JsonCache {
  FileJsonCache._(this._dir);

  static Future<FileJsonCache> open() async {
    final base = await getApplicationCacheDirectory();
    final dir = Directory('${base.path}${Platform.pathSeparator}catalog');
    if (!dir.existsSync()) await dir.create(recursive: true);
    return FileJsonCache._(dir);
  }

  final Directory _dir;

  File _file(String key) =>
      File('${_dir.path}${Platform.pathSeparator}${key.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}.json');

  @override
  Future<Object?> read(String key) async {
    try {
      final file = _file(key);
      if (!file.existsSync()) return null;
      return jsonDecode(await file.readAsString());
    } on Object {
      return null;
    }
  }

  @override
  Future<void> write(String key, Object? json) async {
    try {
      final file = _file(key);
      final tmp = File('${file.path}.tmp');
      await tmp.writeAsString(jsonEncode(json), flush: true);
      await tmp.rename(file.path);
    } on Object {
      // A cache that cannot be written is just a cache miss next time.
    }
  }
}

class MemoryJsonCache implements JsonCache {
  final _store = <String, String>{};

  @override
  Future<Object?> read(String key) async {
    final raw = _store[key];
    return raw == null ? null : jsonDecode(raw);
  }

  @override
  Future<void> write(String key, Object? json) async => _store[key] = jsonEncode(json);
}
