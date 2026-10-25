import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

export const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

/** Calendar/clock validity on top of the regex (rejects 2026-13-40T99:00Z, 2026-02-30...). */
export function isValidIsoInstant(value: unknown): boolean {
  if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value)) return false;
  if (Number.isNaN(Date.parse(value))) return false;
  const [y, mo, d, h, mi, s] = [
    value.slice(0, 4),
    value.slice(5, 7),
    value.slice(8, 10),
    value.slice(11, 13),
    value.slice(14, 16),
    value.length > 16 && value[16] === ':' ? value.slice(17, 19) : '0',
  ].map(Number);
  if (mo < 1 || mo > 12 || h > 23 || mi > 59 || s > 59) return false;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (d < 1 || d > daysInMonth) return false;
  const off = value.match(/([+-])(\d{2}):(\d{2})$/);
  if (off && (Number(off[2]) > 23 || Number(off[3]) > 59)) return false;
  return true;
}

function IsIsoInstant(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'isIsoInstant',
      target: target.constructor,
      propertyName: propertyName as string,
      options: { message: `${String(propertyName)} must be an ISO 8601 date-time with offset`, ...options },
      validator: { validate: (v: unknown) => isValidIsoInstant(v) },
    });
  };
}

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);

export class ChangeCheckoutDto {
  @IsString()
  @Matches(ISO_WITH_OFFSET)
  @IsIsoInstant()
  checkoutAt!: string;

  @Transform(trim)
  @IsString()
  @Length(1, 200)
  reason!: string;

  @IsInt()
  @Min(1)
  version!: number;
}

export class RescheduleCleaningDto {
  @IsString()
  @Matches(ISO_WITH_OFFSET)
  @IsIsoInstant()
  scheduledStartAt!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  reason?: string;

  @IsInt()
  @Min(1)
  version!: number;
}
