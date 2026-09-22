import 'package:flutter/material.dart';

/// Design tokens — the same values as `libs/ui-kit/src/lib/design-tokens.css`,
/// so the app, the web and the Mini App read as one brand.
abstract final class Palette {
  static const caramel = Color(0xFFC77D3B);
  static const caramelHover = Color(0xFFB56D2B);
  static const mint = Color(0xFF7BC4A4);
  static const berry = Color(0xFFD94B5E);
  static const amber = Color(0xFFE9A84B);

  static const catCoffee = Color(0xFFC77D3B);
  static const catTea = Color(0xFF9DB87E);
  static const catSignature = Color(0xFF8E5FB0);
  static const catBreakfast = Color(0xFFF5C95C);
  static const catLunch = Color(0xFFC86A4B);
  static const catDesserts = Color(0xFFE8A0B4);
}

abstract final class Radii {
  static const card = 20.0;
  static const button = 14.0;
  static const input = 12.0;
  static const pill = 999.0;
}

abstract final class Gaps {
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 12.0;
  static const base = 16.0;
  static const lg = 24.0;
  static const xl = 32.0;
  static const xxl = 48.0;
}

abstract final class Motion {
  static const fast = Duration(milliseconds: 150);
  static const medium = Duration(milliseconds: 260);
  static const slow = Duration(milliseconds: 420);
  static const emphasized = Cubic(0.2, 0, 0, 1);
  static const decelerate = Curves.easeOutCubic;
}

/// Semantic colours that do not fit Material's [ColorScheme] one-to-one.
@immutable
class BrandColors extends ThemeExtension<BrandColors> {
  const BrandColors({
    required this.cream,
    required this.foam,
    required this.latte,
    required this.espresso,
    required this.caramel,
    required this.caramelSoft,
    required this.mint,
    required this.berry,
    required this.amber,
    required this.border,
    required this.borderLight,
    required this.textPrimary,
    required this.textSecondary,
    required this.textTertiary,
    required this.shadow,
  });

  final Color cream;
  final Color foam;
  final Color latte;
  final Color espresso;
  final Color caramel;
  final Color caramelSoft;
  final Color mint;
  final Color berry;
  final Color amber;
  final Color border;
  final Color borderLight;
  final Color textPrimary;
  final Color textSecondary;
  final Color textTertiary;
  final Color shadow;

  static const light = BrandColors(
    cream: Color(0xFFF8F3EB),
    foam: Color(0xFFFFFFFF),
    latte: Color(0xFFE8DDCB),
    espresso: Color(0xFF1A1414),
    caramel: Palette.caramel,
    caramelSoft: Color(0x20C77D3B),
    mint: Palette.mint,
    berry: Palette.berry,
    amber: Palette.amber,
    border: Color(0xFFE0D5C7),
    borderLight: Color(0xFFF0E8DC),
    textPrimary: Color(0xFF1A1414),
    textSecondary: Color(0xFF6B5E54),
    textTertiary: Color(0xFF9B8E84),
    shadow: Color(0x0F1A1414),
  );

  static const dark = BrandColors(
    cream: Color(0xFF0E0B0A),
    foam: Color(0xFF1C1817),
    latte: Color(0xFF2A2523),
    espresso: Color(0xFFF8F3EB),
    caramel: Palette.caramel,
    caramelSoft: Color(0x30C77D3B),
    mint: Palette.mint,
    berry: Palette.berry,
    amber: Palette.amber,
    border: Color(0xFF3A3430),
    borderLight: Color(0xFF2A2523),
    textPrimary: Color(0xFFF8F3EB),
    textSecondary: Color(0xFFA89B91),
    textTertiary: Color(0xFF7A6E64),
    shadow: Color(0x40000000),
  );

  List<BoxShadow> get softShadow => [BoxShadow(color: shadow, blurRadius: 20, offset: const Offset(0, 6))];

  List<BoxShadow> get liftedShadow => [
    BoxShadow(
      color: shadow.withValues(alpha: shadow.a * 1.6),
      blurRadius: 32,
      offset: const Offset(0, 12),
    ),
  ];

  /// Busy-meter colour: calm below 40 %, warm to 75 %, hot above.
  Color busy(int meter) {
    if (meter >= 75) return berry;
    if (meter >= 40) return amber;
    return mint;
  }

  @override
  BrandColors copyWith({Color? caramel}) => BrandColors(
    cream: cream,
    foam: foam,
    latte: latte,
    espresso: espresso,
    caramel: caramel ?? this.caramel,
    caramelSoft: (caramel ?? this.caramel).withValues(alpha: caramelSoft.a),
    mint: mint,
    berry: berry,
    amber: amber,
    border: border,
    borderLight: borderLight,
    textPrimary: textPrimary,
    textSecondary: textSecondary,
    textTertiary: textTertiary,
    shadow: shadow,
  );

  @override
  BrandColors lerp(covariant BrandColors? other, double t) {
    if (other == null) return this;
    return BrandColors(
      cream: Color.lerp(cream, other.cream, t)!,
      foam: Color.lerp(foam, other.foam, t)!,
      latte: Color.lerp(latte, other.latte, t)!,
      espresso: Color.lerp(espresso, other.espresso, t)!,
      caramel: Color.lerp(caramel, other.caramel, t)!,
      caramelSoft: Color.lerp(caramelSoft, other.caramelSoft, t)!,
      mint: Color.lerp(mint, other.mint, t)!,
      berry: Color.lerp(berry, other.berry, t)!,
      amber: Color.lerp(amber, other.amber, t)!,
      border: Color.lerp(border, other.border, t)!,
      borderLight: Color.lerp(borderLight, other.borderLight, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      textTertiary: Color.lerp(textTertiary, other.textTertiary, t)!,
      shadow: Color.lerp(shadow, other.shadow, t)!,
    );
  }
}

extension BrandThemeContext on BuildContext {
  BrandColors get brand => Theme.of(this).extension<BrandColors>()!;
  TextTheme get text => Theme.of(this).textTheme;
}
