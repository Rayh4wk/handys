import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { IsString } from 'class-validator';
import type { Response } from 'express';
import { Account, verifyCredentials } from './accounts';
import { CurrentUser } from './current-user.decorator';
import { Public } from './roles.decorator';
import { SESSION_COOKIE, getSessionSecret, signSession } from './session';

class LoginDto {
  @IsString() username!: string;
  @IsString() password!: string;
}

const view = (a: Account) => ({ username: a.username, displayName: a.displayName, role: a.role });
const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, path: '/' };

@Controller('auth')
export class AuthController {
  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const account = verifyCredentials(dto.username, dto.password);
    if (!account) throw new UnauthorizedException('INVALID_CREDENTIALS');
    res.cookie(SESSION_COOKIE, signSession(account.id, getSessionSecret()), cookieOpts);
    return view(account);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE, cookieOpts);
  }

  @Get('me')
  me(@CurrentUser() user: Account) {
    return view(user);
  }
}
