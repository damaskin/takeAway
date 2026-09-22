import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/providers.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/state_views.dart';
import '../auth/auth_service.dart';

class PersonalInfoScreen extends ConsumerStatefulWidget {
  const PersonalInfoScreen({super.key});

  @override
  ConsumerState<PersonalInfoScreen> createState() => _PersonalInfoScreenState();
}

class _PersonalInfoScreenState extends ConsumerState<PersonalInfoScreen> {
  final _form = GlobalKey<FormState>();
  late final TextEditingController _name;
  late final TextEditingController _email;
  late final TextEditingController _phone;
  DateTime? _birthday;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final user = ref.read(currentUserProvider);
    _name = TextEditingController(text: user?.name ?? '');
    _email = TextEditingController(text: user?.email ?? '');
    _phone = TextEditingController(text: user?.phone ?? '');
  }

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _pickBirthday() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _birthday ?? DateTime(now.year - 25),
      firstDate: DateTime(now.year - 100),
      lastDate: DateTime(now.year - 10),
      initialEntryMode: DatePickerEntryMode.calendarOnly,
    );
    if (picked != null) setState(() => _birthday = picked);
  }

  Future<void> _save() async {
    if (!_form.currentState!.validate()) return;
    final user = ref.read(currentUserProvider);
    final patch = <String, dynamic>{
      if (_name.text.trim() != (user?.name ?? '')) 'name': _name.text.trim(),
      if (_email.text.trim().isNotEmpty && _email.text.trim() != (user?.email ?? '')) 'email': _email.text.trim(),
      if (_phone.text.trim().isNotEmpty && _phone.text.trim() != (user?.phone ?? '')) 'phone': _phone.text.trim(),
      if (_birthday != null) 'dateOfBirth': DateFormat('yyyy-MM-dd').format(_birthday!),
    };
    if (patch.isEmpty) {
      await Navigator.of(context).maybePop();
      return;
    }
    setState(() => _saving = true);
    try {
      await ref.read(authServiceProvider).updateProfile(patch);
      unawaited(HapticFeedback.lightImpact());
      if (!mounted) return;
      Snack.show(context, AppLocalizations.of(context).personalSaved, icon: Icons.check_circle_rounded);
      await Navigator.of(context).maybePop();
    } on Object catch (error) {
      if (mounted) Snack.error(context, error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final locale = Localizations.localeOf(context).toLanguageTag();

    return Scaffold(
      appBar: AppBar(title: Text(l10n.profilePersonal)),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(
              controller: _name,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.name],
              decoration: InputDecoration(labelText: l10n.personalName),
              validator: (v) => (v ?? '').trim().isEmpty ? l10n.nameRequired : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _email,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              decoration: InputDecoration(labelText: l10n.personalEmail),
              validator: (v) {
                final value = (v ?? '').trim();
                if (value.isEmpty) return null;
                return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value) ? null : l10n.emailInvalid;
              },
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _phone,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              inputFormatters: [
                FilteringTextInputFormatter.allow(RegExp(r'[0-9+]')),
                LengthLimitingTextInputFormatter(16),
              ],
              decoration: InputDecoration(labelText: l10n.personalPhone, hintText: '+37377712345'),
              // Same rule as the API: E.164.
              validator: (v) {
                final value = (v ?? '').trim();
                if (value.isEmpty) return null;
                return RegExp(r'^\+[1-9]\d{6,14}$').hasMatch(value) ? null : l10n.phoneInvalid;
              },
            ),
            const SizedBox(height: 12),
            InkWell(
              borderRadius: BorderRadius.circular(Radii.input),
              onTap: _pickBirthday,
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: l10n.personalBirthday,
                  suffixIcon: const Icon(Icons.cake_outlined),
                ),
                child: Text(_birthday == null ? '—' : DateFormat.yMMMMd(locale).format(_birthday!)),
              ),
            ),
            const SizedBox(height: 24),
            PrimaryButton(label: l10n.save, loading: _saving, onPressed: _save),
          ],
        ),
      ),
    );
  }
}
