import { SetMetadata } from '@nestjs/common';
import { Role } from './accounts';

export const ROLES_KEY = 'roles';
export const IS_PUBLIC_KEY = 'isPublic';

export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
