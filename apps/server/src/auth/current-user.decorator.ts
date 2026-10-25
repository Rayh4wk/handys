import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Account } from './accounts';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): Account => {
  return ctx.switchToHttp().getRequest().user as Account;
});
