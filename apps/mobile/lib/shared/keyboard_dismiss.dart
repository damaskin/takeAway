import 'package:flutter/gestures.dart';
import 'package:flutter/widgets.dart';

/// Closes the keyboard when the customer taps anywhere outside the focused
/// text field — empty space, a button, a chip, another part of a sheet.
///
/// Flutter only does this on desktop: on phones a touch outside a field is
/// ignored, so the keyboard stayed up over the form until the customer found
/// a "done" key. Every text field asks the enclosing [Actions] what to do
/// with a tap outside it, so one override here covers every form, sheet and
/// dialog in the app.
///
/// A touch that turns into a scroll does not count: the field unfocuses on
/// the finger lifting close to where it went down, not on the finger
/// landing, so scrolling a form with the keyboard up still works.
class DismissKeyboardOnTapOutside extends StatefulWidget {
  const DismissKeyboardOnTapOutside({required this.child, super.key});

  final Widget child;

  @override
  State<DismissKeyboardOnTapOutside> createState() => _DismissKeyboardOnTapOutsideState();
}

class _DismissKeyboardOnTapOutsideState extends State<DismissKeyboardOnTapOutside> {
  /// Where the current touch outside the field went down, by pointer.
  final _downs = <int, Offset>{};

  void _onDown(EditableTextTapOutsideIntent intent) {
    final event = intent.pointerDownEvent;
    // A mouse or stylus click has no scroll to confuse it with.
    if (event.kind != PointerDeviceKind.touch) {
      _unfocus(intent.focusNode);
      return;
    }
    _downs[event.pointer] = event.position;
  }

  void _onUp(EditableTextTapUpOutsideIntent intent) {
    final event = intent.pointerUpEvent;
    final down = _downs.remove(event.pointer);
    if (down == null) return;
    if ((event.position - down).distance > kTouchSlop) return;
    _unfocus(intent.focusNode);
  }

  void _unfocus(FocusNode node) {
    if (node.hasFocus) node.unfocus();
  }

  @override
  Widget build(BuildContext context) {
    return Actions(
      actions: {
        EditableTextTapOutsideIntent: CallbackAction<EditableTextTapOutsideIntent>(
          onInvoke: (intent) {
            _onDown(intent);
            return null;
          },
        ),
        EditableTextTapUpOutsideIntent: CallbackAction<EditableTextTapUpOutsideIntent>(
          onInvoke: (intent) {
            _onUp(intent);
            return null;
          },
        ),
      },
      child: widget.child,
    );
  }
}
