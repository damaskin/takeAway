import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:google_fonts/google_fonts.dart';

import 'tokens.dart';

/// Material 3 theme built from the takeAway design tokens.
///
/// Headings use Fraunces, UI and body use Inter, codes and timers use
/// JetBrains Mono — the same trio as the web apps.
abstract final class AppTheme {
  /// Google Fonts are fetched once and cached on device. Widget tests turn
  /// this off because they run without network.
  static bool useGoogleFonts = true;

  static ThemeData light({Color? accent}) => _build(Brightness.light, accent);

  static ThemeData dark({Color? accent}) => _build(Brightness.dark, accent);

  static TextStyle mono({double size = 16, FontWeight weight = FontWeight.w600, Color? color, double? letterSpacing}) {
    final base = TextStyle(
      fontSize: size,
      fontWeight: weight,
      color: color,
      letterSpacing: letterSpacing,
      fontFeatures: const [FontFeature.tabularFigures()],
    );
    return useGoogleFonts ? GoogleFonts.jetBrainsMono(textStyle: base) : base.copyWith(fontFamily: 'monospace');
  }

  static ThemeData _build(Brightness brightness, Color? accent) {
    final isDark = brightness == Brightness.dark;
    var brand = isDark ? BrandColors.dark : BrandColors.light;
    if (accent != null) brand = brand.copyWith(caramel: accent);

    final scheme = ColorScheme(
      brightness: brightness,
      primary: brand.caramel,
      onPrimary: Colors.white,
      primaryContainer: brand.caramelSoft,
      onPrimaryContainer: brand.textPrimary,
      secondary: brand.espresso,
      onSecondary: brand.cream,
      tertiary: brand.mint,
      onTertiary: Colors.white,
      error: brand.berry,
      onError: Colors.white,
      surface: brand.cream,
      onSurface: brand.textPrimary,
      onSurfaceVariant: brand.textSecondary,
      surfaceContainerLowest: brand.foam,
      surfaceContainerLow: brand.foam,
      surfaceContainer: brand.foam,
      surfaceContainerHigh: brand.latte,
      surfaceContainerHighest: brand.latte,
      outline: brand.border,
      outlineVariant: brand.borderLight,
      shadow: brand.shadow,
      inverseSurface: brand.espresso,
      onInverseSurface: brand.cream,
      surfaceTint: Colors.transparent,
    );

    final text = _textTheme(brand);

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: brand.cream,
      canvasColor: brand.cream,
      textTheme: text,
      extensions: [brand],
      splashFactory: InkSparkle.splashFactory,
      visualDensity: VisualDensity.standard,
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: {
          TargetPlatform.android: PredictiveBackPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
        },
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: brand.cream,
        foregroundColor: brand.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        titleTextStyle: text.titleLarge,
        systemOverlayStyle: isDark ? SystemUiOverlayStyle.light : SystemUiOverlayStyle.dark,
      ),
      cardTheme: CardThemeData(
        color: brand.foam,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Radii.card),
          side: BorderSide(color: brand.borderLight),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: brand.caramel,
          foregroundColor: Colors.white,
          disabledBackgroundColor: brand.caramel.withValues(alpha: 0.35),
          disabledForegroundColor: Colors.white.withValues(alpha: 0.8),
          minimumSize: const Size.fromHeight(54),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.button)),
          textStyle: text.labelLarge,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: brand.textPrimary,
          minimumSize: const Size.fromHeight(50),
          side: BorderSide(color: brand.border),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.button)),
          textStyle: text.labelLarge,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: brand.caramel, textStyle: text.labelLarge),
      ),
      iconButtonTheme: IconButtonThemeData(style: IconButton.styleFrom(foregroundColor: brand.textPrimary)),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: brand.foam,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        hintStyle: text.bodyMedium?.copyWith(color: brand.textTertiary),
        labelStyle: text.bodyMedium?.copyWith(color: brand.textSecondary),
        floatingLabelStyle: text.bodyMedium?.copyWith(color: brand.caramel),
        border: _inputBorder(brand.border),
        enabledBorder: _inputBorder(brand.border),
        focusedBorder: _inputBorder(brand.caramel, width: 1.5),
        errorBorder: _inputBorder(brand.berry),
        focusedErrorBorder: _inputBorder(brand.berry, width: 1.5),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: brand.foam,
        selectedColor: brand.caramel,
        disabledColor: brand.latte,
        side: BorderSide(color: brand.borderLight),
        shape: const StadiumBorder(),
        labelStyle: text.labelMedium,
        secondaryLabelStyle: text.labelMedium?.copyWith(color: Colors.white),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        showCheckmark: false,
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: brand.cream,
        surfaceTintColor: Colors.transparent,
        modalBackgroundColor: brand.cream,
        showDragHandle: true,
        dragHandleColor: brand.border,
        shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: brand.foam,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
        titleTextStyle: text.headlineSmall,
        contentTextStyle: text.bodyMedium?.copyWith(color: brand.textSecondary),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: isDark ? brand.latte : brand.espresso,
        contentTextStyle: text.bodyMedium?.copyWith(color: isDark ? brand.textPrimary : brand.cream),
        actionTextColor: brand.caramel,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.button)),
        elevation: 0,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: brand.foam,
        surfaceTintColor: Colors.transparent,
        indicatorColor: brand.caramelSoft,
        elevation: 0,
        height: 68,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => text.labelSmall?.copyWith(
            color: states.contains(WidgetState.selected) ? brand.caramel : brand.textTertiary,
            fontWeight: states.contains(WidgetState.selected) ? FontWeight.w700 : FontWeight.w500,
          ),
        ),
        iconTheme: WidgetStateProperty.resolveWith(
          (states) => IconThemeData(
            color: states.contains(WidgetState.selected) ? brand.caramel : brand.textTertiary,
            size: 24,
          ),
        ),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected) ? Colors.white : brand.textTertiary,
        ),
        trackColor: WidgetStateProperty.resolveWith(
          (states) => states.contains(WidgetState.selected) ? brand.caramel : brand.latte,
        ),
        trackOutlineColor: WidgetStateProperty.all(Colors.transparent),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: brand.caramel,
        linearTrackColor: brand.latte,
        circularTrackColor: brand.latte,
      ),
      dividerTheme: DividerThemeData(color: brand.borderLight, thickness: 1, space: 1),
      listTileTheme: ListTileThemeData(
        iconColor: brand.textSecondary,
        titleTextStyle: text.titleSmall,
        subtitleTextStyle: text.bodySmall?.copyWith(color: brand.textSecondary),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16),
      ),
      segmentedButtonTheme: SegmentedButtonThemeData(
        style: ButtonStyle(
          backgroundColor: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.selected) ? brand.caramel : brand.foam,
          ),
          foregroundColor: WidgetStateProperty.resolveWith(
            (states) => states.contains(WidgetState.selected) ? Colors.white : brand.textPrimary,
          ),
          side: WidgetStateProperty.all(BorderSide(color: brand.border)),
          textStyle: WidgetStateProperty.all(text.labelMedium),
        ),
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(color: brand.espresso, borderRadius: BorderRadius.circular(8)),
        textStyle: text.bodySmall?.copyWith(color: brand.cream),
      ),
    );
  }

  static OutlineInputBorder _inputBorder(Color color, {double width = 1}) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(Radii.input),
    borderSide: BorderSide(color: color, width: width),
  );

  static TextTheme _textTheme(BrandColors brand) {
    TextStyle display(double size, double height, FontWeight weight) {
      final style = TextStyle(
        fontSize: size,
        height: height / size,
        fontWeight: weight,
        color: brand.textPrimary,
        letterSpacing: -0.2,
      );
      return useGoogleFonts ? GoogleFonts.fraunces(textStyle: style) : style;
    }

    TextStyle ui(double size, double height, FontWeight weight, {Color? color, double letterSpacing = 0}) {
      final style = TextStyle(
        fontSize: size,
        height: height / size,
        fontWeight: weight,
        color: color ?? brand.textPrimary,
        letterSpacing: letterSpacing,
      );
      return useGoogleFonts ? GoogleFonts.inter(textStyle: style) : style;
    }

    return TextTheme(
      displayLarge: display(40, 48, FontWeight.w700),
      displayMedium: display(32, 40, FontWeight.w700),
      displaySmall: display(28, 36, FontWeight.w600),
      headlineLarge: display(26, 32, FontWeight.w700),
      headlineMedium: display(22, 28, FontWeight.w600),
      headlineSmall: display(20, 26, FontWeight.w600),
      titleLarge: ui(18, 24, FontWeight.w600),
      titleMedium: ui(16, 22, FontWeight.w600),
      titleSmall: ui(14, 20, FontWeight.w600),
      bodyLarge: ui(16, 24, FontWeight.w400),
      bodyMedium: ui(14, 20, FontWeight.w400),
      bodySmall: ui(12, 16, FontWeight.w400, color: brand.textSecondary),
      labelLarge: ui(15, 20, FontWeight.w600, letterSpacing: 0.1),
      labelMedium: ui(13, 16, FontWeight.w500),
      labelSmall: ui(11, 14, FontWeight.w500, letterSpacing: 0.2),
    );
  }
}
