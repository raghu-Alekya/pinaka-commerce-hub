import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { PosAuthService } from '../pos-auth/services/pos-auth.service';

interface PosCatalogRequest {
  headers?: Record<string, string | string[] | undefined>;
  user?: {
    id?: string;
    merchantId?: string;
    storeId?: string;
    role?: string;
  };
}

function headerValue(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value || '').trim();
}

@Injectable()
export class PosEmployeeCatalogGuard implements CanActivate {
  constructor(
    @Inject(PosAuthService)
    private readonly posAuthService: PosAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PosCatalogRequest>();
    request.user = await this.posAuthService.authorizeEmployeeStore(
      headerValue(request.headers?.authorization),
      headerValue(request.headers?.['x-merchant-id']),
      headerValue(request.headers?.['x-store-id']),
    );
    return true;
  }
}
