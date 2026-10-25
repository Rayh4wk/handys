import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role, findAccountById } from './accounts';
import { IS_PUBLIC_KEY, ROLES_KEY } from './roles.decorator';
import { SESSION_COOKIE, getSessionSecret, verifySession } from './session';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const req = context.switchToHttp().getRequest();
    const id = verifySession(req.cookies?.[SESSION_COOKIE], getSessionSecret());
    const account = id ? findAccountById(id) : undefined;
    if (!account) throw new UnauthorizedException();
    req.user = account;

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, targets);
    if (roles && roles.length > 0 && !roles.includes(account.role)) {
      throw new ForbiddenException('FORBIDDEN_ROLE');
    }
    return true;
  }
}
