import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** 标记接口为公开访问, 跳过 JWT 认证 (如登录接口) */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
