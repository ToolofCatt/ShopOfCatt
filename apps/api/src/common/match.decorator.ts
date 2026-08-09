import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { K } from '../i18n/messages';

/**
 * Kiểm tra giá trị của trường này phải trùng với một trường khác trong cùng DTO.
 * Ví dụ: @Match('password', { message: K.confirmMismatch })
 */
export function Match(property: string, options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'match',
      target: object.constructor,
      propertyName,
      constraints: [property],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const [relatedPropertyName] = args.constraints as [string];
          const relatedValue = (args.object as Record<string, unknown>)[
            relatedPropertyName
          ];
          return value === relatedValue;
        },
        defaultMessage(args: ValidationArguments): string {
          const [relatedPropertyName] = args.constraints as [string];
          return `${args.property} phải trùng với ${relatedPropertyName}`;
        },
      },
    });
  };
}
