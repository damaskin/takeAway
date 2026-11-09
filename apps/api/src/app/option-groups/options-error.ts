import { BadRequestException } from '@nestjs/common';
import type { OptionPickError, OptionPickErrorCode, OptionsErrorBody } from '@takeaway/shared-types';

/** What an older client shows as-is: it cannot pick a variant, so it has to be updated. */
const REQUIRED_MESSAGE = 'Обновите приложение, чтобы выбрать вариант';

/** Short Russian wording of the first problem, for clients that show `message` as-is. */
const INVALID_MESSAGES: Record<OptionPickErrorCode, string> = {
  UNKNOWN_OPTION: 'Такого выбора у товара нет',
  OPTION_UNAVAILABLE: 'Части выбранного сейчас нет в наличии',
  HIDDEN_GROUP: 'Выбор не подходит к этому варианту',
  BAD_QTY: 'Неверное количество',
  TOO_FEW: 'Выберите вариант',
  TOO_MANY: 'Выбрано слишком много',
};

/**
 * The 400 of the cart for a product with catalog groups (`OptionsErrorBody`):
 * `OPTIONS_REQUIRED` when the request carried no choice and the defaults are
 * not one, `OPTIONS_INVALID` when the choice breaks a rule.
 */
export function optionsError(code: OptionsErrorBody['code'], errors: OptionPickError[]): BadRequestException {
  const first = errors[0];
  const message = code === 'OPTIONS_REQUIRED' || !first ? REQUIRED_MESSAGE : INVALID_MESSAGES[first.code];
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code,
    message,
    errors,
  } satisfies OptionsErrorBody);
}
